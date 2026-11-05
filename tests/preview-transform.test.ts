import { describe, expect, it } from 'vitest'
import { calculateAnchoredPreviewTransform, calculateCenterOriginAnchoredPreviewTransform, getDefaultPreviewPositionForViewport, getPreviewBaseScale, getPreviewMaxRcScaleForSemanticScale } from '~/webview/image-manager/components/image-group/preview-transform'

function imagePointAtAnchor(params: {
  anchor: { x: number, y: number }
  rect: { height: number, width: number, x: number, y: number }
}) {
  const { anchor, rect } = params
  return {
    x: (anchor.x - rect.x) / rect.width,
    y: (anchor.y - rect.y) / rect.height,
  }
}

describe('preview transform helpers', () => {
  it('keeps the preview vertically centered above the toolbar-safe area', () => {
    const position = getDefaultPreviewPositionForViewport(
      { height: 800, width: 1200 },
      { fitPadding: 32, toolbarSafeBottom: 96 },
    )

    expect(position.x).toBe(0)
    expect(position.y).toBe(-32)
  })

  it('keeps the mouse anchor stable while zooming a large image', () => {
    const next = calculateAnchoredPreviewTransform({
      anchor: { x: 700, y: 400 },
      current: { scale: 1, x: 0, y: 0 },
      defaultPosition: { x: 0, y: 0 },
      fitPadding: 32,
      layoutSize: { height: 800, width: 1000 },
      targetScale: 2,
      toolbarSafeBottom: 96,
      viewport: { height: 800, width: 1000 },
    })

    expect(next.scale).toBe(2)
    expect(next.x).toBe(-200)
    expect(next.y).toBe(0)
  })

  it('recenters axes that still fit inside the available preview area', () => {
    const next = calculateAnchoredPreviewTransform({
      anchor: { x: 900, y: 700 },
      current: { scale: 1, x: 120, y: -80 },
      defaultPosition: { x: 0, y: -32 },
      fitPadding: 32,
      layoutSize: { height: 120, width: 120 },
      targetScale: 2,
      toolbarSafeBottom: 96,
      viewport: { height: 800, width: 1000 },
    })

    expect(next.x).toBe(0)
    expect(next.y).toBe(-32)
  })

  it('can preserve a dragged position for fitting axes during normal zoom', () => {
    const next = calculateAnchoredPreviewTransform({
      anchor: { x: 900, y: 700 },
      current: { scale: 1, x: 120, y: -80 },
      defaultPosition: { x: 0, y: -32 },
      fitPadding: 32,
      layoutSize: { height: 120, width: 120 },
      recenterFittingAxes: false,
      targetScale: 2,
      toolbarSafeBottom: 96,
      viewport: { height: 800, width: 1000 },
    })

    expect(next.x).toBe(-160)
    expect(next.y).toBe(-460)
  })

  it('keeps the mouse anchor stable for rc-image center-origin transforms', () => {
    const anchor = { x: 820, y: 360 }
    const base = { x: 656, y: 336 }
    const layoutSize = { height: 128, width: 128 }
    const current = { scale: 1.25, x: -92, y: -93 }
    const currentRect = {
      height: layoutSize.height * current.scale,
      width: layoutSize.width * current.scale,
      x: base.x + current.x + layoutSize.width * (1 - current.scale) / 2,
      y: base.y + current.y + layoutSize.height * (1 - current.scale) / 2,
    }
    const before = imagePointAtAnchor({ anchor, rect: currentRect })
    const next = calculateCenterOriginAnchoredPreviewTransform({
      anchor,
      basePosition: base,
      currentRect,
      layoutSize,
      targetScale: 1.5,
    })
    const nextRect = {
      height: layoutSize.height * next.scale,
      width: layoutSize.width * next.scale,
      x: base.x + next.x + layoutSize.width * (1 - next.scale) / 2,
      y: base.y + next.y + layoutSize.height * (1 - next.scale) / 2,
    }
    const after = imagePointAtAnchor({ anchor, rect: nextRect })

    expect(next.x).not.toBe(0)
    expect(next.y).not.toBe(0)
    expect(after.x).toBeCloseTo(before.x, 8)
    expect(after.y).toBeCloseTo(before.y, 8)
  })

  it('recenters center-origin previews only when the scaled image still fully fits', () => {
    const next = calculateCenterOriginAnchoredPreviewTransform({
      anchor: { x: 260, y: 260 },
      basePosition: { x: 100, y: 100 },
      currentRect: { height: 100, width: 100, x: 100, y: 100 },
      defaultPosition: { x: 0, y: -20 },
      fitPadding: 0,
      layoutSize: { height: 100, width: 100 },
      targetScale: 1.5,
      toolbarSafeBottom: 0,
      viewport: { height: 500, width: 500 },
    })

    expect(next).toEqual({ scale: 1.5, x: 0, y: -20 })
  })

  it('preserves the mouse anchor after center-origin zoom when any axis overflows', () => {
    const anchor = { x: 150, y: 150 }
    const base = { x: 0, y: 0 }
    const layoutSize = { height: 400, width: 400 }
    const currentRect = {
      height: 400,
      width: 400,
      x: -100,
      y: -100,
    }
    const before = imagePointAtAnchor({ anchor, rect: currentRect })
    const next = calculateCenterOriginAnchoredPreviewTransform({
      anchor,
      basePosition: base,
      currentRect,
      defaultPosition: { x: 0, y: 0 },
      fitPadding: 0,
      layoutSize,
      targetScale: 2,
      toolbarSafeBottom: 0,
      viewport: { height: 300, width: 300 },
    })
    const nextRect = {
      height: layoutSize.height * next.scale,
      width: layoutSize.width * next.scale,
      x: base.x + next.x + layoutSize.width * (1 - next.scale) / 2,
      y: base.y + next.y + layoutSize.height * (1 - next.scale) / 2,
    }
    const after = imagePointAtAnchor({ anchor, rect: nextRect })

    expect(next.x).not.toBe(0)
    expect(next.y).not.toBe(0)
    expect(after.x).toBeCloseTo(before.x, 8)
    expect(after.y).toBeCloseTo(before.y, 8)
  })

  it('does not recenter the fitting axis while another center-origin axis overflows', () => {
    const next = calculateCenterOriginAnchoredPreviewTransform({
      anchor: { x: 150, y: 180 },
      basePosition: { x: 0, y: 0 },
      currentRect: { height: 100, width: 400, x: -100, y: 100 },
      defaultPosition: { x: 0, y: 0 },
      fitPadding: 0,
      layoutSize: { height: 100, width: 400 },
      targetScale: 2,
      toolbarSafeBottom: 0,
      viewport: { height: 300, width: 300 },
    })

    expect(next.x).not.toBe(0)
    expect(next.y).not.toBe(0)
  })

  it('uses rotated visual dimensions before deciding whether center-origin previews fit', () => {
    const next = calculateCenterOriginAnchoredPreviewTransform({
      anchor: { x: 150, y: 180 },
      basePosition: { x: 0, y: 0 },
      currentRect: { height: 100, width: 400, x: -100, y: 100 },
      defaultPosition: { x: 0, y: 0 },
      fitPadding: 0,
      layoutSize: { height: 400, width: 100 },
      targetScale: 1,
      toolbarSafeBottom: 0,
      viewport: { height: 500, width: 300 },
      visualSize: { height: 100, width: 400 },
    })

    expect(next.x).not.toBe(0)
    expect(next.y).not.toBe(0)
  })

  it('clamps panning so oversized previews do not expose blank edges', () => {
    const next = calculateAnchoredPreviewTransform({
      anchor: { x: 1000, y: 800 },
      current: { scale: 1, x: 0, y: 0 },
      defaultPosition: { x: 0, y: -32 },
      fitPadding: 32,
      layoutSize: { height: 800, width: 1000 },
      targetScale: 5,
      toolbarSafeBottom: 96,
      viewport: { height: 800, width: 1000 },
    })
    const horizontalOverflow = (1000 * 5 - (1000 - 32 * 2)) / 2
    const verticalOverflow = (800 * 5 - (800 - 32 - 96)) / 2

    expect(next.x).toBeGreaterThanOrEqual(-horizontalOverflow)
    expect(next.x).toBeLessThanOrEqual(horizontalOverflow)
    expect(next.y).toBeGreaterThanOrEqual(-32 - verticalOverflow)
    expect(next.y).toBeLessThanOrEqual(-32 + verticalOverflow)
  })

  it('converts a semantic 5000% preview limit into a dynamic rc-image maxScale', () => {
    const baseScale = getPreviewBaseScale(
      { height: 257, width: 257 },
      { height: 1600, width: 1600 },
    )

    expect(Math.round(baseScale * 1000) / 1000).toBe(0.161)
    expect(Math.round(getPreviewMaxRcScaleForSemanticScale(baseScale, 50) * 100) / 100).toBe(311.28)
    expect(getPreviewMaxRcScaleForSemanticScale(0.6426, 50)).toBeCloseTo(77.81, 2)
  })
})
