import type { CustomFormatConfig, CustomImageDecodeOptions, CustomImagePreset } from '~/core/custom-format/types'

export const CUSTOM_FORMAT_LAYOUT_OPTIONS = ['HW', 'HWC', 'CHW', 'BHW', 'BCHW', 'BHWC', 'BHWI'] as const
export const CUSTOM_FORMAT_EXTS = new Set(['npy', 'raw', 'dat', 'bin'])
export const RAW_LIKE_EXTS = new Set(['raw', 'dat', 'bin'])

export type CustomFormatProbeLike = {
  pageCount?: number
  shape?: number[]
}

export type CustomFormatSessionState = {
  channelIndex?: number
  channelMode?: CustomImageDecodeOptions['channelMode']
  channels?: number
  dtype?: CustomImageDecodeOptions['dtype']
  endian?: CustomImageDecodeOptions['endian']
  height?: number
  layout?: string
  layoutLocked?: boolean
  normalizeMax?: number
  normalizeMin?: number
  offset?: number
  pageIndex?: number
  pages?: number
  width?: number
}

export function normalizeCustomFormatExt(extname: string | undefined) {
  return (extname || '').trim().replace(/^\./, '').toLowerCase()
}

export function isCustomFormatImage(image: Pick<ImageType, 'extname'> | undefined) {
  return CUSTOM_FORMAT_EXTS.has(normalizeCustomFormatExt(image?.extname))
}

export function resolveCustomFormatPresetForImage(
  config: Partial<CustomFormatConfig> | undefined,
  image: Pick<ImageType, 'absDirPath' | 'dirPath' | 'extname' | 'path'> | undefined,
): CustomImagePreset | undefined {
  if (!image)
    return undefined
  const ext = normalizeCustomFormatExt(image.extname)
  const dirPath = normalizePath(image.absDirPath || image.dirPath || dirnameOf(image.path || ''))
  const folderPreset = Object.entries(config?.folderPresets || {})
    .map(([folderPath, preset]) => [normalizePath(folderPath), preset] as const)
    .filter(([folderPath, preset]) => {
      const presetExts = preset.extensions?.map(normalizeCustomFormatExt).filter(Boolean) || []
      return (dirPath === folderPath || dirPath.startsWith(`${folderPath}/`))
        && (!presetExts.length || presetExts.includes(ext))
    })
    .sort((a, b) => b[0].length - a[0].length)[0]?.[1]
  if (folderPreset)
    return folderPreset
  const extensionPreset = (config?.extensionPresets || {})[ext]
  if (extensionPreset)
    return extensionPreset
  const extensionEntry = Object.values(config?.extensionPresets || {}).find((preset) => {
    return (preset.extensions || []).map(normalizeCustomFormatExt).includes(ext)
  })
  if (extensionEntry)
    return extensionEntry
  if (isCustomFormatImage(image)) {
    return {
      extensions: [ext],
      kind: ext === 'npy' ? 'npy' : 'raw',
    }
  }
  return undefined
}

export function isCustomFormatImageWithConfig(
  image: Pick<ImageType, 'absDirPath' | 'dirPath' | 'extname' | 'path'> | undefined,
  config?: Partial<CustomFormatConfig>,
) {
  return !!resolveCustomFormatPresetForImage(config, image)
}

export function isNpyImage(
  image: Pick<ImageType, 'absDirPath' | 'dirPath' | 'extname' | 'path'> | undefined,
  config?: Partial<CustomFormatConfig>,
) {
  return resolveCustomFormatPresetForImage(config, image)?.kind === 'npy'
}

export function isRawLikeImage(
  image: Pick<ImageType, 'absDirPath' | 'dirPath' | 'extname' | 'path'> | undefined,
  config?: Partial<CustomFormatConfig>,
) {
  return resolveCustomFormatPresetForImage(config, image)?.kind === 'raw'
}

export function getCustomFormatLayoutOptionsForRank(rank: number | undefined) {
  if (!rank || !Number.isFinite(rank))
    return [...CUSTOM_FORMAT_LAYOUT_OPTIONS]
  return CUSTOM_FORMAT_LAYOUT_OPTIONS.filter(layout => layout.length === rank)
}

