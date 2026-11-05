import { useMemoizedFn, useSize } from 'ahooks'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { selectAtom } from 'jotai/utils'
import { memo, useEffect, useMemo, useRef } from 'react'
import { getAppRoot } from '~/webview/utils'
import { GlobalAtoms } from '../../stores/global/global-store'
import { useImageWidth, useViewportStable } from '../../stores/global/hooks'
import { imageStateAtom } from '../../stores/image/image-store'
import { LazyMarginScreenFactor } from '../../utils/meta'
import LazyImage from '../lazy-image'

function ImageForSize() {
  const image = useAtomValue(
    selectAtom(
      imageStateAtom,
      useMemoizedFn(state => state.workspaces[0]?.images[0]),
    ),
  )

  const setImagePlaceholderSize = useSetAtom(GlobalAtoms.imagePlaceholderSizeAtom)
  const [viewerPageSize, setViewerPageSize] = useAtom(GlobalAtoms.viewerPageSizeAtom)
  const [imageWidth] = useImageWidth()
  const viewportStable = useViewportStable()

  const imageForSize = useMemo(() => image, [image])
  const imageForSizeRef = useRef<HTMLDivElement>(null)
  const lastSizeRef = useRef<{ width: number, height: number } | null>(null)

  const size = useSize(imageForSizeRef)

  useEffect(() => {
    if (!viewportStable)
      return
    if (!size)
      return
    if (!size.width || !size.height)
      return
    // 只有尺寸变化超过 2px 才更新，避免切标签页时微小抖动触发全量重渲染
    const last = lastSizeRef.current
    if (last && Math.abs(last.width - size.width) < 2 && Math.abs(last.height - size.height) < 2)
      return
    lastSizeRef.current = { width: size.width, height: size.height }
    setImagePlaceholderSize(size)

    if (viewerPageSize)
      return
    const screen = getAppRoot().getBoundingClientRect()
    const screenWidth = screen.width
    const screenHeight = screen.height

    const pageSize = Math.floor(screenWidth / size.width) * Math.floor(screenHeight / size.height)
    const rate = LazyMarginScreenFactor
    setViewerPageSize(Math.floor(pageSize * rate))
  }, [setImagePlaceholderSize, setViewerPageSize, size, viewerPageSize, viewportStable])

  return imageForSize
    ? (
        <div ref={imageForSizeRef} className='fixed left-[-9999px] top-[-9999px]'>
          <LazyImage
            antdImageProps={{
              width: imageWidth,
              height: imageWidth,
              src: imageForSize.vscodePath,
            }}
            image={{
              ...imageForSize,
              path: '',
            }}
            lazy={false}
          />
        </div>
      )
    : null
}

export default memo(ImageForSize)
