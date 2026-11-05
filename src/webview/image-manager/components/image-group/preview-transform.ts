export type PreviewPoint = { x: number, y: number }
export type PreviewSize = { height: number, width: number }
export type PreviewRect = PreviewPoint & PreviewSize
export type PreviewTransform = PreviewPoint & { scale: number }

export function getPreviewBaseScale(
  layoutSize?: PreviewSize | null,
  naturalSize?: PreviewSize | null,
): number {
  if (!naturalSize?.width || !naturalSize?.height || !layoutSize?.width || !layoutSize?.height)
    return 1
  const scaleX = layoutSize.width / naturalSize.width
  const scaleY = layoutSize.height / naturalSize.height
  const scale = Math.min(scaleX, scaleY)
  return Number.isFinite(scale) && scale > 0 ? scale : 1
}

export function getPreviewMaxRcScaleForSemanticScale(
  previewBaseScale: number,
  maxSemanticScale: number,
): number {
  const base = Number.isFinite(previewBaseScale) && previewBaseScale > 0 ? previewBaseScale : 1
  const max = maxSemanticScale / Math.max(base, 0.0001)
  return Number.isFinite(max) && max > 0 ? max : maxSemanticScale
}

export function getDefaultPreviewPositionForViewport(
  viewport: PreviewSize,
  options: { fitPadding: number, toolbarSafeBottom: number },
): PreviewPoint {
  const viewportHeight = viewport.height
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0)
    return { x: 0, y: 0 }
  const usableHeight = Math.max(0, viewportHeight - options.fitPadding - options.toolbarSafeBottom)
  const usableCenterY = options.fitPadding + usableHeight / 2
  return {
    x: 0,
    y: usableCenterY - viewportHeight / 2,
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function calculateAnchoredPreviewTransform(params: {
  anchor?: PreviewPoint
  current: PreviewTransform
  defaultPosition: PreviewPoint
  fitPadding: number
  layoutSize?: PreviewSize | null
  recenterFittingAxes?: boolean
  targetScale: number
  toolbarSafeBottom: number
  viewport: PreviewSize
}): PreviewTransform {
  const { anchor, current, defaultPosition, fitPadding, layoutSize, recenterFittingAxes = true, targetScale, toolbarSafeBottom, viewport } = params
  const viewportCenter = {
    x: viewport.width / 2,
    y: viewport.height / 2,
  }
  const available = {
    height: Math.max(0, viewport.height - fitPadding - toolbarSafeBottom),
    width: Math.max(0, viewport.width - fitPadding * 2),
  }
  const scaled = layoutSize
    ? {
        height: layoutSize.height * targetScale,
        width: layoutSize.width * targetScale,
      }
    : null

  if (!anchor || !scaled) {
    return { ...defaultPosition, scale: targetScale }
  }

  const currentScale = Number.isFinite(current.scale) && current.scale > 0 ? current.scale : 1
  const anchorInViewport = {
    x: anchor.x - viewportCenter.x,
    y: anchor.y - viewportCenter.y,
  }
  const next = {
    x: anchorInViewport.x - ((anchorInViewport.x - current.x) / currentScale) * targetScale,
    y: anchorInViewport.y - ((anchorInViewport.y - current.y) / currentScale) * targetScale,
  }

  if (scaled.width <= available.width) {
    if (recenterFittingAxes)
      next.x = defaultPosition.x
  }
  else {
    const overflow = Math.max(0, (scaled.width - available.width) / 2)
    next.x = clamp(next.x, defaultPosition.x - overflow, defaultPosition.x + overflow)
  }

  if (scaled.height <= available.height) {
    if (recenterFittingAxes)
      next.y = defaultPosition.y
  }
  else {
    const overflow = Math.max(0, (scaled.height - available.height) / 2)
    next.y = clamp(next.y, defaultPosition.y - overflow, defaultPosition.y + overflow)
  }

  return { ...next, scale: targetScale }
}

export function calculateCenterOriginAnchoredPreviewTransform(params: {
  anchor: PreviewPoint
  basePosition: PreviewPoint
  currentRect: PreviewRect
  defaultPosition?: PreviewPoint
  fitPadding?: number
  layoutSize: PreviewSize
  targetScale: number
  toolbarSafeBottom?: number
  viewport?: PreviewSize
  visualSize?: PreviewSize
}): PreviewTransform {
  const { anchor, basePosition, currentRect, defaultPosition, fitPadding = 0, layoutSize, targetScale, toolbarSafeBottom = 0, viewport, visualSize } = params
  const anchorInImage = {
    x: ((anchor.x - currentRect.x) / currentRect.width) * layoutSize.width,
    y: ((anchor.y - currentRect.y) / currentRect.height) * layoutSize.height,
  }
  const next = {
    scale: targetScale,
    x: anchor.x - basePosition.x - anchorInImage.x * targetScale - layoutSize.width * (1 - targetScale) / 2,
    y: anchor.y - basePosition.y - anchorInImage.y * targetScale - layoutSize.height * (1 - targetScale) / 2,
  }

  if (!viewport || !defaultPosition)
    return next

  const bounds = {
    bottom: Math.max(fitPadding, viewport.height - toolbarSafeBottom),
    left: fitPadding,
    right: Math.max(fitPadding, viewport.width - fitPadding),
    top: fitPadding,
  }
  const available = {
    height: Math.max(0, bounds.bottom - bounds.top),
    width: Math.max(0, bounds.right - bounds.left),
  }
  const fitSize = visualSize || layoutSize
  const scaled = {
    height: fitSize.height * targetScale,
    width: fitSize.width * targetScale,
  }

  if (scaled.width <= available.width && scaled.height <= available.height) {
    return { ...defaultPosition, scale: targetScale }
  }

  const centerOffsetX = layoutSize.width / 2 - scaled.width / 2
  if (scaled.width > available.width) {
    next.x = clamp(
      next.x,
      bounds.right - scaled.width - basePosition.x - centerOffsetX,
      bounds.left - basePosition.x - centerOffsetX,
    )
  }

  const centerOffsetY = layoutSize.height / 2 - scaled.height / 2
  if (scaled.height > available.height) {
    next.y = clamp(
      next.y,
      bounds.bottom - scaled.height - basePosition.y - centerOffsetY,
      bounds.top - basePosition.y - centerOffsetY,
    )
  }

  return next
}
