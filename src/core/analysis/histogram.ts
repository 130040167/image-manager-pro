import type { Buffer } from 'node:buffer'
import type { SharpNS } from '~/@types/global'
import { Global } from '~/core/global'

const HISTOGRAM_SAMPLE_SIZE = 64
const HISTOGRAM_BINS = 8
const HISTOGRAM_GROUPS = 4

export async function histogram(image: string | Buffer, options?: SharpNS.SharpOptions) {
  const { data, info } = await Global.sharp(image, options)
    .rotate()
    .resize(HISTOGRAM_SAMPLE_SIZE, HISTOGRAM_SAMPLE_SIZE, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const channels = Math.max(1, info.channels || 1)
  const colorChannels = channels >= 3 ? 3 : 1
  const pixelCount = Math.max(1, info.width * info.height)
  const bins = Array.from({ length: HISTOGRAM_BINS * HISTOGRAM_GROUPS }, () => 0)

  for (let index = 0; index < data.length; index += channels) {
    const r = data[index] || 0
    const g = colorChannels === 3 ? (data[index + 1] || 0) : r
    const b = colorChannels === 3 ? (data[index + 2] || 0) : r
    const intensity = Math.round((r + g + b) / 3)

    bins[Math.min(HISTOGRAM_BINS - 1, Math.floor(r / 32))]++
    bins[HISTOGRAM_BINS + Math.min(HISTOGRAM_BINS - 1, Math.floor(g / 32))]++
    bins[HISTOGRAM_BINS * 2 + Math.min(HISTOGRAM_BINS - 1, Math.floor(b / 32))]++
    bins[HISTOGRAM_BINS * 3 + Math.min(HISTOGRAM_BINS - 1, Math.floor(intensity / 32))]++
  }

  return bins.map(value => value / pixelCount)
}

export function histogramDistance(a: number[], b: number[]) {
  const maxLength = Math.max(a.length, b.length)
  let l1 = 0
  for (let index = 0; index < maxLength; index++)
    l1 += Math.abs((a[index] || 0) - (b[index] || 0))
  return Math.round((l1 / (HISTOGRAM_GROUPS * 2)) * 64)
}
