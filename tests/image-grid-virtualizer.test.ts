import { describe, expect, it } from 'vitest'
import { getInclusiveIndexRange, getScrollTopForVirtualIndex, getVirtualGridMetrics, getVirtualRowWindow } from '~/webview/image-manager/components/image-group/row-virtualizer'

describe('image grid row virtualizer', () => {
  it('keeps ten thousand images in layout while mounting only overscanned rows', () => {
    const metrics = getVirtualGridMetrics({ containerWidth: 1280, itemCount: 10_000, itemHeight: 170, itemWidth: 148 })
    const window = getVirtualRowWindow({
      columns: metrics.columns,
      itemCount: 10_000,
      listBottom: metrics.totalHeight,
      listTop: 0,
      overscanPx: 900,
      rowHeight: metrics.rowHeight,
      viewportBottom: 900,
      viewportTop: 0,
    })

    expect(metrics.columns).toBe(8)
    expect(metrics.totalRows).toBe(1250)
    expect(window.startIndex).toBe(0)
    expect(window.endIndex).toBeLessThanOrEqual(88)
  })

  it('maps a deep scroll position to complete rows and stable item indexes', () => {
    const metrics = getVirtualGridMetrics({ containerWidth: 1280, itemCount: 10_000, itemHeight: 170, itemWidth: 148 })
    const scrollTop = 100_000
    const window = getVirtualRowWindow({
      columns: metrics.columns,
      itemCount: 10_000,
      listBottom: metrics.totalHeight - scrollTop,
      listTop: -scrollTop,
      overscanPx: 900,
      rowHeight: metrics.rowHeight,
      viewportBottom: 900,
      viewportTop: 0,
    })

    expect(window.startIndex % metrics.columns).toBe(0)
    expect(window.endIndex - window.startIndex).toBeLessThanOrEqual(136)
    expect(window.startIndex).toBeGreaterThan(4_000)
  })

  it('centers a requested index without requiring its DOM node to exist', () => {
    const metrics = getVirtualGridMetrics({ containerWidth: 1280, itemCount: 10_000, itemHeight: 170, itemWidth: 148 })
    const target = getScrollTopForVirtualIndex({
      columns: metrics.columns,
      containerScrollTop: 0,
      itemHeight: 170,
      listTop: 120,
      rowHeight: metrics.rowHeight,
      targetIndex: 8_765,
      viewportHeight: 900,
      viewportTop: 0,
    })

    const targetRow = Math.floor(8_765 / metrics.columns)
    expect(target).toBeCloseTo(120 + targetRow * metrics.rowHeight - (900 - 170) / 2)
  })

  it('keeps forward and backward shift ranges inclusive across virtual windows', () => {
    expect(getInclusiveIndexRange(12, 8_765)).toHaveLength(8_754)
    expect(getInclusiveIndexRange(8_765, 12)).toEqual(getInclusiveIndexRange(12, 8_765).reverse())
  })
})
