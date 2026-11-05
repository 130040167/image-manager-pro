import type { UpdatePayload } from '../../utils/tree/tree-manager'
import type { FullUpdate, PatchUpdate } from '~/message/webview-message-factory'
import { groupBy, remove } from 'es-toolkit'
import { find } from 'es-toolkit/compat'
import { produce } from 'immer'
import { atomWithReducer } from 'jotai/utils'
import logger from '~/utils/logger'
import { UpdateEvent, UpdateOrigin, UpdateType } from '../../utils/tree/const'

export type Workspace = {
  images: ImageType[] // 图片
  directories: UpdatePayload[] // 已知目录骨架
  workspaceFolder: string // 工作区名称
  absWorkspaceFolder: string // 工作区绝对路径
  update:
    | {
      payloads: UpdatePayload[] // 更新的图片
      type: UpdateType // 更新类型，全量更新/增量更新
      id?: string
      traceId?: string
    }
    | undefined
}

export enum WorkspaceUpdate {
  reset = 'reset',
}

function identityPath(filePath: string | undefined) {
  const normalized = (filePath || '').replace(/\\/g, '/')
  return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized
}

function dedupeImages(images: ImageType[]) {
  return Array.from(
    images.reduce((map, image) => {
      const key = identityPath(image.path)
      const previous = map.get(key)
      map.set(key, previous ? mergeImage(previous, image) : image)
      return map
    }, new Map<string, ImageType>()).values(),
  )
}

function mergeMetadata<T extends Metadata | undefined>(previous: T, next: T) {
  return {
    ...previous,
    ...Object.fromEntries(
      Object.entries(next || {}).filter(([, value]) => value !== undefined && value !== null),
    ),
  } as Metadata
}

function mergeImage(previous: ImageType, next: ImageType): ImageType {
  return {
    ...previous,
    ...next,
    info: {
      ...previous.info,
      ...next.info,
      metadata: mergeMetadata(previous.info?.metadata, next.info?.metadata),
    },
    stats: {
      mtimeMs: next.stats.mtimeMs || previous.stats.mtimeMs,
      size: next.stats.size || previous.stats.size,
    },
    vscodePath: next.stats.mtimeMs ? next.vscodePath : previous.vscodePath || next.vscodePath,
  }
}

function upsertImage(images: ImageType[], image: ImageType) {
  const key = identityPath(image.path)
  const index = images.findIndex(item => identityPath(item.path) === key)
  if (index === -1) {
    images.push(image)
    return
  }

  images[index] = mergeImage(images[index], image)
}

function dirIdentity(payload: UpdatePayload) {
  return payload.origin === UpdateOrigin.dir ? identityPath(payload.data.payload.absDirPath) : ''
}

