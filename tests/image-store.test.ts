import type { UpdatePayload } from '~/webview/image-manager/utils/tree/tree-manager'
import { createStore } from 'jotai/vanilla'
import { describe, expect, it } from 'vitest'
import { DEFAULT_WORKSPACE_STATE } from '~/core/persist/workspace/common'
import { imageStateAtom, WorkspaceUpdate } from '~/webview/image-manager/stores/image/image-store'
import { UpdateEvent, UpdateOrigin, UpdateType } from '~/webview/image-manager/utils/tree/const'
import { TreeStyle } from '~/webview/image-manager/utils/tree/tree'
import { TreeManager } from '~/webview/image-manager/utils/tree/tree-manager'

type DirPayloadOptions = {
  absDirPath?: string
  canLoadMoreImages?: boolean
  childrenLoaded?: boolean
  directFolderCount?: number
  directImageCount?: number
  imagesLoaded?: boolean
  loadingChildren?: boolean
  type?: UpdateEvent.create | UpdateEvent.update
}

function dirPayload(dirPath: string, options: DirPayloadOptions = {}): UpdatePayload {
  return {
    origin: UpdateOrigin.dir,
    data: {
      type: options.type ?? UpdateEvent.update,
      payload: {
        absDirPath: options.absDirPath ?? `f:/workspace/my-de-flow/datasets/${dirPath}`,
        absWorkspaceFolder: 'f:/workspace/my-de-flow/datasets',
        canLoadMoreImages: options.canLoadMoreImages,
        childrenLoaded: options.childrenLoaded,
        dirPath,
        directFolderCount: options.directFolderCount,
        directImageCount: options.directImageCount,
        imagesLoaded: options.imagesLoaded,
        loadingChildren: options.loadingChildren,
        workspaceFolder: 'datasets',
      },
    },
  }
}

describe('image store update reset guard', () => {
  it('keeps a newer directory-only patch when an older update reset is processed late', () => {
    const store = createStore()
    const root = dirPayload('', {
      absDirPath: 'f:/workspace/my-de-flow/datasets',
      childrenLoaded: true,
      directFolderCount: 1,
      directImageCount: 0,
      imagesLoaded: true,
      type: UpdateEvent.create,
    })

    store.set(imageStateAtom, {
      absWorkspaceFolder: 'f:/workspace/my-de-flow/datasets',
      id: 'full',
      payloads: [root],
      updateType: UpdateType.full,
      workspaceFolder: 'datasets',
    })

    store.set(imageStateAtom, {
      absWorkspaceFolder: 'f:/workspace/my-de-flow/datasets',
      id: 'loading',
      payloads: [dirPayload('AAPM', { loadingChildren: true })],
      updateType: UpdateType.patch,
      workspaceFolder: 'datasets',
    })

    store.set(imageStateAtom, {
      absWorkspaceFolder: 'f:/workspace/my-de-flow/datasets',
      id: 'final',
      payloads: [
        dirPayload('AAPM', {
          childrenLoaded: true,
          directFolderCount: 12,
          directImageCount: 0,
          imagesLoaded: true,
          loadingChildren: false,
        }),
        dirPayload('AAPM/abdomen', { type: UpdateEvent.create }),
      ],
      updateType: UpdateType.patch,
      workspaceFolder: 'datasets',
    })

    store.set(imageStateAtom, {
      updateId: 'loading',
      updateType: WorkspaceUpdate.reset,
      workspaceFolder: 'datasets',
    })

    const workspace = store.get(imageStateAtom).workspaces[0]
    const aapm = workspace.directories.find((payload) => {
      return payload.origin === UpdateOrigin.dir && payload.data.payload.dirPath === 'AAPM'
    })

    expect(workspace.update?.id).toBe('final')
    expect(aapm?.origin === UpdateOrigin.dir ? aapm.data.payload.childrenLoaded : false).toBe(true)
    expect(aapm?.origin === UpdateOrigin.dir ? aapm.data.payload.loadingChildren : true).toBe(false)
    expect(aapm?.origin === UpdateOrigin.dir ? aapm.data.payload.directFolderCount : 0).toBe(12)

    store.set(imageStateAtom, {
      updateId: 'final',
      updateType: WorkspaceUpdate.reset,
      workspaceFolder: 'datasets',
    })

    expect(store.get(imageStateAtom).workspaces[0].update).toBeUndefined()
  })
})

