import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { setAutoFreeze } from 'immer'
import { describe, expect, it, vi } from 'vitest'

vi.mock('vscode', () => {
  const uriFromPath = (fsPath: string) => ({
    fsPath,
    path: fsPath,
    scheme: 'file',
    toString: () => `file://${fsPath.replace(/\\/g, '/')}`,
  })

  const config = {
    get: (_key: string, fallback?: unknown) => fallback,
    update: vi.fn(),
  }

  return {
    commands: {
      executeCommand: vi.fn(),
    },
    ConfigurationTarget: {
      Global: 1,
      Workspace: 2,
      WorkspaceFolder: 3,
    },
    env: {
      appRoot: '',
      language: 'en',
      openExternal: vi.fn(),
      uiKind: 1,
    },
    ExtensionMode: {
      Development: 2,
      Production: 1,
      Test: 3,
    },
    StatusBarAlignment: {
      Left: 1,
      Right: 2,
    },
    ThemeColor: class ThemeColor {
      constructor(public id: string) {}
    },
    Uri: {
      file: uriFromPath,
      joinPath: (base: { fsPath?: string, path?: string }, ...parts: string[]) => {
        return uriFromPath(path.join(base.fsPath || base.path || '', ...parts))
      },
    },
    ViewColumn: {
      Active: 1,
    },
    window: {
      activeColorTheme: { kind: 1 },
      createOutputChannel: () => ({
        append: vi.fn(),
        appendLine: vi.fn(),
        clear: vi.fn(),
        dispose: vi.fn(),
        show: vi.fn(),
      }),
      createStatusBarItem: () => ({
        command: '',
        dispose: vi.fn(),
        hide: vi.fn(),
        show: vi.fn(),
        text: '',
      }),
      onDidChangeActiveColorTheme: () => ({ dispose: vi.fn() }),
      showErrorMessage: vi.fn(),
      showInformationMessage: vi.fn(),
      showTextDocument: vi.fn(),
      showWarningMessage: vi.fn(),
    },
    workspace: {
      fs: {
        copy: vi.fn(),
        delete: vi.fn(),
        rename: vi.fn(),
      },
      getConfiguration: () => config,
      openTextDocument: vi.fn(),
      workspaceFolders: [],
    },
  }
})

const enabled = process.env.IM_RESULTS_FRONTEND_PIPELINE === '1'

function createPanel(rootpaths: string[]) {
  const messages: Array<{ at: number, message: any }> = []
  return {
    panel: {
      webview: {
        asWebviewUri: (uri: { fsPath?: string, path?: string }) => ({
          toString: () => `vscode-resource://${String(uri.fsPath || uri.path || '').replace(/\\/g, '/')}`,
        }),
      },
    },
    id: `results-frontend-pipeline-${Date.now()}`,
    initialData: {
      imageReveal: '',
      rootpaths,
      sharpInstalled: false,
    },
    isDisposed: false,
    visible: true,
    messageCenter: {
      postMessage: (message: any) => {
        messages.push({
          at: performance.now(),
          message,
        })
      },
    },
    onDidChange: () => ({ dispose: vi.fn() }),
    __messages: messages,
  }
}

