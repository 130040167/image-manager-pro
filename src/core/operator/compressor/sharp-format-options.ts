import type { CompressionOptions } from './type'

export const DEFAULT_TIFF_COMPRESSION = 'lzw'
export const TIFF_COMPRESSION_OPTIONS = ['lzw', 'deflate', 'zstd', 'jpeg', 'webp', 'none'] as const
const LOSSY_QUALITY_EXTENSIONS = new Set(['jpeg', 'webp', 'avif', 'heif'])
const TIFF_QUALITY_COMPRESSIONS = new Set(['jpeg', 'webp', 'jp2k'])

export function normalizeCompressionExt(ext: string) {
  const normalized = ext.toLowerCase()
  if (normalized === 'jpg')
    return 'jpeg'
  if (normalized === 'tif')
    return 'tiff'
  if (normalized === 'heic')
    return 'heif'
  return normalized
}

export function supportsCompressionQuality(ext: string, options: Pick<CompressionOptions, 'tiff'>) {
  const normalizedExt = normalizeCompressionExt(ext)
  if (LOSSY_QUALITY_EXTENSIONS.has(normalizedExt))
    return true
  if (normalizedExt !== 'tiff')
    return false
  const compression = options.tiff?.compression || DEFAULT_TIFF_COMPRESSION
  return TIFF_QUALITY_COMPRESSIONS.has(compression)
}

export function buildSharpFormatOptions(ext: string, options: CompressionOptions) {
  const normalizedExt = normalizeCompressionExt(ext)
  const tiffOptions = options.tiff || {}
  switch (normalizedExt) {
    case 'jpeg':
      return {
        mozjpeg: true,
        quality: options.quality,
      }
    case 'png':
      return {
        compressionLevel: options.png.compressionLevel,
      }
    case 'gif':
      return {
        colors: options.gif.colors,
      }
    case 'webp':
    case 'avif':
    case 'heif':
      return {
        quality: options.quality,
      }
    case 'tiff': {
      const compression = tiffOptions.compression || DEFAULT_TIFF_COMPRESSION
      return {
        ...(supportsCompressionQuality(normalizedExt, options) ? { quality: options.quality } : {}),
        compression,
      }
    }
    default:
      return {}
  }
}
