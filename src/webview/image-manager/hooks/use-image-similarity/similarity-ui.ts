import type { SimilarityAlgorithm, SimilaritySliceStrategy } from '~/core/analysis/similarity-common'
import {
  getSimilarityAlgorithmProfile,
  getSimilarityUiDefaultThreshold,
  normalizeSimilarityMaxResults,
  normalizeSimilarityThreshold,
} from '~/core/analysis/similarity-common'

export type SimilarityScope = 'all' | 'same-level'

export type SimilarityOptions = {
  algorithm?: SimilarityAlgorithm
  maxResults?: number
  scope?: SimilarityScope
  sliceStrategy?: SimilaritySliceStrategy
  threshold?: number
}

export type ResolvedSimilarityOptions = {
  algorithm: SimilarityAlgorithm
  maxResults: number
  scope: SimilarityScope
  sliceStrategy: SimilaritySliceStrategy
  threshold?: number
}

type SimilarityImageLike = {
  absDirPath?: string
  path: string
}

export function getSimilaritySearchLaunch<T extends SimilarityImageLike>(
  scope: SimilarityScope,
  collections: {
    sameLevelImages?: T[]
    sameWorkspaceImages?: T[]
  },
) {
  return {
    options: { scope } as const,
    scopeImages: collections.sameWorkspaceImages?.length
      ? collections.sameWorkspaceImages
      : (collections.sameLevelImages || []),
  }
}

export function getSimilarityResultContextMenuEnable() {
  return {
    compress: true,
    crop: true,
    delete: true,
    edit: true,
    find_similar_in_all: false,
    find_similar_in_same_level: false,
    format_conversion: true,
    rename: true,
    reveal_in_viewer: true,
  }
}

export function resolveSimilarityOptions(options: SimilarityOptions = {}): ResolvedSimilarityOptions {
  const algorithm = options.algorithm || 'hybrid'
  const fallbackThreshold = getSimilarityUiDefaultThreshold(algorithm)
  return {
    algorithm,
    maxResults: normalizeSimilarityMaxResults(options.maxResults),
    scope: options.scope || 'all',
    sliceStrategy: options.sliceStrategy || 'first',
    threshold: normalizeSimilarityThreshold(algorithm, options.threshold ?? fallbackThreshold),
  }
}

export function getSimilarityAutoPlaceholder(algorithm: SimilarityAlgorithm) {
  return String(getSimilarityAlgorithmProfile(algorithm).threshold.defaultValue)
}

export function getSimilarityCandidateImages<T extends SimilarityImageLike>(
  image: T,
  images: T[] | undefined,
  options: Pick<ResolvedSimilarityOptions, 'scope'>,
) {
  const seen = new Set<string>()
  const scopedImages = options.scope === 'same-level'
    ? (images || []).filter(item => item.absDirPath === image.absDirPath)
    : (images || [])

  return scopedImages.filter((item) => {
    if (item.path === image.path || seen.has(item.path))
      return false
    seen.add(item.path)
    return true
  })
}

export function showOrUpdateSimilarityModal<TProps, THandle>(
  driver: {
    isOpened: () => boolean
    showModal: (props: TProps) => THandle
    updateModal: (props: TProps) => THandle | undefined
  },
  props: TProps,
) {
  if (driver.isOpened()) {
    const updated = driver.updateModal(props)
    if (updated)
      return updated
  }
  return driver.showModal(props)
}
