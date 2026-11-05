import type { Workspace } from '../../stores/image/image-store'
import type { NestedTreeNode } from '../../utils/tree/tree-manager'
import { useMemoizedFn } from 'ahooks'
import { ConfigProvider } from 'antd'
import { flatten, isSubset } from 'es-toolkit'
import { produce } from 'immer'
import { useSetAtom } from 'jotai'
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DisplayGroupType, DisplayStyleType } from '~/core/persist/workspace/common'
import logger from '~/utils/logger'
import { vscodeApi } from '~/webview/vscode-api'
import useUpdateDeepEffect from '../../hooks/use-update-deep-effect'
import useUpdateImages from '../../hooks/use-update-images'
import { useWhyUpdateDebug } from '../../hooks/use-why-update-debug'
import { ActionAtoms } from '../../stores/action/action-store'
import { useImageFilter } from '../../stores/action/hooks'
import { GlobalAtoms } from '../../stores/global/global-store'
import { useDisplayGroup, useDisplayStyle, useHideKnownEmptyDirs, useSort } from '../../stores/settings/hooks'
import { UpdateOrigin, UpdateType } from '../../utils/tree/const'
import { TreeStyle } from '../../utils/tree/tree'
import { TreeManager } from '../../utils/tree/tree-manager'
import TreeRenderer from './components/tree-renderer'

type Props = {
  workspace: Workspace
}

function updateTarget(payloads: NonNullable<Workspace['update']>['payloads'] | undefined) {
  const first = payloads?.[0]
  if (!first) {
    return undefined
  }
  if (first.origin === UpdateOrigin.dir) {
    return first.data.payload.absDirPath
  }
  return first.data.payload.path
}

function updateTargetDir(payloads: NonNullable<Workspace['update']>['payloads'] | undefined) {
  const dirPayload = payloads?.find(payload => payload.origin === UpdateOrigin.dir)
  return dirPayload?.origin === UpdateOrigin.dir ? dirPayload.data.payload.absDirPath : undefined
}

/**
 * NOTE: 此重组件在大量图片时，会有性能问题，因为每次都会重新计算树结构。
 * 所以尽量保证，这个组件中的状态和方法是稳定的。
 * 把经常变动的状态下沉，由轻量子组件处理。
 */
