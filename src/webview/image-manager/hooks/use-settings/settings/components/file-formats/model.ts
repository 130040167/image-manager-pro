import type { CustomFormatConfig, CustomImageDecodeOptions, CustomImageKind, CustomImagePreset } from '~/core/custom-format/types'
import { uniq } from 'es-toolkit'

export type FileFormatsDraft = {
  customFormats: CustomFormatConfig
  scan: string[]
}

export type ExtensionDraftInput = {
  extensions: string
  kind?: CustomImageKind
  name?: string
}

export const DTYPE_OPTIONS = ['uint8', 'int8', 'uint16', 'int16', 'uint32', 'int32', 'float32', 'float64'] as const
export const LAYOUT_OPTIONS = ['HW', 'HWC', 'CHW', 'BHW', 'BCHW', 'BHWC', 'BHWI'] as const
export const CHANNEL_MODE_OPTIONS = ['auto', 'rgb', 'rgba', 'stack', 'single'] as const

export function normalizeExt(ext: string) {
  return ext.trim().replace(/^\./, '').toLowerCase()
}

export function normalizeExtList(value: string | string[] | undefined) {
  const items = Array.isArray(value) ? value : String(value || '').split(/[,\s;，；]+/g)
  return uniq(items.map(normalizeExt).filter(Boolean))
}

export function normalizeDir(dir: string) {
  return dir.trim().replace(/\\/g, '/').replace(/\/+$/g, '')
}

function clonePreset(preset: CustomImagePreset): CustomImagePreset {
  return {
    ...preset,
    extensions: preset.extensions?.slice(),
    options: preset.options
      ? {
          ...preset.options,
          normalize: preset.options.normalize ? { ...preset.options.normalize } : undefined,
        }
      : undefined,
  }
}

export function normalizeCustomFormats(value: CustomFormatConfig | undefined): CustomFormatConfig {
  const extensionPresets: Record<string, CustomImagePreset> = {}
  Object.entries(value?.extensionPresets || {}).forEach(([ext, preset]) => {
    const cloned = clonePreset(preset)
    const extensions = normalizeExtList(cloned.extensions?.length ? cloned.extensions : [ext])
    cloned.extensions = extensions
    extensions.forEach((item) => {
      extensionPresets[item] = cloned
    })
  })
  const folderPresets: Record<string, CustomImagePreset> = {}
  Object.entries(value?.folderPresets || {}).forEach(([dir, preset]) => {
    folderPresets[normalizeDir(dir)] = clonePreset(preset)
  })
  return { extensionPresets, folderPresets }
}

export function createFileFormatsDraft(scan: string[], customFormats: CustomFormatConfig): FileFormatsDraft {
  return {
    customFormats: normalizeCustomFormats(customFormats),
    scan: uniq(scan.map(normalizeExt).filter(Boolean)),
  }
}

export function defaultPreset(
  extOrExtensions: string | string[],
  kind?: CustomImageKind,
  name?: string,
): CustomImagePreset {
  const extensions = normalizeExtList(extOrExtensions)
  const primaryExt = extensions[0] || 'raw'
  const presetKind = kind || (extensions.length === 1 && primaryExt === 'npy' ? 'npy' : 'raw')
  return {
    extensions,
    kind: presetKind,
    name: name?.trim() || primaryExt.toUpperCase(),
    options: presetKind === 'npy'
      ? { channelMode: 'auto', layout: '' }
      : {
          channelMode: 'single',
          channels: 1,
          dtype: 'uint8',
          endian: 'little',
          height: 512,
          layout: 'HW',
          offset: 0,
          pages: 1,
          width: 512,
        },
  }
}

export function presetToFormValue(preset: CustomImagePreset) {
  const options = preset.options || {}
  return {
    extensions: (preset.extensions || []).join(', '),
    kind: preset.kind,
    name: preset.name,
    ...options,
    normalizeMax: options.normalize?.max,
    normalizeMin: options.normalize?.min,
  }
}

