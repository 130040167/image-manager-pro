export type ViewportSize = {
  width: number
  height: number
}

export type ViewportStabilityReason = 'boot' | 'hidden' | 'restore-collapsed' | 'stable'

export type ViewportStabilityState = {
  stable: boolean
  visible: boolean
  reason: ViewportStabilityReason
  viewport: ViewportSize
  lastStableViewport: ViewportSize | null
}

export const TRANSIENT_TINY_VIEWPORT_MAX_WIDTH = 360
export const TRANSIENT_TINY_VIEWPORT_MAX_HEIGHT = 240

export function readViewportSize(): ViewportSize {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { width: 0, height: 0 }
  }

  return {
    width: Math.max(window.innerWidth || 0, document.documentElement?.clientWidth || 0),
    height: Math.max(window.innerHeight || 0, document.documentElement?.clientHeight || 0),
  }
}

export function isTinyViewport(viewport: ViewportSize) {
  return viewport.width > 0
    && viewport.height > 0
    && viewport.width <= TRANSIENT_TINY_VIEWPORT_MAX_WIDTH
    && viewport.height <= TRANSIENT_TINY_VIEWPORT_MAX_HEIGHT
}

export function isRestoreViewportCollapsed(args: {
  viewport: ViewportSize
  restoring: boolean
  lastStableViewport?: ViewportSize | null
}) {
  const { viewport, restoring, lastStableViewport } = args

  if (viewport.width <= 0 || viewport.height <= 0)
    return true

  if (restoring && isTinyViewport(viewport))
    return true

  if (!restoring || !lastStableViewport)
    return false

  const widthRatio = viewport.width / Math.max(lastStableViewport.width, 1)
  const heightRatio = viewport.height / Math.max(lastStableViewport.height, 1)
  const areaRatio = (viewport.width * viewport.height) / Math.max(lastStableViewport.width * lastStableViewport.height, 1)

  return widthRatio <= 0.55 && heightRatio <= 0.55 && areaRatio <= 0.35
}

export function shouldRestoreViewportOnVisible(args: {
  viewport: ViewportSize
  lastStableViewport?: ViewportSize | null
}) {
  return isRestoreViewportCollapsed({
    viewport: args.viewport,
    restoring: true,
    lastStableViewport: args.lastStableViewport,
  })
}

export function createViewportStabilityState(
  override: Partial<ViewportStabilityState> = {},
): ViewportStabilityState {
  const viewport = override.viewport || readViewportSize()
  const visible = override.visible ?? (typeof document === 'undefined' ? true : document.visibilityState !== 'hidden')
  const stable = override.stable ?? (visible && viewport.width > 0 && viewport.height > 0)

  return {
    stable,
    visible,
    reason: override.reason || (stable ? 'stable' : visible ? 'boot' : 'hidden'),
    viewport,
    lastStableViewport: override.lastStableViewport ?? (stable ? viewport : null),
  }
}
