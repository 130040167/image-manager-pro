export type CustomImageKind = 'npy' | 'raw'

export type CustomImageDtype
  = | 'uint8'
    | 'int8'
    | 'uint16'
    | 'int16'
    | 'uint32'
    | 'int32'
    | 'float32'
    | 'float64'

export type CustomImageEndian = 'little' | 'big'

export type CustomImageAxisRole = 'B' | 'C' | 'H' | 'W' | 'Ignore'

export type CustomImageChannelMode = 'auto' | 'rgb' | 'rgba' | 'stack' | 'single'
export type ResolvedCustomImageChannelMode = Exclude<CustomImageChannelMode, 'auto'>

export type CustomImageNormalize = {
  auto?: boolean
  min?: number
  max?: number
}

export type CustomImageDecodeOptions = {
  axes?: CustomImageAxisRole[]
  channelIndex?: number
  channelMode?: CustomImageChannelMode
  channels?: number
  dtype?: CustomImageDtype
  endian?: CustomImageEndian
  height?: number
  layout?: string
  normalize?: CustomImageNormalize
  offset?: number
  pageIndex?: number
  pages?: number
  width?: number
}

export type CustomImagePreset = {
  extensions?: string[]
  id?: string
  kind: CustomImageKind
  name?: string
  options?: CustomImageDecodeOptions
}

export type CustomFormatConfig = {
  extensionPresets: Record<string, CustomImagePreset>
  folderPresets: Record<string, CustomImagePreset>
}

export type ResolvedCustomImagePreset = {
  cacheKey: string
  preset: CustomImagePreset
  source: 'extension' | 'folder' | 'implicit-npy'
}

export type CustomImageProbeResult = {
  axes: CustomImageAxisRole[]
  channelMode: ResolvedCustomImageChannelMode
  channels: number
  dataUrl?: string
  dtype: CustomImageDtype
  height: number
  kind: CustomImageKind
  layout: string
  littleEndian: boolean
  max: number
  min: number
  pageCount: number
  pageIndex: number
  shape: number[]
  width: number
}

export const DEFAULT_CUSTOM_FORMAT_CONFIG: CustomFormatConfig = {
  extensionPresets: {},
  folderPresets: {},
}

function cloneDefaultCustomFormatConfig(): CustomFormatConfig {
  return {
    extensionPresets: { ...DEFAULT_CUSTOM_FORMAT_CONFIG.extensionPresets },
    folderPresets: { ...DEFAULT_CUSTOM_FORMAT_CONFIG.folderPresets },
  }
}

export function normalizeCustomFormatConfig(config?: Partial<CustomFormatConfig>): CustomFormatConfig {
  const base = cloneDefaultCustomFormatConfig()
  return {
    extensionPresets: {
      ...base.extensionPresets,
      ...(config?.extensionPresets || {}),
    },
    folderPresets: {
      ...base.folderPresets,
      ...(config?.folderPresets || {}),
    },
  }
}
