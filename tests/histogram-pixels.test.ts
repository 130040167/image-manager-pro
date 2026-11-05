import { describe, expect, it } from 'vitest'
import { histogramFromPixels } from '~/webview/image-manager/components/histogram-panel/histogram-pixels'

describe('original and adjusted histograms', () => {
  const source = new Uint8ClampedArray([50, 100, 150, 255, 100, 100, 100, 255, 150, 200, 250, 255])
  it('leaves the original histogram and pixel buffer unchanged after a range adjustment', () => {
    const original = histogramFromPixels(source)
    const adjusted = histogramFromPixels(source, [50, 150])
    expect(original.r[50]).toBe(1)
    expect(original.r[100]).toBe(1)
    expect(adjusted.r[0]).toBe(1)
    expect(adjusted.r[128]).toBe(1)
    expect(adjusted.r[255]).toBe(1)
    expect(adjusted.b[255]).toBe(2)
    expect(histogramFromPixels(source)).toEqual(original)
  })
  it('counts already-rendered filter pixels once without applying a range twice', () => {
    const rendered = new Uint8ClampedArray([64, 64, 64, 255, 128, 128, 128, 255])
    const histogram = histogramFromPixels(rendered)
    expect(histogram.channels).toBe(1)
    expect(histogram.lum[64]).toBe(1)
    expect(histogram.lum[128]).toBe(1)
    expect(histogram.lum.reduce((sum, bin) => sum + bin, 0)).toBe(2)
  })
})
