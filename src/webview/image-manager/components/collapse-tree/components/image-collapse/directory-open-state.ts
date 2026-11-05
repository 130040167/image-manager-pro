export type DirectoryOpenReason = 'active-effect' | 'collapse-change' | 'click-toggle'

export function hasInitialImagePagePending(options: {
  canLoadMoreImages?: boolean
  childrenLoaded?: boolean
  loadedImageCount?: number
  totalImageCount?: number
}) {
  return !!options.childrenLoaded
    && (options.loadedImageCount || 0) === 0
    && ((options.totalImageCount ?? 0) > 0 || options.canLoadMoreImages === true)
}

export function needsDirectoryOpenRequest(options: {
  canLoadChildren?: boolean
  canLoadMoreImages?: boolean
  childrenLoaded?: boolean
  loadedImageCount?: number
  loadingChildren?: boolean
  totalImageCount?: number
}) {
  if (options.canLoadChildren === false || options.loadingChildren)
    return false

  return !options.childrenLoaded || hasInitialImagePagePending(options)
}

export function shouldSkipDuplicateDirectoryOpen(options: {
  hasInitialImagePagePending: boolean
  hasOpenRequestSession: boolean
  reason: DirectoryOpenReason
}) {
  return options.reason !== 'click-toggle'
    && options.hasOpenRequestSession
    && !options.hasInitialImagePagePending
}
