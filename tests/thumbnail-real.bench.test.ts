import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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
      language: 'zh-cn',
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

const enabled = process.env.IM_THUMBNAIL_BENCH === '1'
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function normalizePath(filePath: string) {
  return filePath.replace(/\\/g, '/').replace(/\/$/, '')
}

function createPanel(rootpaths: string[]) {
  const messages: Array<{ at: number, message: any }> = []
  return {
    __messages: messages,
    id: `thumbnail-real-bench-${Date.now()}`,
    initialData: {
      imageReveal: '',
      rootpaths,
    },
    isDisposed: false,
    messageCenter: {
      postMessage: (message: any) => {
        messages.push({
          at: performance.now(),
          message,
        })
      },
    },
    panel: {
      webview: {
        asWebviewUri: (uri: { fsPath?: string, path?: string }) => ({
          toString: () => `vscode-resource://${normalizePath(uri.fsPath || uri.path || '')}`,
        }),
      },
    },
    visible: true,
  }
}

async function existingDirectory(dirPath: string) {
  try {
    const stat = await fs.stat(dirPath)
    return stat.isDirectory()
  }
  catch {
    return false
  }
}

describe.skipIf(!enabled)('real thumbnail benchmark', () => {
  it('loads a directory image page and generates thumbnails through the real message factory', async () => {
    const targetDir = normalizePath(process.env.IM_THUMBNAIL_BENCH_DIR
      || 'c:/Users/lucy/Desktop/deflow/abdomen-base-crop128-4080/0226-base_lr1e5_pt10_cp128_nb14_K16_40801/n_sample_001/heat1001/step_50000/0_original')
    const cwd = normalizePath(process.env.IM_THUMBNAIL_BENCH_CWD || targetDir)
    const maxImages = Number(process.env.IM_THUMBNAIL_BENCH_IMAGES || 8)
    const maxWidth = Number(process.env.IM_THUMBNAIL_BENCH_WIDTH || 200)

    if (!await existingDirectory(targetDir)) {
      console.warn(`Thumbnail bench skipped; directory does not exist: ${targetDir}`)
      return
    }

    const { ExtensionMode } = await import('vscode')
    const { FileCache } = await import('~/core/file-cache')
    const { Global } = await import('~/core/global')
    const { CmdToVscode, CmdToWebview } = await import('~/message/cmd')
    const { VscodeMessageFactory, resetDirectoryIoRuntime } = await import('~/message/message-factory')

    ;(Global as any).context = {
      extensionMode: ExtensionMode.Development,
      extensionUri: {
        fsPath: repoRoot,
      },
      subscriptions: [],
    }
    const sharpPath = path.join(repoRoot, 'dist', 'lib', 'sharp', 'index.js')

    const sharpModule = require(sharpPath)
    ;(Global as any).sharp = sharpModule.default || sharpModule.sharp || sharpModule

    resetDirectoryIoRuntime('thumbnail-real-bench')

    const panel = createPanel([cwd]) as any
    const directoryStart = performance.now()
    const directoryResult = await VscodeMessageFactory[CmdToVscode.get_directory_children](
      {
        cwd,
        dirPath: targetDir,
        imageLimit: maxImages,
        includeImages: true,
        priority: 'background',
        requestReason: 'thumbnail-real-bench',
      } as any,
      panel,
      {
        callbackId: 'thumbnail-real-bench-directory',
        cmd: CmdToVscode.get_directory_children,
        data: {},
        traceId: 'thumbnail-real-bench-directory',
      } as any,
    )
    const directoryMs = Math.round(performance.now() - directoryStart)

    const imagePaths = panel.__messages
      .filter((entry: any) => entry.message.cmd === CmdToWebview.update_images)
      .flatMap((entry: any) => entry.message.data?.payloads || [])
      .filter((payload: any) => payload.origin === 'image')
      .map((payload: any) => payload.data?.payload?.path)
      .filter(Boolean)
      .slice(0, maxImages)

    const thumbnailStart = performance.now()
    const thumbnails = await VscodeMessageFactory[CmdToVscode.get_thumbnails](
      {
        images: imagePaths,
        maxWidth,
      },
      panel,
    )
    const thumbnailMs = Math.round(performance.now() - thumbnailStart)

    const summary = {
      cacheDir: FileCache.cacheDir,
      directoryMs,
      directoryResult,
      images: imagePaths.length,
      maxImages,
      maxWidth,
      targetDir,
      thumbnailMs,
      thumbnails: thumbnails.length,
    }
    console.log(`THUMBNAIL_REAL_BENCH_SUMMARY ${JSON.stringify(summary, null, 2)}`)

    expect(directoryResult?.ok).toBe(true)
    if (!imagePaths.length) {
      console.warn(`Thumbnail bench skipped thumbnail assertions; directory has no direct images: ${targetDir}`)
      return
    }
    expect(imagePaths.length).toBeGreaterThan(0)
    expect(thumbnails.length).toBeGreaterThan(0)
  }, 5 * 60 * 1000)
})
