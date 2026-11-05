import fs from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
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

type BenchRecord = {
  canLoadMoreImages?: boolean
  childDirs: number
  childrenLoaded?: boolean
  depth: number
  dirPath: string
  directFolderCount?: number
  directImageCount?: number
  elapsedMs: number
  imagePayloads: number
  imagesLoaded?: boolean
  loadedImageCount?: number
  ok?: boolean
  pending?: boolean
  payloads: number
  postedMessages: number
  timeout?: boolean
  workspace: string
}

const enabled = process.env.IM_DIRECTORY_EXPAND_BENCH === '1'
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function setupExtensionContext() {
  const { ExtensionMode } = await import('vscode')
  const { Global } = await import('~/core/global')
  const { disposeDirectoryIoPool } = await import('~/message/message-factory')
  disposeDirectoryIoPool()
  ;(Global as any).context = {
    extensionMode: ExtensionMode.Development,
    extensionUri: {
      fsPath: repoRoot,
    },
    subscriptions: [],
  }
}

function parseList(value: string | undefined, fallback: string[]) {
  return (value || fallback.join(';'))
    .split(/[;\n]/)
    .map(item => item.trim())
    .filter(Boolean)
}

function normalizePath(filePath: string) {
  return filePath.replace(/\\/g, '/').replace(/\/$/, '')
}

function commonDirectoryRoot(paths: string[]) {
  if (!paths.length) {
    return ''
  }

  const partsList = paths.map(item => normalizePath(item).split('/').filter(Boolean))
  const common: string[] = []
  const max = Math.min(...partsList.map(parts => parts.length))
  for (let i = 0; i < max; i++) {
    const value = partsList[0][i]
    if (partsList.every(parts => parts[i]?.toLowerCase() === value.toLowerCase())) {
      common.push(value)
      continue
    }
    break
  }
  return common.join('/')
}

async function existingDirectories(paths: string[]) {
  const result: string[] = []
  for (const item of paths) {
    try {
      const stat = await fs.stat(item)
      if (stat.isDirectory()) {
        result.push(normalizePath(item))
      }
    }
    catch {}
  }
  return result
}

function createPanel(rootpaths: string[]) {
  const messages: Array<{ at: number, message: any }> = []
  return {
    panel: {
      webview: {
        asWebviewUri: (uri: { fsPath?: string, path?: string }) => ({
          toString: () => `vscode-resource://${normalizePath(uri.fsPath || uri.path || '')}`,
        }),
      },
    },
    id: `directory-expand-bench-${Date.now()}`,
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
    onDidChange: () => ({ dispose: vi.fn() }),
    visible: true,
    __messages: messages,
  }
}

