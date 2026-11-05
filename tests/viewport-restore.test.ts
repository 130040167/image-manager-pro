import { describe, expect, it } from 'vitest'
import {
  createViewportStabilityState,
  isRestoreViewportCollapsed,
  shouldRestoreViewportOnVisible,
} from '../src/webview/image-manager/utils/viewport-restore'

describe('viewport restore guard', () => {
  it('treats a tiny restore viewport as collapsed when returning from a larger stable size', () => {
    expect(isRestoreViewportCollapsed({
      viewport: { width: 300, height: 150 },
      restoring: true,
      lastStableViewport: { width: 1621, height: 940 },
    })).toBe(true)
  })

  it('keeps normal visible viewports stable during ordinary resize', () => {
    expect(isRestoreViewportCollapsed({
      viewport: { width: 1280, height: 720 },
      restoring: false,
      lastStableViewport: { width: 1621, height: 940 },
    })).toBe(false)
  })

  it('does not enter restore mode on tab return when the viewport is already normal', () => {
    expect(shouldRestoreViewportOnVisible({
      viewport: { width: 1280, height: 720 },
      lastStableViewport: { width: 1621, height: 940 },
    })).toBe(false)
  })

  it('enters restore mode on tab return when VS Code reports a tiny viewport', () => {
    expect(shouldRestoreViewportOnVisible({
      viewport: { width: 300, height: 150 },
      lastStableViewport: { width: 1621, height: 940 },
    })).toBe(true)
  })

  it('still treats a tiny boot viewport as unstable before any stable size is known', () => {
    expect(isRestoreViewportCollapsed({
      viewport: { width: 300, height: 150 },
      restoring: true,
      lastStableViewport: null,
    })).toBe(true)
  })

  it('builds a stable state from an explicit viewport override', () => {
    const state = createViewportStabilityState({
      stable: true,
      visible: true,
      reason: 'stable',
      viewport: { width: 1440, height: 900 },
      lastStableViewport: { width: 1440, height: 900 },
    })

    expect(state.stable).toBe(true)
    expect(state.viewport).toEqual({ width: 1440, height: 900 })
    expect(state.lastStableViewport).toEqual({ width: 1440, height: 900 })
  })
})
