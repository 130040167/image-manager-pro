export function resolveVisibleImageSourceState(options: {
  base64Src?: string
  needsBase64: boolean
  needsThumb: boolean
  renderedSrc: string
  thumbSrc?: string
  waitForThumbnail: boolean
}) {
  const { base64Src, needsBase64, needsThumb, renderedSrc, thumbSrc, waitForThumbnail } = options
  const hasUsableBase64 = needsBase64 && !!base64Src
  const shouldWaitForThumbnail = needsThumb && waitForThumbnail && !thumbSrc && !hasUsableBase64
  return {
    gridSrc: shouldWaitForThumbnail ? undefined : (thumbSrc || renderedSrc),
    shouldWaitForThumbnail,
    showThumbFallback: shouldWaitForThumbnail,
  }
}

export function shouldRequestViewportThumbnail(options: {
  needsBase64: boolean
  size: number
  threshold: number
}) {
  const { needsBase64, size, threshold } = options
  const hasKnownSize = size > 0
  return needsBase64 || (hasKnownSize && size > threshold)
}

export function shouldBlockOnViewportThumbnail(options: {
  needsBase64: boolean
  size: number
  threshold: number
}) {
  const { needsBase64 } = options
  // Browser-supported images (png/jpg/webp/...) must remain directly visible even
  // while the thumbnail queue is slow or broken. Unsupported formats (tif) still
  // need a generated thumbnail/base64 because the browser cannot render them.
  return needsBase64
}
