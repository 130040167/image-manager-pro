import type { GetProps } from 'antd'
import type { AliasToken, ComponentTokenMap } from 'antd/es/theme/interface'
import type { TransformAction, TransformType, UpdateTransformFunc } from 'rc-image/es/hooks/useImageTransform'
import type { ToolbarRenderInfoType } from 'rc-image/es/Preview'
import type { PreviewGroupPreview } from 'rc-image/es/PreviewGroup'
import type { CSSProperties, ForwardedRef, ReactElement, ReactNode } from 'react'
import type { ImageContextMenuType } from '../context-menus/components/image-context-menu/hooks/use-image-context-menu'
import { useDeepCompareEffect, useMemoizedFn } from 'ahooks'
import { Button, ConfigProvider, Dropdown, Image, Input, InputNumber, Spin, theme, Tooltip } from 'antd'
import { round } from 'es-toolkit'
import { isObject } from 'es-toolkit/compat'
import { useAtomValue } from 'jotai'
import { selectAtom } from 'jotai/utils'
import { cloneElement, forwardRef, isValidElement, memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { FaLock, FaLockOpen } from 'react-icons/fa6'
import { LuMouse } from 'react-icons/lu'
import { MdChevronLeft, MdChevronRight, MdFitScreen, MdOutlineCenterFocusStrong, MdSwapHoriz } from 'react-icons/md'
import { TbChartHistogram } from 'react-icons/tb'
import { WorkspaceStateKey } from '~/core/persist/workspace/common'
import { CmdToVscode } from '~/message/cmd'
import logger from '~/utils/logger'
import { useControlledState } from '~/webview/image-manager/hooks/use-controlled-state'
import { logLayoutDebug } from '~/webview/image-manager/utils/layout-debug'
import { pauseThumbnailsForPreview } from '~/webview/image-manager/utils/thumbnail-cache'
import { classNames } from '~/webview/image-manager/utils/tw-clsx'
import { getAppRoot } from '~/webview/utils'
import { vscodeApi } from '~/webview/vscode-api'
import useImageManagerEvent, { IMEvent } from '../../hooks/use-image-manager-event'
import { useWhyUpdateDebug } from '../../hooks/use-why-update-debug'
import { useWorkspaceState } from '../../hooks/use-workspace-state'
import { GlobalAtoms } from '../../stores/global/global-store'
import { useImageWidth, useViewportStabilityState } from '../../stores/global/hooks'
import { useImageBackgroundColor, useIsDarkBackground, useTinyBackgroundColor } from '../../stores/settings/hooks'
import { VscodeAtoms } from '../../stores/vscode/vscode-store'
import { clearTimestamp } from '../../utils'
import { prefetchNeighbors } from '../../utils/image-prefetch'
import {
  fetchUnsupportedAsBase64,
  getCachedUnsupportedBase64,
  getStableSrcForUnsupported,
  isUnsupportedImage,
  isUnsupportedPlaceholder,
  releaseUnsupportedDataUrls,
  subscribeUnsupportedCache,
} from '../../utils/unsupported-image-cache'
import useImageContextMenu from '../context-menus/components/image-context-menu/hooks/use-image-context-menu'
import CustomFormatToolbar from '../custom-format-toolbar'
import { useCustomFormatSession } from '../custom-format-toolbar/use-custom-format-session'
import HistogramPanel from '../histogram-panel'
import { DEFAULT_PIXEL_VALUE_MODE } from '../image-editor/histogram-range'
import LazyImage from '../lazy-image'
import PixelInspector from '../pixel-inspector'
import { PreventClickAway, ShouldClickAway } from '../viewer/hooks/use-click-image-away'
import { buildPreviewContextMenuEnable, buildThumbnailContextMenuEnable, resolvePreviewRootTarget } from './preview-context-menu'
import { calculateAnchoredPreviewTransform, calculateCenterOriginAnchoredPreviewTransform, getDefaultPreviewPositionForViewport, getPreviewBaseScale, getPreviewMaxRcScaleForSemanticScale } from './preview-transform'
import { getInclusiveIndexRange, IMAGE_GRID_GAP, IMAGE_GRID_VIRTUALIZE_THRESHOLD } from './row-virtualizer'
import useLazyLoadImages from './use-lazy-load-images'
import useRowVirtualizer from './use-row-virtualizer'

function imageToken(isDarkBackground: boolean): Partial<ComponentTokenMap['Image'] & AliasToken> {
  return {
    previewOperationColor: isDarkBackground ? 'rgba(255, 255, 255, 1)' : 'rgba(0, 0, 0, 1)',
    previewOperationColorDisabled: isDarkBackground ? 'rgba(255, 255, 255, 0.25)' : 'rgba(0, 0, 0, 0.25)',
    previewOperationHoverColor: isDarkBackground ? 'rgba(255, 255, 255, 0.8)' : 'rgba(0, 0, 0, 0.8)',
    colorTextLightSolid: isDarkBackground ? 'rgba(255, 255, 255, 1)' : 'rgba(0, 0, 0, 1)',
  }
}

type Props = {
  id?: string
  images: ImageType[]
  workspaceImages?: ImageType[]
  lazyImageProps?: Partial<GetProps<typeof LazyImage>>
  enableMultipleSelect?: boolean
  onMultipleSelectContextMenu?: () => ImageType[]
  interactive?: boolean
  renderer?: (lazyImage: ReactNode, image: ImageType) => ReactNode
  selectedImages?: ImageType[]
  onSelectedImagesChange?: (selectedImages: ImageType[]) => void
  clearSelectedOnBlankClick?: boolean
  enableContextMenu?: ImageContextMenuType['enableContextMenu']
  onClearImageGroupSelected?: () => void
  inViewer?: boolean
  onNeedMoreImages?: () => Promise<{ ok?: boolean, timeout?: boolean } | void> | { ok?: boolean, timeout?: boolean } | void
  canLoadMoreImages?: boolean
  totalImageCount?: number
}

type PreviewToolbarActions = ToolbarRenderInfoType['actions'] & {
  onSetTransform?: UpdateTransformFunc
}

type PreviewToolbarInfo = Omit<ToolbarRenderInfoType, 'actions'> & {
  actions: PreviewToolbarActions
}

const ToastKey = 'image-preview-scale'
const PREVIEW_VALUE_RANGE_FILTER_ID = 'image-manager-preview-value-range-filter'
const PREVIEW_LOG_PREFIX = '[preview]'
const PREVIEW_FIT_PADDING = 32
const PREVIEW_TOOLBAR_SAFE_BOTTOM = 96
const PREVIEW_DEFAULT_SCALE = 1
const PREVIEW_WHEEL_EVENT_OPTIONS = { passive: false, capture: true } as const

const ZOOM_STEP_RATIO = 1.25
const RC_TRANSFORM_FALLBACK_ACTION: TransformAction = 'reset'
const SCALE_ACTIONS = ['zoomIn', 'zoomOut', 'zoomPreset', 'zoomInput', 'keyboard', 'wheel', 'fitToWindow'] as const

// 阶梯式缩放档位（参考 WPS 图片）：
// <10% 每次 1%；<40% 每次 5%；之后按下述固定档位前进/后退。
// 比恒定比例的缩放更贴近成熟图片软件的手感。
const ZOOM_LADDER = [40, 50, 60, 72, 86, 100, 125, 150, 195, 200, 280, 400, 640, 800, 1440, 1600, 2240, 2880, 3200, 4000, 5000] as const

function nextZoomPercent(currentPercent: number, direction: 1 | -1): number {
  const eps = 0.5
  if (direction === 1) {
    if (currentPercent < 10 - eps) {
      const next = Math.floor(currentPercent + eps) + 1
      return Math.min(10, next)
    }
    if (currentPercent < 40 - eps) {
      const next = Math.floor(currentPercent / 5) * 5 + 5
      return Math.min(40, next)
    }
    for (const v of ZOOM_LADDER) {
      if (v > currentPercent + eps)
        return v
    }
    return ZOOM_LADDER[ZOOM_LADDER.length - 1]
  }
  // direction === -1
  if (currentPercent > 40 + eps) {
    for (let i = ZOOM_LADDER.length - 1; i >= 0; i--) {
      if (ZOOM_LADDER[i] < currentPercent - eps)
        return ZOOM_LADDER[i]
    }
    return 40
  }
  if (currentPercent > 10 + eps) {
    const next = Math.ceil(currentPercent / 5) * 5 - 5
    return Math.max(10, next)
  }
  // <=10%
  const next = Math.ceil(currentPercent - eps) - 1
  return Math.max(1, next)
}

function clampScale(s: number, min: number, max: number) {
  return Math.max(min, Math.min(max, s))
}

function toRcTransformAction(action?: string): TransformAction {
  switch (action) {
    case 'wheel':
    case 'zoomIn':
    case 'zoomOut':
    case 'zoomPreset':
    case 'zoomInput':
    case 'keyboard':
    case 'fitToWindow':
      return 'move'
    case 'doubleClick':
    case 'move':
    case 'dragRebound':
    case 'touchZoom':
    case 'flipX':
    case 'flipY':
    case 'rotateLeft':
    case 'rotateRight':
    case 'prev':
    case 'next':
    case 'close':
    case 'reset':
      return action
    default:
      return RC_TRANSFORM_FALLBACK_ACTION
  }
}

function getActivePreviewImage() {
  return document.querySelector<HTMLImageElement>(
    '.ant-image-preview-root:not([aria-hidden="true"]) .ant-image-preview-img, '
    + '.rc-image-preview-root:not([aria-hidden="true"]) .rc-image-preview-img, '
    + '.ant-image-preview-img, .rc-image-preview-img',
  )
}

function isPreviewEventIgnored(target: EventTarget | null) {
  if (!(target instanceof HTMLElement))
    return false
  return !!target.closest([
    '[data-no-wheel-passthrough]',
    '.contexify',
    '.ant-modal',
    '.ant-dropdown',
    '.ant-popover',
    '.ant-tooltip',
    '.ant-input-number',
    'input',
    'textarea',
    'select',
  ].join(','))
}

function isEditablePreviewTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    && !!target.closest('.ant-input-number, input, textarea, select, [contenteditable="true"]')
}

function isPreviewSideNavTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && !!target.closest('[data-preview-side-nav]')
}

function isPreviewDoubleClickIgnored(target: EventTarget | null) {
  if (!(target instanceof HTMLElement))
    return true
  return isPreviewSideNavTarget(target)
    || isEditablePreviewTarget(target)
    || !!target.closest([
      '[data-no-preview-dblclick]',
      '.ant-image-preview-operations-wrapper',
      '.rc-image-preview-operations-wrapper',
      '.ant-dropdown',
      '.ant-modal',
      '.ant-popover',
      '.ant-tooltip',
      '.contexify',
      'button',
      '[role="button"]',
    ].join(','))
}

function normalizePreviewScaleState(value: number | Record<string, number> | null | undefined) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return { __default__: value } as Record<string, number>
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, scale]) => Number.isFinite(scale) && scale > 0)
    if (entries.length) {
      return Object.fromEntries(entries)
    }
  }
  return { __default__: PREVIEW_DEFAULT_SCALE } as Record<string, number>
}

function normalizePreviewScaleLockState(value: boolean | Record<string, boolean> | null | undefined) {
  if (typeof value === 'boolean') {
    return { __default__: value } as Record<string, boolean>
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, locked]) => typeof locked === 'boolean')
    if (entries.length) {
      return Object.fromEntries(entries)
    }
  }
  return { __default__: true } as Record<string, boolean>
}

