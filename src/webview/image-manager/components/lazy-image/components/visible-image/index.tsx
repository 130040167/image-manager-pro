import type { GetProps } from 'antd'
import type lazyImage from '../..'
import { useMemoizedFn } from 'ahooks'
import { Image } from 'antd'
import { useAtomValue } from 'jotai'
import { selectAtom } from 'jotai/utils'
import { memo, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FiCheckCircle } from 'react-icons/fi'
import { HiOutlineViewfinderCircle } from 'react-icons/hi2'
import { MdOutlineRemoveCircle } from 'react-icons/md'
import { RiErrorWarningLine } from 'react-icons/ri'
import { RxDimensions } from 'react-icons/rx'
import { TbResize } from 'react-icons/tb'
import { DEFAULT_CONFIG } from '~/core/config/common'
import { Compressed } from '~/meta'
import useImageDetails from '~/webview/image-manager/hooks/use-image-details/use-image-details'
import { useImageWidth } from '~/webview/image-manager/stores/global/hooks'
import { useCustomFormats, useHoverShowImageDetail } from '~/webview/image-manager/stores/settings/hooks'
import { VscodeAtoms } from '~/webview/image-manager/stores/vscode/vscode-store'
import { bytesToUnit, formatBytes } from '~/webview/image-manager/utils'
import {
  fetchImageMetadata,
  getCachedImageMeta,
} from '~/webview/image-manager/utils/image-metadata-cache'
import {
  fetchThumbnail,
  getCachedThumbnail,
} from '~/webview/image-manager/utils/thumbnail-cache'
import { classNames } from '~/webview/image-manager/utils/tw-clsx'
import {
  getCachedUnsupportedBase64,
  getStableSrcForUnsupported,
  isUnsupportedImage,
} from '~/webview/image-manager/utils/unsupported-image-cache'
import { vscodeApi } from '~/webview/vscode-api'
import { isCustomFormatImageWithConfig } from '../../../custom-format-toolbar/session'
import ImageName from '../../../image-name'
import Corner from '../corner'
import styles from './index.module.css'
import { resolveVisibleImageSourceState, shouldBlockOnViewportThumbnail, shouldRequestViewportThumbnail } from './source-state'

type VisibleImageProps = {} & Omit<
  GetProps<typeof lazyImage>,
  keyof Pick<GetProps<typeof lazyImage>, 'lazy' | 'className' | 'inViewer'>
>

