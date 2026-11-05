export type CanvasSize = { height: number, width: number }
export type CanvasFrame = CanvasSize & { left: number, top: number }
export type CanvasPoint = { x: number, y: number }
export type PanePointEvent = {
  clientX: number
  clientY: number
}

export const CANVAS_FRAME_FALLBACK: CanvasFrame = { height: 1, left: 0, top: 0, width: 1 }

export const EDITOR_CANVAS_SELECTORS = [
  '.fp-canvas-mount .upper-canvas',
  '.fp-canvas-mount .lower-canvas',
  '.fp-canvas-mount canvas',
  '.fp-canvas-mount',
] as const

export function getElementSize(element: HTMLElement): CanvasSize | null {
  const width = Math.floor(element.clientWidth)
  const height = Math.floor(element.clientHeight)
  if (width > 0 && height > 0)
    return { height, width }
  return null
}

export function getEditorCanvasElement(mount: HTMLElement) {
  for (const selector of EDITOR_CANVAS_SELECTORS) {
    const element = mount.querySelector<HTMLElement>(selector)
    if (element)
      return element
  }
  return null
}

/**
 * 把指针事件映射到「图像像素坐标」（0..imageWidth / 0..imageHeight）。
 * 直接用画布元素的实时 bounding rect（已含 CSS zoom 的缩放），所以 zoom 无关：
 * imgX = (clientX - rect.left) / rect.width * imageWidth。
 * 返回 null 表示指针在画布之外。
 */
export function mapPointerToImagePixel(
  event: PanePointEvent,
  mount: HTMLElement | null,
  imageSize: CanvasSize,
  options: { clamp?: boolean } = {},
): CanvasPoint | null {
  if (!mount)
    return null
  const canvas = mount.querySelector<HTMLElement>('.fp-canvas-mount .upper-canvas')
    || mount.querySelector<HTMLElement>('.fp-canvas-mount .lower-canvas')
    || mount.querySelector<HTMLElement>('.fp-canvas-mount canvas')
  if (!canvas)
    return null
  const rect = canvas.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0)
    return null
  const nx = (event.clientX - rect.left) / rect.width
  const ny = (event.clientY - rect.top) / rect.height
  let x = nx * imageSize.width
  let y = ny * imageSize.height
  if (options.clamp) {
    x = Math.max(0, Math.min(imageSize.width, x))
    y = Math.max(0, Math.min(imageSize.height, y))
  }
  else if (nx < 0 || ny < 0 || nx > 1 || ny > 1) {
    return null
  }
  return { x, y }
}

export function getCanvasFrame(pane: HTMLElement, mount: HTMLElement | null): CanvasFrame | null {
  const target = mount ? getEditorCanvasElement(mount) : null
  const paneRect = pane.getBoundingClientRect()
  if (paneRect.width <= 0 || paneRect.height <= 0)
    return null

  if (!target) {
    return {
      height: Math.max(1, Math.floor(paneRect.height)),
      left: 0,
      top: 0,
      width: Math.max(1, Math.floor(paneRect.width)),
    }
  }

  const rect = target.getBoundingClientRect()
  const left = Math.max(0, rect.left - paneRect.left)
  const top = Math.max(0, rect.top - paneRect.top)
  const right = Math.min(paneRect.width, rect.right - paneRect.left)
  const bottom = Math.min(paneRect.height, rect.bottom - paneRect.top)
  const width = Math.floor(right - left)
  const height = Math.floor(bottom - top)
  if (width <= 0 || height <= 0)
    return null

  return {
    height,
    left: Math.floor(left),
    top: Math.floor(top),
    width,
  }
}

export function collectCanvasPoint(
  event: PanePointEvent,
  pane: HTMLElement | null,
  mount: HTMLElement | null,
  fallbackFrame: CanvasFrame,
) {
  if (!pane)
    return null
  const paneRect = pane.getBoundingClientRect()
  const frame = getCanvasFrame(pane, mount) || fallbackFrame
  if (paneRect.width <= 0 || paneRect.height <= 0 || frame.width <= 0 || frame.height <= 0)
    return null

  const x = event.clientX - paneRect.left - frame.left
  const y = event.clientY - paneRect.top - frame.top
  if (x < 0 || y < 0 || x > frame.width || y > frame.height)
    return null

  return {
    x: Math.max(0, Math.min(frame.width, x)),
    y: Math.max(0, Math.min(frame.height, y)),
  }
}

export function mapCanvasPointToImagePixel(
  point: CanvasPoint,
  frame: CanvasSize,
  imageSize: CanvasSize,
) {
  return {
    x: Math.max(0, Math.min(imageSize.width - 1, Math.floor((point.x / frame.width) * imageSize.width))),
    y: Math.max(0, Math.min(imageSize.height - 1, Math.floor((point.y / frame.height) * imageSize.height))),
  }
}

export function scaleCanvasPoints<T extends CanvasPoint>(points: T[], prev: CanvasSize, next: CanvasSize): T[] {
  const scaleX = prev.width > 0 ? next.width / prev.width : 1
  const scaleY = prev.height > 0 ? next.height / prev.height : 1
  if (prev.width <= 1 || prev.height <= 1 || (scaleX === 1 && scaleY === 1))
    return points
  return points.map(point => ({
    ...point,
    x: Math.max(0, point.x * scaleX),
    y: Math.max(0, point.y * scaleY),
  }))
}
