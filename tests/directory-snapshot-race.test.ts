import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const vscodeMocks = vi.hoisted(() => ({
  readDirectory: vi.fn(),
}))

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
        readDirectory: vscodeMocks.readDirectory,
        rename: vi.fn(),
      },
      getConfiguration: () => config,
      onDidChangeConfiguration: () => ({ dispose: vi.fn() }),
      openTextDocument: vi.fn(),
      workspaceFolders: [],
    },
  }
})

function createPanel(rootpaths: string[]) {
  const messages: any[] = []
  return {
    panel: {
      webview: {
        asWebviewUri: (uri: { fsPath?: string, path?: string }) => ({
          toString: () => `vscode-resource://${String(uri.fsPath || uri.path || '').replace(/\\/g, '/')}`,
        }),
      },
    },
    id: `snapshot-race-test-${Date.now()}`,
    initialData: {
      imageReveal: '',
      rootpaths,
    },
    isDisposed: false,
    messageCenter: {
      postMessage: (message: any) => messages.push(message),
    },
    onDidChange: () => ({ dispose: vi.fn() }),
    visible: true,
    __messages: messages,
  }
}

async function createWorkerExtensionRoot() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'im-snapshot-race-'))
  const distDir = path.join(tmpDir, 'dist')
  await fs.mkdir(distDir, { recursive: true })
  // 健康 worker：对 snapshot 请求回一份固定的目录骨架。
  // 旧设计在这里塞一个"永不回复"的卡死 worker，用来验证 workspace.fs 竞速兜底；
  // 该三路竞速已移除（单 SSH 连接下竞速只会放大争抢，见 message-factory 注释），
  // 因此这里改为验证单一 worker 路径能正确、快速地返回前台目录骨架。
  await fs.writeFile(path.join(distDir, 'directory-io-worker.js'), `
    const { parentPort } = require('node:worker_threads');
    const path = require('node:path');
    parentPort.postMessage({ id: -1, ok: true, dirs: [], imagePaths: [], directImageCount: 0, scannedEntries: 0, complete: true, readMs: 0 });
    parentPort.on('message', (req) => {
      const join = (name) => path.join(req.dirPath, name).replace(/\\\\/g, '/');
      parentPort.postMessage({
        id: req.id,
        ok: true,
        dirs: [join('compare'), join('experiments')],
        imagePaths: [join('preview.png')],
        directImageCount: 1,
        scannedEntries: 3,
        complete: true,
        readMs: 1,
      });
    });
  `)
  return tmpDir
}

afterEach(async () => {
  vscodeMocks.readDirectory.mockReset()
  const { disposeDirectoryIoPool } = await import('~/message/message-factory')
  disposeDirectoryIoPool()
})

describe('directory snapshot (single worker path)', () => {
  it('returns the foreground skeleton from the worker quickly', async () => {
    const extensionRoot = await createWorkerExtensionRoot()
    try {
      const { ExtensionMode } = await import('vscode')
      const { Global } = await import('~/core/global')
      const { CmdToVscode, CmdToWebview } = await import('~/message/cmd')
      const { VscodeMessageFactory } = await import('~/message/message-factory')
      const { UpdateOrigin } = await import('~/webview/image-manager/utils/tree/const')

      ;(Global as any).context = {
        extensionMode: ExtensionMode.Development,
        extensionUri: {
          fsPath: extensionRoot,
        },
      }

      const cwd = 'f:/workspace'
      const dirPath = 'f:/workspace/results'

      const panel = createPanel([cwd]) as any
      const startedAt = performance.now()
      const result = await VscodeMessageFactory[CmdToVscode.get_directory_children](
        {
          cwd,
          dirPath,
          includeImages: false,
          imageLimit: 128,
          priority: 'click',
          requestReason: 'click-toggle',
        },
        panel,
        {
          callbackId: 'snapshot-race',
          cmd: CmdToVscode.get_directory_children,
          data: {},
          traceId: 'snapshot-race',
        } as any,
      )
      const elapsedMs = performance.now() - startedAt

      expect(elapsedMs).toBeLessThan(2000)
      expect(result.ok).toBe(true)
      expect(result.childrenLoaded).toBe(true)
      expect(result.directFolderCount).toBe(2)
      // includeImages=false → 骨架不带图片，但 directImageCount 仍反映真实计数
      expect(result.directImageCount).toBe(1)

      const update = panel.__messages.find((message: any) => message.cmd === CmdToWebview.update_images)
      expect(update).toBeTruthy()
      const payloads = update.data.payloads
      const dirPayloads = payloads.filter((payload: any) => payload.origin === UpdateOrigin.dir)
      const imagePayloads = payloads.filter((payload: any) => payload.origin === UpdateOrigin.image)
      // 目标目录自身 + 2 个子目录 = 3 个 dir payload，0 张图片（骨架请求）
      expect(dirPayloads).toHaveLength(3)
      expect(imagePayloads).toHaveLength(0)
    }
    finally {
      await fs.rm(extensionRoot, { recursive: true, force: true })
    }
  }, 15_000)
})
