import type { CollapseProps, GetProps } from 'antd'
import type { ReactNode } from 'react'
import type { EnableCollapseContextMenuType } from '../../../context-menus/components/collapse-context-menu'
import type imageName from '../../../image-name'
import type { DirectoryOpenReason } from './directory-open-state'
import { useMemoizedFn } from 'ahooks'
import { Collapse, Spin } from 'antd'
import { isUndefined } from 'es-toolkit'
import { produce } from 'immer'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { selectAtom } from 'jotai/utils'
import { memo, useEffect, useMemo, useRef } from 'react'
import { Element, scroller } from 'react-scroll'
import { useControlledState } from '~/webview/image-manager/hooks/use-controlled-state'
import { useWhyUpdateDebug } from '~/webview/image-manager/hooks/use-why-update-debug'
import { ActionAtoms } from '~/webview/image-manager/stores/action/action-store'
import { CopyType, FileAtoms } from '~/webview/image-manager/stores/file/file-store'
import { GlobalAtoms } from '~/webview/image-manager/stores/global/global-store'
import { clearTimestamp } from '~/webview/image-manager/utils'
import { classNames } from '~/webview/image-manager/utils/tw-clsx'
import { vscodeApi } from '~/webview/vscode-api'
import useImageManagerEvent, { IMEvent } from '../../../../hooks/use-image-manager-event'
import useSticky from '../../../../hooks/use-sticky'
import useCollapseContextMenu from '../../../context-menus/components/collapse-context-menu/hooks/use-collapse-context-menu'
import ImageGroup from '../../../image-group'
import SingleLabel from './components/single-label'
import {

  hasInitialImagePagePending as getHasInitialImagePagePending,
  needsDirectoryOpenRequest,
  shouldSkipDuplicateDirectoryOpen,
} from './directory-open-state'
import './index.css'

type ImageCollapseProps = {
  workspaceFolder: string
  workspaceRoot: string
  canLoadMoreImages?: boolean
  loadedImageCount?: number
  totalImageCount?: number
  /**
   * 透传给 antd collapse 的 props
   */
  collapseProps: CollapseProps
  /**
   * collapase展示的title
   */
  label: string
  /**
   * 增强label渲染
   */
  labelRender: (children: ReactNode) => ReactNode
  /**
   * 需要渲染的图片
   */
  images: ImageType[] | undefined
  /**
   * 当前文件夹下的图片
   */
  folderImages: ImageType[] | undefined
  /**
   * 当前文件夹下的所有图片（包括子目录）
   */
  subfolderImages: ImageType[] | undefined
  /**
   * 嵌套子组件
   */
  children?: JSX.Element | null
  /**
   * 按展开状态懒渲染嵌套目录，避免关闭的深层目录提前挂载。
   */
  renderChildren?: () => JSX.Element | null
  /**
   * 目录绝对地址
   */
  id: string
  /**
   * collapse头部菜单上下文
   */
  contextMenu: ((path: string) => EnableCollapseContextMenuType) | undefined
  /**
   * 是否可以展开
   */
  collapsible?: boolean
  /**
   * 强制展开
   */
  forceOpen?: boolean
  /**
   * 图片名称显示方式
   */
  tooltipDisplayFullPath: GetProps<typeof imageName>['tooltipDisplayFullPath']
  /**
   * 展开目录时懒加载子项
   */
  onOpen?: (id: string, options?: { reason?: OpenReason }) => void
  /**
   * 图片滚动到底时按需加载下一批目录图片
   */
  onNeedMoreImages?: (id: string, loaded: number) => Promise<{ ok?: boolean, timeout?: boolean } | void> | { ok?: boolean, timeout?: boolean } | void
  /**
   * 子项是否正在加载
   */
  loadingChildren?: boolean
  childrenLoaded?: boolean
  canLoadChildren?: boolean
}

type OpenReason = DirectoryOpenReason

const directoryOpenRequestSession = new Set<string>()