function ImageGroup(props: Props, ref: ForwardedRef<HTMLDivElement>) {
  const { t } = useTranslation()
  const {
    images: imagesProp,
    workspaceImages,
    lazyImageProps,
    enableContextMenu,
    enableMultipleSelect = false,
    interactive = true,
    onMultipleSelectContextMenu,
    clearSelectedOnBlankClick,
    onClearImageGroupSelected,
    onNeedMoreImages,
    canLoadMoreImages,
    totalImageCount,
    selectedImages: selectedImagesProp,
    onSelectedImagesChange,
    inViewer,
  } = props

  useWhyUpdateDebug('ImageGroup', props)

  const renderer = useMemoizedFn(props.renderer || (c => c))
  const previewFilterUid = useId().replace(/[^\w-]/g, '')

  const { token } = theme.useToken()
  const containerRef = useRef<HTMLDivElement>(null)
  const [imageListEl, setImageListEl] = useState<HTMLDivElement | null>(null)
  const setImageListRef = useCallback((node: HTMLDivElement | null) => {
    setImageListEl(node)
    if (typeof ref === 'function') {
      ref(node)
    }
    else if (ref) {
      ref.current = node
    }
  }, [ref])

  const [imageWidth] = useImageWidth()
  const imagePlaceholderSize = useAtomValue(GlobalAtoms.imagePlaceholderSizeAtom)
  const imageReveal = useAtomValue(GlobalAtoms.imageRevealAtom)
  const viewportState = useViewportStabilityState()
  const viewportStable = viewportState.stable

  const [index, setIndex] = useState<number>(-1)

  const viewerPageSize = useAtomValue(GlobalAtoms.viewerPageSizeAtom) || 24

  const [images, imageStatus, actions] = useLazyLoadImages({
    images: imagesProp,
    canLoadMoreImages,
    totalImageCount,
    pageSize: viewerPageSize,
    target: imageListEl,
    container: isObject(lazyImageProps?.lazy) ? lazyImageProps.lazy.root || getAppRoot() : getAppRoot(),
    index,
    onNeedMoreImages,
  })
  const scrollContainer = isObject(lazyImageProps?.lazy) && lazyImageProps.lazy.root
    ? lazyImageProps.lazy.root
    : getAppRoot()
  const virtualized = props.renderer === undefined && images.length >= IMAGE_GRID_VIRTUALIZE_THRESHOLD
  const virtualGrid = useRowVirtualizer({
    container: scrollContainer,
    enabled: virtualized,
    itemCount: images.length,
    itemHeight: imagePlaceholderSize?.height || imageWidth + 48,
    itemWidth: imagePlaceholderSize?.width || imageWidth + 20,
    list: imageListEl,
  })
  const renderedImages = virtualized ? images.slice(virtualGrid.startIndex, virtualGrid.endIndex) : images

  useDeepCompareEffect(() => {
    if (inViewer) {
      if (imageReveal) {
        const cleanPath = clearTimestamp(imageReveal)
        const idx = imagesProp.findIndex(t => t.path === cleanPath)
        logger.debug('Reveal Image Index', idx)
        setIndex(idx)
      }
    }
  }, [imageReveal, imagesProp])

  useEffect(() => {
    if (!inViewer || index < 0 || index >= images.length || !virtualized)
      return
    virtualGrid.scrollToIndex(index)
  }, [images.length, inViewer, index, virtualGrid.scrollToIndex, virtualized])

  const preview_scale = useAtomValue(
    selectAtom(
      VscodeAtoms.workspaceStateAtom,
      useMemoizedFn(state => state[WorkspaceStateKey.preview_scale]),
    ),
  )
  const preview_scale_lock = useAtomValue(
    selectAtom(
      VscodeAtoms.workspaceStateAtom,
      useMemoizedFn(state => state[WorkspaceStateKey.preview_scale_lock]),
    ),
  )

  const [isDarkBackground] = useIsDarkBackground()
  const [backgroundColor] = useImageBackgroundColor()
  const [tinyBackgroundColor] = useTinyBackgroundColor()

  const trackedPreviewScaleState = useMemo(
    () => normalizePreviewScaleState(preview_scale as number | Record<string, number> | undefined),
    [preview_scale],
  )
  const trackedPreviewScaleLockState = useMemo(
    () => normalizePreviewScaleLockState(preview_scale_lock as boolean | Record<string, boolean> | undefined),
    [preview_scale_lock],
  )

  const [previewScaleState, setPreviewScaleState] = useWorkspaceState(
    WorkspaceStateKey.preview_scale,
    trackedPreviewScaleState,
  )
  const [previewScaleLockState, setPreviewScaleLockState] = useWorkspaceState(
    WorkspaceStateKey.preview_scale_lock,
    trackedPreviewScaleLockState,
  )
  const previewScaleMap = useMemo(
    () => normalizePreviewScaleState(previewScaleState as number | Record<string, number> | undefined),
    [previewScaleState],
  )
  const previewScaleLockMap = useMemo(
    () => normalizePreviewScaleLockState(previewScaleLockState as boolean | Record<string, boolean> | undefined),
    [previewScaleLockState],
  )
  const previewScopeKey = useMemoizedFn((image?: ImageType) => image?.absDirPath || image?.dirPath || '__default__')
  const getLockedScaleForImage = useMemoizedFn((image?: ImageType) => {
    const key = previewScopeKey(image)
    const scale = previewScaleMap[key] ?? previewScaleMap.__default__ ?? PREVIEW_DEFAULT_SCALE
    return Number.isFinite(scale) && scale > 0 ? scale : PREVIEW_DEFAULT_SCALE
  })
  const setLockedScaleForImage = useMemoizedFn((image: ImageType | undefined, scale: number) => {
    const key = previewScopeKey(image)
    setPreviewScaleState((prev) => {
      const next = normalizePreviewScaleState(prev as number | Record<string, number> | undefined)
      next[key] = scale
      return next
    })
  })
  const getScaleLockedForImage = useMemoizedFn((image?: ImageType) => {
    const key = previewScopeKey(image)
    return previewScaleLockMap[key] ?? previewScaleLockMap.__default__ ?? true
  })
  const setScaleLockedForImage = useMemoizedFn((image: ImageType | undefined, locked: boolean) => {
    const key = previewScopeKey(image)
    setPreviewScaleLockState((prev) => {
      const next = normalizePreviewScaleLockState(prev as boolean | Record<string, boolean> | undefined)
      next[key] = locked
      return next
    })
  })

  const [selectedImages, _setSelectedImages] = useControlledState({
    defaultValue: [],
    value: selectedImagesProp,
    onChange: onSelectedImagesChange,
  })

  const setSelectedImages = useMemoizedFn((...args: Parameters<typeof _setSelectedImages>) => {
    if (!interactive)
      return
    _setSelectedImages(...args)
  })

  const [preview, setPreview] = useState<{ open?: boolean, current?: number }>({ open: false, current: -1 })
  const previewRef = useRef(preview)
  previewRef.current = preview
  const previewContextRef = useRef<{
    enableContextMenu: typeof enableContextMenu
    flipPreview: (axis: 'x' | 'y') => void
    images: ImageType[]
    show: ReturnType<typeof useImageContextMenu>['show'] | null
    workspaceImages: ImageType[] | undefined
  }>({
    enableContextMenu,
    flipPreview: () => {},
    images: imagesProp,
    show: null,
    workspaceImages,
  })
  const [previewPageDraft, setPreviewPageDraft] = useState('')
  const pendingPreviewIndexRef = useRef<number | null>(null)
  const pendingPreviewLoadRef = useRef(false)
  const currentPreviewImageForScale = preview.open && typeof preview.current === 'number' && preview.current >= 0
    ? imagesProp[preview.current]
    : undefined
  const lockedScale = getScaleLockedForImage(currentPreviewImageForScale)
  const lockedScaleRef = useRef(lockedScale)
  lockedScaleRef.current = lockedScale
  const [currentTransform, setCurrentTransform] = useState<TransformType>({ x: 0, y: 0, scale: 1, rotate: 0, flipX: false, flipY: false })
  const currentTransformRef = useRef(currentTransform)
  currentTransformRef.current = currentTransform
  const initialPreviewTransformRef = useRef<TransformType | null>(null)
  const [previewNaturalSize, setPreviewNaturalSize] = useState<{ height: number, width: number } | null>(null)
  const [previewLayoutSize, setPreviewLayoutSize] = useState<{ height: number, width: number } | null>(null)
  const previewBaseScale = useMemo(() => getPreviewBaseScale(previewLayoutSize, previewNaturalSize), [previewLayoutSize, previewNaturalSize])
  const toSemanticScale = useMemoizedFn((rcScale: number) => rcScale * previewBaseScale)
  const fromSemanticScale = useMemoizedFn((semanticScale: number) => semanticScale / Math.max(previewBaseScale, 0.0001))
  const semanticScalePercent = useMemoizedFn((rcScale = currentTransformRef.current.scale) => {
    return Math.max(1, round(toSemanticScale(rcScale) * 100))
  })

  // toolbarRender 里捕获 rc-image 的 actions，用于命令式控制 transform。
  const previewActionsRef = useRef<{
    onSetTransform?: UpdateTransformFunc
  }>({})

  const [valueRange, setValueRange] = useState<[number, number]>([0, 255])
  const [pixelValueMode, setPixelValueMode] = useState(DEFAULT_PIXEL_VALUE_MODE)
  const [histogramVisible, setHistogramVisible] = useState(false)
  const [wheelMode, setWheelMode] = useState<'zoom' | 'page'>('zoom')
  const wheelModeRef = useRef(wheelMode)
  wheelModeRef.current = wheelMode
  const lastPreviewPointerRef = useRef<{ x: number, y: number } | null>(null)

  const valueRangeFilter = useMemo(() => {
    if (valueRange[0] === 0 && valueRange[1] === 255)
      return undefined
    return valueRange
  }, [valueRange])

  const previewImageSvgFilter = useMemo(() => {
    if (!valueRangeFilter)
      return undefined
    const [lo, hi] = valueRangeFilter
    if (lo === hi) {
      const threshold = Math.max(0, Math.min(255, lo))
      const table = Array.from({ length: 256 }, (_, index) => (index <= threshold ? 0 : 1)).join(' ')
      return {
        type: 'threshold' as const,
        table,
      }
    }
    const width = Math.max(1, hi - lo)
    return {
      type: 'linear' as const,
      slope: 255 / width,
      intercept: -lo / width,
    }
  }, [valueRangeFilter])

  const previewValueRangeFilterId = useMemo(() => {
    const [lo, hi] = valueRange
    return `${PREVIEW_VALUE_RANGE_FILTER_ID}-${previewFilterUid}-${Math.round(lo)}-${Math.round(hi)}`
  }, [previewFilterUid, valueRange])

  const previewImageFilterCss = previewImageSvgFilter ? `url(#${previewValueRangeFilterId})` : undefined

  const PREVIEW_MIN_SCALE = 0.01
  const PREVIEW_MAX_SEMANTIC_SCALE = 50
  const previewMaxRcScale = useMemo(
    () => getPreviewMaxRcScaleForSemanticScale(previewBaseScale, PREVIEW_MAX_SEMANTIC_SCALE),
    [previewBaseScale],
  )

  const { show, hideAll } = useImageContextMenu()

  const onToastClose = useMemoizedFn(() => {
    toast.remove(ToastKey)
  })

  useEffect(() => {
    if (preview.open)
      return

    onToastClose()
    hideAll()
    setHistogramVisible(false)
    setValueRange(range => (range[0] === 0 && range[1] === 255 ? range : [0, 255]))
  }, [hideAll, onToastClose, preview.open])

  const getPreviewImageAt = useMemoizedFn((current: number | undefined) => {
    return current !== undefined && current >= 0 ? imagesProp[current] : undefined
  })

  const hasKnownPreviewTotal = totalImageCount !== undefined
  const previewTotalCount = Math.max(totalImageCount || 0, imagesProp.length)
  const canPreviewLoadMore = imageStatus.hasMoreRemote || previewTotalCount > imagesProp.length

  const getInitialPreviewScaleForImage = useMemoizedFn((image?: ImageType) => {
    return getScaleLockedForImage(image) ? getLockedScaleForImage(image) : PREVIEW_DEFAULT_SCALE
  })

  const getDefaultPreviewPosition = useMemoizedFn(() => {
    if (typeof window === 'undefined') {
      return { x: 0, y: 0 }
    }
    return getDefaultPreviewPositionForViewport(
      { height: window.innerHeight, width: window.innerWidth },
      { fitPadding: PREVIEW_FIT_PADDING, toolbarSafeBottom: PREVIEW_TOOLBAR_SAFE_BOTTOM },
    )
  })

  const buildPreviewTransformForImage = useMemoizedFn((image?: ImageType) => ({
    ...currentTransformRef.current,
    ...getDefaultPreviewPosition(),
    scale: getInitialPreviewScaleForImage(image),
    rotate: 0,
    flipX: false,
    flipY: false,
  }))

  const applyPreviewTransformForIndex = useMemoizedFn((current: number | undefined) => {
    const nextTransform = buildPreviewTransformForImage(getPreviewImageAt(current))
    initialPreviewTransformRef.current = nextTransform
    currentTransformRef.current = nextTransform
    setCurrentTransform(nextTransform)
    setPreviewNaturalSize(null)
    setPreviewLayoutSize(null)
    toast.remove(ToastKey)
  })

  const toggleLockedScale = useMemoizedFn((scalePercent?: number) => {
    const currentImage = getPreviewImageAt(previewRef.current.current)
    const nextLocked = !getScaleLockedForImage(currentImage)
    setScaleLockedForImage(currentImage, nextLocked)
    if (nextLocked) {
      const nextScale = fromSemanticScale((scalePercent || semanticScalePercent()) / 100)
      setLockedScaleForImage(currentImage, nextScale)
      logger.debug('锁定缩放比例', nextScale)
    }
  })

  const toastContent = useMemoizedFn((scalePercent: number, isLocked: boolean) => {
    const Icon = isLocked ? FaLock : FaLockOpen
    return (
      <div className='flex items-center gap-2'>
        <span>
          {scalePercent}
          %
        </span>
        <Button
          size='small'
          icon={<Icon className='prevent-click-away !text-white' />}
          onClick={() => {
            toggleLockedScale(scalePercent)
            toast(toastContent(scalePercent, !isLocked), { id: ToastKey })
          }}
          type='text'
        >
        </Button>
      </div>
    )
  })

  const openToast = useMemoizedFn((scalePercent: number) => {
    if (!scalePercent || !preview.open)
      return
    toast(toastContent(scalePercent, lockedScaleRef.current), { id: ToastKey })
  })

  useImageManagerEvent({
    on: {
      [IMEvent.reveal_in_viewer]: () => {
        if (preview.open)
          setPreview({ open: false })
      },
      [IMEvent.clear_selected_images]: () => {
        if (!inViewer && selectedImages.length)
          setSelectedImages([])
      },
      [IMEvent.clear_viewer_selected_images]: () => {
        if (inViewer && selectedImages.length)
          setSelectedImages([])
      },
    },
  })

  const toggleImageSelection = useMemoizedFn((previous: ImageType[], image: ImageType, selected: boolean) => {
    previous = previous.filter(t => t.path !== image.path)
    return selected ? [...previous, image] : [...previous]
  })

  const handlePreviewClick = useMemoizedFn((image: ImageType) => {
    const idx = imagesProp.findIndex(t => t.path === image.path)
    const nextTransform = buildPreviewTransformForImage(image)
    initialPreviewTransformRef.current = nextTransform
    currentTransformRef.current = nextTransform
    setCurrentTransform(nextTransform)
    vscodeApi.log('debug', `${PREVIEW_LOG_PREFIX} open requested`, {
      extname: image.extname,
      imagePath: image.path,
      index: idx,
      unsupported: isUnsupportedImage(image),
      vscodePathPrefix: image.vscodePath?.slice(0, 48),
    })
    logLayoutDebug('preview open requested', {
      imagePath: image.path,
      initialScale: nextTransform.scale,
      previewIndex: idx,
    })
    setPreview({ open: true, current: idx })
  })

  const onContextMenu = useMemoizedFn((e: React.MouseEvent<HTMLDivElement>, image: ImageType) => {
    let selected: ImageType[] | undefined
    if (!selectedImages.some(t => t.path === image.path)) {
      onClearImageGroupSelected?.()
      selected = [image]
      setSelectedImages(selected)
    }
    else {
      selected = onMultipleSelectContextMenu?.() || selectedImages
    }
    show({
      event: e,
      props: {
        image,
        images: selected,
        sameLevelImages: images,
        sameWorkspaceImages: workspaceImages,
        enableContextMenu: buildThumbnailContextMenuEnable(enableContextMenu),
        z_commands: {
          preview: { onClick: image => handlePreviewClick(image) },
        },
        shortcutsVisible: true,
      },
    })
  })

  const onClick = useMemoizedFn((e: React.MouseEvent<HTMLDivElement, MouseEvent>, image: ImageType) => {
    if (enableMultipleSelect) {
      if (e.metaKey || e.ctrlKey) {
        setSelectedImages((t) => {
          const idx = t.findIndex(i => i.path === image.path)
          return toggleImageSelection(t, image, idx === -1)
        })
        return
      }
      if (e.shiftKey) {
        if (!selectedImages.length) {
          onClearImageGroupSelected?.()
          setSelectedImages([image])
          return
        }
        const start = selectedImages[0]
        const end = image
        const indexOfStart = images.findIndex(t => t.path === start.path)
        const indexOfEnd = images.findIndex(t => t.path === end.path)
        setSelectedImages(getInclusiveIndexRange(indexOfStart, indexOfEnd).map(i => images[i]))
        return
      }
    }
    onClearImageGroupSelected?.()
    setSelectedImages([image])
  })

  useEffect(() => {
    if (!selectedImages.length)
      return

    const visiblePaths = new Set(images.map(image => image.path))
    const nextSelectedImages = selectedImages.filter(image => visiblePaths.has(image.path))
    const unchanged = nextSelectedImages.length === selectedImages.length
      && nextSelectedImages.every((image, index) => image.path === selectedImages[index]?.path)

    if (!unchanged) {
      setSelectedImages(nextSelectedImages)
    }
  }, [images, selectedImages, setSelectedImages])

  const isMultipleSelecting = useMemoizedFn((e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    return enableMultipleSelect ? e.metaKey || e.ctrlKey || e.shiftKey : false
  })

  const handlePreviewChange = useMemoizedFn((current: number) => {
    setPreview({ current, open: true })
    applyPreviewTransformForIndex(current)
  })

  const handleVisibleChange = useMemoizedFn((v: boolean, _: any, current: number) => {
    logLayoutDebug('preview visible change', {
      current,
      open: v,
    })
    setPreview({ open: v, current })
    if (!v) {
      releaseUnsupportedDataUrls()
      setPreviewPageDraft('')
      initialPreviewTransformRef.current = null
    }
    if (v) {
      setPreviewPageDraft(String(current + 1))
      applyPreviewTransformForIndex(current)
    }
  })

  const goToPreviewIndex = useMemoizedFn((targetIndex: number) => {
    const maxKnownIndex = Math.max(0, imagesProp.length - 1)
    const maxPreviewIndex = hasKnownPreviewTotal
      ? Math.max(maxKnownIndex, previewTotalCount - 1)
      : (canPreviewLoadMore ? maxKnownIndex + 1 : maxKnownIndex)
    const next = Math.max(0, Math.min(maxPreviewIndex, targetIndex))
    const cur = typeof previewRef.current.current === 'number' ? previewRef.current.current : preview.current
    if (next === cur && next < imagesProp.length)
      return
    if (next >= imagesProp.length) {
      if (!canPreviewLoadMore)
        return
      pendingPreviewIndexRef.current = next
      logger.debug('Preview requests next image page', {
        current: cur,
        loaded: imagesProp.length,
        next,
        total: totalImageCount,
      })
      void Promise.resolve(actions.ensureVisibleIndex(next))
      return
    }
    setPreview({ open: true, current: next })
    applyPreviewTransformForIndex(next)
  })

  const stepPreview = useMemoizedFn((delta: -1 | 1) => {
    const cur = typeof previewRef.current.current === 'number' ? previewRef.current.current : preview.current
    if (typeof cur !== 'number')
      return
    goToPreviewIndex(cur + delta)
  })

  const commitPreviewPageDraft = useMemoizedFn((rawValue = previewPageDraft) => {
    const page = Number.parseInt(String(rawValue).trim(), 10)
    if (!Number.isFinite(page)) {
      setPreviewPageDraft(String((previewRef.current.current ?? 0) + 1))
      return
    }
    goToPreviewIndex(page - 1)
  })

  const goPrev = useMemoizedFn(() => stepPreview(-1))

  const goNext = useMemoizedFn(() => stepPreview(1))

  const computeFitTransform = useMemoizedFn(() => {
    if (!viewportStable)
      return null
    const previewImg = getActivePreviewImage()
    if (!previewImg)
      return null
    const layoutW = previewImg.clientWidth
    const layoutH = previewImg.clientHeight
    if (!layoutW || !layoutH)
      return null
    const viewportW = Math.max(0, window.innerWidth - PREVIEW_FIT_PADDING * 2)
    const viewportH = Math.max(0, window.innerHeight - PREVIEW_TOOLBAR_SAFE_BOTTOM - PREVIEW_FIT_PADDING)
    if (viewportW <= 0 || viewportH <= 0)
      return null
    const targetScale = Math.min(viewportW / layoutW, viewportH / layoutH)
    if (!Number.isFinite(targetScale) || targetScale <= 0)
      return null
    return { scale: targetScale, ...getDefaultPreviewPosition() }
  })

  const setScale = useMemoizedFn((
    target: number,
    options: { action?: TransformAction | string, anchor?: { x: number, y: number }, persist?: boolean, x?: number, y?: number } = {},
  ) => {
    const clamped = clampScale(target, PREVIEW_MIN_SCALE, previewMaxRcScale)
    const defaultPosition = getDefaultPreviewPosition()
    const fallbackAnchor = typeof window === 'undefined'
      ? undefined
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    const anchor = options.anchor || lastPreviewPointerRef.current || fallbackAnchor
    const previewImg = typeof window === 'undefined' ? null : getActivePreviewImage()
    const previewImgRect = previewImg?.getBoundingClientRect()
    const previewImgOffsetParent = previewImg?.offsetParent instanceof HTMLElement ? previewImg.offsetParent : null
    const previewImgOffsetParentRect = previewImgOffsetParent?.getBoundingClientRect()
    const previewImgBasePosition = previewImg
      ? {
          x: (previewImgOffsetParentRect?.left || 0) + previewImg.offsetLeft,
          y: (previewImgOffsetParentRect?.top || 0) + previewImg.offsetTop,
        }
      : null
    const previewImgLayout = previewImg
      ? {
          height: previewImg.offsetHeight || previewImg.clientHeight || previewLayoutSize?.height || 0,
          width: previewImg.offsetWidth || previewImg.clientWidth || previewLayoutSize?.width || 0,
        }
      : null
    const rotation = ((currentTransformRef.current.rotate || 0) % 360 + 360) % 360
    const previewImgVisualSize = previewImgLayout
      ? (Math.abs(rotation - 90) < 0.001 || Math.abs(rotation - 270) < 0.001
          ? { height: previewImgLayout.width, width: previewImgLayout.height }
          : previewImgLayout)
      : null
    let anchored: { scale: number, x: number, y: number }
    if (anchor && previewImgRect && previewImgBasePosition && previewImgLayout?.width && previewImgLayout.height) {
      anchored = calculateCenterOriginAnchoredPreviewTransform({
        anchor,
        basePosition: previewImgBasePosition,
        currentRect: {
          height: previewImgRect.height,
          width: previewImgRect.width,
          x: previewImgRect.left,
          y: previewImgRect.top,
        },
        defaultPosition,
        fitPadding: PREVIEW_FIT_PADDING,
        layoutSize: previewImgLayout,
        targetScale: clamped,
        toolbarSafeBottom: PREVIEW_TOOLBAR_SAFE_BOTTOM,
        viewport: { height: window.innerHeight, width: window.innerWidth },
        visualSize: previewImgVisualSize || undefined,
      })
    }
    else if (typeof window === 'undefined') {
      anchored = { ...defaultPosition, scale: clamped }
    }
    else {
      anchored = calculateAnchoredPreviewTransform({
        anchor,
        current: currentTransformRef.current,
        defaultPosition,
        fitPadding: PREVIEW_FIT_PADDING,
        layoutSize: previewLayoutSize,
        recenterFittingAxes: false,
        targetScale: clamped,
        toolbarSafeBottom: PREVIEW_TOOLBAR_SAFE_BOTTOM,
        viewport: { height: window.innerHeight, width: window.innerWidth },
      })
    }
    const x = options.x ?? anchored.x
    const y = options.y ?? anchored.y
    const nextTransform = { ...currentTransformRef.current, x, y, scale: clamped }
    currentTransformRef.current = nextTransform
    setCurrentTransform(nextTransform)
    if (options.persist ?? lockedScaleRef.current) {
      const currentImage = getPreviewImageAt(previewRef.current.current)
      setLockedScaleForImage(currentImage, clamped)
    }
    const setTransform = previewActionsRef.current.onSetTransform
    if (setTransform) {
      setTransform({ x, y, scale: clamped }, toRcTransformAction(options.action))
    }
    if ((SCALE_ACTIONS as readonly string[]).includes(String(options.action))) {
      openToast(semanticScalePercent(clamped))
    }
  })

  const handlePreviewDoubleClick = useMemoizedFn(() => {
    const currentScale = currentTransformRef.current.scale
    const fitTransform = computeFitTransform()
    if (fitTransform && Math.abs(currentScale - fitTransform.scale) > 0.01) {
      setScale(fitTransform.scale, { action: 'fitToWindow', x: fitTransform.x, y: fitTransform.y })
    }
    else {
      const defaultPosition = getDefaultPreviewPosition()
      setScale(1, { action: 'reset', x: defaultPosition.x, y: defaultPosition.y })
    }
  })

  const handleImageRender = useMemoizedFn<Exclude<PreviewGroupPreview['imageRender'], undefined>>(
    (originalNode, info) => {
      const currentImage = imagesProp[info.current]
      const previewNode = isValidElement(originalNode)
        ? cloneElement(originalNode as ReactElement<{ style?: CSSProperties }>, {
            style: {
              ...((originalNode.props as { style?: CSSProperties }).style || {}),
              filter: previewImageFilterCss,
              imageRendering: 'pixelated',
            },
          })
        : originalNode
      return (
        <div
          className='contents'
          data-image-preview-render
          onDoubleClickCapture={(e) => {
            if (isPreviewDoubleClickIgnored(e.target))
              return
            e.preventDefault()
            e.stopPropagation()
            handlePreviewDoubleClick()
          }}
        >
          <div
            className='fixed left-4 top-4 z-30 rounded bg-[rgba(118,118,118,0.38)] px-3 py-1 text-base text-white shadow backdrop-blur-md'
            data-disable-context-fallback
          >
            {currentImage?.basename}
          </div>
          {previewNode}
          {/* 左右翻页竖条区域，箭头水平垂直居中 */}
          <div
            className='absolute left-0 top-0 z-30 flex h-full w-[8%] cursor-pointer items-center justify-center text-white/55 transition-colors hover:bg-[rgba(150,150,150,0.16)] hover:text-white/90'
            onClick={(e) => {
              e.stopPropagation()
              goPrev()
            }}
            onDoubleClickCapture={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            data-disable-context-fallback
            data-preview-side-nav
          >
            <MdChevronLeft className='text-4xl' />
          </div>
          <div
            className='absolute right-0 top-0 z-30 flex h-full w-[8%] cursor-pointer items-center justify-center text-white/55 transition-colors hover:bg-[rgba(150,150,150,0.16)] hover:text-white/90'
            onClick={(e) => {
              e.stopPropagation()
              goNext()
            }}
            onDoubleClickCapture={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            data-disable-context-fallback
            data-preview-side-nav
          >
            <MdChevronRight className='text-4xl' />
          </div>
        </div>
      )
    },
  )

  const handleTransform: PreviewGroupPreview['onTransform'] = useMemoizedFn((info) => {
    const transform = info.transform
    currentTransformRef.current = transform
    setCurrentTransform(transform)
    vscodeApi.log('debug', `${PREVIEW_LOG_PREFIX} transform updated`, {
      action: info.action,
      current: previewRef.current.current,
      maxRcScale: previewMaxRcScale,
      scale: transform.scale,
      semanticScalePercent: semanticScalePercent(transform.scale),
      x: transform.x,
      y: transform.y,
    })
    if ((SCALE_ACTIONS as readonly string[]).includes(info.action)) {
      const scalePercent = semanticScalePercent(transform.scale)
      if (lockedScaleRef.current) {
        const currentImage = getPreviewImageAt(previewRef.current.current)
        setLockedScaleForImage(currentImage, transform.scale)
      }
      openToast(scalePercent)
    }
  })

  const flipPreview = useMemoizedFn((axis: 'x' | 'y') => {
    const transform = currentTransformRef.current
    const defaultPosition = getDefaultPreviewPosition()
    previewActionsRef.current.onSetTransform?.(
      axis === 'x'
        ? { x: defaultPosition.x, y: defaultPosition.y, flipX: !transform.flipX }
        : { x: defaultPosition.x, y: defaultPosition.y, flipY: !transform.flipY },
      axis === 'x' ? 'flipX' : 'flipY',
    )
  })

  previewContextRef.current = {
    enableContextMenu,
    flipPreview,
    images: imagesProp,
    show,
    workspaceImages,
  }

  const fitToWindow = useMemoizedFn(() => {
    const target = computeFitTransform()
    if (target == null)
      return
    setScale(target.scale, { action: 'fitToWindow', x: target.x, y: target.y })
  })

  const resetCenter = useMemoizedFn(() => {
    const defaultPosition = getDefaultPreviewPosition()
    setScale(1, { action: 'reset', x: defaultPosition.x, y: defaultPosition.y })
  })

  // 阶梯式缩放：方向 +1 = 放大，-1 = 缩小。读取当前缩放百分比，跳到 ZOOM_LADDER 上的下一档。
  const zoomStep = useMemoizedFn((direction: 1 | -1, anchor?: { x: number, y: number }) => {
    const currentPercent = semanticScalePercent()
    const nextPercent = nextZoomPercent(currentPercent, direction)
    setScale(
      fromSemanticScale(nextPercent / 100),
      anchor ? { action: 'wheel', anchor } : { action: direction === 1 ? 'zoomIn' : 'zoomOut' },
    )
  })

  const handleToolbarRender: PreviewGroupPreview['toolbarRender'] = useMemoizedFn(
    (_originalNode, info) => {
      const toolbarInfo = info as PreviewToolbarInfo
      // 捕获 rc-image 的 actions，用于命令式控制 transform（缩放锚点固定到背景中心）
      previewActionsRef.current.onSetTransform = toolbarInfo.actions.onSetTransform

      const currentPercent = semanticScalePercent(info.transform.scale)
      const zoomPresets = [1, 5, 10, 25, 50, 75, 100, 125, 150, 200, 300, 400, 500, 800, 1600, 3200, 5000]
      const presetItems = zoomPresets.map(p => ({
        key: String(p),
        label: `${p}%`,
        onClick: () => setScale(fromSemanticScale(p / 100), { action: 'zoomPreset' }),
      }))
      const toolbarShellClass = 'flex items-center rounded-xl bg-[rgba(118,118,118,0.34)] px-2.5 py-2 text-white shadow-lg ring-1 ring-white/10 backdrop-blur-md'
      const toolbarSectionClass = 'flex items-center gap-1.5'
      const toolbarIconButtonClass = '!h-10 !w-10 !rounded-md !p-0 !text-white hover:!bg-white/10 [&_.anticon]:!text-[24px] [&_svg]:!h-6 [&_svg]:!w-6'
      const toolbarDividerClass = 'mx-1 h-7 w-px shrink-0 bg-white/14'
      const toolbarValueTextClass = 'text-[14px] font-normal leading-10 tabular-nums'

      const pageIndex = (preview.current ?? 0) + 1
      const pageTotal = previewTotalCount || imagesProp.length
      const pageTotalLabel = hasKnownPreviewTotal || !canPreviewLoadMore ? String(pageTotal) : `${imagesProp.length}+`

      return (
        <div className={toolbarShellClass}>
          {/* 页码导航：左箭头图标 + 页码 + 右箭头图标 */}
          <div className={toolbarSectionClass}>
            <Button
              size='small'
              type='text'
              className={toolbarIconButtonClass}
              icon={<MdChevronLeft className='text-2xl' />}
              onClick={goPrev}
              disabled={(preview.current ?? 0) <= 0}
            />
            <div className='flex h-10 items-center gap-1 tabular-nums' data-no-wheel-passthrough>
              <Input
                size='small'
                value={previewPageDraft}
                inputMode='numeric'
                onFocus={() => setPreviewPageDraft(String(pageIndex))}
                onBlur={() => commitPreviewPageDraft()}
                onKeyDownCapture={(e) => {
                  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
                    e.stopPropagation()
                    e.nativeEvent.stopImmediatePropagation?.()
                  }
                }}
                onKeyDown={(e) => {
                  e.stopPropagation()
                }}
                onPressEnter={() => commitPreviewPageDraft()}
                onChange={e => setPreviewPageDraft(e.target.value.replace(/\D/g, ''))}
                className={`!h-10 !min-w-0 !border-0 !bg-transparent !px-0 !text-center !text-white focus:!bg-white/10 focus:!shadow-none ${toolbarValueTextClass}`}
                style={{ width: `${Math.max(String(pageIndex).length, 2) + 1.5}ch` }}
              />
              <span className={`select-none ${toolbarValueTextClass}`}>/</span>
              <span className={`min-w-[2ch] select-none text-left ${toolbarValueTextClass}`}>{pageTotalLabel}</span>
            </div>
            <Button
              size='small'
              type='text'
              className={toolbarIconButtonClass}
              icon={<MdChevronRight className='text-2xl' />}
              onClick={goNext}
              disabled={(preview.current ?? 0) >= pageTotal - 1 && !canPreviewLoadMore}
            />
          </div>
          <div className={toolbarDividerClass} />
          <div className={toolbarSectionClass}>
            <Tooltip title={t('im.fit_to_window')}>
              <Button
                size='small'
                type='text'
                className={toolbarIconButtonClass}
                icon={<MdFitScreen className='text-2xl' />}
                onClick={fitToWindow}
              />
            </Tooltip>
            <Tooltip title={t('im.reset_center')}>
              <Button
                size='small'
                type='text'
                className={toolbarIconButtonClass}
                icon={<MdOutlineCenterFocusStrong className='text-[22px]' />}
                onClick={resetCenter}
              />
            </Tooltip>
            <Tooltip title={t('im.histogram_range')}>
              <Button
                size='small'
                type='text'
                className={toolbarIconButtonClass}
                icon={<TbChartHistogram className='text-[22px]' />}
                onClick={() => setHistogramVisible(v => !v)}
              />
            </Tooltip>
            <Tooltip title={wheelMode === 'zoom' ? t('im.wheel_zoom_mode') : t('im.wheel_page_mode')}>
              <Button
                size='small'
                type='text'
                className={toolbarIconButtonClass}
                icon={wheelMode === 'zoom' ? <LuMouse className='text-xl' /> : <MdSwapHoriz className='text-xl' />}
                onClick={() => setWheelMode(m => (m === 'zoom' ? 'page' : 'zoom'))}
              />
            </Tooltip>
          </div>
          <div className={toolbarDividerClass} />
          <div className={toolbarSectionClass}>
            <Button
              size='small'
              type='text'
              className={toolbarIconButtonClass}
              icon={info.icons.rotateLeftIcon}
              onClick={info.actions.onRotateLeft}
            />
            <Button
              size='small'
              type='text'
              className={toolbarIconButtonClass}
              icon={info.icons.rotateRightIcon}
              onClick={info.actions.onRotateRight}
            />
            <Button
              size='small'
              type='text'
              className={toolbarIconButtonClass}
              icon={info.icons.zoomOutIcon}
              onClick={() => zoomStep(-1)}
            />
            <Button
              size='small'
              type='text'
              className={toolbarIconButtonClass}
              icon={info.icons.zoomInIcon}
              onClick={() => zoomStep(1)}
            />
          </div>
          <div className={toolbarDividerClass} />
          <Dropdown
            menu={{ items: presetItems }}
            trigger={['contextMenu']}
            placement='top'
            overlayStyle={{ paddingBottom: 4 }}
            autoAdjustOverflow
            getPopupContainer={node => node.closest('.ant-image-preview-root') as HTMLElement || document.body}
          >
            <div
              className={`flex h-10 cursor-pointer items-center rounded-md px-2 text-white hover:bg-white/10 ${toolbarValueTextClass}`}
              data-no-wheel-passthrough
              title={t('im.reset_center')}
              onMouseDown={(event) => {
                if (event.button !== 0 || event.target instanceof HTMLInputElement)
                  return
                event.preventDefault()
                resetCenter()
              }}
            >
              <InputNumber
                size='small'
                value={currentPercent}
                min={1}
                max={5000}
                step={25}
                parser={v => Number(v?.replace('%', '') || 0)}
                onKeyDownCapture={(e) => {
                  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
                    e.stopPropagation()
                    e.nativeEvent.stopImmediatePropagation?.()
                  }
                }}
                onKeyDown={(e) => {
                  e.stopPropagation()
                }}
                onPressEnter={(e) => {
                  const val = Number((e.target as HTMLInputElement).value.replace('%', ''))
                  if (val > 0)
                    setScale(fromSemanticScale(val / 100), { action: 'zoomInput' })
                }}
                onChange={(val) => {
                  if (val && val > 0)
                    setScale(fromSemanticScale(val / 100), { action: 'zoomInput' })
                }}
                className='!h-10 !min-w-0 [&_.ant-input-number-handler-wrap]:hidden [&_.ant-input-number-input-wrap]:!px-0 [&_input]:!h-10 [&_input]:!px-0 [&_input]:!text-right [&_input]:!text-[14px] [&_input]:!font-normal [&_input]:!leading-10 [&_input]:!text-white'
                style={{ width: `${Math.max(String(currentPercent).length, 2) + 1.5}ch` }}
                variant='borderless'
                controls={false}
              />
              <span className={`select-none pr-1 text-white ${toolbarValueTextClass}`}>%</span>
            </div>
          </Dropdown>
          <Tooltip title={lockedScale ? t('im.lock_zoom') : t('im.unlock_zoom')}>
            <Button
              size='small'
              type='text'
              className={toolbarIconButtonClass}
              icon={lockedScale ? <FaLock className='text-xl' /> : <FaLockOpen className='text-xl' />}
              onClick={() => toggleLockedScale(currentPercent)}
            />
          </Tooltip>
        </div>
      )
    },
  )

  const previewProps: PreviewGroupPreview = useMemo(() => {
    const initialTransform = initialPreviewTransformRef.current || buildPreviewTransformForImage(getPreviewImageAt(preview.current))
    return {
      destroyOnClose: true,
      visible: preview?.open,
      current: preview?.current,
      maskClosable: false,
      movable: true,
      style: {
        backgroundColor: tinyBackgroundColor.setAlpha(0.9).toRgbString(),
      },
      keyboard: true,
      onChange: handlePreviewChange,
      onVisibleChange: handleVisibleChange,
      maxScale: previewMaxRcScale,
      minScale: PREVIEW_MIN_SCALE,
      scaleStep: ZOOM_STEP_RATIO - 1,
      imageRender: handleImageRender,
      toolbarRender: handleToolbarRender,
      onTransform: handleTransform,
      initialTransform: {
        ...initialTransform,
      },
    } satisfies PreviewGroupPreview
  }, [preview, lockedScale, tinyBackgroundColor, previewImageFilterCss, handlePreviewChange, handleVisibleChange, handleImageRender, handleToolbarRender, handleTransform, buildPreviewTransformForImage, getPreviewImageAt, imagesProp, previewMaxRcScale])

  useEffect(() => {
    if (!preview.open)
      return

    const onDoubleClick = (e: MouseEvent) => {
      const target = e.target
      if (!(target instanceof HTMLElement))
        return
      if (!target.closest('.ant-image-preview-root, .rc-image-preview-root'))
        return
      if (isPreviewDoubleClickIgnored(target))
        return
      e.preventDefault()
      e.stopImmediatePropagation()
      handlePreviewDoubleClick()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditablePreviewTarget(e.target)) {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key))
          e.stopImmediatePropagation()
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopImmediatePropagation()
        zoomStep(1)
      }
      else if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopImmediatePropagation()
        zoomStep(-1)
      }
      else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        e.stopImmediatePropagation()
        goPrev()
      }
      else if (e.key === 'ArrowRight') {
        e.preventDefault()
        e.stopImmediatePropagation()
        goNext()
      }
    }

    document.addEventListener('dblclick', onDoubleClick, true)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('dblclick', onDoubleClick, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [preview.open, zoomStep, goPrev, goNext, handlePreviewDoubleClick])

  const updatePreviewImageMetrics = useMemoizedFn(() => {
    if (!viewportStable)
      return
    const img = getActivePreviewImage()
    if (!img)
      return

    const apply = () => {
      const layoutWidth = img.offsetWidth || img.clientWidth
      const layoutHeight = img.offsetHeight || img.clientHeight
      const naturalWidth = img.naturalWidth
      const naturalHeight = img.naturalHeight
      if (layoutWidth > 0 && layoutHeight > 0) {
        setPreviewLayoutSize({ height: layoutHeight, width: layoutWidth })
      }
      if (naturalWidth > 0 && naturalHeight > 0) {
        setPreviewNaturalSize({ height: naturalHeight, width: naturalWidth })
      }
      logLayoutDebug('preview metrics sampled', {
        layoutHeight,
        layoutWidth,
        maxRcScale: previewMaxRcScale,
        naturalHeight,
        naturalWidth,
        previewCurrent: previewRef.current.current,
        semanticScalePercent: semanticScalePercent(),
      })
    }

    apply()
    window.requestAnimationFrame(apply)
    window.setTimeout(apply, 120)
  })

  useEffect(() => {
    if (!preview.open || !viewportStable)
      return
    updatePreviewImageMetrics()
    const timer = window.setInterval(updatePreviewImageMetrics, 250)
    return () => window.clearInterval(timer)
  }, [preview.open, preview.current, imagesProp, updatePreviewImageMetrics, viewportStable])

  useEffect(() => {
    if (!preview.open)
      return

    const logVisibility = () => {
      logLayoutDebug('preview visibility change', {
        previewCurrent: previewRef.current.current,
      })
      if (document.visibilityState === 'visible') {
        window.requestAnimationFrame(() => {
          updatePreviewImageMetrics()
          logLayoutDebug('preview visibility restore raf#1', {
            previewCurrent: previewRef.current.current,
          })
          window.requestAnimationFrame(() => {
            updatePreviewImageMetrics()
            logLayoutDebug('preview visibility restore raf#2', {
              previewCurrent: previewRef.current.current,
            })
          })
        })
      }
    }

    const onResize = () => {
      updatePreviewImageMetrics()
      logLayoutDebug('preview window resize', {
        previewCurrent: previewRef.current.current,
      })
    }

    document.addEventListener('visibilitychange', logVisibility)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('visibilitychange', logVisibility)
      window.removeEventListener('resize', onResize)
    }
  }, [preview.open, updatePreviewImageMetrics])

  useEffect(() => {
    if (preview.open && viewportStable) {
      updatePreviewImageMetrics()
    }
  }, [preview.open, updatePreviewImageMetrics, viewportStable])

  useEffect(() => {
    if (!preview.open)
      return

    const onWheel = (e: WheelEvent) => {
      if (!resolvePreviewRootTarget(e.target, { x: e.clientX, y: e.clientY }))
        return
      if (isPreviewEventIgnored(e.target))
        return
      lastPreviewPointerRef.current = { x: e.clientX, y: e.clientY }

      // 必须用 stopImmediatePropagation 阻止 React 合成事件系统把 wheel 传给 rc-image 的 onWheel。
      // 仅 stopPropagation 不够，因为 React portal 的事件委托可能在同一元素上。
      e.preventDefault()
      e.stopImmediatePropagation()

      if (wheelModeRef.current === 'page') {
        if (e.deltaY > 0)
          goNext()
        else if (e.deltaY < 0)
          goPrev()
        return
      }

      zoomStep(e.deltaY < 0 ? 1 : -1, { x: e.clientX, y: e.clientY })
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!resolvePreviewRootTarget(e.target, { x: e.clientX, y: e.clientY }) || isPreviewEventIgnored(e.target))
        return
      lastPreviewPointerRef.current = { x: e.clientX, y: e.clientY }
    }

    const onContextMenuRoot = (e: MouseEvent) => {
      if (!resolvePreviewRootTarget(e.target, { x: e.clientX, y: e.clientY }) || isPreviewEventIgnored(e.target))
        return

      // 用 ref 读取最新 preview.current，否则翻页后右键拿到的是旧 image
      const cur = previewRef.current.current ?? 0
      const {
        enableContextMenu: latestEnableContextMenu,
        flipPreview: latestFlipPreview,
        images,
        show: latestShow,
        workspaceImages: latestWorkspaceImages,
      } = previewContextRef.current
      const currentImage = images[cur]
      if (!currentImage)
        return
      e.preventDefault()
      e.stopImmediatePropagation()

      vscodeApi.log('debug', `${PREVIEW_LOG_PREFIX} context menu requested`, {
        current: cur,
        imagePath: currentImage.path,
      })
      latestShow?.({
        event: e as any,
        props: {
          image: currentImage,
          sameLevelImages: images,
          sameWorkspaceImages: latestWorkspaceImages,
          enableContextMenu: buildPreviewContextMenuEnable(latestEnableContextMenu),
          z_commands: {
            edit: {
              beforeOpen: () => setHistogramVisible(false),
            },
            transform: {
              onFlipX: () => latestFlipPreview('x'),
              onFlipY: () => latestFlipPreview('y'),
            },
          },
          shortcutsVisible: false,
        },
      })
    }

    document.addEventListener('wheel', onWheel, PREVIEW_WHEEL_EVENT_OPTIONS)
    document.addEventListener('pointermove', onPointerMove, true)
    document.addEventListener('contextmenu', onContextMenuRoot, true)

    return () => {
      document.removeEventListener('wheel', onWheel, PREVIEW_WHEEL_EVENT_OPTIONS)
      document.removeEventListener('pointermove', onPointerMove, true)
      document.removeEventListener('contextmenu', onContextMenuRoot, true)
    }
  }, [preview.open])

  const [previewBase64Tick, setPreviewBase64Tick] = useState(0)

  useEffect(() => {
    const unsub = subscribeUnsupportedCache(() => setPreviewBase64Tick(t => t + 1))
    return unsub
  }, [])

  const currentCustomPreviewImage = preview.open && typeof preview.current === 'number'
    ? imagesProp[preview.current]
    : undefined
  const customFormatController = useCustomFormatSession(currentCustomPreviewImage)
  const currentCustomDecodeOptions = customFormatController.isCustom ? customFormatController.decodeOptions : undefined
  const currentCustomOptionsKey = customFormatController.isCustom ? customFormatController.optionsKey : ''

  const _previewItems = useMemo(
    () =>
      imagesProp.map((t, itemIndex) => {
        if (isUnsupportedImage(t) || (preview.open && itemIndex === preview.current && customFormatController.isCustom)) {
          const options = preview.open && itemIndex === preview.current && customFormatController.isCustom
            ? currentCustomDecodeOptions
            : undefined
          return { src: getStableSrcForUnsupported(t.path, options) }
        }
        return { src: t.vscodePath }
      }),
    [customFormatController.isCustom, currentCustomDecodeOptions, currentCustomOptionsKey, imagesProp, preview.current, preview.open, previewBase64Tick],
  )
  const previewItems = _previewItems

  useEffect(() => {
    if (!preview.open)
      return
    const current = imagesProp[preview.current ?? 0]
    if (current) {
      pauseThumbnailsForPreview()
      vscodeApi.log('debug', `${PREVIEW_LOG_PREFIX} focus current`, {
        current: preview.current,
        extname: current.extname,
        path: current.path,
        unsupported: isUnsupportedImage(current),
      })
      vscodeApi.postMessage({ cmd: CmdToVscode.focus_preview_image, data: { filePath: current.path } })
    }
    let cancelled = false
    const currentIndex = preview.current
    if (typeof currentIndex === 'number') {
      prefetchNeighbors(imagesProp, currentIndex, 2)
    }
    const currentNeedsCustomDecode = customFormatController.isCustom
    if (!current || (!isUnsupportedImage(current) && !currentNeedsCustomDecode)) {
      return () => {
        cancelled = true
      }
    }
    const decodeOptions = customFormatController.isCustom ? currentCustomDecodeOptions : undefined
    if (getCachedUnsupportedBase64(current.path, decodeOptions)) {
      vscodeApi.log('debug', `${PREVIEW_LOG_PREFIX} unsupported cache hit`, {
        decodeOptions,
        path: current.path,
      })
      return () => {
        cancelled = true
      }
    }
    vscodeApi.log('debug', `${PREVIEW_LOG_PREFIX} unsupported fetch requested`, {
      decodeOptions,
      path: current.path,
    })
    fetchUnsupportedAsBase64(current.path, {
      decodeOptions,
      forceCustomDecode: currentNeedsCustomDecode,
      priority: 'high',
    }).then((dataUrl) => {
      vscodeApi.log(dataUrl ? 'debug' : 'warn', `${PREVIEW_LOG_PREFIX} unsupported fetch finished`, {
        decodeOptions,
        len: dataUrl.length,
        path: current.path,
        prefix: dataUrl.slice(0, 32),
      })
      if (!cancelled && dataUrl)
        setPreviewBase64Tick(t => t + 1)
    })
    return () => {
      cancelled = true
    }
  }, [customFormatController.isCustom, currentCustomDecodeOptions, currentCustomOptionsKey, preview.open, preview.current, imagesProp])

  useEffect(() => {
    if (!preview.open)
      return
    const pending = pendingPreviewIndexRef.current
    if (pending === null)
      return
    if (pending >= imagesProp.length) {
      if (canPreviewLoadMore && !pendingPreviewLoadRef.current) {
        pendingPreviewLoadRef.current = true
        void Promise.resolve(actions.ensureVisibleIndex(pending)).finally(() => {
          pendingPreviewLoadRef.current = false
        })
      }
      return
    }
    pendingPreviewIndexRef.current = null
    pendingPreviewLoadRef.current = false
    setPreview({ open: true, current: pending })
    applyPreviewTransformForIndex(pending)
  }, [preview.open, imagesProp.length, canPreviewLoadMore, actions, applyPreviewTransformForIndex])

  useEffect(() => {
    if (!preview.open)
      return
    setPreviewPageDraft(String((preview.current ?? 0) + 1))
  }, [preview.open, preview.current])

  const antdImageProps = useMemo(
    () => ({
      ...(lazyImageProps?.antdImageProps || {}),
      style: { backgroundColor },
      className: 'object-scale-down',
      width: imageWidth,
      height: imageWidth,
    }),
    [lazyImageProps?.antdImageProps, backgroundColor, imageWidth],
  )

  const handleSelectedChange = useMemoizedFn((image: ImageType, selected: boolean) => {
    setSelectedImages(t => toggleImageSelection(t, image, selected))
  })

  const previewSrc = preview.open && typeof preview.current === 'number' ? previewItems[preview.current]?.src : undefined
  const previewImage = preview.open && typeof preview.current === 'number' ? imagesProp[preview.current] : undefined

  useEffect(() => {
    if (!preview.open)
      return
    vscodeApi.log(isUnsupportedPlaceholder(previewSrc) ? 'warn' : 'debug', `${PREVIEW_LOG_PREFIX} src selected`, {
      current: preview.current,
      imagePath: previewImage?.path,
      isPlaceholder: isUnsupportedPlaceholder(previewSrc),
      srcPrefix: previewSrc?.slice(0, 48),
      unsupported: previewImage ? isUnsupportedImage(previewImage) : false,
    })
  }, [preview.open, preview.current, previewImage?.path, previewSrc])

  useEffect(() => {
    if (!preview.open)
      return

    let disposed = false
    let raf = 0

    const apply = () => {
      if (disposed)
        return
      const img = getActivePreviewImage()
      if (img) {
        img.style.filter = previewImageFilterCss || ''
        return
      }
      raf = window.requestAnimationFrame(apply)
    }

    apply()

    return () => {
      disposed = true
      if (raf)
        window.cancelAnimationFrame(raf)
      const img = getActivePreviewImage()
      if (img)
        img.style.filter = ''
    }
  }, [preview.open, preview.current, previewImageFilterCss])

  // 高倍率下禁用 CSS transition，让像素网格能即时对齐图像位置。
  // antd/rc-image 的 .ant-image-preview-img 有 transition: transform 0.3s，
  // 在 8× 以上缩放时这个动画会导致网格"慢半拍"。
  useEffect(() => {
    if (!preview.open)
      return
    const timer = window.setTimeout(() => {
      const img = document.querySelector<HTMLElement>('.ant-image-preview-img, .rc-image-preview-img')
      if (!img)
        return
      img.style.transitionDuration = currentTransform.scale >= 8 ? '0s' : ''
    }, 0)
    return () => {
      window.clearTimeout(timer)
      const img = document.querySelector<HTMLElement>('.ant-image-preview-img, .rc-image-preview-img')
      if (img)
        img.style.transitionDuration = ''
    }
  }, [preview.open, currentTransform.scale])

  return (
    <div ref={containerRef} className='flex flex-col gap-2'>
      <div
        className={classNames(!virtualized && 'flex flex-wrap gap-1.5', virtualized && 'relative', clearSelectedOnBlankClick && ShouldClickAway.Viewer)}
        data-image-grid-count={images.length}
        data-image-grid-virtualized={virtualized ? 'true' : 'false'}
        ref={setImageListRef}
        style={virtualized ? { height: virtualGrid.totalHeight } : undefined}
      >
        <ConfigProvider
          theme={{ components: { Image: { ...imageToken(isDarkBackground) } } }}
        >
          <svg
            width='0'
            height='0'
            className='pointer-events-none fixed left-0 top-0'
            aria-hidden='true'
          >
            <defs>
              {previewImageSvgFilter && (
                <filter id={previewValueRangeFilterId} colorInterpolationFilters='sRGB'>
                  {previewImageSvgFilter.type === 'threshold'
                    ? (
                        <feComponentTransfer>
                          <feFuncR type='table' tableValues={previewImageSvgFilter.table} />
                          <feFuncG type='table' tableValues={previewImageSvgFilter.table} />
                          <feFuncB type='table' tableValues={previewImageSvgFilter.table} />
                          <feFuncA type='identity' />
                        </feComponentTransfer>
                      )
                    : (
                        <feComponentTransfer>
                          <feFuncR type='linear' slope={previewImageSvgFilter.slope} intercept={previewImageSvgFilter.intercept} />
                          <feFuncG type='linear' slope={previewImageSvgFilter.slope} intercept={previewImageSvgFilter.intercept} />
                          <feFuncB type='linear' slope={previewImageSvgFilter.slope} intercept={previewImageSvgFilter.intercept} />
                          <feFuncA type='identity' />
                        </feComponentTransfer>
                      )}
                </filter>
              )}
            </defs>
          </svg>
          <div
            className={classNames('flex w-full flex-wrap', virtualized && 'absolute left-0 top-0')}
            data-image-grid-window={virtualized ? `${virtualGrid.startIndex}:${virtualGrid.endIndex}` : undefined}
            style={{ gap: IMAGE_GRID_GAP, ...(virtualized ? { transform: `translateY(${virtualGrid.offsetTop}px)` } : {}) }}
          >
            <Image.PreviewGroup preview={previewProps} items={previewItems}>
              <ConfigProvider
                theme={{ components: { Image: { colorTextLightSolid: token.colorTextLightSolid } } }}
              >
                {renderedImages.map((image, renderedIndex) => (
                  <div
                    key={image.key}
                    data-image-grid-item={virtualized ? virtualGrid.startIndex + renderedIndex : renderedIndex}
                    onClick={e => onClick(e, image)}
                    className={classNames(PreventClickAway.Viewer, PreventClickAway.Other)}
                  >
                    {renderer(
                      <LazyImage
                        {...lazyImageProps}
                        image={image}
                        selected={selectedImages.some(t => t.path === image.path)}
                        isMultipleSelecting={isMultipleSelecting}
                        antdImageProps={antdImageProps}
                        onSelectedChange={handleSelectedChange}
                        onPreviewClick={handlePreviewClick}
                        onContextMenu={onContextMenu}
                        interactive={interactive}
                      />,
                      image,
                    )}
                  </div>
                ))}
              </ConfigProvider>
            </Image.PreviewGroup>
          </div>
          <PixelInspector
            src={previewSrc}
            transform={currentTransform}
            visible={!!preview.open}
            valueRange={valueRangeFilter}
            pixelValueMode={pixelValueMode}
          />
          <HistogramPanel
            src={previewSrc}
            imagePath={previewImage && !isUnsupportedImage(previewImage) ? previewImage.path : undefined}
            visible={!!preview.open && histogramVisible}
            range={valueRange}
            pixelValueMode={pixelValueMode}
            onChange={setValueRange}
            onClose={() => setHistogramVisible(false)}
            onPixelValueModeChange={setPixelValueMode}
          />
          {preview.open && previewImage
            ? (
                <CustomFormatToolbar
                  image={previewImage}
                  controller={customFormatController}
                  variant='preview'
                />
              )
            : null}
        </ConfigProvider>
      </div>
      {imageStatus.hasMore && (
        <div
          onClick={actions.loadMore}
          className='mx-auto my-4 flex cursor-pointer items-center gap-2 rounded border border-solid border-ant-color-border px-3 py-1 text-xs text-ant-color-text-secondary hover:border-ant-color-primary hover:text-ant-color-primary'
        >
          <Spin spinning={false} size='small' />
          <span>
            {totalImageCount === undefined && imageStatus.hasMoreRemote
              ? `${images.length}+`
              : `${images.length}/${Math.max(totalImageCount || 0, imagesProp.length)}`}
          </span>
        </div>
      )}
    </div>
  )
}

export default memo(forwardRef(ImageGroup))
