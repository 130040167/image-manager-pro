export const IMAGE_GRID_GAP = 6
export const IMAGE_GRID_OVERSCAN_VIEWPORTS = 1
export const IMAGE_GRID_VIRTUALIZE_THRESHOLD = 80

export type VirtualGridMetrics = {
  columns: number
  rowHeight: number
  totalHeight: number
  totalRows: number
}

export type VirtualRowWindow = {
  endIndex: number
  offsetTop: number
  startIndex: number
}

export function getInclusiveIndexRange(startIndex: number, endIndex: number): number[] {
  if (startIndex < 0 || endIndex < 0)
    return []
  const direction = endIndex >= startIndex ? 1 : -1
  const indexes: number[] = []
  for (let index = startIndex; direction > 0 ? index <= endIndex : index >= endIndex; index += direction)
    indexes.push(index)
  return indexes
}

export function getVirtualGridMetrics(params: {
  containerWidth: number
  gap?: number
  itemCount: number
  itemHeight: number
  itemWidth: number
}): VirtualGridMetrics {
  const gap = Math.max(0, params.gap ?? IMAGE_GRID_GAP)
  const itemWidth = Math.max(1, params.itemWidth)
  const itemHeight = Math.max(1, params.itemHeight)
  const columns = Math.max(1, Math.floor((Math.max(0, params.containerWidth) + gap) / (itemWidth + gap)))
  const totalRows = Math.ceil(Math.max(0, params.itemCount) / columns)
  const rowHeight = itemHeight + gap
  return {
    columns,
    rowHeight,
    totalHeight: totalRows > 0 ? totalRows * rowHeight - gap : 0,
    totalRows,
  }
}

export function getVirtualRowWindow(params: {
  columns: number
  itemCount: number
  listBottom: number
  listTop: number
  overscanPx: number
  rowHeight: number
  viewportBottom: number
  viewportTop: number
}): VirtualRowWindow {
  const { columns, itemCount, listBottom, listTop, rowHeight, viewportBottom, viewportTop } = params
  const totalRows = Math.ceil(itemCount / columns)
  if (itemCount <= 0 || totalRows <= 0) {
    return { endIndex: 0, offsetTop: 0, startIndex: 0 }
  }

  const overscanPx = Math.max(0, params.overscanPx)
  const visibleTop = Math.max(0, viewportTop - listTop - overscanPx)
  const visibleBottom = Math.min(listBottom - listTop, viewportBottom - listTop + overscanPx)
  if (visibleBottom <= 0) {
    return { endIndex: Math.min(itemCount, columns), offsetTop: 0, startIndex: 0 }
  }
  if (visibleTop >= listBottom - listTop) {
    const startRow = Math.max(0, totalRows - 1)
    return {
      endIndex: itemCount,
      offsetTop: startRow * rowHeight,
      startIndex: startRow * columns,
    }
  }

  const startRow = Math.max(0, Math.floor(visibleTop / rowHeight))
  const endRow = Math.min(totalRows, Math.ceil(Math.max(visibleBottom, 0) / rowHeight))
  return {
    endIndex: Math.min(itemCount, Math.max(startRow + 1, endRow) * columns),
    offsetTop: startRow * rowHeight,
    startIndex: startRow * columns,
  }
}

export function getScrollTopForVirtualIndex(params: {
  columns: number
  containerScrollTop: number
  itemHeight: number
  listTop: number
  rowHeight: number
  targetIndex: number
  viewportHeight: number
  viewportTop: number
}): number {
  const row = Math.floor(Math.max(0, params.targetIndex) / Math.max(1, params.columns))
  const rowTopInViewport = params.listTop + row * params.rowHeight
  return Math.max(0, params.containerScrollTop + rowTopInViewport - params.viewportTop - (params.viewportHeight - params.itemHeight) / 2)
}
