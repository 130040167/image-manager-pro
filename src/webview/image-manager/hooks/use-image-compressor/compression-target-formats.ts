import type { CompressionOptions } from '~/core/operator/compressor/type'
import { normalizeCompressionExt, supportsCompressionQuality } from '~/core/operator/compressor/sharp-format-options'

type ImageLike = {
  extname: string
}

export function resolveCompressionTargetFormats(images: ImageLike[], format?: string) {
  if (format)
    return [normalizeCompressionExt(format)]
  return Array.from(new Set(images.map(image => normalizeCompressionExt(image.extname))))
}

export function includesCompressionTargetFormat(targetFormats: string[], format: string) {
  return targetFormats.includes(normalizeCompressionExt(format))
}

export function shouldShowCompressionQuality(targetFormats: string[], options: Pick<CompressionOptions, 'tiff'>) {
  return targetFormats.some(format => supportsCompressionQuality(format, options))
}
