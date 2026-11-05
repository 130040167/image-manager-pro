import type { PixelTransform } from './preview-pixel-grid'
import { mapValueToRange } from '../image-editor/histogram-range'
import { imagePixelToScreen } from './preview-pixel-grid'

type PixelSource = { width: number, height: number, data: Uint8ClampedArray }
type PixelBounds = { left: number, top: number, right: number, bottom: number }

/** Render only visible source pixels, avoiding browser raster rounding on huge CSS-scaled images. */
export function drawPreviewPixelTile(
  context: CanvasRenderingContext2D,
  tile: HTMLCanvasElement,
  source: PixelSource,
  transform: PixelTransform,
  bounds: PixelBounds,
  range?: [number, number],
) {
  const width = bounds.right - bounds.left
  const height = bounds.bottom - bounds.top
  if (width <= 0 || height <= 0)
    return
  if (tile.width !== width || tile.height !== height) {
    tile.width = width
    tile.height = height
  }
  const tileContext = tile.getContext('2d')!
  const pixels = tileContext.createImageData(width, height)
  const lookup = range && (range[0] !== 0 || range[1] !== 255)
    ? Uint8ClampedArray.from({ length: 256 }, (_, value) => mapValueToRange(value, range))
    : null
  for (let y = 0; y < height; y++) {
    const start = ((bounds.top + y) * source.width + bounds.left) * 4
    pixels.data.set(source.data.subarray(start, start + width * 4), y * width * 4)
  }
  if (lookup) {
    for (let i = 0; i < pixels.data.length; i += 4) {
      pixels.data[i] = lookup[pixels.data[i]]
      pixels.data[i + 1] = lookup[pixels.data[i + 1]]
      pixels.data[i + 2] = lookup[pixels.data[i + 2]]
    }
  }
  tileContext.putImageData(pixels, 0, 0)
  const origin = imagePixelToScreen(transform, bounds.left, bounds.top)
  context.save()
  context.imageSmoothingEnabled = false
  context.transform(transform.a, transform.b, transform.c, transform.d, origin.x, origin.y)
  context.drawImage(tile, 0, 0)
  context.restore()
}
