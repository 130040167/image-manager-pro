// 编辑器缩放阶梯与上下限。与预览页（image-group/index.tsx 的 ZOOM_LADDER）完全对齐：
// 下探到 10%，上探到 5000% / 50x。
// 编辑器缩放通过改写 canvas/container 的实际 CSS 布局尺寸实现（而不是 fabric 内部
// zoomToPoint）——后者会把画布裁剪成「固定窗口套在放大图上」的效果。布局尺寸 +
// 外层 overflow:auto 滚动，才是「图像真的变大、可整体查看」的正确模型。
export const EDITOR_ZOOM_LADDER = [10, 25, 40, 50, 60, 72, 86, 100, 125, 150, 195, 200, 280, 400, 640, 800, 1440, 1600, 2240, 2880, 3200, 4000, 5000] as const

export const EDITOR_MAX_ZOOM = 50
export const EDITOR_MIN_ZOOM = 0.1

/**
 * 阶梯式缩放：方向 +1 = 放大，-1 = 缩小。
 * 读取当前缩放百分比，跳到 EDITOR_ZOOM_LADDER 上的下一档。
 */
export function nextEditorZoomPercent(currentPercent: number, direction: 1 | -1): number {
  const eps = 0.5
  if (direction === 1) {
    for (const value of EDITOR_ZOOM_LADDER) {
      if (value > currentPercent + eps)
        return value
    }
    return EDITOR_ZOOM_LADDER[EDITOR_ZOOM_LADDER.length - 1]
  }
  for (let i = EDITOR_ZOOM_LADDER.length - 1; i >= 0; i--) {
    if (EDITOR_ZOOM_LADDER[i] < currentPercent - eps)
      return EDITOR_ZOOM_LADDER[i]
  }
  return EDITOR_ZOOM_LADDER[0]
}

/** 将任意缩放倍率夹到编辑器允许的 [0.1, 50] 区间，并保留两位小数。 */
export function clampEditorZoom(zoom: number): number {
  return Math.max(EDITOR_MIN_ZOOM, Math.min(EDITOR_MAX_ZOOM, Number(zoom.toFixed(2))))
}

export type EditorZoomLayoutElements = {
  canvasContainer?: HTMLElement | null
  canvases?: HTMLElement[]
  editor?: HTMLElement | null
  fabricContainer?: HTMLElement | null
}

export function getZoomedEditorSize(base: { height: number, width: number }, zoom: number) {
  return {
    height: Math.max(1, Math.round(base.height * zoom)),
    width: Math.max(1, Math.round(base.width * zoom)),
  }
}

function applyZoomedSize(element: HTMLElement | null | undefined, size: { height: number, width: number }) {
  if (!element)
    return
  if (element instanceof HTMLCanvasElement && element.dataset.editorPixelGrid === 'true')
    return
  element.style.width = `${size.width}px`
  element.style.height = `${size.height}px`
  element.style.maxWidth = 'none'
  element.style.maxHeight = 'none'
}

export function applyEditorZoomLayout(
  elements: EditorZoomLayoutElements,
  base: { height: number, width: number },
  zoom: number,
) {
  const size = getZoomedEditorSize(base, zoom)
  if (elements.editor)
    elements.editor.style.zoom = ''
  applyZoomedSize(elements.editor, size)
  if (elements.canvasContainer) {
    elements.canvasContainer.style.transform = ''
    elements.canvasContainer.style.transformOrigin = ''
  }
  applyZoomedSize(elements.canvasContainer, size)
  applyZoomedSize(elements.fabricContainer, size)
  for (const canvas of elements.canvases ?? [])
    applyZoomedSize(canvas, size)
  return size
}

export function getCenteredEditorScroll(metrics: {
  clientHeight: number
  clientWidth: number
  scrollHeight: number
  scrollWidth: number
}) {
  const scrollLeft = Math.max(0, Math.round((metrics.scrollWidth - metrics.clientWidth) / 2))
  const scrollTop = Math.max(0, Math.round((metrics.scrollHeight - metrics.clientHeight) / 2))
  return { scrollLeft, scrollTop }
}