function VisibleImage(props: VisibleImageProps) {
  const {
    image,
    selected,
    onPreviewClick,
    onRemoveClick,
    antdImageProps,
    imageNameProps,
    onContextMenu,
    interactive = true,
  } = props

  const removeRender = useMemoizedFn(props.removeRender || (children => children))
  const isMultipleSelecting = useMemoizedFn(props.isMultipleSelecting || (() => false))

  const { t } = useTranslation()
  const { showImageDetails } = useImageDetails()

  const [hoverShowImageDetail] = useHoverShowImageDetail()
  const [customFormats] = useCustomFormats()

  const [imageWidth] = useImageWidth()
  const warningSize = useAtomValue(
    selectAtom(
      VscodeAtoms.extConfigAtom,
      useMemoizedFn(state => state.viewer.warningSize),
    ),
  )
  const imageRendering = useAtomValue(
    selectAtom(
      VscodeAtoms.extConfigAtom,
      useMemoizedFn(state => state.viewer.imageRendering),
    ),
  )

  const imageStyle = useMemo(
    () => ({
      imageRendering,
      ...antdImageProps.style,
    }),
    [imageRendering, antdImageProps.style],
  )

  // 浏览器不支持的格式（如 TIF）：进入视口时才向 vscode 请求 base64，
  // 避免在初始扫描阶段对每张图都做 sharp 解码。
  const isCustomImage = isCustomFormatImageWithConfig(image, customFormats)
  const needsBase64 = isUnsupportedImage(image) || isCustomImage
  const cachedBase64 = needsBase64 ? getCachedUnsupportedBase64(image.path) : undefined
  const base64Src = cachedBase64

  const renderedSrc = needsBase64 ? base64Src || getStableSrcForUnsupported(image.path) : image.vscodePath

  // 已知大图/浏览器不支持的图片使用缩略图加速网格加载。未知大小的普通图片先直接显示，
  // 等 metadata 回来确认是大图后再后台换缩略图。TIF 不在网格里转整图 base64，
  // 否则一屏几十张图会同时触发 sharp -> PNG base64，深层目录会被解码风暴拖住。
  const THUMB_SIZE_THRESHOLD = 512 * 1024
  const initialMeta = getCachedImageMeta(image.path)
  // 按需懒加载 metadata（width/height/compressed）。初始扫描已不再批量预读，
  // 只有图片真正进入视口（VisibleImage 渲染）时才向 vscode 请求一次，结果缓存到内存里。
  const [extraMeta, setExtraMeta] = useState<{
    metadata: Metadata
    compressed: Compressed
    stats?: Pick<ImageType['stats'], 'mtimeMs' | 'size'>
  } | undefined>(
    () => {
      if (initialMeta) {
        return initialMeta
      }
      // 已经有从扫描阶段带过来的非空 metadata 时直接复用，避免再请求一次
      if (image.info.metadata?.width || image.info.metadata?.height) {
        return { metadata: image.info.metadata, compressed: image.info.compressed }
      }
      return undefined
    },
  )

  useEffect(() => {
    if (extraMeta) {
      return
    }
    let cancelled = false
    fetchImageMetadata(image.path).then((res) => {
      if (!cancelled) {
        setExtraMeta(res)
      }
    })
    return () => {
      cancelled = true
    }
  }, [image.path, extraMeta])

  const visibleStats = extraMeta?.stats || initialMeta?.stats || image.stats
  const initialVisibleStats = initialMeta?.stats || image.stats
  const needsThumb = shouldRequestViewportThumbnail({
    needsBase64,
    size: visibleStats.size,
    threshold: THUMB_SIZE_THRESHOLD,
  })
  const waitForThumbnail = shouldBlockOnViewportThumbnail({
    needsBase64,
    size: initialVisibleStats.size,
    threshold: THUMB_SIZE_THRESHOLD,
  })
  const [thumbSrc, setThumbSrc] = useState<string | undefined>(() => needsThumb ? getCachedThumbnail(image.path) : undefined)
  const [thumbState, setThumbState] = useState<'idle' | 'loading' | 'failed'>('idle')
  const [imageLoadFailed, setImageLoadFailed] = useState(false)

  useEffect(() => {
    setThumbSrc(needsThumb ? getCachedThumbnail(image.path) : undefined)
    setThumbState('idle')
    setImageLoadFailed(false)
  }, [image.path, needsThumb])

  useEffect(() => {
    if (!needsThumb || thumbSrc) {
      return
    }
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const retryDelays = [1_500, 6_000, 15_000]

    const request = (attempt: number) => {
      setThumbState('loading')
      fetchThumbnail(image.path).then((url) => {
        if (cancelled) {
          return
        }
        if (url) {
          setThumbSrc(url)
          setThumbState('idle')
          return
        }
        if (attempt < retryDelays.length) {
          retryTimer = setTimeout(() => request(attempt + 1), retryDelays[attempt])
          return
        }
        vscodeApi.log('warn', 'visible image thumbnail failed after retries', {
          attempts: attempt + 1,
          filePath: image.path,
          needsBase64,
          needsThumb,
        })
        setThumbState('failed')
      })
    }

    request(0)
    return () => {
      cancelled = true
      if (retryTimer) {
        clearTimeout(retryTimer)
      }
    }
  }, [needsBase64, needsThumb, image.path, thumbSrc])

  const { gridSrc, shouldWaitForThumbnail, showThumbFallback } = resolveVisibleImageSourceState({
    base64Src,
    needsBase64,
    needsThumb,
    renderedSrc,
    thumbSrc,
    waitForThumbnail,
  })
  const showBrokenFallback = imageLoadFailed || (showThumbFallback && thumbState === 'failed')
  const fallbackExt = (image.extname || 'img').toUpperCase()

  useEffect(() => {
    vscodeApi.log('debug', 'visible image source selected', {
      filePath: image.path,
      gridSrcPrefix: gridSrc?.slice(0, 96),
      hasBase64Src: !!base64Src,
      hasRenderedSrc: !!renderedSrc,
      hasThumbSrc: !!thumbSrc,
      imageSize: image.stats?.size,
      needsBase64,
      needsThumb,
      shouldWaitForThumbnail,
      showThumbFallback,
      thumbState,
      waitForThumbnail,
    })
  }, [
    base64Src,
    gridSrc,
    image.path,
    image.stats?.size,
    needsBase64,
    needsThumb,
    renderedSrc,
    shouldWaitForThumbnail,
    showThumbFallback,
    thumbSrc,
    thumbState,
    waitForThumbnail,
  ])

  const imageMetadata = useMemo(() => {
    if (extraMeta) {
      return {
        compressed: extraMeta.compressed,
        metadata: extraMeta.metadata,
      }
    }
    return {
      compressed: image.info.compressed,
      metadata: image.info.metadata,
    }
  }, [extraMeta, image.info.compressed, image.info.metadata])

  const imageStats = extraMeta?.stats || image.stats

  const sizeWarning = useMemo((): boolean => {
    if (!!warningSize && bytesToUnit(imageStats.size, 'KB') > warningSize) {
      return true
    }
    return false
  }, [imageStats.size, warningSize])

  /**
   * @param depth 父元素查找深度，默认向上查找3层，如果查不到 [data-disable-dbclick] 元素，则可以双击
   */
  const preventDbClick = useMemoizedFn((el: HTMLElement, depth: number = 3) => {
    let parent = el
    let count = 0
    while (parent) {
      if (count > depth) {
        return false
      }
      if (parent.getAttribute('data-disable-dbclick')) {
        // prevent double-click
        return true
      }
      parent = parent.parentElement!
      count++
    }

    return false
  })

  const computedMaskFontSize = useMemo(() => {
    const base = 0.875 // 基础字体大小 text-sm 0.875rem
    const factor = 0.001 // 比例因子
    return base + (imageWidth - DEFAULT_CONFIG.viewer.imageWidth) * factor
  }, [imageWidth])

  const previewMask = useMemo(() => {
    return (
      <div
        className='flex size-full flex-col items-center justify-center'
        style={{
          fontSize: `${computedMaskFontSize}rem`,
        }}
      >
        {onPreviewClick && (
          <div
            className={classNames(
              'flex cursor-pointer items-center space-x-1 truncate transition-opacity hover:opacity-85',
            )}
            data-disable-dbclick
          >
            <HiOutlineViewfinderCircle />
            <span>{t('im.preview')}</span>
          </div>
        )}
        <div className='flex items-center space-x-1 truncate'>
          <TbResize />
          <span className={classNames(sizeWarning && 'text-ant-color-warning-text')}>
            {imageStats.size ? formatBytes(imageStats.size) : '-'}
          </span>
        </div>
        {imageMetadata.metadata.width && imageMetadata.metadata.height
          ? (
              <div className='flex items-center space-x-1 truncate'>
                <RxDimensions />
                <span className='flex items-center'>
                  {imageMetadata.metadata.width}
                  x
                  {imageMetadata.metadata.height}
                </span>
              </div>
            )
          : null}
        {imageMetadata.compressed === Compressed.yes
          ? (
              <div className='flex items-center space-x-1 truncate'>
                <FiCheckCircle />
                <span>{t('im.compressed')}</span>
              </div>
            )
          : null}
      </div>
    )
  }, [computedMaskFontSize, image, imageMetadata, t])

  const imagePreivew = useMemo(() => {
    // 始终关闭 antd Image 自带的点击预览。原因：
    // rc-image PreviewGroup 在 fromItems 模式下用 src 做 findIndex 来定位 current，
    // 一旦多张未就绪 TIF 共享空 src（或我们用的稳定占位 src），它们彼此可区分，
    // 但是 rc-image 在我们的 PreviewGroup 里使用的是 group context onPreview——
    // 该路径仍然要按 src 匹配。如果同名占位换了实现细节，匹配就会错位。
    // 所以：所有点击进入预览的入口都强制走 path-based 的 onPreviewClick。
    // mask 仍然显示，但点击 mask 任意位置都会 stopPropagation 后调 onPreviewClick。
    return false as const
  }, [])

  const compressedMap = useMemo(
    () => ({
      [Compressed.yes]: <FiCheckCircle className='text-sm text-ant-color-text' title={t('im.compressed')} />,
    }),
    [t],
  )

  return (
    <div
      data-image-context-menu={true}
      tabIndex={-1}
      className={classNames(
        'group relative flex flex-none flex-col items-center space-y-1 p-2',
        'overflow-hidden rounded-lg border-[2px] border-solid border-transparent opacity-0',
        interactive && 'hover:border-ant-color-border',
        interactive && selected && 'border-ant-color-primary-hover hover:border-ant-color-primary-hover',
        styles['animate-fade-in'],
      )}
      onContextMenu={e => onContextMenu?.(e, image)}
      onDoubleClick={(e) => {
        if (isMultipleSelecting(e))
          return
        const el = e.target as HTMLElement
        if (preventDbClick(el))
          return
        showImageDetails({
          image,
          onPreview: onPreviewClick,
        })
      }}
    >
      <Corner
        leftTop={
          onRemoveClick && (
            <div
              className='cursor-pointer text-ant-color-error opacity-0 transition-opacity group-hover:opacity-100'
              onClick={(e) => {
                // prevent click away
                e.stopPropagation()
                onRemoveClick(image)
              }}
              title={t('im.remove')}
            >
              {removeRender(<MdOutlineRemoveCircle />, image)}
            </div>
          )
        }
        rightTop={
          sizeWarning && (
            <RiErrorWarningLine className='text-base' title={t('im.size_over_warning', { size: warningSize })} />
          )
        }
        rightBottom={compressedMap[imageMetadata.compressed]}
      >
        <div className='relative inline-flex'>
          <Image
            {...antdImageProps}
            className={classNames(
              'rounded-md object-contain p-1 will-change-auto',
              showThumbFallback && 'opacity-0',
              antdImageProps.className,
            )}
            preview={imagePreivew}
            rootClassName={classNames('transition-all', antdImageProps.rootClassName)}
            style={imageStyle}
            src={gridSrc}
            onLoad={(e) => {
              const img = e.currentTarget as HTMLImageElement
              setImageLoadFailed(false)
              vscodeApi.log('debug', 'visible image source loaded', {
                clientHeight: img.clientHeight,
                clientWidth: img.clientWidth,
                complete: img.complete,
                currentSrcPrefix: img.currentSrc?.slice(0, 96),
                filePath: image.path,
                naturalHeight: img.naturalHeight,
                naturalWidth: img.naturalWidth,
                needsBase64,
                needsThumb,
                srcPrefix: gridSrc?.slice(0, 96),
              })
              antdImageProps.onLoad?.(e)
            }}
            onError={(e) => {
              const img = e.currentTarget as HTMLImageElement
              setImageLoadFailed(true)
              vscodeApi.log('warn', 'visible image source failed to load', {
                complete: img.complete,
                currentSrcPrefix: img.currentSrc?.slice(0, 96),
                filePath: image.path,
                hasThumbSrc: !!thumbSrc,
                naturalHeight: img.naturalHeight,
                naturalWidth: img.naturalWidth,
                needsBase64,
                needsThumb,
                srcPrefix: gridSrc?.slice(0, 160),
              })
              antdImageProps.onError?.(e)
            }}
          >
          </Image>
          {showThumbFallback || showBrokenFallback
            ? (
                <div
                  className={classNames(
                    'pointer-events-none absolute inset-0 flex flex-col items-center justify-center rounded-md border border-solid',
                    'border-ant-color-border bg-ant-color-fill-secondary p-2 text-ant-color-text-secondary',
                  )}
                  style={{
                    height: antdImageProps.height,
                    width: antdImageProps.width,
                  }}
                >
                  {showBrokenFallback
                    ? <RiErrorWarningLine className='mb-1 text-lg text-ant-color-warning-text' />
                    : <HiOutlineViewfinderCircle className='mb-1 text-lg opacity-70' />}
                  <span className='max-w-full truncate text-xs font-medium'>{fallbackExt}</span>
                </div>
              )
            : null}
          {hoverShowImageDetail && onPreviewClick && (
            <div
              className={classNames(
                'absolute inset-0 z-10 flex cursor-pointer items-center justify-center rounded-md',
                'bg-[rgba(0,0,0,0.45)] opacity-0 transition-opacity group-hover:opacity-100',
              )}
              onClick={(e) => {
                if (isMultipleSelecting(e))
                  return
                e.stopPropagation()
                onPreviewClick(image)
              }}
              data-disable-dbclick
            >
              {previewMask}
            </div>
          )}
        </div>
      </Corner>

      <div className='max-w-full truncate' style={{ maxWidth: antdImageProps.width }}>
        {image.nameElement || (
          <ImageName image={image} {...imageNameProps}>
            {image.basename}
          </ImageName>
        )}
      </div>
    </div>
  )
}

export default memo(VisibleImage)
