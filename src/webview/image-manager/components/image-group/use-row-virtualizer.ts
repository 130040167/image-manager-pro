import { useEventListener, useSize } from 'ahooks'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getScrollTopForVirtualIndex,
  getVirtualGridMetrics,
  getVirtualRowWindow,
  IMAGE_GRID_GAP,
  IMAGE_GRID_OVERSCAN_VIEWPORTS,
} from './row-virtualizer'

type Props = {
  container: HTMLElement
  enabled: boolean
  itemCount: number
  itemHeight: number
  itemWidth: number
  list: HTMLElement | null
}

export default function useRowVirtualizer(props: Props) {
  const { container, enabled, itemCount, itemHeight, itemWidth, list } = props
  const listSize = useSize(list)
  const containerSize = useSize(container)
  const frameRef = useRef(0)
  const metrics = useMemo(() => getVirtualGridMetrics({
    containerWidth: listSize?.width || list?.clientWidth || itemWidth,
    gap: IMAGE_GRID_GAP,
    itemCount,
    itemHeight,
    itemWidth,
  }), [itemCount, itemHeight, itemWidth, list, listSize?.width])
  const [windowRange, setWindowRange] = useState({ endIndex: Math.min(itemCount, 100), offsetTop: 0, startIndex: 0 })

  const measure = useCallback(() => {
    if (!enabled || !list) {
      setWindowRange(previous => previous.startIndex === 0 && previous.endIndex === itemCount && previous.offsetTop === 0
        ? previous
        : { endIndex: itemCount, offsetTop: 0, startIndex: 0 })
      return
    }
    const listRect = list.getBoundingClientRect()
    const viewportRect = container.getBoundingClientRect()
    const next = getVirtualRowWindow({
      columns: metrics.columns,
      itemCount,
      listBottom: listRect.bottom,
      listTop: listRect.top,
      overscanPx: viewportRect.height * IMAGE_GRID_OVERSCAN_VIEWPORTS,
      rowHeight: metrics.rowHeight,
      viewportBottom: viewportRect.bottom,
      viewportTop: viewportRect.top,
    })
    setWindowRange(previous => previous.startIndex === next.startIndex && previous.endIndex === next.endIndex && previous.offsetTop === next.offsetTop ? previous : next)
  }, [container, enabled, itemCount, list, metrics.columns, metrics.rowHeight])

  const scheduleMeasure = useCallback(() => {
    if (frameRef.current)
      return
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = 0
      measure()
    })
  }, [measure])

  useEventListener('scroll', scheduleMeasure, { target: container })
  useEventListener('resize', scheduleMeasure, { target: window })

  useEffect(() => {
    measure()
    return () => {
      if (frameRef.current)
        window.cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
    }
  }, [containerSize?.height, containerSize?.width, listSize?.height, listSize?.width, measure])

  const scrollToIndex = useCallback((targetIndex: number) => {
    if (!list || targetIndex < 0 || targetIndex >= itemCount)
      return
    const listRect = list.getBoundingClientRect()
    const viewportRect = container.getBoundingClientRect()
    container.scrollTo({
      behavior: 'auto',
      top: getScrollTopForVirtualIndex({
        columns: metrics.columns,
        containerScrollTop: container.scrollTop,
        itemHeight,
        listTop: listRect.top,
        rowHeight: metrics.rowHeight,
        targetIndex,
        viewportHeight: viewportRect.height,
        viewportTop: viewportRect.top,
      }),
    })
    scheduleMeasure()
  }, [container, itemCount, itemHeight, list, metrics.columns, metrics.rowHeight, scheduleMeasure])

  return {
    ...metrics,
    ...windowRange,
    scrollToIndex,
  }
}
