import { useEventListener, useMemoizedFn, useSize, useThrottleFn, useUpdateEffect } from 'ahooks'
import { ceil } from 'es-toolkit/compat'
import { useAtomValue } from 'jotai'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getAppRoot } from '~/webview/utils'
import { GlobalAtoms } from '../../stores/global/global-store'
import { LazyMarginScreenFactor } from '../../utils/meta'

type UseElementBottomStatusProps = {
  target: HTMLElement | null
  container: HTMLElement
  offset: number // 距离底部的偏移量
}

function useElementBottom({ target, offset, container = getAppRoot() }: UseElementBottomStatusProps) {
  const [isBottomInView, setIsBottomInView] = useState(false)
  const viewportStable = useAtomValue(GlobalAtoms.viewportStabilityAtom).stable
  const targetSize = useSize(target)
  const containerSize = useSize(container)

  const { run } = useThrottleFn(
    () => {
      if (!viewportStable) {
        setIsBottomInView(false)
        return
      }
      if (!target)
        return

      const targetRect = target.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()

      // offset 大意味着提前触发底部检测
      const isVisibleAroundViewport = targetRect.bottom >= containerRect.top - offset
        && targetRect.top <= containerRect.bottom + offset
      const isBottom = isVisibleAroundViewport
        && targetRect.bottom - offset <= containerRect.bottom

      setIsBottomInView(isBottom)
    },
    {
      wait: 16,
    },
  )

  useEventListener('scroll', run, {
    target: container,
  })

  useEffect(() => {
    if (!viewportStable) {
      setIsBottomInView(false)
      return
    }
    run()
  }, [container, containerSize?.height, containerSize?.width, offset, run, target, targetSize?.height, targetSize?.width, viewportStable])

  return [isBottomInView, setIsBottomInView] as const
}

type Props = {
  images: ImageType[]
  canLoadMoreImages?: boolean
  totalImageCount?: number
  pageSize: number
  /**
   * 如果index!==-1，则加载index位置的图片
   */
  index: number
  onNeedMoreImages?: () => Promise<{ ok?: boolean, timeout?: boolean } | void> | { ok?: boolean, timeout?: boolean } | void
} & Pick<UseElementBottomStatusProps, 'target' | 'container'>
export default function useLazyLoadImages(props: Props) {
  const { images, canLoadMoreImages, totalImageCount, onNeedMoreImages, pageSize, index, target, container = getAppRoot() } = props
  const safePageSize = Math.max(1, pageSize || 24)
  const totalAvailableImageCount = Math.max(totalImageCount || 0, images.length)

  const { rootVerticalMargin } = useLazyMargin()

  const [loadedImages, setLoadedImages] = useState<{
    images: ImageType[]
    page: number
  }>({
    images: images.slice(0, safePageSize),
    page: 1,
  })

  const [isBottomInView, setIsBottomInView] = useElementBottom({
    target,
    container,
    offset: rootVerticalMargin(0.8),
  })
  const waitingForRemotePage = useRef(false)
  const requestedRemoteWhileBottomVisible = useRef(false)

  const hasMoreLocal = loadedImages.images.length < images.length
  const hasMoreRemote = !!canLoadMoreImages || totalAvailableImageCount > images.length
  const hasMore = hasMoreLocal || hasMoreRemote

  const addImages = useMemoizedFn((pageNum: number) => {
    if (!images.length)
      return

    setLoadedImages(() => {
      const maxPage = Math.max(1, ceil(images.length / safePageSize))
      const nextPage = Math.min(Math.max(pageNum, 1), maxPage)
      const nextImages = images.slice(0, safePageSize * nextPage)

      return {
        images: nextImages,
        page: nextPage,
      }
    })

    setIsBottomInView(false)
  })

  const requestRemoteImages = useMemoizedFn(async (force = false) => {
    if (!hasMoreRemote || !onNeedMoreImages)
      return undefined

    if (!force && (waitingForRemotePage.current || requestedRemoteWhileBottomVisible.current))
      return undefined

    waitingForRemotePage.current = true
    requestedRemoteWhileBottomVisible.current = true
    try {
      const result = await Promise.resolve(onNeedMoreImages())
      if (result && typeof result === 'object' && ('timeout' in result || 'ok' in result) && (result.timeout || result.ok === false)) {
        requestedRemoteWhileBottomVisible.current = false
      }
      return result
    }
    finally {
      waitingForRemotePage.current = false
    }
  })

  /**
   * 追加下一页图片
   */
  const append = useMemoizedFn((manual = false) => {
    if (hasMoreLocal) {
      addImages(loadedImages.page + 1)
      return undefined
    }

    return requestRemoteImages(manual)
  })

  useUpdateEffect(() => {
    if (index !== -1) {
      const target = images[index]
      if (target) {
        const pageNum = ceil((index + 1) / safePageSize)
        addImages(pageNum)
      }
    }
  }, [index, safePageSize])

  // 后端 patch 触达（warmup / 邻居目录补图）会让父组件 imagesProp 引用变化。
  // 如果用 [images] 做依赖，每次 patch 都会重跑切片 + setLoadedImages，
  // 深层多目录场景下大量 ImageGroup 会同时抖动。
  // 用"长度 + 末项 path"作为指纹：只有真的有图增减时才触发。
  const imagesFingerprint = `${images.length}:${images[images.length - 1]?.path || ''}:${totalAvailableImageCount}:${canLoadMoreImages ? 1 : 0}`
  useUpdateEffect(() => {
    waitingForRemotePage.current = false
    requestedRemoteWhileBottomVisible.current = false
    if (!images.length) {
      setLoadedImages({
        images: [],
        page: 1,
      })
      return
    }

    const nextPage = loadedImages.images.length
      ? Math.min(loadedImages.page, Math.max(1, ceil(images.length / safePageSize)))
      : 1

    addImages(nextPage)
  }, [imagesFingerprint])

  useUpdateEffect(() => {
    if (!isBottomInView) {
      requestedRemoteWhileBottomVisible.current = false
      return
    }

    append(false)
  }, [isBottomInView])

  return [
    useMemo(() => loadedImages.images, [loadedImages.images]),
    useMemo(() => ({ hasMore, hasMoreLocal, hasMoreRemote }), [hasMore, hasMoreLocal, hasMoreRemote]),
    useMemo(() => ({
      append: () => append(false),
      ensureVisibleIndex: (targetIndex: number) => {
        if (targetIndex < 0) {
          return undefined
        }
        if (targetIndex < loadedImages.images.length) {
          return undefined
        }
        if (targetIndex < images.length) {
          addImages(ceil((targetIndex + 1) / safePageSize))
          return undefined
        }
        return requestRemoteImages(true)
      },
      loadMore: () => append(true),
    }), [addImages, append, images.length, loadedImages.images.length, requestRemoteImages, safePageSize]),
  ] as const
}

export function useLazyMargin() {
  const viewportState = useAtomValue(GlobalAtoms.viewportStabilityAtom)
  const screenHeight = useMemo(() => {
    return getAppRoot().getBoundingClientRect().height
  }, [])

  const { height } = useSize(getAppRoot()) || {}

  const rootVerticalMargin = useMemoizedFn(
    (rate: number = LazyMarginScreenFactor) => {
      const r = viewportState.lastStableViewport?.height || height || screenHeight
      return r * rate
    },
  )

  return {
    rootVerticalMargin,
  }
}
