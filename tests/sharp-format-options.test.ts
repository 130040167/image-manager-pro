import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '~/core/config/common'
import {
  buildSharpFormatOptions,
  DEFAULT_TIFF_COMPRESSION,
  supportsCompressionQuality,
} from '~/core/operator/compressor/sharp-format-options'

describe('sharp format option mapping', () => {
  it('keeps lossy quality only for lossy output formats', () => {
    const options = {
      ...DEFAULT_CONFIG.compression,
      quality: 61,
    }

    expect(buildSharpFormatOptions('jpg', options)).toMatchObject({
      mozjpeg: true,
      quality: 61,
    })
    expect(buildSharpFormatOptions('webp', options)).toMatchObject({
      quality: 61,
    })
    expect(buildSharpFormatOptions('png', options)).toEqual({
      compressionLevel: options.png.compressionLevel,
    })
    expect(buildSharpFormatOptions('gif', options)).toEqual({
      colors: options.gif.colors,
    })
  })

  it('uses tiff compression without forcing quality for lossless modes', () => {
    const options = {
      ...DEFAULT_CONFIG.compression,
      quality: 25,
      tiff: {
        compression: 'lzw',
      },
    }

    expect(buildSharpFormatOptions('tif', options)).toEqual({
      compression: 'lzw',
    })
    expect(supportsCompressionQuality('tiff', options)).toBe(false)
  })

  it('allows tiff quality when using lossy tiff compression', () => {
    const options = {
      ...DEFAULT_CONFIG.compression,
      quality: 48,
      tiff: {
        compression: 'jpeg',
      },
    }

    expect(buildSharpFormatOptions('tiff', options)).toEqual({
      compression: 'jpeg',
      quality: 48,
    })
    expect(supportsCompressionQuality('tiff', options)).toBe(true)
  })

  it('falls back to the default tiff compression mode', () => {
    const options = {
      ...DEFAULT_CONFIG.compression,
      tiff: {
        compression: '',
      },
    }

    expect(buildSharpFormatOptions('tiff', options)).toEqual({
      compression: DEFAULT_TIFF_COMPRESSION,
    })
  })
})
