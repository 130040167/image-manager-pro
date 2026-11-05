import type { PixelValue } from './editor-utils'
import type { Doc } from './fabric-photo/core/model/doc'
import { DEFAULT_FILTERS } from './fabric-photo/core/model/doc'

export function readImagePixel(image: ImageData, x: number, y: number): PixelValue | null {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height)
    return null
  const index = (y * image.width + x) * 4
  return { x, y, r: image.data[index], g: image.data[index + 1], b: image.data[index + 2], a: image.data[index + 3] }
}

export function hasPixelEdits(doc: Doc): boolean {
  const background = doc.background
  const range = background?.valueRange
  return Boolean((range && (range[0] !== 0 || range[1] !== 255))
    || (background?.filters && Object.entries(DEFAULT_FILTERS).some(([key, value]) => (background.filters?.[key as keyof typeof DEFAULT_FILTERS] ?? value) !== value))
    || doc.objects.some(object => !object.hidden && object.opacity !== 0))
}

export function formatPixelComparison(original: PixelValue, current: PixelValue | null, channels = 3): string {
  const grayscale = channels === 1 && (!current || (current.r === current.g && current.g === current.b))
  const value = (pixel: PixelValue) => `${grayscale ? pixel.r : `${pixel.r} ${pixel.g} ${pixel.b}`}${pixel.a < 255 ? ` A:${pixel.a}` : ''}`
  const changed = current !== null
    && (original.r !== current.r || original.g !== current.g || original.b !== current.b || original.a !== current.a)
  return `(${original.x}, ${original.y}) ${value(original)}${changed ? ` → ${value(current)}` : ''}`
}
