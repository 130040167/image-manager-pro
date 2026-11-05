import { describe, expect, it } from 'vitest'
import {
  clampCompareWidth,
  createCompareZoomState,
  formatCompareZoomPercent,
} from '~/webview/image-manager/hooks/use-operation/use-operation-result/operation-result/hooks/use-compare-image/compare-image-state'

describe('compare image zoom state', () => {
  it('builds a large default compare viewport with explicit bounds', () => {
    const state = createCompareZoomState({
      imageWidth: 420,
      viewportWidth: 1280,
    })

    expect(state.baseWidth).toBeGreaterThanOrEqual(420)
    expect(state.maxWidth).toBeGreaterThan(state.baseWidth)
    expect(state.width).toBe(state.baseWidth)
  })

  it('clamps compare width into its legal range', () => {
    expect(clampCompareWidth(120, 320, 2400)).toBe(320)
    expect(clampCompareWidth(3200, 320, 2400)).toBe(2400)
    expect(clampCompareWidth(960, 320, 2400)).toBe(960)
  })

  it('formats compare zoom based on the fitted base width', () => {
    expect(formatCompareZoomPercent(960, 480)).toBe('200%')
    expect(formatCompareZoomPercent(480, 480)).toBe('100%')
  })
})
