// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { applyValueRangeToImageData, formatPixelValue, getContrastingPixelLabelColor, getPixelDisplayRgb, getRangeAdjustedRgb, isDefaultValueRange, mapValueToRange, normalizeValueRange } from '~/webview/image-manager/components/image-editor/histogram-range'

describe('image editor histogram range mapping', () => {
  it('normalizes and clamps ranges', () => {
    expect(normalizeValueRange([260, -5])).toEqual([0, 255])
    expect(normalizeValueRange([200, 100])).toEqual([100, 200])
    expect(isDefaultValueRange([255, 0])).toBe(true)
    expect(isDefaultValueRange([0, 254])).toBe(false)
  })

  it('linearly stretches values into 0-255', () => {
    expect(mapValueToRange(50, [50, 150])).toBe(0)
    expect(mapValueToRange(100, [50, 150])).toBe(128)
    expect(mapValueToRange(150, [50, 150])).toBe(255)
    expect(mapValueToRange(200, [50, 150])).toBe(255)
  })

  it('binarizes when min and max are equal', () => {
    expect(mapValueToRange(80, [100, 100])).toBe(0)
    expect(mapValueToRange(120, [100, 100])).toBe(255)
  })

  it('applies range mapping to RGB channels while preserving alpha', () => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    const input = ctx.createImageData(2, 1)
    input.data.set([
      50,
      100,
      150,
      128,
      25,
      200,
      250,
      255,
    ])

    const output = applyValueRangeToImageData(input, [50, 150])

    expect(Array.from(output.data)).toEqual([
      0,
      128,
      255,
      128,
      0,
      255,
      255,
      255,
    ])
    expect(Array.from(input.data)).toEqual([
      50,
      100,
      150,
      128,
      25,
      200,
      250,
      255,
    ])
  })

  it('derives pixel label contrast from the range-adjusted displayed value', () => {
    expect(getRangeAdjustedRgb({ b: 120, g: 120, r: 120 }, [100, 130])).toEqual({ b: 170, g: 170, r: 170 })
    expect(getContrastingPixelLabelColor({ b: 120, g: 120, r: 120 }, [0, 255])).toContain('255,255,255')
    expect(getContrastingPixelLabelColor({ b: 120, g: 120, r: 120 }, [100, 130])).toContain('0,0,0')
  })

  it('formats raw or range-adjusted pixel values without mixed arrows', () => {
    expect(getPixelDisplayRgb({ b: 150, g: 125, r: 100 }, [100, 150], 'raw')).toEqual({ b: 150, g: 125, r: 100 })
    expect(getPixelDisplayRgb({ b: 150, g: 125, r: 100 }, [100, 150], 'adjusted')).toEqual({ b: 255, g: 128, r: 0 })

    expect(formatPixelValue({ b: 120, g: 120, r: 120 }, 1, [100, 150], 'raw')).toBe('120')
    expect(formatPixelValue({ b: 120, g: 120, r: 120 }, 1, [100, 150], 'adjusted')).toBe('102')
    expect(formatPixelValue({ b: 150, g: 125, r: 100 }, 3, [100, 150], 'raw')).toBe('100 125 150')
    expect(formatPixelValue({ b: 150, g: 125, r: 100 }, 3, [100, 150], 'adjusted')).toBe('0 128 255')
  })
})
