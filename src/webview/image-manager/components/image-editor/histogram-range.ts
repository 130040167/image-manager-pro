export type PixelValueMode = 'adjusted' | 'raw'

export const DEFAULT_PIXEL_VALUE_MODE: PixelValueMode = 'raw'

export function normalizeValueRange(range: [number, number]) {
  const lo = Math.max(0, Math.min(255, Math.round(range[0])))
  const hi = Math.max(0, Math.min(255, Math.round(range[1])))
  return lo <= hi ? [lo, hi] as [number, number] : [hi, lo] as [number, number]
}

export function isDefaultValueRange(range: [number, number]) {
  const [lo, hi] = normalizeValueRange(range)
  return lo === 0 && hi === 255
}

export function mapValueToRange(value: number, range: [number, number]) {
  const [lo, hi] = normalizeValueRange(range)
  if (lo === hi)
    return value <= lo ? 0 : 255
  const next = ((value - lo) / (hi - lo)) * 255
  return Math.max(0, Math.min(255, Math.round(next)))
}

export function getRangeAdjustedRgb(
  rgb: { b: number, g: number, r: number },
  range?: [number, number],
) {
  if (!range)
    return rgb
  return {
    b: mapValueToRange(rgb.b, range),
    g: mapValueToRange(rgb.g, range),
    r: mapValueToRange(rgb.r, range),
  }
}

export function getPixelDisplayRgb(
  rgb: { b: number, g: number, r: number },
  range: [number, number] | undefined,
  mode: PixelValueMode = 'raw',
) {
  return mode === 'adjusted' ? getRangeAdjustedRgb(rgb, range) : rgb
}

export function formatPixelValue(
  rgb: { b: number, g: number, r: number },
  channels: number,
  range: [number, number] | undefined,
  mode: PixelValueMode = 'raw',
) {
  const displayed = getPixelDisplayRgb(rgb, range, mode)
  return channels === 1
    ? String(displayed.r)
    : `${displayed.r} ${displayed.g} ${displayed.b}`
}

export function getRgbLuminance(rgb: { b: number, g: number, r: number }) {
  return 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b
}

export function getContrastingPixelLabelColor(
  rgb: { b: number, g: number, r: number },
  range?: [number, number],
) {
  const adjusted = getRangeAdjustedRgb(rgb, range)
  return getRgbLuminance(adjusted) > 128 ? 'rgba(0,0,0,0.9)' : 'rgba(255,255,255,0.92)'
}

export function isImageDataGrayscale(imageData: ImageData, metadataChannels?: number) {
  if (metadataChannels === 1)
    return true
  const sampleStep = Math.max(1, Math.floor(imageData.data.length / 4 / 4096))
  for (let i = 0; i < imageData.data.length; i += sampleStep * 4) {
    if (
      imageData.data[i] !== imageData.data[i + 1]
      || imageData.data[i + 1] !== imageData.data[i + 2]
    ) {
      return false
    }
  }
  return true
}

export function applyValueRangeToImageData(imageData: ImageData, range: [number, number]) {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx)
    throw new Error('Unable to create 2d canvas context')
  const output = ctx.createImageData(imageData.width, imageData.height)
  output.data.set(imageData.data)
  for (let i = 0; i < output.data.length; i += 4) {
    output.data[i] = mapValueToRange(output.data[i], range)
    output.data[i + 1] = mapValueToRange(output.data[i + 1], range)
    output.data[i + 2] = mapValueToRange(output.data[i + 2], range)
  }
  return output
}

export function imageDataToDataUrl(imageData: ImageData) {
  const canvas = document.createElement('canvas')
  canvas.width = imageData.width
  canvas.height = imageData.height
  const ctx = canvas.getContext('2d')
  if (!ctx)
    throw new Error('Unable to create 2d canvas context')
  ctx.putImageData(imageData, 0, 0)
  return canvas.toDataURL('image/png')
}

export function applyValueRangeToDataUrl(imageData: ImageData, range: [number, number]) {
  return imageDataToDataUrl(applyValueRangeToImageData(imageData, range))
}