function CollapseTree(props: Props) {
  const { workspace } = props

  useWhyUpdateDebug('CollapseTree', props)

  const { resetPartialState } = useUpdateImages()

  const treeManager = useRef<TreeManager>()
  const updateSeqRef = useRef(0)
  const pendingCommitRef = useRef<{
    nestedNodes: number
    seq: number
    traceId?: string
    updateId?: string
    updateLabel?: string
  } | null>(null)

  const setWorkspaceImages = useSetAtom(GlobalAtoms.workspaceImagesAtom)
  const [nestedTree, setNestedTree] = useState<NestedTreeNode[]>()

  const [displayGroup] = useDisplayGroup()
  const [displayStyle] = useDisplayStyle()
  const [sort] = useSort()
  const [hideKnownEmptyDirs] = useHideKnownEmptyDirs()

  const [imageFilter] = useImageFilter()

  const notifyCollapseChange = useSetAtom(ActionAtoms.notifyCollapseChange)

  const afterUpdate = useMemoizedFn((seq: number, updateId?: string, traceId?: string, updateLabel?: string) => {
    const targetAbsDirPath = updateTargetDir(workspace.update?.payloads)
    if (traceId) {
      vscodeApi.log('debug', 'tree update start', {
        seq,
        targetAbsDirPath,
        traceId,
        updateId: updateId || updateLabel,
      })
    }
    treeManager.current?.setTraceContext(traceId, targetAbsDirPath)
    const nestedTree = treeManager.current?.toNestedArraySync()

    if (updateId) {
      resetPartialState(workspace.workspaceFolder, updateId)
    }
    const nestedRoot = nestedTree?.[0]
    pendingCommitRef.current = {
      nestedNodes: nestedTree?.length ?? 0,
      seq,
      traceId,
      updateId,
      updateLabel,
    }
    setNestedTree(nestedTree || [])

    // 获取当前工作区的可见图片列表
    const images = flatten(treeManager.current!.toArray(nestedTree || [], node => node.data.images || []))
    setWorkspaceImages(
      produce((draft) => {
        const index = draft.findIndex(t => t.workspaceFolder === workspace.workspaceFolder)
        if (index !== -1) {
          draft[index].images = images
        }
        else {
          draft.push({ workspaceFolder: workspace.workspaceFolder, images })
        }
      }),
    )
    notifyCollapseChange()
    if (traceId) {
      vscodeApi.log('debug', 'apply tree update', {
        firstNodeChildren: nestedRoot?.children?.length ?? 0,
        firstNodeImages: nestedRoot?.data.images?.length ?? 0,
        nodes: nestedTree?.length ?? 0,
        seq,
        targetAbsDirPath,
        traceId,
        updateId: updateId || updateLabel,
      })
    }
  })

  const displayGroupToTreeStyle = useMemoizedFn((group: DisplayGroupType[]) => {
    if (isSubset(group, [DisplayGroupType.dir, DisplayGroupType.extname])) {
      return TreeStyle.dir_extension
    }
    if (isSubset(group, [DisplayGroupType.dir])) {
      return TreeStyle.dir
    }
    if (isSubset(group, [DisplayGroupType.extname])) {
      return TreeStyle.extension
    }
    return TreeStyle.flat
  })

  const generateRenderTree = useMemoizedFn(() => {
    const treeStyle = displayGroupToTreeStyle(displayGroup)

    const isCompact = displayStyle === DisplayStyleType.compact
    logger.debug('紧凑模式: ', isCompact)

    treeManager.current = new TreeManager(workspace.workspaceFolder, {
      compact: isCompact,
      filter: imageFilter,
      hideKnownEmptyDirs,
      sort,
      treeStyle,
    })

    treeManager.current?.generateTree(workspace.images, workspace.directories)
  })

  useEffect(() => {
    if (workspace.update) {
      const seq = ++updateSeqRef.current
      const targetAbsDirPath = updateTargetDir(workspace.update.payloads)
      if (workspace.update.traceId) {
        vscodeApi.log('debug', 'workspace update received by collapse tree', {
          payloads: workspace.update.payloads.length,
          targetAbsDirPath,
          traceId: workspace.update.traceId,
          updateId: workspace.update.id,
          updateType: workspace.update.type,
          workspaceFolder: workspace.workspaceFolder,
        })
      }
      switch (workspace.update.type) {
        case UpdateType.patch:
          if (!treeManager.current) {
            generateRenderTree()
          }
          else {
            treeManager.current.setTraceContext(workspace.update.traceId, targetAbsDirPath)
            treeManager.current.updateTree(workspace.update.payloads)
          }
          break
        case UpdateType.full:
          generateRenderTree()
          treeManager.current?.setTraceContext(workspace.update.traceId, targetAbsDirPath)
          break
        default:
          break
      }

      afterUpdate(seq, workspace.update.id, workspace.update.traceId, updateTarget(workspace.update.payloads))
    }
  }, [workspace.update])

  useLayoutEffect(() => {
    const pending = pendingCommitRef.current
    if (!pending?.traceId) {
      return
    }

    vscodeApi.log('debug', 'tree render commit', {
      nodes: pending.nestedNodes,
      seq: pending.seq,
      traceId: pending.traceId,
      updateId: pending.updateId || pending.updateLabel,
    })
    pendingCommitRef.current = null
  }, [nestedTree])

  useUpdateDeepEffect(() => {
    if (workspace.images.length || treeManager.current?.tree.nodes.size) {
      const seq = ++updateSeqRef.current
      generateRenderTree()
      afterUpdate(seq)
    }
  }, [displayGroup, displayStyle, hideKnownEmptyDirs, imageFilter, sort])

  return (
    <ConfigProvider
      theme={{
        components: {
          Collapse: {
            lineWidth: 0,
          },
        },
      }}
    >
      <TreeRenderer
        tree={nestedTree}
        treeManager={treeManager.current}
        workspaceFolder={workspace.workspaceFolder}
        workspaceId={workspace.absWorkspaceFolder}
      />
    </ConfigProvider>
  )
}

export default memo(CollapseTree)
