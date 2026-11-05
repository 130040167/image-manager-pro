import { describe, expect, it } from 'vitest'
import { getVisibleEditorPixelWindow, shouldShowEditorPixelOverlay, shouldShowEditorPixelValues } from '~/webview/image-manager/components/image-editor/editor-pixel-grid'

describe('editor pixel grid helpers', () => {
  it('maps the visible scrolled viewport back to image pixel bounds', () => {
    const window = getVisibleEditorPixelWindow({
      canvasRect: { height: 800, left: -200, top: -100, width: 1000 },
      imageSize: { height: 80, width: 100 },
      viewportRect: { height: 400, left: 0, top: 0, width: 500 },
    })

    expect(window).toMatchObject({
      localLeft: 200,
      localTop: 100,
      localWidth: 500,
      localHeight: 400,
      minX: 20,
      minY: 10,
      maxX: 69,
      maxY: 49,
      pixelHeight: 10,
      pixelWidth: 10,
    })
  })

  it('returns null when the canvas is outside the viewport', () => {
    expect(getVisibleEditorPixelWindow({
      canvasRect: { height: 100, left: 200, top: 200, width: 100 },
      imageSize: { height: 10, width: 10 },
      viewportRect: { height: 100, left: 0, top: 0, width: 100 },
    })).toBeNull()
  })

  it('uses the same value-label thresholds as the preview inspector', () => {
    expect(shouldShowEditorPixelValues(13.9, 1)).toBe(false)
    expect(shouldShowEditorPixelValues(14, 1)).toBe(true)
    expect(shouldShowEditorPixelValues(21.9, 3)).toBe(false)
    expect(shouldShowEditorPixelValues(22, 3)).toBe(true)
  })

  it('renders the editor grid only when pixel values can be shown', () => {
    expect(shouldShowEditorPixelOverlay({ channels: 1, pixelCount: 100, pixelSize: 13.9 })).toBe(false)
    expect(shouldShowEditorPixelOverlay({ channels: 1, pixelCount: 100, pixelSize: 14 })).toBe(true)
    expect(shouldShowEditorPixelOverlay({ channels: 3, pixelCount: 100, pixelSize: 21.9 })).toBe(false)
    expect(shouldShowEditorPixelOverlay({ channels: 3, pixelCount: 100, pixelSize: 22 })).toBe(true)
    expect(shouldShowEditorPixelOverlay({ channels: 3, pixelCount: 96 * 96 + 1, pixelSize: 40 })).toBe(false)
  })

  it('includes partially visible pixels after a fractional pan', () => {
    expect(getVisibleEditorPixelWindow({
      canvasRect: { height: 100, left: -6, top: -7, width: 100 },
      imageSize: { height: 10, width: 10 },
      viewportRect: { height: 28, left: 0, top: 0, width: 28 },
    })).toMatchObject({ minX: 0, minY: 0, maxX: 3, maxY: 3 })
  })
})
