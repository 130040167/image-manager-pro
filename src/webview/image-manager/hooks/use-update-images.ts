import type { FullUpdate, PatchUpdate } from '~/message/webview-message-factory'
import { useMemoizedFn } from 'ahooks'
import { useSetAtom } from 'jotai'
import { CmdToVscode } from '~/message/cmd'
import logger from '~/utils/logger'
import { vscodeApi } from '~/webview/vscode-api'
import { imageStateAtom, WorkspaceUpdate } from '../stores/image/image-store'

/**
 * 更新图片
 */
export default function useUpdateImages() {
  const dispatchImageState = useSetAtom(imageStateAtom)

  /**
   * 全量更新
   */
  const fullUpdate = useMemoizedFn((data: FullUpdate) => {
    dispatchImageState(data)
  })

  /**
   * 增量更新
   */
  const patchUpdate = useMemoizedFn((data: PatchUpdate) => {
    dispatchImageState(data)
  })

  /**
   * imageState更新后，把部分属性恢复到默认值
   */
  const resetPartialState = useMemoizedFn((workspaceFolder?: string, updateId?: string) => {
    dispatchImageState({
      updateType: WorkspaceUpdate.reset,
      updateId,
      workspaceFolder,
    })
  })

  /**
   * 获取所有图片
   */
  const getAllImages = useMemoizedFn(async (options?: { refresh?: boolean }) => {
    logger.time(CmdToVscode.get_all_images_from_cwds)
    return new Promise<boolean>((resolve) => {
      vscodeApi.postMessage({ cmd: CmdToVscode.get_all_images_from_cwds, data: options }, () => {
        resolve(true)
        logger.timeEnd(CmdToVscode.get_all_images_from_cwds)
      })
    })
  })

  const warmupDirectoryTree = useMemoizedFn(async (
    cwd: string,
    startDirs?: string[],
    options?: {
      imageDepth?: number
      maxDepth?: number
      reason?: string
      targets?: Array<{
        imageDepth?: number
        maxDepth?: number
        reason?: string
        startDirs?: string[]
      }>
    },
  ) => {
    return new Promise<boolean>((resolve) => {
      vscodeApi.postMessage(
        {
          cmd: CmdToVscode.warmup_directory_tree,
          data: {
            cwd,
            startDirs,
            ...options,
          },
        },
        () => {
          resolve(true)
        },
      )
    })
  })

  return {
    fullUpdate,
    patchUpdate,
    getAllImages,
    warmupDirectoryTree,
    resetPartialState,
  }
}