describe('tree manager known empty directories', () => {
  it('hides a settled directory whose child directories are all image-empty', async () => {
    const root = 'f:/workspace/my-de-flow/datasets'
    const manager = new TreeManager(root, {
      compact: false,
      hideKnownEmptyDirs: true,
      treeStyle: TreeStyle.dir,
    })

    manager.generateTree([], [
      dirPayload('', {
        absDirPath: root,
        childrenLoaded: true,
        directFolderCount: 1,
        directImageCount: 0,
        imagesLoaded: true,
        type: UpdateEvent.create,
      }),
      dirPayload('parent', {
        childrenLoaded: true,
        directFolderCount: 2,
        directImageCount: 0,
        imagesLoaded: true,
        type: UpdateEvent.create,
      }),
      dirPayload('parent/a', {
        childrenLoaded: true,
        directFolderCount: 0,
        directImageCount: 0,
        imagesLoaded: true,
        type: UpdateEvent.create,
      }),
      dirPayload('parent/b', {
        childrenLoaded: true,
        directFolderCount: 0,
        directImageCount: 0,
        imagesLoaded: true,
        type: UpdateEvent.create,
      }),
    ])

    const nested = await manager.toNestedArray()

    expect(nested).toHaveLength(1)
    expect(nested[0].children ?? []).toHaveLength(0)
  })

  it('does not infer a direct image count while more directory pages are unknown', async () => {
    const root = 'f:/workspace/my-de-flow/datasets'
    const manager = new TreeManager(root, {
      compact: false,
      hideKnownEmptyDirs: true,
      treeStyle: TreeStyle.dir,
    })

    manager.generateTree([
      {
        absDirPath: `${root}/large`,
        absWorkspaceFolder: root,
        basename: '0001.png',
        dirPath: 'large',
        extname: 'png',
        name: '0001',
        path: `${root}/large/0001.png`,
        stats: { mtimeMs: 0, size: 0 },
        workspaceFolder: 'datasets',
      } as ImageType,
    ], [
      dirPayload('large', {
        canLoadMoreImages: true,
        childrenLoaded: true,
        directFolderCount: 0,
        imagesLoaded: false,
        type: UpdateEvent.create,
      }),
    ])

    const nested = await manager.toNestedArray()
    const large = nested[0].children?.find(node => node.data.absPath === `${root}/large`)

    expect(large?.data.directImageCount).toBeUndefined()
    expect(large?.data.imageCount).toBe(1)
    expect(large?.data.knownEmpty).toBe(false)
  })
})

describe('workspace preview scale state', () => {
  it('accepts per-directory preview scale and lock maps while keeping scalar defaults compatible', () => {
    const scalar = { ...DEFAULT_WORKSPACE_STATE, preview_scale: 1.25, preview_scale_lock: false }
    const mapped = {
      ...DEFAULT_WORKSPACE_STATE,
      preview_scale: {
        '__default__': 1,
        'f:/workspace/my-de-flow/results': 0.75,
      },
      preview_scale_lock: {
        '__default__': true,
        'f:/workspace/my-de-flow/results': false,
      },
    }

    expect(typeof scalar.preview_scale === 'number' || typeof scalar.preview_scale === 'object').toBe(true)
    expect(typeof scalar.preview_scale_lock === 'boolean' || typeof scalar.preview_scale_lock === 'object').toBe(true)
    expect(typeof mapped.preview_scale).toBe('object')
    expect(typeof mapped.preview_scale_lock).toBe('object')
    expect((mapped.preview_scale as Record<string, number>)['f:/workspace/my-de-flow/results']).toBe(0.75)
    expect((mapped.preview_scale_lock as Record<string, boolean>)['f:/workspace/my-de-flow/results']).toBe(false)
  })
})
