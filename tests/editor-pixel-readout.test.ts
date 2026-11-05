import type { Doc } from '~/webview/image-manager/components/image-editor/fabric-photo/core/model/doc'
import { describe, expect, it } from 'vitest'
import { formatPixelComparison, hasPixelEdits, readImagePixel } from '~/webview/image-manager/components/image-editor/editor-pixel-readout'
import { DEFAULT_FILTERS } from '~/webview/image-manager/components/image-editor/fabric-photo/core/model/doc'

const original = { x: 12, y: 7, r: 20, g: 40, b: 80, a: 255 }

describe('editor original and composite pixel readout', () => {
  it('shows source coordinates once and keeps both RGB values and alpha', () => {
    expect(formatPixelComparison(original, null)).toBe('(12, 7) 20 40 80')
    expect(formatPixelComparison(original, { ...original })).toBe('(12, 7) 20 40 80')
    expect(formatPixelComparison(original, { ...original, r: 255, g: 0, b: 0, a: 128 })).toBe('(12, 7) 20 40 80 → 255 0 0 A:128')
  })

  it('expands a grayscale source to RGB when a colored layer is painted over it', () => {
    const gray = { ...original, r: 20, g: 20, b: 20 }
    expect(formatPixelComparison(gray, null, 1)).toBe('(12, 7) 20')
    expect(formatPixelComparison(gray, { ...original, r: 200, g: 200, b: 200 }, 1)).toBe('(12, 7) 20 → 200')
    expect(formatPixelComparison(gray, { ...original, r: 255, g: 0, b: 0 }, 1)).toBe('(12, 7) 20 20 20 → 255 0 0')
  })

  it('samples source edge pixels without leaking an adjacent row', () => {
    const image = { width: 2, height: 1, data: new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 7]) } as ImageData
    expect(readImagePixel(image, 1, 0)).toEqual({ x: 1, y: 0, r: 4, g: 5, b: 6, a: 7 })
    expect(readImagePixel(image, 2, 0)).toBeNull()
    expect(readImagePixel(image, -1, 0)).toBeNull()
  })

  it('treats range, filters and visible content as pixel edits, but not rotation or hidden layers', () => {
    const doc: Doc = { background: { src: 'test', name: 'test', width: 10, height: 20, angle: 90, filters: { ...DEFAULT_FILTERS } }, objects: [] }
    expect(hasPixelEdits(doc)).toBe(false)
    expect(hasPixelEdits({ ...doc, background: { ...doc.background!, valueRange: [10, 240] } })).toBe(true)
    expect(hasPixelEdits({ ...doc, background: { ...doc.background!, filters: { ...DEFAULT_FILTERS, contrast: 0.2 } } })).toBe(true)
    const shape = { id: 'test', kind: 'shape' as const, shapeType: 'rect' as const, left: 0, top: 0, width: 10, height: 10, angle: 0, scaleX: 1, scaleY: 1, fill: 'red', stroke: 'red', strokeWidth: 0 }
    expect(hasPixelEdits({ ...doc, objects: [shape] })).toBe(true)
    expect(hasPixelEdits({ ...doc, objects: [{ ...shape, hidden: true }] })).toBe(false)
    expect(hasPixelEdits({ ...doc, objects: [{ ...shape, opacity: 0 }] })).toBe(false)
  })
})