describe.skipIf(!enabled)('results frontend pipeline benchmark', () => {
  it('measures store patch + tree rebuild costs for opening and expanding results', async () => {
    setAutoFreeze(false)

    const scenarios = [
      {
        expandDirPath: 'f:/workspace/my-de-flow/results',
        label: 'workspace=my-de-flow -> expand results',
        workspaceRoot: 'f:/workspace/my-de-flow',
      },
      {
        expandDirPath: 'f:/workspace/my-de-flow/results',
        label: 'workspace=results -> expand results root',
        workspaceRoot: 'f:/workspace/my-de-flow/results',
      },
      {
        expandDirPath: 'f:/workspace/my-de-flow/results/compare/revalidate_all_fixedmetrics_20260523/radial/abdomen-base-crop128-3090/0305-base_lr1e6_wsr1_pt10_cp128_nb14_K16_radial_3090/n_sample_001/heat100/step_10000/0_to_1',
        label: 'workspace=my-de-flow -> deep image dir',
        workspaceRoot: 'f:/workspace/my-de-flow',
        warmupDirs: [
          'f:/workspace/my-de-flow/results',
          'f:/workspace/my-de-flow/results/compare',
          'f:/workspace/my-de-flow/results/compare/revalidate_all_fixedmetrics_20260523',
          'f:/workspace/my-de-flow/results/compare/revalidate_all_fixedmetrics_20260523/radial',
          'f:/workspace/my-de-flow/results/compare/revalidate_all_fixedmetrics_20260523/radial/abdomen-base-crop128-3090',
          'f:/workspace/my-de-flow/results/compare/revalidate_all_fixedmetrics_20260523/radial/abdomen-base-crop128-3090/0305-base_lr1e6_wsr1_pt10_cp128_nb14_K16_radial_3090',
          'f:/workspace/my-de-flow/results/compare/revalidate_all_fixedmetrics_20260523/radial/abdomen-base-crop128-3090/0305-base_lr1e6_wsr1_pt10_cp128_nb14_K16_radial_3090/n_sample_001',
          'f:/workspace/my-de-flow/results/compare/revalidate_all_fixedmetrics_20260523/radial/abdomen-base-crop128-3090/0305-base_lr1e6_wsr1_pt10_cp128_nb14_K16_radial_3090/n_sample_001/heat100',
          'f:/workspace/my-de-flow/results/compare/revalidate_all_fixedmetrics_20260523/radial/abdomen-base-crop128-3090/0305-base_lr1e6_wsr1_pt10_cp128_nb14_K16_radial_3090/n_sample_001/heat100/step_10000',
        ],
      },
    ]

    const { CmdToVscode, CmdToWebview } = await import('~/message/cmd')
    const { VscodeMessageFactory } = await import('~/message/message-factory')
    const { imageStateAtom } = await import('~/webview/image-manager/stores/image/image-store')
    const { TreeManager } = await import('~/webview/image-manager/utils/tree/tree-manager')
    const { TreeStyle } = await import('~/webview/image-manager/utils/tree/tree')
    const { DEFAULT_WORKSPACE_STATE } = await import('~/core/persist/workspace/common')
    const { createStore } = await import('jotai/vanilla')

    const summaries: any[] = []

    for (const scenario of scenarios) {
      const panel = createPanel([scenario.workspaceRoot]) as any
      const store = createStore()

      const fullStart = performance.now()
      await (VscodeMessageFactory as any)[CmdToVscode.get_all_images_from_cwds]({}, panel, {
        callbackId: `initial:${scenario.label}`,
        cmd: CmdToVscode.get_all_images_from_cwds,
        data: {},
        traceId: `initial-load:${scenario.label}`,
      } as any)
      const fullLoadBackendMs = performance.now() - fullStart

      const fullMessages = panel.__messages
        .filter((entry: any) => entry.message.cmd === CmdToWebview.update_images)
        .map((entry: any) => entry.message.data)

      const fullUpdate = fullMessages.find((item: any) => item.updateType === 'full')
      expect(fullUpdate).toBeTruthy()

      const reduceStart = performance.now()
      store.set(imageStateAtom, fullUpdate as any)
      const reduced = store.get(imageStateAtom) as any
      const reduceMs = performance.now() - reduceStart

      const workspace = reduced.workspaces.find((item: any) => item.absWorkspaceFolder === scenario.workspaceRoot)
      expect(workspace).toBeTruthy()

      const treeManager = new TreeManager(workspace.workspaceFolder, {
        compact: DEFAULT_WORKSPACE_STATE.display_style === 'compact',
        filter: DEFAULT_WORKSPACE_STATE.image_filter,
        hideKnownEmptyDirs: DEFAULT_WORKSPACE_STATE.hide_known_empty_dirs,
        sort: DEFAULT_WORKSPACE_STATE.display_sort,
        treeStyle: TreeStyle.dir,
      })

      const generateStart = performance.now()
      treeManager.generateTree(workspace.images, workspace.directories)
      const generateMs = performance.now() - generateStart

      const nestedStart = performance.now()
      const nested = await treeManager.toNestedArray()
      const nestedMs = performance.now() - nestedStart

      if (scenario.warmupDirs?.length) {
        for (const warmupDir of scenario.warmupDirs) {
          const warmupResult = await (VscodeMessageFactory as any)[CmdToVscode.get_directory_children](
            {
              cwd: scenario.workspaceRoot,
              dirPath: warmupDir,
              imageLimit: 32,
              includeImages: false,
            },
            panel,
            {
              callbackId: `warmup:${scenario.label}:${warmupDir}`,
              cmd: CmdToVscode.get_directory_children,
              data: {
                cwd: scenario.workspaceRoot,
                dirPath: warmupDir,
                imageLimit: 32,
                includeImages: false,
              },
              traceId: `warmup:${scenario.label}:${warmupDir}`,
            } as any,
          )
          expect(warmupResult.ok).toBe(true)
          const warmupPatch = panel.__messages
            .filter((entry: any) => entry.message.cmd === CmdToWebview.update_images)
            .map((entry: any) => entry.message.data)
            .filter((data: any) => data.traceId === `warmup:${scenario.label}:${warmupDir}`)
            .at(-1)
          expect(warmupPatch).toBeTruthy()
          store.set(imageStateAtom, warmupPatch as any)
          const afterWarmup = store.get(imageStateAtom) as any
          const warmupWorkspace = afterWarmup.workspaces.find((item: any) => item.absWorkspaceFolder === scenario.workspaceRoot)
          treeManager.updateTree(warmupWorkspace.update.payloads)
        }
      }

      const clickStart = performance.now()
      const result = await (VscodeMessageFactory as any)[CmdToVscode.get_directory_children](
        {
          cwd: scenario.workspaceRoot,
          dirPath: scenario.expandDirPath,
          includeImages: false,
          imageLimit: 32,
        },
        panel,
        {
          callbackId: `expand:${scenario.label}`,
          cmd: CmdToVscode.get_directory_children,
          data: {
            cwd: scenario.workspaceRoot,
            dirPath: scenario.expandDirPath,
            includeImages: false,
            imageLimit: 32,
          },
          traceId: `expand-results:${scenario.label}`,
        } as any,
      )
      const backendExpandMs = performance.now() - clickStart

      const patchMessages = panel.__messages
        .filter((entry: any) => entry.message.cmd === CmdToWebview.update_images)
        .map((entry: any) => entry.message.data)
        .filter((data: any) => data.traceId === `expand-results:${scenario.label}`)

      const patch = patchMessages.at(-1)
      expect(patch).toBeTruthy()

      const patchReduceStart = performance.now()
      store.set(imageStateAtom, patch as any)
      const patchReduced = store.get(imageStateAtom) as any
      const patchReduceMs = performance.now() - patchReduceStart

      const nextWorkspace = patchReduced.workspaces.find((item: any) => item.absWorkspaceFolder === scenario.workspaceRoot)
      expect(nextWorkspace).toBeTruthy()

      const updateTreeStart = performance.now()
      treeManager.updateTree(nextWorkspace.update.payloads)
      const updateTreeMs = performance.now() - updateTreeStart

      const patchNestedStart = performance.now()
      const patchNested = await treeManager.toNestedArray()
      const patchNestedMs = performance.now() - patchNestedStart

      let imagePageBackendMs: number | undefined
      let imagePagePayloads: number | undefined
      let imagePageReduceMs: number | undefined
      let imagePageUpdateTreeMs: number | undefined
      let imagePageNestedMs: number | undefined
      if (result.directImageCount && result.directImageCount > 0) {
        const imagePageTraceId = `image-page:${scenario.label}`
        const imagePageStart = performance.now()
        await (VscodeMessageFactory as any)[CmdToVscode.get_directory_children](
          {
            cwd: scenario.workspaceRoot,
            dirPath: scenario.expandDirPath,
            imageLimit: 32,
            imageOffset: 0,
            includeImages: true,
            priority: 'background',
          },
          panel,
          {
            callbackId: `image-page:${scenario.label}`,
            cmd: CmdToVscode.get_directory_children,
            data: {
              cwd: scenario.workspaceRoot,
              dirPath: scenario.expandDirPath,
              imageLimit: 32,
              imageOffset: 0,
              includeImages: true,
              priority: 'background',
            },
            traceId: imagePageTraceId,
          } as any,
        )
        imagePageBackendMs = performance.now() - imagePageStart
        const imagePagePatch = panel.__messages
          .filter((entry: any) => entry.message.cmd === CmdToWebview.update_images)
          .map((entry: any) => entry.message.data)
          .filter((data: any) => data.traceId === imagePageTraceId)
          .at(-1)
        expect(imagePagePatch).toBeTruthy()
        imagePagePayloads = imagePagePatch.payloads.length
        const imagePageReduceStart = performance.now()
        store.set(imageStateAtom, imagePagePatch as any)
        const afterImagePage = store.get(imageStateAtom) as any
        imagePageReduceMs = performance.now() - imagePageReduceStart
        const imagePageWorkspace = afterImagePage.workspaces.find((item: any) => item.absWorkspaceFolder === scenario.workspaceRoot)
        const imagePageUpdateStart = performance.now()
        treeManager.updateTree(imagePageWorkspace.update.payloads)
        imagePageUpdateTreeMs = performance.now() - imagePageUpdateStart
        const imagePageNestedStart = performance.now()
        await treeManager.toNestedArray()
        imagePageNestedMs = performance.now() - imagePageNestedStart
      }

      summaries.push({
        backendExpandMs: Math.round(backendExpandMs),
        expandDirPath: scenario.expandDirPath,
        fullLoadBackendMs: Math.round(fullLoadBackendMs),
        fullRootDirectories: workspace.directories.length,
        fullRootImages: workspace.images.length,
        generateMs: Math.round(generateMs),
        imagePageBackendMs: imagePageBackendMs === undefined ? undefined : Math.round(imagePageBackendMs),
        imagePageNestedMs: imagePageNestedMs === undefined ? undefined : Math.round(imagePageNestedMs),
        imagePagePayloads,
        imagePageReduceMs: imagePageReduceMs === undefined ? undefined : Math.round(imagePageReduceMs),
        imagePageUpdateTreeMs: imagePageUpdateTreeMs === undefined ? undefined : Math.round(imagePageUpdateTreeMs),
        label: scenario.label,
        nestedCount: nested.length,
        nestedMs: Math.round(nestedMs),
        patchChildrenLoaded: result.childrenLoaded,
        patchPayloads: patch.payloads.length,
        patchReduceMs: Math.round(patchReduceMs),
        patchNestedCount: patchNested.length,
        patchNestedMs: Math.round(patchNestedMs),
        reduceMs: Math.round(reduceMs),
        updateTreeMs: Math.round(updateTreeMs),
        workspaceRoot: scenario.workspaceRoot,
      })
    }

    console.log(`RESULTS_FRONTEND_PIPELINE ${JSON.stringify(summaries, null, 2)}`)
  }, 10 * 60 * 1000)
})