function mergeDirPayload(previous: UpdatePayload, next: UpdatePayload): UpdatePayload {
  if (previous.origin !== UpdateOrigin.dir || next.origin !== UpdateOrigin.dir) {
    return next
  }

  const previousPayload = previous.data.payload
  const nextPayload = next.data.payload

  const merged = {
    ...next,
    data: {
      ...next.data,
      payload: {
        ...previousPayload,
        ...nextPayload,
        absWorkspaceFolder: nextPayload.absWorkspaceFolder ?? previousPayload.absWorkspaceFolder,
        canLoadChildren: nextPayload.canLoadChildren ?? previousPayload.canLoadChildren,
        canLoadMoreImages: nextPayload.canLoadMoreImages ?? previousPayload.canLoadMoreImages,
        childrenLoaded: !!previousPayload.childrenLoaded || !!nextPayload.childrenLoaded,
        directFolderCount: nextPayload.directFolderCount ?? previousPayload.directFolderCount,
        directImageCount: nextPayload.directImageCount ?? previousPayload.directImageCount,
        imagePageLimit: nextPayload.imagePageLimit ?? previousPayload.imagePageLimit,
        imagePageOffset: nextPayload.imagePageOffset ?? previousPayload.imagePageOffset,
        imagesLoaded: nextPayload.imagesLoaded ?? previousPayload.imagesLoaded,
        loadedImageCount: Math.max(previousPayload.loadedImageCount || 0, nextPayload.loadedImageCount || 0),
        loadingChildren: !!nextPayload.loadingChildren,
      },
    },
  }

  const wasLoading = !!previousPayload.loadingChildren
  const isLoading = !!nextPayload.loadingChildren
  const becameLoaded = !previousPayload.childrenLoaded && !!nextPayload.childrenLoaded
  if (wasLoading !== isLoading || becameLoaded) {
    logger.debug('[directory-state]', {
      absDirPath: nextPayload.absDirPath ?? previousPayload.absDirPath,
      childrenLoaded: !!previousPayload.childrenLoaded || !!nextPayload.childrenLoaded,
      canLoadMoreImages: nextPayload.canLoadMoreImages ?? previousPayload.canLoadMoreImages,
      directFolderCount: nextPayload.directFolderCount ?? previousPayload.directFolderCount,
      directImageCount: nextPayload.directImageCount ?? previousPayload.directImageCount,
      imagesLoaded: nextPayload.imagesLoaded ?? previousPayload.imagesLoaded,
      loadedImageCount: Math.max(previousPayload.loadedImageCount || 0, nextPayload.loadedImageCount || 0),
      loadingChildren: isLoading,
      previousLoadingChildren: wasLoading,
    })
  }

  if (
    nextPayload.childrenLoaded !== undefined
    || nextPayload.imagesLoaded !== undefined
    || nextPayload.directFolderCount !== undefined
    || nextPayload.directImageCount !== undefined
    || nextPayload.loadedImageCount !== undefined
  ) {
    logger.debug('[directory-merge]', {
      absDirPath: nextPayload.absDirPath ?? previousPayload.absDirPath,
      canLoadChildren: nextPayload.canLoadChildren ?? previousPayload.canLoadChildren,
      canLoadMoreImages: nextPayload.canLoadMoreImages ?? previousPayload.canLoadMoreImages,
      childrenLoaded: !!previousPayload.childrenLoaded || !!nextPayload.childrenLoaded,
      directFolderCount: nextPayload.directFolderCount ?? previousPayload.directFolderCount,
      directImageCount: nextPayload.directImageCount ?? previousPayload.directImageCount,
      imagesLoaded: nextPayload.imagesLoaded ?? previousPayload.imagesLoaded,
      loadedImageCount: Math.max(previousPayload.loadedImageCount || 0, nextPayload.loadedImageCount || 0),
      loadingChildren: !!nextPayload.loadingChildren,
      previousChildrenLoaded: previousPayload.childrenLoaded,
      previousDirectFolderCount: previousPayload.directFolderCount,
      previousDirectImageCount: previousPayload.directImageCount,
      previousImagesLoaded: previousPayload.imagesLoaded,
    })
  }

  return merged
}

function dedupeDirPayloads(payloads: UpdatePayload[]) {
  return Array.from(
    payloads
      .filter(payload => payload.origin === UpdateOrigin.dir)
      .reduce((map, payload) => {
        const key = dirIdentity(payload)
        const previous = map.get(key)
        map.set(key, previous ? mergeDirPayload(previous, payload) : payload)
        return map
      }, new Map<string, UpdatePayload>())
      .values(),
  )
}

function mergePendingPayloads(previousPayloads: UpdatePayload[], nextPayloads: UpdatePayload[]) {
  const map = new Map<string, UpdatePayload>()

  previousPayloads.concat(nextPayloads).forEach((payload) => {
    const key = payload.origin === UpdateOrigin.image
      ? `${payload.origin}:${identityPath(payload.data.payload.path)}`
      : `${payload.origin}:${identityPath(payload.data.payload.absDirPath)}`
    const previous = map.get(key)
    map.set(
      key,
      previous && payload.origin === UpdateOrigin.dir && previous.origin === UpdateOrigin.dir
        ? mergeDirPayload(previous, payload)
        : payload,
    )
  })

  return Array.from(map.values())
}