export function isCustomFormatLayoutCompatibleWithRank(layout: string | undefined, rank: number | undefined) {
  const normalized = normalizeCustomFormatLayout(layout)
  if (!normalized.valid || !normalized.layout)
    return false
  if (!rank || !Number.isFinite(rank))
    return true
  return normalized.layout.length === rank
}

function isChannelDim(value: number | undefined) {
  return value === 3 || value === 4
}

export function guessNpyLayoutForShape(shape: number[] | undefined, previousLayout?: string) {
  const rank = shape?.length || 0
  if (rank === 2)
    return 'HW'
  if (rank === 3) {
    if (isChannelDim(shape?.[2]))
      return 'HWC'
    if (isChannelDim(shape?.[0]))
      return 'CHW'
    return 'BHW'
  }
  if (rank === 4) {
    if (isChannelDim(shape?.[1]))
      return 'BCHW'
    if (isChannelDim(shape?.[3]))
      return 'BHWC'
    return 'BHWI'
  }
  return isCustomFormatLayoutCompatibleWithRank(previousLayout, rank)
    ? normalizeCustomFormatLayout(previousLayout).layout
    : undefined
}

export function getCustomFormatScopeKey(image: Pick<ImageType, 'absDirPath' | 'dirPath' | 'extname' | 'path'> | undefined) {
  const dir = image?.absDirPath || image?.dirPath || dirnameOf(image?.path || '') || '__unknown__'
  const ext = normalizeCustomFormatExt(image?.extname)
  return `${normalizePath(dir)}::${ext}`
}

export function normalizeCustomFormatLayout(value: string | undefined): {
  error?: string
  layout: string
  valid: boolean
} {
  const layout = String(value || '').toUpperCase().replace(/[^BCHWI]/g, '')
  if (!layout) {
    return { layout: '', valid: true }
  }
  if (/[^\sBCHWI_-]/i.test(String(value || ''))) {
    return {
      error: 'Layout must use only B/C/H/W/I axes',
      layout,
      valid: false,
    }
  }
  if (!layout.includes('H') || !layout.includes('W')) {
    return {
      error: 'Layout must include H and W axes',
      layout,
      valid: false,
    }
  }
  const uniqueAxes = new Set(layout.replace(/I/g, '').split(''))
  if (uniqueAxes.size !== layout.replace(/I/g, '').length) {
    return {
      error: 'Layout axes cannot repeat except I',
      layout,
      valid: false,
    }
  }
  return { layout, valid: true }
}

export function clampPageIndex(pageIndex: number | undefined, pageCount: number | undefined) {
  const max = Math.max(1, Math.floor(pageCount || 1))
  const next = Math.floor(Number(pageIndex || 0))
  if (!Number.isFinite(next))
    return 0
  return Math.max(0, Math.min(max - 1, next))
}

export function buildCustomFormatDecodeOptions(
  session: CustomFormatSessionState | undefined,
  probe?: CustomFormatProbeLike,
): CustomImageDecodeOptions {
  const options: CustomImageDecodeOptions = {}
  const layout = normalizeCustomFormatLayout(session?.layout)
  if (layout.valid && layout.layout)
    options.layout = layout.layout
  if (session?.channelMode)
    options.channelMode = session.channelMode
  if (Number.isFinite(session?.channelIndex))
    options.channelIndex = Math.max(0, Math.floor(Number(session?.channelIndex)))
  if (Number.isFinite(session?.pageIndex))
    options.pageIndex = clampPageIndex(Number(session?.pageIndex), probe?.pageCount)
  if (session?.dtype)
    options.dtype = session.dtype
  if (session?.endian)
    options.endian = session.endian
  for (const key of ['width', 'height', 'channels', 'pages', 'offset'] as const) {
    if (Number.isFinite(session?.[key])) {
      const value = Number(session?.[key])
      options[key] = key === 'offset' ? Math.max(0, Math.floor(value)) : Math.max(1, Math.floor(value))
    }
  }
  const normalize: NonNullable<CustomImageDecodeOptions['normalize']> = {}
  if (Number.isFinite(session?.normalizeMin))
    normalize.min = Number(session?.normalizeMin)
  if (Number.isFinite(session?.normalizeMax))
    normalize.max = Number(session?.normalizeMax)
  if (Object.keys(normalize).length)
    options.normalize = normalize
  return options
}

