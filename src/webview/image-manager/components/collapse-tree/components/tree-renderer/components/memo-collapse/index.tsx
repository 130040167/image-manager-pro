import type { CollapseProps, GetProps } from 'antd'
import type { ReactNode } from 'react'
import type TreeRenderer from '../..'
import type { EnableCollapseContextMenuType } from '~/webview/image-manager/components/context-menus/components/collapse-context-menu'
import type { NestedTreeNode, TreeData } from '~/webview/image-manager/utils/tree/tree-manager'
import { useMemoizedFn } from 'ahooks'
import { produce } from 'immer'
import { useAtomValue, useSetAtom } from 'jotai'
import { selectAtom } from 'jotai/utils'
import { memo, useEffect, useMemo } from 'react'
import { VscFileMedia, VscFolder } from 'react-icons/vsc'
import { DisplayGroupType } from '~/core/persist/workspace/common'
import { CmdToVscode } from '~/message/cmd'
import { ActionAtoms } from '~/webview/image-manager/stores/action/action-store'
import { imageStateAtom } from '~/webview/image-manager/stores/image/image-store'
import { useDisplayGroup, useHideKnownEmptyDirs } from '~/webview/image-manager/stores/settings/hooks'
import { recordThumbnailDirectoryLoad } from '~/webview/image-manager/utils/thumbnail-cache'
import { UpdateEvent, UpdateOrigin, UpdateType } from '~/webview/image-manager/utils/tree/const'
import { NodeType } from '~/webview/image-manager/utils/tree/tree'
import { classNames } from '~/webview/image-manager/utils/tw-clsx'
import { vscodeApi } from '~/webview/vscode-api'
import ImageCollapse from '../../../image-collapse'
import RevealInFolder from '../../../reveal-in-folder'
import { getDirectoryWarmupPauseMs, logDirectoryWarmupSkipped, recordDirectoryWarmupLoadTiming } from './directory-warmup-pause'
import styles from './index.module.css'

const directoryChildrenInFlight = new Set<string>()
const directoryImagePagesInFlight = new Set<string>()
const directoryRequestedImageOffset = new Map<string, number>()
const directoryTimedOutUntil = new Map<string, number>()
const directorySingleChildAutoOpened = new Set<string>()
const directoryAutoRetryAttempts = new Map<string, number>()
let directoryNavigationGeneration = 0
const ENABLE_OPENED_DIR_EMPTY_PROBE = false
const DIRECTORY_IMAGE_PAGE_SIZE = 128
const DIRECTORY_REQUEST_TIMEOUT_MS = 11_000
const DIRECTORY_TIMEOUT_COOLDOWN_MS = 6_000
const DIRECTORY_LOADING_UI_DELAY_MS = 800
// 超时后允许的自动重试次数。SSHFS 连接偶发卡顿时，单次失败不应让用户手动点。
const DIRECTORY_TIMEOUT_AUTO_RETRY_LIMIT = 1
const DIRECTORY_TIMEOUT_AUTO_RETRY_DELAY_MS = 1_500

function normalizeWebviewPath(filePath: string) {
  return filePath.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '')
}

function relativeToWorkspace(absDirPath: string, workspaceId: string) {
  const abs = normalizeWebviewPath(absDirPath)
  const root = normalizeWebviewPath(workspaceId)
  const absLower = abs.toLowerCase()
  const rootLower = root.toLowerCase()

  if (absLower === rootLower)
    return ''
  if (absLower.startsWith(`${rootLower}/`))
    return abs.slice(root.length + 1)
  return abs
}

type DirectoryLoadResult = {
  canLoadMoreImages?: boolean
  childrenLoaded?: boolean
  directFolderCount?: number
  directImageCount?: number
  imagesLoaded?: boolean
  loadedImageCount?: number
  ok?: boolean
  timeout?: boolean
  count?: number
}

type DirectoryOpenOptions = {
  reason?: 'active-effect' | 'collapse-change' | 'click-toggle'
}