// 非 click 来源（active-effect / collapse-change）的合并去重窗口。
// 同一目录在窗口期内的多次自动触发只发送一次请求，且优先级保持 normal，
// 不会与用户主动 click-toggle 抢占同一条 SSH 连接。
const NON_CLICK_OPEN_DEBOUNCE_MS = 300
const pendingNonClickOpens = new Map<string, ReturnType<typeof setTimeout>>()

function scheduleNonClickOpen(id: string, fire: () => void) {
  const existing = pendingNonClickOpens.get(id)
  if (existing) {
    clearTimeout(existing)
  }
  const timer = setTimeout(() => {
    pendingNonClickOpens.delete(id)
    fire()
  }, NON_CLICK_OPEN_DEBOUNCE_MS)
  pendingNonClickOpens.set(id, timer)
}

function cancelPendingNonClickOpen(id: string) {
  const timer = pendingNonClickOpens.get(id)
  if (timer) {
    clearTimeout(timer)
    pendingNonClickOpens.delete(id)
  }
}

/**
 * viewer 目录图片组件
 */
function ImageCollapse(props: ImageCollapseProps) {
  const {
    workspaceFolder,
    workspaceRoot,
    canLoadMoreImages,
    loadedImageCount,
    totalImageCount,
    collapseProps,
    children,
    renderChildren,
    labelRender,
    label,
    images,
    folderImages,
    subfolderImages,
    id,
    contextMenu,
    collapsible = true,
    forceOpen,
    tooltipDisplayFullPath,
    onOpen,
    onNeedMoreImages,
    loadingChildren,
    childrenLoaded,
    canLoadChildren,
  } = props

  useWhyUpdateDebug('ImageCollapse', props)

  const isActive = useAtomValue(selectAtom(ActionAtoms.activeCollapseIdSet, useMemoizedFn(state => state.has(id))))

  const setActiveCollapseIdSet = useSetAtom(ActionAtoms.activeCollapseIdSet)

  const onOpenChange = useMemoizedFn((open: boolean) => {
    setActiveCollapseIdSet(
      produce((draft) => {
        if (open) {
          draft.add(id)
        }
        else {
          draft.delete(id)
        }
      }),
    )
  })

  const [_open, setOpen] = useControlledState<boolean>({
    value: forceOpen || isActive,
    onChange: onOpenChange,
  })

  const open = _open
  const shouldRenderContent = !!forceOpen || open
  const hasInitialImagePagePending = getHasInitialImagePagePending({
    canLoadMoreImages,
    childrenLoaded,
    loadedImageCount,
    totalImageCount,
  })

  const emitOpen = useMemoizedFn((reason: OpenReason) => {
    const needsOpenRequest = needsDirectoryOpenRequest({
      canLoadChildren,
      canLoadMoreImages,
      childrenLoaded,
      loadedImageCount,
      loadingChildren,
      totalImageCount,
    })

    if (!needsOpenRequest) {
      vscodeApi.log('debug', 'directory open trigger skipped', {
        canLoadChildren,
        canLoadMoreImages,
        childrenLoaded,
        id,
        loadingChildren,
        open: _open,
        reason,
        skipReason: 'already-settled-or-loading',
        shouldRenderContent,
      })
      return
    }

    if (shouldSkipDuplicateDirectoryOpen({
      hasInitialImagePagePending,
      hasOpenRequestSession: directoryOpenRequestSession.has(id),
      reason,
    })) {
      vscodeApi.log('debug', 'directory open trigger skipped', {
        canLoadChildren,
        canLoadMoreImages,
        childrenLoaded,
        hasInitialImagePagePending,
        id,
        loadingChildren,
        open: _open,
        reason,
        skipReason: 'duplicate-open-session',
        shouldRenderContent,
      })
      return
    }

    const fire = () => {
      directoryOpenRequestSession.add(id)
      vscodeApi.log('debug', 'directory open trigger', {
        canLoadChildren,
        canLoadMoreImages,
        childrenLoaded,
        hasInitialImagePagePending,
        id,
        loadingChildren,
        open: _open,
        reason,
        shouldRenderContent,
      })
      onOpen?.(id, { reason })
    }

    if (reason === 'click-toggle') {
      // 用户主动点击，立即发送，并取消任何同 id 待发送的自动请求
      cancelPendingNonClickOpen(id)
      fire()
      return
    }

    // 非 click 来源（active-effect / collapse-change）合并去重，延迟 300ms 后发送
    vscodeApi.log('debug', 'directory open trigger debounced', {
      id,
      reason,
      delayMs: NON_CLICK_OPEN_DEBOUNCE_MS,
    })
    scheduleNonClickOpen(id, fire)
  })

  useEffect(() => {
    if (_open || forceOpen) {
      emitOpen('active-effect')
    }
  }, [_open, forceOpen, id, hasInitialImagePagePending])

  useEffect(() => {
    if (_open || forceOpen) {
      return
    }

    directoryOpenRequestSession.delete(id)
    cancelPendingNonClickOpen(id)
  }, [_open, forceOpen, id])

  const imageReveal = useAtomValue(GlobalAtoms.imageRevealAtom)
  const viewerHeaderStickyHeight = useAtomValue(GlobalAtoms.viewerHeaderStickyHeightAtom)
  const [dirReveal, setDirReveal] = useAtom(GlobalAtoms.dirRevealAtom)
  const workspaceImages = useAtomValue(GlobalAtoms.workspaceImagesAtom)

  const sameWorkspaceImages = useMemo(() => {
    return workspaceImages.find(item => item.workspaceFolder === workspaceFolder)?.images
  }, [workspaceImages])

  const stickyRef = useRef<HTMLDivElement>(null)
  const holderRef = useRef<HTMLDivElement>(null)

  // 获取collapse的header dom
  const getCollpaseHeader = useMemoizedFn(() => stickyRef.current?.querySelector('.ant-collapse-header') as HTMLElement | null)
  const isSticky = useRef(false)

  useEffect(() => {
    if (stickyRef.current) {
      const target = getCollpaseHeader()

      if (target) {
        // 不让header可获取焦点，避免点击header回车后有聚焦效果
        target.removeAttribute('tabindex')

        if (!collapsible) {
          target.style.cursor = 'auto'
        }
      }
    }
  }, [stickyRef])

  const onCollapseChange = useMemoizedFn((keys: string[]) => {
    if (!collapsible)
      return

    setOpen(!!keys.length)
    if (keys.length) {
      emitOpen('collapse-change')
    }
    if (!keys.length) {
      directoryOpenRequestSession.delete(id)
      cancelPendingNonClickOpen(id)
      // 关闭collapse
      // 如果sticky状态，需要滚动collapse的header到顶部
      if (isSticky.current) {
        scroller.scrollTo(id, {
          duration: 0,
          smooth: false,
          offset: -viewerHeaderStickyHeight,
          containerId: 'root',
        })
      }
    }
  })

  const { show, hideAll } = useCollapseContextMenu()

  const basePath = useMemo(() => id.slice(0, id.lastIndexOf(label)), [id, label])
  const labels = useMemo(() => label.split('/').filter(Boolean), [label])

  const onActive = useMemoizedFn((imagePaths: string[]) => {
    // 判断当前collapse是否active
    if (imagePaths.length && subfolderImages?.find(image => imagePaths.includes(image.path))) {
      setOpen(true)
    }
  })

  // 由于collapse的内容默认是不渲染的，
  // 所以需要在 `reveal_in_viewer` 的时候，主动触发collapse渲染
  useEffect(() => {
    if (!open) {
      onActive([clearTimestamp(imageReveal)])
    }
  }, [imageReveal])

  useEffect(() => {
    // 如果此目录是需要打开的目录，需要把目录滚动到可视区域中间
    // 并且清空全局的dirReveal
    if (id === dirReveal) {
      setDirReveal('')
      stickyRef.current?.scrollIntoView({
        behavior: 'instant',
        block: 'center',
      })
    }
  }, [id])

  const { imageManagerEvent } = useImageManagerEvent({
    on: {
      [IMEvent.reveal_in_viewer]: (imagePath) => {
        onActive([imagePath])
      },
      [IMEvent.rename_directory]: (previousDirPath, newPath) => {
        if (previousDirPath === id) {
          setDirReveal(newPath)
        }
      },
    },
  })

  const getCurrentPath = useMemoizedFn((index: number | undefined) => {
    if (isUndefined(index))
      return basePath
    return basePath + labels.slice(0, index + 1).join('/')
  })

  const onContextMenu = useMemoizedFn((e: React.MouseEvent<HTMLDivElement>, index: number) => {
    if (!contextMenu)
      return

    const path = getCurrentPath(index) || ''

    show({
      event: e,
      props: {
        path,
        images: [images, folderImages].find(arr => arr?.length) || [],
        subfolderImages: subfolderImages || [],
        workspaceRoot,
        enableContextMenu: contextMenu(path),
        onPaste: hideAll,
      },
    })
  })

  const onClick = useMemoizedFn(() => {
    if (!collapsible)
      return
    setOpen((open) => {
      const next = !open
      if (next) {
        directoryOpenRequestSession.delete(id)
        emitOpen('click-toggle')
      }
      return next
    })
  })

  const generateLabel = useMemoizedFn((labels: string[]) => {
    if (labels.length > 1) {
      return (
        <div className='flex w-full min-w-0 items-center'>
          {labels.map((item, i) => (
            <div key={i} className={classNames('flex min-w-0 items-center', i === labels.length - 1 && 'flex-1')}>
              <SingleLabel
                index={i}
                contextMenu={contextMenu?.(getCurrentPath(i))}
                onContextMenu={e => onContextMenu(e, i)}
                onClick={onClick}
                dirPath={getCurrentPath(i)}
                className={classNames('min-w-0', collapsible && 'cursor-pointer')}
              >
                {item}
              </SingleLabel>
              <div className={classNames('px-0.5', i !== labels.length - 1 ? 'block' : 'hidden')}>/</div>
            </div>
          ))}
        </div>
      )
    }
    else {
      return (
        <SingleLabel
          onClick={onClick}
          index={0}
          contextMenu={contextMenu?.(id)}
          onContextMenu={e => onContextMenu(e, 0)}
          dirPath={id}
          className={classNames(collapsible && 'cursor-pointer')}
        >
          {labels[0]}
        </SingleLabel>
      )
    }
  })

  useSticky({
    target: getCollpaseHeader(),
    holder: holderRef,
    onStickyToogle(sticky, { rawStyle }) {
      isSticky.current = sticky
      if (sticky) {
        const style = [
          'z-index: 4',
          `top: ${viewerHeaderStickyHeight}px`,
          'position: sticky',
          'background-color: var(--sticky-collapse-header-bgColor)',
          'backdrop-filter: blur(30px)',
          'box-shadow: var(--ant-box-shadow)',
        ].join('; ')

        rawStyle += style
      }

      getCollpaseHeader()?.setAttribute('style', rawStyle)
    },
    topOffset: viewerHeaderStickyHeight,
    enable: open,
  })

  const memoArr = useMemo(() => [], [])
  // atom中，map引用每次都会改变
  const selectedImages = useAtomValue(selectAtom(FileAtoms.imageSelectedMap, useMemoizedFn(state => state.get(id) || memoArr)))
  const setImageSelectedMap = useSetAtom(FileAtoms.imageSelectedMap)

  const imageSelected = useAtomValue(FileAtoms.imageSelected)
  const imageCopied = useAtomValue(FileAtoms.imageCopied)

  const onSelectedImagesChange = useMemoizedFn((images: ImageType[]) => {
    setImageSelectedMap(
      produce((draft) => {
        // 优化渲染
        if (!images.length && !draft.get(id)?.length)
          return
        draft.set(id, images)
      }),
    )
  })

  const onClearImageGroupSelected = useMemoizedFn(() => {
    imageManagerEvent.emit(IMEvent.clear_viewer_selected_images)
  })

  const lazyImageProps: GetProps<typeof ImageGroup>['lazyImageProps'] = useMemo(() => {
    return {
      // 剪切的图片添加透明度
      className: (image) => {
        if (imageCopied?.type === CopyType.MOVE && imageCopied.list.length) {
          return imageCopied.list.some(item => item.path === image.path) ? classNames('opacity-50') : ''
        }
        return ''
      },
      inViewer: true,
      imageNameProps: {
        tooltipDisplayFullPath,
      },
    }
  }, [tooltipDisplayFullPath, imageCopied])

  const enableContextMenu: GetProps<typeof ImageGroup>['enableContextMenu'] = useMemo(() => {
    return {
      compress: true,
      edit: true,
      format_conversion: true,
      crop: true,
      find_similar_in_all: true,
      find_similar_in_same_level: true,
      cut: true,
      copy: true,
      delete: true,
      rename: true,
      reveal_in_viewer: false,
    }
  }, [])

  const onMultipleSelectContextMenu = useMemoizedFn(() => {
    return imageSelected
  })

  const nestedChildren = shouldRenderContent ? renderChildren?.() || children : null

  useEffect(() => {
    vscodeApi.log('debug', 'directory panel state', {
      canLoadChildren,
      canLoadMoreImages,
      childrenLoaded,
      hasNestedChildren: !!nestedChildren,
      id,
      images: images?.length || 0,
      loadingChildren,
      open,
      shouldRenderContent,
      totalImageCount,
    })
  }, [
    canLoadChildren,
    canLoadMoreImages,
    childrenLoaded,
    id,
    images,
    loadingChildren,
    nestedChildren,
    open,
    shouldRenderContent,
    totalImageCount,
  ])

  if (!images?.length && !nestedChildren && !renderChildren && !loadingChildren && canLoadChildren === false)
    return null

  return (
    <Element name={id}>
      <Collapse
        {...collapseProps}
        /**
         * 由于图片数量可能很多，如果打开了collapse之后，即使关闭了也会一直渲染
         * 所以需要在关闭的时候销毁inactive的panel
         *
         * UPDATE: 摧毁组件会导致每次打开都耗费性能，可能会有交互延迟
         */
        destroyOnHidden={false}
        ref={stickyRef}
        activeKey={open ? [id] : []}
        onChange={onCollapseChange}
        items={[
          {
            forceRender: shouldRenderContent,
            key: id,
            label: labelRender(generateLabel(labels)),
            children: images?.length
              ? (
                  <div className={classNames('space-y-2')}>
                    <ImageGroup
                      ref={holderRef}
                      id={id}
                      selectedImages={selectedImages}
                      onSelectedImagesChange={onSelectedImagesChange}
                      enableMultipleSelect={true}
                      onMultipleSelectContextMenu={onMultipleSelectContextMenu}
                      enableContextMenu={enableContextMenu}
                      lazyImageProps={lazyImageProps}
                      images={images}
                      workspaceImages={sameWorkspaceImages}
                      onNeedMoreImages={() => onNeedMoreImages?.(id, images.length)}
                      canLoadMoreImages={canLoadMoreImages}
                      totalImageCount={totalImageCount}
                      onClearImageGroupSelected={onClearImageGroupSelected}
                      clearSelectedOnBlankClick={true}
                      inViewer={true}
                    />
                    {nestedChildren}
                    {loadingChildren ? <Spin size='small' /> : null}
                  </div>
                )
              : (
                  <>
                    {nestedChildren}
                    {loadingChildren ? <Spin size='small' /> : null}
                  </>
                ),
          },
        ]}
      >
      </Collapse>
    </Element>
  )
}

export default memo(ImageCollapse)