export function decodeOptionsToSession(options: CustomImageDecodeOptions | undefined): CustomFormatSessionState {
  return {
    channelIndex: options?.channelIndex,
    channelMode: options?.channelMode,
    channels: options?.channels,
    dtype: options?.dtype,
    endian: options?.endian,
    height: options?.height,
    layout: options?.layout,
    layoutLocked: false,
    normalizeMax: options?.normalize?.max,
    normalizeMin: options?.normalize?.min,
    offset: options?.offset,
    pageIndex: options?.pageIndex,
    pages: options?.pages,
    width: options?.width,
  }
}

export function buildRawFolderPresetConfig(
  config: CustomFormatConfig,
  image: Pick<ImageType, 'absDirPath' | 'dirPath' | 'extname' | 'path'>,
  name: string,
  options: CustomImageDecodeOptions,
): CustomFormatConfig {
  const folder = normalizePath(image.absDirPath || image.dirPath || dirnameOf(image.path))
  const ext = normalizeCustomFormatExt(image.extname)
  const preset: CustomImagePreset = {
    extensions: ext ? [ext] : [],
    kind: 'raw',
    name: name.trim() || `${ext || 'raw'} preset`,
    options,
  }
  return {
    extensionPresets: {
      ...(config.extensionPresets || {}),
    },
    folderPresets: {
      ...(config.folderPresets || {}),
      [folder]: preset,
    },
  }
}

export function buildRawExtensionPresetConfig(
  config: CustomFormatConfig,
  image: Pick<ImageType, 'extname'>,
  name: string,
  options: CustomImageDecodeOptions,
): CustomFormatConfig {
  const ext = normalizeCustomFormatExt(image.extname) || 'raw'
  const preset: CustomImagePreset = {
    extensions: [ext],
    kind: 'raw',
    name: name.trim() || `${ext} preset`,
    options,
  }
  return {
    extensionPresets: {
      ...(config.extensionPresets || {}),
      [ext]: preset,
    },
    folderPresets: {
      ...(config.folderPresets || {}),
    },
  }
}

export function resolveRawExtensionPreset(
  config: Partial<CustomFormatConfig> | undefined,
  image: Pick<ImageType, 'extname'> | undefined,
) {
  const ext = normalizeCustomFormatExt(image?.extname)
  if (!ext)
    return undefined
  const direct = (config?.extensionPresets || {})[ext]
  if (direct)
    return direct
  return Object.values(config?.extensionPresets || {}).find((preset) => {
    return (preset.extensions || []).map(normalizeCustomFormatExt).includes(ext)
  })
}

export function resolveCustomFormatSessionFromConfig(
  config: Partial<CustomFormatConfig> | undefined,
  image: Pick<ImageType, 'absDirPath' | 'dirPath' | 'extname' | 'path'> | undefined,
): CustomFormatSessionState {
  if (!image)
    return {}
  const ext = normalizeCustomFormatExt(image.extname)
  const dirPath = normalizePath(image.absDirPath || image.dirPath || dirnameOf(image.path))
  const folderEntries = Object.entries(config?.folderPresets || {})
    .map(([folderPath, preset]) => [normalizePath(folderPath), preset] as const)
    .filter(([folderPath, preset]) => {
      const presetExts = preset.extensions?.map(normalizeCustomFormatExt) || []
      return (dirPath === folderPath || dirPath.startsWith(`${folderPath}/`))
        && (!presetExts.length || presetExts.includes(ext))
    })
    .sort((a, b) => b[0].length - a[0].length)
  const folderPreset = folderEntries[0]?.[1]
  if (folderPreset?.options)
    return decodeOptionsToSession(folderPreset.options)
  const extensionPreset = (config?.extensionPresets || {})[ext]
  if (extensionPreset?.options)
    return decodeOptionsToSession(extensionPreset.options)
  return {}
}

export function customFormatOptionsKey(options: CustomImageDecodeOptions | undefined) {
  if (!options || !Object.keys(options).length)
    return ''
  return JSON.stringify(options)
}

export function normalizePath(filePath: string) {
  return filePath.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '')
}

function dirnameOf(filePath: string) {
  const normalized = normalizePath(filePath)
  const index = normalized.lastIndexOf('/')
  return index > 0 ? normalized.slice(0, index) : normalized
}
