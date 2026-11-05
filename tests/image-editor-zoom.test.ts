// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { applyEditorZoomLayout, clampEditorZoom, EDITOR_MAX_ZOOM, EDITOR_MIN_ZOOM, EDITOR_ZOOM_LADDER, getCenteredEditorScroll, getZoomedEditorSize, nextEditorZoomPercent } from '~/webview/image-manager/components/image-editor/editor-zoom'

describe('image editor zoom ladder', () => {
  it('unifies the editor max zoom with the preview (5000% / 50x) and allows zoom-out below 100%', () => {
    expect(EDITOR_ZOOM_LADDER[EDITOR_ZOOM_LADDER.length - 1]).toBe(5000)
    expect(EDITOR_ZOOM_LADDER[0]).toBe(10)
    expect(EDITOR_MAX_ZOOM).toBe(50)
    expect(EDITOR_MIN_ZOOM).toBe(0.1)
    expect(EDITOR_ZOOM_LADDER).toContain(100)
  })

  it('can step below 100% (CSS-zoom model supports shrinking)', () => {
    expect(nextEditorZoomPercent(100, -1)).toBe(86)
    expect(nextEditorZoomPercent(50, -1)).toBe(40)
    expect(nextEditorZoomPercent(10, -1)).toBe(10)
  })

  it('steps up and down along the ladder', () => {
    expect(nextEditorZoomPercent(100, 1)).toBe(125)
    expect(nextEditorZoomPercent(125, 1)).toBe(150)
    expect(nextEditorZoomPercent(400, 1)).toBe(640)
    expect(nextEditorZoomPercent(150, -1)).toBe(125)
    expect(nextEditorZoomPercent(640, -1)).toBe(400)
  })

  it('saturates at the ladder ends instead of overflowing', () => {
    expect(nextEditorZoomPercent(5000, 1)).toBe(5000)
    expect(nextEditorZoomPercent(9000, 1)).toBe(5000)
    expect(nextEditorZoomPercent(10, -1)).toBe(10)
    expect(nextEditorZoomPercent(5, -1)).toBe(10)
  })

  it('reaches 5000% by repeated zoom-in steps from the bottom', () => {
    let percent = 10
    const seen = new Set<number>()
    for (let i = 0; i < EDITOR_ZOOM_LADDER.length + 5; i++) {
      percent = nextEditorZoomPercent(percent, 1)
      seen.add(percent)
    }
    expect(percent).toBe(5000)
    for (const rung of EDITOR_ZOOM_LADDER.slice(1))
      expect(seen.has(rung)).toBe(true)
  })

  it('clamps arbitrary zoom factors into the allowed range (incl. below 1)', () => {
    expect(clampEditorZoom(0.05)).toBe(0.1)
    expect(clampEditorZoom(0.5)).toBe(0.5)
    expect(clampEditorZoom(1)).toBe(1)
    expect(clampEditorZoom(12.345)).toBe(12.35)
    expect(clampEditorZoom(80)).toBe(50)
  })

  it('recenters the editor scroll area after crop/rotate rebuilds the canvas layout', () => {
    expect(getCenteredEditorScroll({
      clientHeight: 800,
      clientWidth: 1000,
      scrollHeight: 2400,
      scrollWidth: 3000,
    })).toEqual({
      scrollLeft: 1000,
      scrollTop: 800,
    })

    expect(getCenteredEditorScroll({
      clientHeight: 800,
      clientWidth: 1000,
      scrollHeight: 600,
      scrollWidth: 900,
    })).toEqual({
      scrollLeft: 0,
      scrollTop: 0,
    })
  })

  it('sizes the TOAST editor shell with the zoomed canvas so small images stay centered', () => {
    const editor = document.createElement('div')
    const canvasContainer = document.createElement('div')
    const fabricContainer = document.createElement('div')
    const canvas = document.createElement('canvas')

    const size = applyEditorZoomLayout({
      canvasContainer,
      canvases: [canvas],
      editor,
      fabricContainer,
    }, {
      height: 120,
      width: 160,
    }, 2)

    expect(size).toEqual({ height: 240, width: 320 })
    for (const element of [editor, canvasContainer, fabricContainer, canvas]) {
      expect(element.style.width).toBe('320px')
      expect(element.style.height).toBe('240px')
      expect(element.style.maxWidth).toBe('none')
      expect(element.style.maxHeight).toBe('none')
    }
    expect(canvasContainer.style.transform).toBe('')
  })

  it('does not resize fixed pixel-grid overlay canvases with the TOAST canvas layout', () => {
    const editor = document.createElement('div')
    const canvasContainer = document.createElement('div')
    const fabricContainer = document.createElement('div')
    const toastCanvas = document.createElement('canvas')
    const pixelGrid = document.createElement('canvas')
    pixelGrid.dataset.editorPixelGrid = 'true'

    applyEditorZoomLayout({
      canvasContainer,
      canvases: [toastCanvas, pixelGrid],
      editor,
      fabricContainer,
    }, {
      height: 120,
      width: 160,
    }, 2)

    expect(toastCanvas.style.width).toBe('320px')
    expect(toastCanvas.style.height).toBe('240px')
    expect(pixelGrid.style.width).toBe('')
    expect(pixelGrid.style.height).toBe('')
    expect(pixelGrid.style.maxWidth).toBe('')
    expect(pixelGrid.style.maxHeight).toBe('')
  })

  it('rounds zoomed editor sizes consistently', () => {
    expect(getZoomedEditorSize({ height: 101, width: 203 }, 0.5)).toEqual({
      height: 51,
      width: 102,
    })
  })
})