export function formValueToPreset(extOrDir: string, value: any, previous?: CustomImagePreset): CustomImagePreset {
  const normalize: CustomImageDecodeOptions['normalize'] = {}
  if (Number.isFinite(value.normalizeMin))
    normalize.min = Number(value.normalizeMin)
  if (Number.isFinite(value.normalizeMax))
    normalize.max = Number(value.normalizeMax)
  const extensions = normalizeExtList(value.extensions || previous?.extensions || (extOrDir.includes('/') ? [] : [extOrDir]))
  const options: CustomImageDecodeOptions = {
    channelIndex: value.channelIndex,
    channelMode: value.channelMode,
    channels: value.channels,
    dtype: value.dtype,
    endian: value.endian,
    height: value.height,
    layout: value.layout,
    offset: value.offset,
    pageIndex: value.pageIndex,
    pages: value.pages,
    width: value.width,
    ...(Object.keys(normalize).length ? { normalize } : {}),
  }
  Object.keys(options).forEach((key) => {
    if (options[key as keyof CustomImageDecodeOptions] === undefined || options[key as keyof CustomImageDecodeOptions] === '') {
      delete options[key as keyof CustomImageDecodeOptions]
    }
  })
  return {
    ...previous,
    extensions,
    kind: value.kind,
    name: value.name || previous?.name || extensions[0] || extOrDir,
    options,
  }
}

export function addExtensionToDraft(draft: FileFormatsDraft, input: ExtensionDraftInput): FileFormatsDraft {
  const extensions = normalizeExtList(input.extensions)
  if (!extensions.length)
    return draft
  const preset = defaultPreset(extensions, input.kind, input.name)
  const extensionPresets = { ...draft.customFormats.extensionPresets }
  extensions.forEach((ext) => {
    extensionPresets[ext] = preset
  })
  return {
    customFormats: {
      ...draft.customFormats,
      extensionPresets,
    },
    scan: uniq([...draft.scan, ...extensions]),
  }
}

export function updateExtensionPresetDraft(
  draft: FileFormatsDraft,
  ext: string,
  preset: CustomImagePreset,
): FileFormatsDraft {
  const normalizedExt = normalizeExt(ext)
  const extensions = normalizeExtList(preset.extensions?.length ? preset.extensions : [normalizedExt])
  const previousPreset = draft.customFormats.extensionPresets[normalizedExt]
  const previousExtensions = normalizeExtList(previousPreset?.extensions?.length ? previousPreset.extensions : [normalizedExt])
  const nextPreset = {
    ...clonePreset(preset),
    extensions,
  }
  const extensionPresets = { ...draft.customFormats.extensionPresets }
  previousExtensions.forEach((key) => {
    if (!extensions.includes(key)) {
      delete extensionPresets[key]
    }
  })
  extensions.forEach((item) => {
    extensionPresets[item] = nextPreset
  })
  return {
    customFormats: {
      ...draft.customFormats,
      extensionPresets,
    },
    scan: uniq([...draft.scan, ...extensions]),
  }
}

export function removeExtensionFromDraft(draft: FileFormatsDraft, ext: string): FileFormatsDraft {
  const normalizedExt = normalizeExt(ext)
  const extensionPresets = { ...draft.customFormats.extensionPresets }
  const removedPreset = extensionPresets[normalizedExt]
  delete extensionPresets[normalizedExt]
  if (removedPreset?.extensions?.length) {
    const remainingExtensions = removedPreset.extensions.map(normalizeExt).filter(item => item && item !== normalizedExt)
    remainingExtensions.forEach((item) => {
      const preset = extensionPresets[item]
      const presetExtensions = normalizeExtList(preset?.extensions)
      if (preset && presetExtensions.includes(normalizedExt)) {
        extensionPresets[item] = {
          ...clonePreset(preset),
          extensions: remainingExtensions,
        }
      }
    })
  }
  return {
    customFormats: {
      ...draft.customFormats,
      extensionPresets,
    },
    scan: draft.scan.filter(item => item !== normalizedExt),
  }
}

export function updateFolderPresetDraft(
  draft: FileFormatsDraft,
  dir: string,
  preset: CustomImagePreset,
): FileFormatsDraft {
  const normalizedDir = normalizeDir(dir)
  return {
    ...draft,
    customFormats: {
      ...draft.customFormats,
      folderPresets: {
        ...draft.customFormats.folderPresets,
        [normalizedDir]: clonePreset(preset),
      },
    },
  }
}

export function removeFolderPresetDraft(draft: FileFormatsDraft, dir: string): FileFormatsDraft {
  const folderPresets = { ...draft.customFormats.folderPresets }
  delete folderPresets[normalizeDir(dir)]
  return {
    ...draft,
    customFormats: {
      ...draft.customFormats,
      folderPresets,
    },
  }
}
