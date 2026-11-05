import { mapValueToRange } from '../image-editor/histogram-range'

/** Count real source samples, avoiding resampling that invents colours between pixels. */
export function histogramFromPixels(data: Uint8ClampedArray, range?: [number, number]) {
  const r = Array.from<number>({ length: 256 }).fill(0)
  const g = r.slice()
  const b = r.slice()
  const lum = r.slice()
  let grayscale = true
  for (let i = 0; i < data.length; i += 4) {
    const rv = range ? mapValueToRange(data[i], range) : data[i]
    const gv = range ? mapValueToRange(data[i + 1], range) : data[i + 1]
    const bv = range ? mapValueToRange(data[i + 2], range) : data[i + 2]
    grayscale &&= rv === gv && gv === bv
    r[rv]++
    g[gv]++
    b[bv]++
    lum[Math.round(0.299 * rv + 0.587 * gv + 0.114 * bv)]++
  }
  return { r, g, b, lum, channels: grayscale ? 1 : 3, domain: [0, 255] as [number, number] }
}