type DirectoryWarmupTarget = {
  imageDepth?: number
  maxDepth?: number
  reason?: string
  startDirs?: string[]
}

function isDirectoryCoolingDown(key: string) {
  const until = directoryTimedOutUntil.get(key) || 0
  if (until <= Date.now()) {
    directoryTimedOutUntil.delete(key)
    return false
  }
  return true
}

function createDirectoryTraceId(kind: 'children' | 'page', dirPath: string, attempt = 0) {
  const leaf = normalizeWebviewPath(dirPath).split('/').filter(Boolean).pop() || 'root'
  return `dir-${kind}:${Date.now()}:${attempt}:${leaf}`
}

type Props = {
  data: TreeData
  id: string
  resolvedId: string
  isRoot?: boolean
  collapseProps?: CollapseProps
  tree: NestedTreeNode[] | undefined
  renderTree: (tree: NestedTreeNode[]) => JSX.Element | null
} & GetProps<typeof TreeRenderer>

const RevealGroup = memo((props: { path: string, folderChildren?: ReactNode }) => {
  return (
    <div className='flex items-center gap-x-1'>
      <RevealInFolder {...props}>{props.folderChildren}</RevealInFolder>
    </div>
  )
})

function MemoCollapse(props: Props) {
  const { data, workspaceFolder, workspaceId, id, isRoot, collapseProps, treeManager, renderTree, resolvedId, tree } = props

  // 优化状态访问，使用 selectAtom 减少不必要的重新渲染
  const workspaceLength = useAtomValue(
    selectAtom(
      imageStateAtom,
      useMemoizedFn(state => state.workspaces.length),
    ),
  )

  const [displayGroup] = useDisplayGroup()
  const [hideKnownEmptyDirs] = useHideKnownEmptyDirs()
  const dispatchImageState = useSetAtom(imageStateAtom)

  const getContextMenu = useMemoizedFn((contextMenu: EnableCollapseContextMenuType): EnableCollapseContextMenuType => {
    return {
      compress_in_current_directory: true,
      compress_in_recursive_directories: true,
      format_conversion_in_current_directory: true,
      format_conversion_in_recursive_directories: true,
      open_in_os_explorer: true,
      open_in_vscode_explorer: true,
      ...contextMenu,
    }
  })

  const strategies = useMemo(() => {
    return {
      [NodeType.dir]: {
        icon: (props: { path: string }) => <RevealGroup {...props} />,
        contextMenu: getContextMenu,
      },
      [NodeType.ext]: {
        icon: () => <VscFileMedia className='mr-1' />,
        contextMenu: null,
      },
      [NodeType.root]: {
        icon: (props: { path: string }) => <RevealGroup {...props} />,
        contextMenu: getContextMenu,
      },
    }
  }, [])

  // 记忆化策略函数，避免每次渲染都重新创建
  const fnStrategy = useMemo(() => {
    return (nodeType: NodeType) => {
      return strategies[nodeType] || strategies[NodeType.dir]
    }
  }, [strategies])

  // 这个状态是稳定的
  const collapseIdSet = useAtomValue(ActionAtoms.collapseIdSet)
  collapseIdSet.add(resolvedId)
  const setActiveCollapseIdSet = useSetAtom(ActionAtoms.activeCollapseIdSet)
  const isActiveCollapse = useAtomValue(selectAtom(ActionAtoms.activeCollapseIdSet, useMemoizedFn(state => state.has(resolvedId))))

  // 非根节点，或者多工作区时，可以折叠
  const collapsible = !isRoot || workspaceLength > 1

  const { contextMenu } = fnStrategy(data.nodeType)
  const memoedContextMenu = useMemoizedFn((id: string) => {
    return contextMenu!({
      rename_directory: id !== workspaceId,
      delete_directory: id !== workspaceId,
    })
  })

  const memoedCollapseProps = useMemo(() => {
    return {
      bordered: false,
      className: classNames(styles.collapse),
      ...collapseProps,
    }
  }, [collapseProps])

  const labelRender = useMemoizedFn((label: ReactNode) => {
    const showCounts = data.nodeType === NodeType.ext
      || !!data.childrenLoaded
      || !!data.imagesLoaded
      || data.canLoadChildren === false
    const folderCount = data.directFolderCount ?? data.folderCount ?? 0
    const imageCount = data.directImageCount ?? data.imageCount ?? 0
    const showFolderCount = folderCount > 0
    const showImageCount = imageCount > 0 || (showCounts && folderCount === 0 && imageCount === 0)

    return (
      <div className='flex min-w-0 items-center gap-x-1'>
        <div className='flex items-center'>{fnStrategy(data.nodeType).icon({ path: resolvedId })}</div>
        <div className='min-w-0 flex-1'>{label}</div>
        {showCounts && (showFolderCount || showImageCount)
          ? (
              <div className='ml-2 flex shrink-0 items-center gap-x-2 rounded px-1.5 py-0.5 text-[11px] text-ant-color-text-tertiary'>
                {showFolderCount
                  ? (
                      <div className='flex items-center gap-x-1'>
                        <VscFolder className='text-[12px]' />
                        <span>{folderCount}</span>
                      </div>
                    )
                  : null}
                {showImageCount
                  ? (
                      <div className='flex items-center gap-x-1'>
                        <VscFileMedia className='text-[12px]' />
                        <span>{imageCount}</span>
                      </div>
                    )
                  : null}
              </div>
            )
          : null}
      </div>
    )
  })

  useEffect(() => {
    if (data.nodeType !== NodeType.dir && data.nodeType !== NodeType.root)
      return

    vscodeApi.log('debug', 'directory node render state', {
      absPath: data.absPath,
      canLoadChildren: data.canLoadChildren,
      canLoadMoreImages: data.canLoadMoreImages,
      childDirNodes: tree?.filter(node => node.data.nodeType === NodeType.dir).length ?? 0,
      childNodes: tree?.length ?? 0,
      childrenLoaded: data.childrenLoaded,
      directFolderCount: data.directFolderCount,
      directImageCount: data.directImageCount,
      imagesLoaded: data.imagesLoaded,
      knownEmpty: data.knownEmpty,
      loadedImageCount: data.loadedImageCount,
      loadingChildren: data.loadingChildren,
      resolvedId,
      workspaceId,
    })
  }, [
    data.absPath,
    data.canLoadChildren,
    data.canLoadMoreImages,
    data.childrenLoaded,
    data.directFolderCount,
    data.directImageCount,
    data.imagesLoaded,
    data.knownEmpty,
    data.loadedImageCount,
    data.loadingChildren,
    data.nodeType,
    resolvedId,
    tree,
    workspaceId,
  ])

  const patchDirectoryLoading = useMemoizedFn((dirPath: string, loadingChildren: boolean, reason: string) => {
    vscodeApi.log(reason === 'timeout' ? 'warn' : 'debug', 'directory loading patched locally', {
      childrenLoaded: data.childrenLoaded,
      dirPath,
      loadingChildren,
      previousLoadingChildren: data.loadingChildren,
      reason,
      workspaceId,
    })
    dispatchImageState({
      updateType: UpdateType.patch,
      id: `directory-loading:${dirPath}:${Date.now()}`,
      workspaceFolder,
      absWorkspaceFolder: workspaceId,
      payloads: [
        {
          origin: UpdateOrigin.dir,
          data: {
            type: UpdateEvent.update,
            payload: {
              absDirPath: normalizeWebviewPath(dirPath),
              absWorkspaceFolder: normalizeWebviewPath(workspaceId),
              canLoadChildren: true,
              dirPath: relativeToWorkspace(dirPath, workspaceId),
              loadingChildren,
              workspaceFolder,
            },
          },
        },
      ],
    })
  })

  const settleDirectoryLoading = useMemoizedFn((dirPath: string, reason: 'success' | 'timeout') => {
    patchDirectoryLoading(dirPath, false, reason)
  })

  const loadDirectoryChildren = useMemoizedFn((dirPath: string, options?: DirectoryOpenOptions, attempt = 0) => {
    if (data.nodeType !== NodeType.dir && data.nodeType !== NodeType.root)
      return

    const loadedImageCount = data.loadedImageCount || 0
    const directImageCount = data.directImageCount
    const needsInitialImages = data.childrenLoaded
      && !data.imagesLoaded
      && (data.canLoadMoreImages || (directImageCount !== undefined && directImageCount > loadedImageCount))
      && loadedImageCount === 0
    const isImageOnlyRequest = !!needsInitialImages

    if (options?.reason === 'click-toggle' && !isImageOnlyRequest) {
      directoryNavigationGeneration++
    }

    if ((data.childrenLoaded && !needsInitialImages) || (attempt === 0 && data.loadingChildren) || data.canLoadChildren === false)
      return

    const key = `${workspaceId}:${dirPath}`
    if (isDirectoryCoolingDown(key)) {
      vscodeApi.log('debug', 'directory children load skipped', {
        attempt,
        dirPath,
        reason: 'timeout-cooldown',
        workspaceId,
      })
      return
    }
    if (directoryChildrenInFlight.has(key))
      return

    directoryChildrenInFlight.add(key)
    const traceId = createDirectoryTraceId('children', dirPath, attempt)
    let loadingTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
      loadingTimer = undefined
      patchDirectoryLoading(dirPath, true, 'foreground-delayed')
    }, DIRECTORY_LOADING_UI_DELAY_MS)
    vscodeApi.log('debug', 'directory children load scheduled', {
      attempt,
      childrenLoaded: data.childrenLoaded,
      dirPath,
      directImageCount,
      inFlight: directoryChildrenInFlight.size,
      loadingDelayMs: DIRECTORY_LOADING_UI_DELAY_MS,
      loadedImageCount,
      loadingChildren: data.loadingChildren,
      needsInitialImages,
      requestReason: options?.reason,
      traceId,
      workspaceId,
    })

    void (async () => {
      let result: DirectoryLoadResult | undefined
      const startedAt = Date.now()
      try {
        vscodeApi.log('debug', 'directory children load start', {
          attempt,
          childrenLoaded: data.childrenLoaded,
          dirPath,
          inFlight: directoryChildrenInFlight.size,
          loadedImageCount,
          loadingChildren: data.loadingChildren,
          needsInitialImages,
          requestReason: options?.reason,
          traceId,
          workspaceId,
        })

        if (isDirectoryCoolingDown(key)) {
          vscodeApi.log('debug', 'directory children load skipped', {
            attempt,
            dirPath,
            reason: 'timeout-cooldown-before-request',
            traceId,
            workspaceId,
          })
          settleDirectoryLoading(dirPath, 'timeout')
          return
        }

        result = await new Promise<DirectoryLoadResult | undefined>((resolve) => {
          vscodeApi.postMessageWithTimeout(
            {
              cmd: CmdToVscode.get_directory_children,
              traceId,
              data: {
                cwd: workspaceId,
                dirPath,
                imageLimit: DIRECTORY_IMAGE_PAGE_SIZE,
                includeImages: isImageOnlyRequest,
                imageOffset: isImageOnlyRequest ? 0 : undefined,
                refresh: attempt > 0,
                requestReason: options?.reason,
                priority: isImageOnlyRequest
                  ? 'background'
                  : (options?.reason === 'click-toggle' ? 'click' : 'normal'),
              },
            },
            DIRECTORY_REQUEST_TIMEOUT_MS,
            resolve,
            { ok: false, timeout: true } as any,
          )
        })

        if (result?.ok) {
          const nextOffset = Math.max(
            directoryRequestedImageOffset.get(key) || 0,
            result.loadedImageCount || 0,
            result.directImageCount !== undefined && result.imagesLoaded ? result.directImageCount : 0,
          )
          directoryRequestedImageOffset.set(key, nextOffset)
          directoryTimedOutUntil.delete(key)
          directoryAutoRetryAttempts.delete(key)
        }
        const isCancelled = result?.ok === false && result.timeout === false
        if ((result?.timeout || result?.ok === false) && !isCancelled) {
          directoryTimedOutUntil.set(key, Date.now() + DIRECTORY_TIMEOUT_COOLDOWN_MS)
        }
      }
      catch (err) {
        vscodeApi.log('error', 'directory children load failed before callback', {
          dirPath,
          error: err instanceof Error ? err.message : String(err),
          traceId,
          workspaceId,
        })
        directoryTimedOutUntil.set(key, Date.now() + DIRECTORY_TIMEOUT_COOLDOWN_MS)
      }
      finally {
        if (loadingTimer) {
          clearTimeout(loadingTimer)
          loadingTimer = undefined
        }
        directoryChildrenInFlight.delete(key)
        const isCancelled = result?.ok === false && result.timeout === false
        const isFailure = !!(result?.timeout || result?.ok === false) && !isCancelled
        if (isCancelled || isFailure) {
          patchDirectoryLoading(dirPath, false, 'cancelled')
        }
        const runMs = Date.now() - startedAt
        recordThumbnailDirectoryLoad(dirPath, runMs, !!result?.ok && !isFailure)
        recordDirectoryWarmupLoadTiming({ dirPath, isImageOnlyRequest, runMs, traceId, workspaceId })
        vscodeApi.log(isFailure ? 'warn' : 'debug', 'directory children load finish', {
          attempt,
          dirPath,
          inFlight: directoryChildrenInFlight.size,
          result,
          runMs,
          traceId,
          workspaceId,
        })

        // 自动重试：仅在用户主动点击触发的请求超时后做一次。
        // SSHFS 偶发卡顿时第一次 readdir 卡满 14s 是常见现象，第二次往往就通了。
        const isUserClick = options?.reason === 'click-toggle'
        const retryCount = directoryAutoRetryAttempts.get(key) || 0
        if (isFailure && isUserClick && retryCount < DIRECTORY_TIMEOUT_AUTO_RETRY_LIMIT) {
          directoryAutoRetryAttempts.set(key, retryCount + 1)
          // 暂时清掉 cooldown，允许立即重试
          directoryTimedOutUntil.delete(key)
          vscodeApi.log('debug', 'directory children auto-retry scheduled', {
            attempt,
            dirPath,
            retryCount: retryCount + 1,
            traceId,
            workspaceId,
          })
          setTimeout(() => {
            // 重新检查目录仍未加载且未关闭，再发起重试
            if (data.childrenLoaded || data.canLoadChildren === false)
              return
            loadDirectoryChildren(dirPath, options, attempt + 1)
          }, DIRECTORY_TIMEOUT_AUTO_RETRY_DELAY_MS)
        }
        else if (!isFailure) {
          directoryAutoRetryAttempts.delete(key)
        }
      }
    })()
  })

  const scheduleDirectoryWarmup = useMemoizedFn((dirPath: string) => {
    if (data.nodeType !== NodeType.dir && data.nodeType !== NodeType.root)
      return
    if (!isRoot && !isActiveCollapse)
      return
    if (!data.childrenLoaded || data.loadingChildren)
      return
    if (!tree?.length)
      return
    const warmupPauseMs = getDirectoryWarmupPauseMs(workspaceId)
    if (warmupPauseMs > 0) {
      logDirectoryWarmupSkipped({
        dirPath,
        pauseMs: warmupPauseMs,
        reason: 'slow-foreground-load',
        workspaceId,
      })
      return
    }

    const childDirs = tree
      .filter(node => node.data.nodeType === NodeType.dir)
      .map(node => normalizeWebviewPath(node.data.absPath || node.id))
      .slice(0, 24)
    const siblingDirs = treeManager?.tree
      .getSibling(id)
      .filter(node => node.data.nodeType === NodeType.dir)
      .map(node => normalizeWebviewPath(node.data.absPath || node.id.replace(new RegExp(`^${workspaceFolder}`), workspaceId)))
      .filter(siblingDir => siblingDir !== dirPath)
      .slice(0, 8) || []

    if (!childDirs.length && !siblingDirs.length)
      return

    const targets: DirectoryWarmupTarget[] = []
    if (childDirs.length) {
      targets.push({
        imageDepth: -1,
        maxDepth: 0,
        reason: 'opened-dir-children',
        startDirs: childDirs,
      })
    }
    if (siblingDirs.length) {
      targets.push({
        imageDepth: -1,
        maxDepth: 0,
        reason: 'opened-dir-siblings',
        startDirs: siblingDirs,
      })
    }

    const currentDirKey = `${workspaceId}:${dirPath}`
    const scheduledGeneration = directoryNavigationGeneration
    const handle = window.setTimeout(() => {
      if (scheduledGeneration !== directoryNavigationGeneration)
        return
      if (directoryChildrenInFlight.has(currentDirKey))
        return
      const warmupPauseMs = getDirectoryWarmupPauseMs(workspaceId)
      if (warmupPauseMs > 0) {
        logDirectoryWarmupSkipped({
          dirPath,
          pauseMs: warmupPauseMs,
          reason: 'slow-foreground-load-before-post',
          workspaceId,
        })
        return
      }
      vscodeApi.log('debug', 'directory warmup requested', {
        childDirs: childDirs.length,
        dirPath,
        siblingDirs: siblingDirs.length,
        workspaceId,
      })
      vscodeApi.postMessage({
        cmd: CmdToVscode.warmup_directory_tree,
        data: {
          cwd: workspaceId,
          targets,
        },
      })
    }, 350)

    return () => window.clearTimeout(handle)
  })

  const loadMoreDirectoryImages = useMemoizedFn((dirPath: string, loaded: number): Promise<DirectoryLoadResult | undefined> => {
    if (data.nodeType !== NodeType.dir && data.nodeType !== NodeType.root)
      return Promise.resolve(undefined)
    const loadedImageCount = data.loadedImageCount || 0
    const hasMoreKnownImages = !!data.canLoadMoreImages
      || (data.directImageCount !== undefined && loadedImageCount < data.directImageCount)
    if ((!data.childrenLoaded && !hasMoreKnownImages) || data.imagesLoaded || data.loadingChildren || data.canLoadChildren === false)
      return Promise.resolve(undefined)
    if (directoryChildrenInFlight.size) {
      vscodeApi.log('debug', 'directory image page load skipped', {
        dirPath,
        inFlightChildren: directoryChildrenInFlight.size,
        reason: 'directory-request-in-flight',
        workspaceId,
      })
      return Promise.resolve({ ok: false, timeout: true })
    }

    const total = data.directImageCount
    const dirKey = `${workspaceId}:${dirPath}`
    const requestedOffset = directoryRequestedImageOffset.get(dirKey) || 0
    const offset = Math.max(loaded, data.loadedImageCount || 0)
    const nextOffset = Math.max(offset, requestedOffset)
    if (total !== undefined && nextOffset >= total)
      return Promise.resolve(undefined)
    if (total === undefined && !data.canLoadMoreImages)
      return Promise.resolve(undefined)

    const key = `${dirKey}:${nextOffset}`
    if (directoryImagePagesInFlight.has(key))
      return Promise.resolve(undefined)

    directoryImagePagesInFlight.add(key)
    directoryRequestedImageOffset.set(dirKey, nextOffset + DIRECTORY_IMAGE_PAGE_SIZE)
    const traceId = createDirectoryTraceId('page', dirPath, nextOffset)
    vscodeApi.log('debug', 'directory image page load start', {
      dirPath,
      loaded,
      loadedImageCount: data.loadedImageCount,
      nextOffset,
      requestedOffset,
      canLoadMoreImages: data.canLoadMoreImages,
      total,
      traceId,
      workspaceId,
    })
    return new Promise((resolve) => {
      vscodeApi.postMessageWithTimeout(
        {
          cmd: CmdToVscode.get_directory_children,
          traceId,
          data: {
            cwd: workspaceId,
            dirPath,
            imageLimit: DIRECTORY_IMAGE_PAGE_SIZE,
            imageOffset: nextOffset,
            includeImages: true,
            priority: 'background',
          },
        },
        DIRECTORY_REQUEST_TIMEOUT_MS,
        (result: DirectoryLoadResult | undefined) => {
          directoryImagePagesInFlight.delete(key)
          vscodeApi.log(result?.timeout || result?.ok === false ? 'warn' : 'debug', 'directory image page load finish', {
            dirPath,
            inFlight: directoryImagePagesInFlight.size,
            nextOffset,
            result,
            traceId,
            workspaceId,
          })
          if (result?.timeout) {
            const rollbackOffset = Math.max(
              loaded,
              data.loadedImageCount || 0,
              nextOffset,
            )
            directoryRequestedImageOffset.set(dirKey, rollbackOffset)
          }
          resolve(result)
        },
        { ok: false, timeout: true } as any,
      )
    })
  })

  useEffect(() => {
    if (!data.childrenLoaded || data.loadingChildren)
      return
    if (data.nodeType !== NodeType.dir && data.nodeType !== NodeType.root)
      return
    if (data.directFolderCount !== 1 || (data.directImageCount ?? 0) > 0)
      return
    if (!tree?.length)
      return

    const dirChildren = tree.filter(node => node.data.nodeType === NodeType.dir)
    if (dirChildren.length !== 1)
      return

    const child = dirChildren[0]
    const childPath = child.data.absPath || normalizeWebviewPath(child.id).replace(new RegExp(`^${workspaceFolder}`), workspaceId)
    const key = `${workspaceId}:${resolvedId}->${childPath}`
    if (directorySingleChildAutoOpened.has(key))
      return

    directorySingleChildAutoOpened.add(key)
    setActiveCollapseIdSet(
      produce((draft) => {
        draft.add(resolvedId)
        draft.add(childPath)
      }),
    )
    vscodeApi.log('debug', 'directory single child auto open', {
      childPath,
      dirPath: resolvedId,
      workspaceId,
    })
  }, [
    data.childrenLoaded,
    data.directFolderCount,
    data.directImageCount,
    data.loadingChildren,
    data.nodeType,
    resolvedId,
    setActiveCollapseIdSet,
    tree,
    workspaceFolder,
    workspaceId,
  ])

  useEffect(() => {
    const cleanup = scheduleDirectoryWarmup(resolvedId)
    return cleanup
  }, [
    data.childrenLoaded,
    data.loadingChildren,
    data.nodeType,
    isActiveCollapse,
    isRoot,
    resolvedId,
    scheduleDirectoryWarmup,
    tree,
    workspaceId,
  ])

  if (!data)
    return null

  return (
    <ImageCollapse
      key={resolvedId}
      id={resolvedId}
      collapseProps={memoedCollapseProps}
      collapsible={collapsible}
      // 不能折叠时，强制展开
      forceOpen={!collapsible ? true : undefined}
      labelRender={labelRender}
      contextMenu={contextMenu ? memoedContextMenu : undefined}
      label={data.path!}
      images={data.images}
      workspaceFolder={workspaceFolder}
      workspaceRoot={workspaceId}
      totalImageCount={data.directImageCount}
      loadedImageCount={data.loadedImageCount}
      folderImages={treeManager?.getNodeImages(id)}
      subfolderImages={treeManager?.getSubnodeImages(id)}
      tooltipDisplayFullPath={!displayGroup.includes(DisplayGroupType.dir)}
      loadingChildren={data.loadingChildren}
      childrenLoaded={data.childrenLoaded}
      canLoadChildren={data.canLoadChildren}
      canLoadMoreImages={data.canLoadMoreImages}
      onOpen={loadDirectoryChildren}
      onNeedMoreImages={loadMoreDirectoryImages}
      renderChildren={() => data.path && tree ? renderTree(tree) : null}
    />
  )
}

export default memo(MemoCollapse)