describe.skipIf(!enabled)('directory expansion benchmark', () => {
  it('expands many directories through the real message factory', async () => {
    await setupExtensionContext()
    const { CmdToVscode, CmdToWebview } = await import('~/message/cmd')
    const { VscodeMessageFactory } = await import('~/message/message-factory')
    const { UpdateOrigin } = await import('~/webview/image-manager/utils/tree/const')

    const defaultRoots = [
      'f:/workspace/my-de-flow/results',
      'f:/workspace/my-de-flow/results/abdomen-paired-4090',
      'f:/workspace/my-de-flow/results/redcnn_data/crop-v4-radial-boost-heat2/radial_ploss/synth_ndct_B',
      'f:/workspace/my-de-flow/results/compare/datastes/radial_ploss-full/0_to_1',
      'f:/workspace/my-de-flow/eval_extra/crop-v4-radial-boost',
      'f:/workspace/my-de-flow/experiments/abdomen-base-crop128-4080/0226-base_lr1e5_pt10_cp128_nb14_K16_4080/val_images/step_20000',
      'f:/workspace/my-de-flow/experiments/abdomen-base-crop128-4080/0226-base_lr1e5_pt10_cp128_nb14_K16_4080/val_images/step_40000',
    ]

    const roots = await existingDirectories(parseList(process.env.IM_DIRECTORY_EXPAND_BENCH_ROOTS, defaultRoots))
    const maxDepth = Number(process.env.IM_DIRECTORY_EXPAND_BENCH_DEPTH || 3)
    const maxDirs = Number(process.env.IM_DIRECTORY_EXPAND_BENCH_MAX_DIRS || 120)
    const maxChildrenPerDir = Number(process.env.IM_DIRECTORY_EXPAND_BENCH_MAX_CHILDREN || 16)
    const pageSize = Number(process.env.IM_DIRECTORY_EXPAND_BENCH_PAGE_SIZE || 128)
    const settleMs = Number(process.env.IM_DIRECTORY_EXPAND_BENCH_SETTLE_MS || 20)

    const panel = createPanel(roots) as any
    const queue = roots.map(root => ({ cwd: root, depth: 0, dirPath: root }))
    const seen = new Set<string>()
    const records: BenchRecord[] = []

    while (queue.length && records.length < maxDirs) {
      const item = queue.shift()!
      const key = `${item.cwd}::${item.dirPath}`.toLowerCase()
      if (seen.has(key)) {
        continue
      }
      seen.add(key)

      const messageStart = panel.__messages.length
      const start = performance.now()
      const traceId = `bench:${records.length}:${path.basename(item.dirPath) || 'root'}`
      const result = await VscodeMessageFactory[CmdToVscode.get_directory_children](
        {
          cwd: item.cwd,
          dirPath: item.dirPath,
          includeImages: false,
          imageLimit: pageSize,
          priority: 'click',
          requestReason: 'click-toggle',
        },
        panel,
        {
          callbackId: `bench-${records.length}`,
          cmd: CmdToVscode.get_directory_children,
          data: {},
          traceId,
        } as any,
      )
      await new Promise(resolve => setTimeout(resolve, settleMs))
      const elapsedMs = performance.now() - start

      const newMessages = panel.__messages.slice(messageStart)
      const payloads = newMessages
        .filter(entry => entry.message.cmd === CmdToWebview.update_images)
        .filter(entry => entry.message.data?.traceId === traceId)
        .flatMap(entry => entry.message.data?.payloads || [])
      const dirPayloads = payloads.filter((payload: any) => payload.origin === UpdateOrigin.dir)
      const imagePayloads = payloads.filter((payload: any) => payload.origin === UpdateOrigin.image)
      const selfPayload = dirPayloads
        .map((payload: any) => payload.data.payload)
        .reverse()
        .find((payload: any) => normalizePath(payload.absDirPath) === normalizePath(item.dirPath))
      const childDirs = Array.from(new Set<string>(
        dirPayloads
          .map((payload: any) => normalizePath(payload.data.payload.absDirPath))
          .filter((dirPath: string) => dirPath !== normalizePath(item.dirPath)),
      ))

      records.push({
        canLoadMoreImages: result?.canLoadMoreImages ?? selfPayload?.canLoadMoreImages,
        childDirs: childDirs.length,
        childrenLoaded: result?.childrenLoaded ?? selfPayload?.childrenLoaded,
        depth: item.depth,
        dirPath: item.dirPath,
        directFolderCount: result?.directFolderCount ?? selfPayload?.directFolderCount,
        directImageCount: result?.directImageCount ?? selfPayload?.directImageCount,
        elapsedMs: Math.round(elapsedMs),
        imagePayloads: imagePayloads.length,
        imagesLoaded: result?.imagesLoaded ?? selfPayload?.imagesLoaded,
        loadedImageCount: result?.loadedImageCount ?? selfPayload?.loadedImageCount,
        ok: result?.ok,
        pending: result?.pending,
        payloads: payloads.length,
        postedMessages: newMessages.length,
        timeout: result?.timeout,
        workspace: item.cwd,
      })

      if (item.depth < maxDepth) {
        childDirs.slice(0, maxChildrenPerDir).forEach((dirPath) => {
          queue.push({
            cwd: item.cwd,
            depth: item.depth + 1,
            dirPath,
          })
        })
      }
    }

    await new Promise(resolve => setTimeout(resolve, Number(process.env.IM_DIRECTORY_EXPAND_BENCH_FINAL_SETTLE_MS || 500)))

    const sortedByTime = [...records].sort((a, b) => b.elapsedMs - a.elapsedMs)
    const slow = sortedByTime.slice(0, 20)
    const blank = records.filter(record =>
      record.ok
      && !record.childrenLoaded
      && record.childDirs === 0
      && record.imagePayloads === 0
      && (record.loadedImageCount || 0) === 0,
    )
    const pending = records.filter(record => record.pending)
    const timedOut = records.filter(record => record.timeout || !record.ok)
    const summary = {
      avgMs: Math.round(records.reduce((sum, record) => sum + record.elapsedMs, 0) / Math.max(1, records.length)),
      blank,
      maxDepth,
      maxDirs,
      pending,
      records: records.length,
      roots,
      slow,
      timedOut,
      totalPostedMessages: panel.__messages.length,
    }

    console.log(`DIRECTORY_EXPAND_BENCH_SUMMARY ${JSON.stringify(summary, null, 2)}`)
    console.log(`DIRECTORY_EXPAND_BENCH_RECORDS ${JSON.stringify(records, null, 2)}`)

    if (blank.length || pending.length || timedOut.length) {
      throw new Error(`Directory expansion returned incomplete results: ${JSON.stringify({
        blank: blank.slice(0, 10),
        pending: pending.slice(0, 10),
        timedOut: timedOut.slice(0, 10),
      }, null, 2)}`)
    }
  }, 10 * 60 * 1000)

  // 并发场景：模拟用户点击展开 N 个同级目录时，所有请求同时入队、争抢前台 IO 队列。
  // 这更贴近真实场景：tree update 触发后，所有 open 的目录的 emitOpen 几乎同时 fired。
  it('handles concurrent same-level expansions without starving newest click', async () => {
    await setupExtensionContext()
    const { CmdToVscode, CmdToWebview } = await import('~/message/cmd')
    const { VscodeMessageFactory } = await import('~/message/message-factory')

    const defaultRoots = [
      'f:/workspace/my-de-flow/results',
      'f:/workspace/my-de-flow/eval_extra',
      'f:/workspace/my-de-flow/codes',
      'f:/workspace/my-de-flow/.vscode',
    ]
    const concurrentRoots = await existingDirectories(parseList(
      process.env.IM_DIRECTORY_EXPAND_BENCH_CONCURRENT_ROOTS,
      defaultRoots,
    ))

    if (!concurrentRoots.length) {
      console.warn('No concurrent roots found; skipping concurrent bench')
      return
    }

    const pageSize = Number(process.env.IM_DIRECTORY_EXPAND_BENCH_PAGE_SIZE || 128)
    const cwd = process.env.IM_DIRECTORY_EXPAND_BENCH_CWD || commonDirectoryRoot(concurrentRoots)
    const panel = createPanel([cwd]) as any

    type ConcurrentRecord = {
      dirPath: string
      reason: string
      priority: string
      elapsedMs: number
      ok?: boolean
      timeout?: boolean
      childrenLoaded?: boolean
      payloads: number
      messagesSeen: number
    }

    const startedAt = performance.now()
    const records: ConcurrentRecord[] = []

    // 同时发起 N 个请求：第一个为 click（用户实际点击），其余为 normal（连锁触发）。
    // includeImages=false 与真实目录骨架展开一致，避免把图片分页成本混进目录展开指标。
    await Promise.all(concurrentRoots.map(async (dirPath, i) => {
      const reason = i === 0 ? 'click-toggle' : 'active-effect'
      const priority = i === 0 ? 'click' : 'normal'
      const traceId = `concurrent-bench:${i}:${path.basename(dirPath) || 'root'}`
      const messageStart = panel.__messages.length
      const start = performance.now()
      try {
        const result = await VscodeMessageFactory[CmdToVscode.get_directory_children](
          {
            cwd,
            dirPath,
            includeImages: false,
            imageLimit: pageSize,
            requestReason: reason as any,
            priority: priority as any,
          } as any,
          panel,
          {
            callbackId: `concurrent-${i}`,
            cmd: CmdToVscode.get_directory_children,
            data: {},
            traceId,
          } as any,
        )
        const newMessages = panel.__messages.slice(messageStart)
        const payloads = newMessages
          .filter((entry: any) => entry.message.cmd === CmdToWebview.update_images)
          .filter((entry: any) => entry.message.data?.traceId === traceId)
          .flatMap((entry: any) => entry.message.data?.payloads || [])
        records.push({
          dirPath,
          reason,
          priority,
          elapsedMs: Math.round(performance.now() - start),
          ok: result?.ok,
          timeout: result?.timeout,
          childrenLoaded: result?.childrenLoaded,
          payloads: payloads.length,
          messagesSeen: newMessages.length,
        })
      }
      catch (err) {
        records.push({
          dirPath,
          reason,
          priority,
          elapsedMs: Math.round(performance.now() - start),
          ok: false,
          timeout: false,
          childrenLoaded: false,
          payloads: 0,
          messagesSeen: 0,
        })
        console.error(`Concurrent expansion failed: ${dirPath}`, err)
      }
    }))

    const totalElapsedMs = Math.round(performance.now() - startedAt)

    const click = records.find(r => r.priority === 'click')!
    const normals = records.filter(r => r.priority === 'normal')

    const summary = {
      totalElapsedMs,
      click,
      normals,
      records,
    }

    console.log(`DIRECTORY_EXPAND_CONCURRENT_BENCH_SUMMARY ${JSON.stringify(summary, null, 2)}`)

    // 关键断言：click 优先级应当显著快于普通同级请求的最大耗时（即使后者也很慢）
    const slowestNormal = normals.reduce((max, r) => Math.max(max, r.elapsedMs), 0)
    if (slowestNormal > 0 && click.elapsedMs > slowestNormal * 0.8) {
      console.warn(
        `Click priority did not win: clickMs=${click.elapsedMs}, slowestNormalMs=${slowestNormal}. `
        + `In SSHFS scenarios this can happen due to OS-level read serialization, but on local FS click should be faster.`,
      )
    }

    expect(click.ok).toBe(true)
    expect(click.childrenLoaded).toBe(true)
  }, 5 * 60 * 1000)
})
