export type PixelTransform = {
  a: number
  b: number
  c: number
  d: number
  centerX: number
  centerY: number
  height: number
  width: number
}

/** Source pixel edges and pointer reads share the image's actual CSS transform. */
export function imagePixelToScreen(transform: PixelTransform, x: number, y: number) {
  const dx = x - transform.width / 2
  const dy = y - transform.height / 2
  return {
    x: transform.centerX + transform.a * dx + transform.c * dy,
    y: transform.centerY + transform.b * dx + transform.d * dy,
  }
}

export function screenToImagePixel(transform: PixelTransform, x: number, y: number) {
  const determinant = transform.a * transform.d - transform.b * transform.c
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12)
    return null
  const dx = x - transform.centerX
  const dy = y - transform.centerY
  return {
    imgX: (transform.d * dx - transform.c * dy) / determinant + transform.width / 2,
    imgY: (transform.a * dy - transform.b * dx) / determinant + transform.height / 2,
  }
}

export function getDisplayedPixelSize(transform: PixelTransform) {
  return Math.min(Math.hypot(transform.a, transform.b), Math.hypot(transform.c, transform.d))
}

export function readPreviewPixelTransform(image: HTMLImageElement, width: number, height: number): PixelTransform | null {
  const rect = image.getBoundingClientRect()
  const style = getComputedStyle(image)
  // clientWidth/clientHeight round fractional CSS dimensions; that error grows with zoom.
  const layoutWidth = Number.parseFloat(style.width)
  const layoutHeight = Number.parseFloat(style.height)
  if (!width || !height || !layoutWidth || !layoutHeight || !rect.width || !rect.height)
    return null
  const matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform)
  // Preview's entering/leaving animation may also scale an ancestor.
  const boundsWidth = Math.abs(matrix.a) * layoutWidth + Math.abs(matrix.c) * layoutHeight
  const boundsHeight = Math.abs(matrix.b) * layoutWidth + Math.abs(matrix.d) * layoutHeight
  if (!boundsWidth || !boundsHeight)
    return null
  const screenScaleX = rect.width / boundsWidth
  const screenScaleY = rect.height / boundsHeight
  return {
    a: matrix.a * layoutWidth / width * screenScaleX,
    b: matrix.b * layoutWidth / width * screenScaleY,
    c: matrix.c * layoutHeight / height * screenScaleX,
    d: matrix.d * layoutHeight / height * screenScaleY,
    centerX: rect.left + rect.width / 2,
    centerY: rect.top + rect.height / 2,
    width,
    height,
  }
}