export const imageStateAtom = atomWithReducer(
  {
    loading: true,
    workspaces: [] as Workspace[],
  },
  (
    state,
    action:
      | FullUpdate
      | PatchUpdate
      | {
        updateType: WorkspaceUpdate.reset
        workspaceFolder?: string
        updateId?: string
      },
  ) => {
    if (action.updateType === WorkspaceUpdate.reset) {
      state = produce(state, (draft) => {
        draft.workspaces.forEach((workspace) => {
          if (action.workspaceFolder && workspace.workspaceFolder !== action.workspaceFolder) {
            return
          }
          if (action.updateId && workspace.update?.id !== action.updateId) {
            return
          }
          workspace.update = undefined
        })
      })
    }
    else {
      if (action.updateType === UpdateType.full) {
        state = produce(state, (draft) => {
          const imagePayloads = action.payloads.filter(item => item.origin === UpdateOrigin.image)
          const images = dedupeImages(imagePayloads.map(item => item.data.payload))
          const directories = dedupeDirPayloads(action.payloads)

          const index = draft.workspaces.findIndex(t => t.workspaceFolder === action.workspaceFolder)

          if (index !== -1) {
            draft.workspaces[index].images = images
            draft.workspaces[index].directories = directories
            draft.workspaces[index].absWorkspaceFolder = action.absWorkspaceFolder
            draft.workspaces[index].update = {
              id: action.id,
              payloads: action.payloads,
              traceId: action.traceId,
              type: UpdateType.full,
            }
          }
          else {
            draft.workspaces.push({
              workspaceFolder: action.workspaceFolder,
              absWorkspaceFolder: action.absWorkspaceFolder,
              directories,
              images,
              update: {
                id: action.id,
                payloads: action.payloads,
                traceId: action.traceId,
                type: UpdateType.full,
              },
            })
          }
        })
      }
      else if (action.updateType === UpdateType.patch) {
        // payload按照工作区分组
        const groupedPayload = groupBy(action.payloads, item => item.data.payload.workspaceFolder)
        state = produce(state, (draft) => {
          Object.entries(groupedPayload).forEach(([workspaceFolder, payloads]) => {
            const workspace = find(draft.workspaces, { workspaceFolder })
            if (!workspace) {
              logger.error('Workspace not found:', workspaceFolder)
              return
            }

            if (action.traceId) {
              const dirPayloads = payloads.filter(item => item.origin === UpdateOrigin.dir)
              const imagePayloads = payloads.filter(item => item.origin === UpdateOrigin.image)
              logger.debug('[directory-store-patch]', {
                dirPayloads: dirPayloads.length,
                imagePayloads: imagePayloads.length,
                traceId: action.traceId,
                workspaceFolder,
                workspaceImageCountBefore: workspace.images.length,
                workspaceKnownDirsBefore: workspace.directories.length,
              })
            }

            const pendingPatch = workspace.update?.type === UpdateType.patch ? workspace.update : undefined
            const pendingPayloads = pendingPatch
              ? mergePendingPayloads(pendingPatch.payloads, payloads)
              : payloads

            workspace.update = {
              id: action.id,
              payloads: pendingPayloads,
              traceId: action.traceId || pendingPatch?.traceId,
              type: UpdateType.patch,
            }

            payloads
              .filter(t => t.origin === UpdateOrigin.image)
              .forEach((item) => {
                const { type, payload } = item.data

                // NOTE: 这里的情况和imageUpdate是一一对应的
                switch (type) {
                  case UpdateEvent.create: {
                    upsertImage(workspace.images, payload)
                    break
                  }

                  case UpdateEvent.update: {
                    const index = workspace.images.findIndex(item => identityPath(item.path) === identityPath(payload.path))
                    if (index !== -1) {
                      workspace.images[index] = mergeImage(workspace.images[index], payload)
                    }
                    break
                  }

                  case UpdateEvent.delete: {
                    remove(workspace.images, image => identityPath(image.path) === identityPath(payload.path))
                    break
                  }

                  default:
                    break
                }
              })

            payloads
              .filter(t => t.origin === UpdateOrigin.dir)
              .forEach((item) => {
                const { type, payload } = item.data

                // NOTE: 这里的情况和dirUpdate是一一对应的
                switch (type) {
                  case UpdateEvent.create:
                  case UpdateEvent.update: {
                    const key = identityPath(payload.absDirPath)
                    const index = workspace.directories.findIndex(item => dirIdentity(item) === key)
                    if (index === -1) {
                      workspace.directories.push(item)
                    }
                    else {
                      workspace.directories[index] = mergeDirPayload(workspace.directories[index], item)
                    }
                    break
                  }

                  case UpdateEvent.delete: {
                    // 清除payload的目录以及子目录下的图片
                    remove(workspace.images, image => identityPath(image.absDirPath).startsWith(identityPath(payload.absDirPath)))
                    remove(workspace.directories, (item) => {
                      if (item.origin !== UpdateOrigin.dir)
                        return false
                      return identityPath(item.data.payload.absDirPath).startsWith(identityPath(payload.absDirPath))
                    })
                    break
                  }

                  default:
                    break
                }
              })

            if (action.traceId) {
              logger.debug('[directory-store-patch-applied]', {
                traceId: action.traceId,
                workspaceFolder,
                workspaceImageCountAfter: workspace.images.length,
                workspaceKnownDirsAfter: workspace.directories.length,
              })
            }
          })
        })
      }
    }

    return {
      ...state,
      loading: false,
    }
  },
)
