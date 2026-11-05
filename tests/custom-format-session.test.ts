import type { CustomFormatConfig, CustomImageDecodeOptions } from '~/core/custom-format/types'
import { describe, expect, it } from 'vitest'
import { Compressed } from '~/meta'
import {
  buildCustomFormatDecodeOptions,
  buildRawExtensionPresetConfig,
  buildRawFolderPresetConfig,
  getCustomFormatLayoutOptionsForRank,
  getCustomFormatScopeKey,
  guessNpyLayoutForShape,
  isCustomFormatImage,
  normalizeCustomFormatLayout,
  resolveCustomFormatSessionFromConfig,
} from '~/webview/image-manager/components/custom-format-toolbar/session'

function image(path: string, extname: string, absDirPath = 'c:/data/set'): ImageType {
  return {
    absDirPath,
    absWorkspaceFolder: 'c:/data',
    basename: `${path.split(/[\\/]/).pop()}`,
    dirPath: 'set',
    extname,
    info: { compressed: Compressed.unknown, gitStaged: false, metadata: {} as Metadata },
    key: path,
    name: path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || 'image',
    path,
    relativePath: path,
    stats: { mtimeMs: 1, size: 1 } as ImageType['stats'],
    vscodePath: `vscode://${path}`,
    workspaceFolder: 'data',
  }
}

describe('custom format session utilities', () => {
  it('normalizes common and custom npy layouts while rejecting invalid axes', () => {
    expect(normalizeCustomFormatLayout('bhwc')).toEqual({ layout: 'BHWC', valid: true })
    expect(normalizeCustomFormatLayout(' h-b-w ')).toEqual({ layout: 'HBW', valid: true })
    expect(normalizeCustomFormatLayout('BZI')).toEqual({
      error: 'Layout must use only B/C/H/W/I axes',
      layout: 'BI',
      valid: false,
    })
    expect(normalizeCustomFormatLayout('BCH')).toEqual({
      error: 'Layout must include H and W axes',
      layout: 'BCH',
      valid: false,
    })
    expect(normalizeCustomFormatLayout('HHW')).toEqual({
      error: 'Layout axes cannot repeat except I',
      layout: 'HHW',
      valid: false,
    })
  })

  it('uses folder plus extension as the session scope', () => {
    expect(getCustomFormatScopeKey(image('c:/data/set/a.npy', 'npy'))).toBe('c:/data/set::npy')
    expect(getCustomFormatScopeKey(image('c:/data/set/b.raw', 'raw'))).toBe('c:/data/set::raw')
  })

  it('identifies npy and raw-like custom formats', () => {
    expect(isCustomFormatImage(image('c:/data/a.npy', 'npy'))).toBe(true)
    expect(isCustomFormatImage(image('c:/data/a.raw', 'raw'))).toBe(true)
    expect(isCustomFormatImage(image('c:/data/a.dat', 'dat'))).toBe(true)
    expect(isCustomFormatImage(image('c:/data/a.png', 'png'))).toBe(false)
  })

  it('builds decode options with normalized layout and clamped page indexes', () => {
    const options = buildCustomFormatDecodeOptions(
      { layout: ' bhw ', pageIndex: 9 },
      { pageCount: 3 },
    )
    expect(options).toEqual({ layout: 'BHW', pageIndex: 2 })
  })

  it('drops invalid layouts before decoding', () => {
    const options = buildCustomFormatDecodeOptions({ layout: 'BC', pageIndex: 1 }, { pageCount: 4 })
    expect(options).toEqual({ pageIndex: 1 })
  })

  it('filters common NPY layout options by array rank', () => {
    expect(getCustomFormatLayoutOptionsForRank(2)).toEqual(['HW'])
    expect(getCustomFormatLayoutOptionsForRank(3)).toEqual(['HWC', 'CHW', 'BHW'])
    expect(getCustomFormatLayoutOptionsForRank(4)).toEqual(['BCHW', 'BHWC', 'BHWI'])
  })

  it('guesses an NPY layout from shape before falling back to previous layout', () => {
    expect(guessNpyLayoutForShape([300, 400])).toBe('HW')
    expect(guessNpyLayoutForShape([300, 400, 3], 'BHW')).toBe('HWC')
    expect(guessNpyLayoutForShape([3, 300, 400], 'HWC')).toBe('CHW')
    expect(guessNpyLayoutForShape([10, 300, 400], 'HWC')).toBe('BHW')
    expect(guessNpyLayoutForShape([4, 3, 300, 400])).toBe('BCHW')
    expect(guessNpyLayoutForShape([4, 300, 400, 3])).toBe('BHWC')
    expect(guessNpyLayoutForShape([4, 8, 300, 400], 'BHWC')).toBe('BHWI')
  })

  it('writes a named raw folder preset without losing existing extension presets', () => {
    const config: CustomFormatConfig = {
      extensionPresets: {
        raw: {
          kind: 'raw',
          name: 'Global Raw',
          options: { height: 16, layout: 'HW', width: 16 },
        },
      },
      folderPresets: {},
    }
    const options: CustomImageDecodeOptions = {
      dtype: 'uint16',
      endian: 'little',
      height: 2,
      layout: 'BHW',
      pages: 3,
      width: 4,
    }

    const next = buildRawFolderPresetConfig(config, image('c:/data/set/a.raw', 'raw'), 'a', options)

    expect(next.extensionPresets.raw.name).toBe('Global Raw')
    expect(next.folderPresets['c:/data/set']).toEqual({
      extensions: ['raw'],
      kind: 'raw',
      name: 'a',
      options,
    })
  })

  it('writes a named raw extension preset without losing folder presets', () => {
    const config: CustomFormatConfig = {
      extensionPresets: {},
      folderPresets: {
        'c:/data/set': {
          extensions: ['raw'],
          kind: 'raw',
          options: { height: 2, layout: 'HW', width: 2 },
        },
      },
    }
    const options: CustomImageDecodeOptions = { height: 8, layout: 'HW', width: 4 }

    const next = buildRawExtensionPresetConfig(config, image('c:/data/other/a.raw', 'raw', 'c:/data/other'), 'a', options)

    expect(next.folderPresets['c:/data/set']).toEqual(config.folderPresets['c:/data/set'])
    expect(next.extensionPresets.raw).toEqual({
      extensions: ['raw'],
      kind: 'raw',
      name: 'a',
      options,
    })
  })

  it('resolves folder presets only for matching extensions before falling back to extension presets', () => {
    const config: CustomFormatConfig = {
      extensionPresets: {
        raw: {
          kind: 'raw',
          options: { height: 8, layout: 'HW', width: 8 },
        },
      },
      folderPresets: {
        'c:/data/set': {
          extensions: ['dat'],
          kind: 'raw',
          options: { height: 9, layout: 'BHW', pages: 2, width: 9 },
        },
      },
    }

    expect(resolveCustomFormatSessionFromConfig(config, image('c:/data/set/a.raw', 'raw'))).toMatchObject({
      height: 8,
      layout: 'HW',
      width: 8,
    })
    expect(resolveCustomFormatSessionFromConfig(config, image('c:/data/set/a.dat', 'dat', 'c:/data/set'))).toMatchObject({
      height: 9,
      layout: 'BHW',
      pages: 2,
      width: 9,
    })
  })
})
