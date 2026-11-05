export type FilenameSearchMatcher = {
  caseSensitive: boolean
  includeGlob?: string
  keyword: string
  wholeWord: boolean
}

export type FilenameSearchResult<T> = {
  image: T
  score: number
}

function normalizeText(value: string, caseSensitive: boolean) {
  return caseSensitive ? value : value.toLowerCase()
}

function getStem(basename: string) {
  const dotIndex = basename.lastIndexOf('.')
  return dotIndex > 0 ? basename.slice(0, dotIndex) : basename
}

function isBoundaryCharacter(char: string | undefined) {
  return !char || /[^a-z0-9]/i.test(char)
}

function scoreContainedMatch(text: string, keyword: string) {
  const index = text.indexOf(keyword)
  if (index === -1)
    return 0

  const startBoundary = isBoundaryCharacter(text[index - 1])
  const endBoundary = isBoundaryCharacter(text[index + keyword.length])
  const boundaryBonus = startBoundary && endBoundary ? 60 : startBoundary || endBoundary ? 30 : 0
  return 620 - index * 4 + boundaryBonus
}

export function scoreFilenameMatch(
  basename: string,
  keyword: string,
  caseSensitive = false,
  wholeWord = false,
) {
  const trimmedKeyword = keyword.trim()
  if (!trimmedKeyword)
    return 0

  const normalizedKeyword = normalizeText(trimmedKeyword, caseSensitive)
  const normalizedBasename = normalizeText(basename, caseSensitive)
  const normalizedStem = normalizeText(getStem(basename), caseSensitive)

  if (wholeWord) {
    if (normalizedBasename === normalizedKeyword)
      return 1200
    if (normalizedStem === normalizedKeyword)
      return 1180
    return 0
  }

  if (normalizedStem === normalizedKeyword)
    return 1100
  if (normalizedBasename === normalizedKeyword)
    return 1080
  if (normalizedStem.startsWith(normalizedKeyword))
    return 960 - normalizedStem.length * 0.01
  if (normalizedBasename.startsWith(normalizedKeyword))
    return 920 - normalizedBasename.length * 0.01

  return Math.max(
    scoreContainedMatch(normalizedStem, normalizedKeyword),
    scoreContainedMatch(normalizedBasename, normalizedKeyword) - 20,
  )
}

export function buildFilenameSearchMatcher(matcher: FilenameSearchMatcher) {
  return {
    ...matcher,
    keyword: matcher.keyword.trim(),
  }
}

export function filterImagesByFilename<T extends { basename: string, path: string }>(
  images: T[],
  matcher: FilenameSearchMatcher,
) {
  if (!matcher.keyword.trim())
    return [] as FilenameSearchResult<T>[]

  return images
    .map((image) => {
      const score = scoreFilenameMatch(
        image.basename,
        matcher.keyword,
        matcher.caseSensitive,
        matcher.wholeWord,
      )
      return {
        image,
        score,
      }
    })
    .filter(item => item.score > 0)
    .sort((a, b) => (
      b.score - a.score
      || a.image.basename.localeCompare(b.image.basename)
      || a.image.path.localeCompare(b.image.path)
    ))
}
