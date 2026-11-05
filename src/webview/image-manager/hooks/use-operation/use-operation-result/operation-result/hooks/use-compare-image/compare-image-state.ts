import { clamp } from 'es-toolkit'

export function clampCompareWidth(width: number, minWidth: number, maxWidth: number) {
  return clamp(width, minWidth, maxWidth)
}

export function createCompareZoomState(props: {
  imageWidth: number
  viewportWidth: number
}) {
  const { imageWidth, viewportWidth } = props
  const safeViewportWidth = Math.max(960, viewportWidth || 0)
  const baseWidth = clampCompareWidth(
    Math.max(imageWidth || 0, Math.round(safeViewportWidth * 0.82)),
    420,
    Math.round(safeViewportWidth * 0.92),
  )
  const minWidth = Math.max(320, Math.round(baseWidth * 0.5))
  const maxWidth = Math.max(
    Math.round(safeViewportWidth * 1.4),
    Math.round(baseWidth * 3.2),
  )
  return {
    baseWidth,
    minWidth,
    maxWidth,
    width: baseWidth,
  }
}

export function formatCompareZoomPercent(width: number, baseWidth: number) {
  const percent = Math.max(10, Math.round((width / Math.max(1, baseWidth)) * 100))
  return `${percent}%`
}
