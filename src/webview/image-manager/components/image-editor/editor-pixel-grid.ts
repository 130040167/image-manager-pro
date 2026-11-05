import type { PixelTransform } from '../pixel-inspector/preview-pixel-grid'
import type { CanvasSize } from './canvas-frame'
import { screenToImagePixel } from '../pixel-inspector/preview-pixel-grid'
import { rotationComponents } from './image-geometry'

export function getEditorPixelTransform(params: {
  angle: number
  centerX: number
  centerY: number
  pixelWidth: number
  pixelHeight: number
  sourceSize: CanvasSize
}): PixelTransform {
  const { cos, sin } = rotationComponents(params.angle)
  return {
    a: cos * params.pixelWidth,
    b: sin * params.pixelHeight,
    c: -sin * params.pixelWidth,
    d: cos * params.pixelHeight,
    centerX: params.centerX,
    centerY: params.centerY,
    width: params.sourceSize.width,
    height: params.sourceSize.height,
  }
}

export function getRotatedEditorPixelWindow(transform: PixelTransform, width: number, height: number) {
  const corners = [[0, 0], [width, 0], [width, height], [0, height]].map(([x, y]) => screenToImagePixel(transform, x, y))
  if (corners.some(point => !point))
    return null
  const minX = Math.max(0, Math.floor(Math.min(...corners.map(point => point!.imgX))))
  const minY = Math.max(0, Math.floor(Math.min(...corners.map(point => point!.imgY))))
  const maxX = Math.min(transform.width - 1, Math.ceil(Math.max(...corners.map(point => point!.imgX))) - 1)
  const maxY = Math.min(transform.height - 1, Math.ceil(Math.max(...corners.map(point => point!.imgY))) - 1)
  return minX <= maxX && minY <= maxY ? { minX, minY, maxX, maxY } : null
}

export const EDITOR_GRAYSCALE_VALUE_MIN_PIXEL_SIZE = 14
export const EDITOR_RGB_VALUE_MIN_PIXEL_SIZE = 22
export const EDITOR_GRID_MAX_VALUE_PIXELS = 96 * 96

type Rect = {
  height: number
  left: number
  top: number
  width: number
}

export type EditorPixelWindow = {
  localHeight: number
  localLeft: number
  localTop: number
  localWidth: number
  maxX: number
  maxY: number
  minX: number
  minY: number
  pixelHeight: number
  pixelWidth: number
}

export function getVisibleEditorPixelWindow(params: {
  canvasRect: Rect
  imageSize: CanvasSize
  viewportRect: Rect
}): EditorPixelWindow | null {
  const { canvasRect, imageSize, viewportRect } = params
  if (
    canvasRect.width <= 0
    || canvasRect.height <= 0
    || imageSize.width <= 0
    || imageSize.height <= 0
    || viewportRect.width <= 0
    || viewportRect.height <= 0
  ) {
    return null
  }

  const visibleLeft = Math.max(canvasRect.left, viewportRect.left)
  const visibleTop = Math.max(canvasRect.top, viewportRect.top)
  const visibleRight = Math.min(canvasRect.left + canvasRect.width, viewportRect.left + viewportRect.width)
  const visibleBottom = Math.min(canvasRect.top + canvasRect.height, viewportRect.top + viewportRect.height)
  if (visibleLeft >= visibleRight || visibleTop >= visibleBottom)
    return null

  const localLeft = visibleLeft - canvasRect.left
  const localTop = visibleTop - canvasRect.top
  const localWidth = visibleRight - visibleLeft
  const localHeight = visibleBottom - visibleTop
  const pixelWidth = canvasRect.width / imageSize.width
  const pixelHeight = canvasRect.height / imageSize.height
  if (pixelWidth <= 0 || pixelHeight <= 0)
    return null

  // Include clipped edge cells; panning must not drop a pixel before it leaves the viewport.
  const minX = Math.max(0, Math.min(imageSize.width - 1, Math.floor(localLeft / pixelWidth)))
  const minY = Math.max(0, Math.min(imageSize.height - 1, Math.floor(localTop / pixelHeight)))
  const maxX = Math.max(minX, Math.min(imageSize.width - 1, Math.ceil((localLeft + localWidth) / pixelWidth) - 1))
  const maxY = Math.max(minY, Math.min(imageSize.height - 1, Math.ceil((localTop + localHeight) / pixelHeight) - 1))
  return {
    localHeight,
    localLeft,
    localTop,
    localWidth,
    maxX,
    maxY,
    minX,
    minY,
    pixelHeight,
    pixelWidth,
  }
}

export function shouldShowEditorPixelValues(pixelSize: number, channels: number) {
  const threshold = channels === 1 ? EDITOR_GRAYSCALE_VALUE_MIN_PIXEL_SIZE : EDITOR_RGB_VALUE_MIN_PIXEL_SIZE
  return pixelSize >= threshold
}

export function shouldShowEditorPixelOverlay(params: {
  channels: number
  pixelCount: number
  pixelSize: number
}) {
  const { channels, pixelCount, pixelSize } = params
  return pixelCount > 0
    && pixelCount <= EDITOR_GRID_MAX_VALUE_PIXELS
    && shouldShowEditorPixelValues(pixelSize, channels)
}
