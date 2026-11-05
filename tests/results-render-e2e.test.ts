import type { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { chromium } from 'playwright'
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

const enabled = process.env.IM_RESULTS_RENDER_E2E === '1'
const preferredPort = Number(process.env.IM_RESULTS_RENDER_E2E_PORT || 4557)
const workspaceRoot = process.env.IM_RESULTS_RENDER_E2E_WORKSPACE || 'f:/workspace/my-de-flow'
const targetDir = process.env.IM_RESULTS_RENDER_E2E_TARGET_DIR || 'f:/workspace/my-de-flow/results'
const targetLabel = process.env.IM_RESULTS_RENDER_E2E_TARGET_LABEL || path.basename(targetDir)
const targetChildLabel = process.env.IM_RESULTS_RENDER_E2E_TARGET_CHILD || 'abdomen-base-4080'
const expectEmptyTarget = process.env.IM_RESULTS_RENDER_E2E_EXPECT_EMPTY === '1'
const targetChain = (process.env.IM_RESULTS_RENDER_E2E_CHAIN || '')
  .split(/[>\n]/)
  .map(item => item.trim())
  .filter(Boolean)

function normalizePath(filePath: string) {
  return filePath.replace(/\\/g, '/').replace(/\/$/, '')
}

function findSystemBrowser() {
  if (process.env.IM_RENDER_SMOKE_BROWSER && fs.existsSync(process.env.IM_RENDER_SMOKE_BROWSER)) {
    return process.env.IM_RENDER_SMOKE_BROWSER
  }

  const candidates = process.platform === 'win32'
    ? [
        `${process.env.ProgramFiles || 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env.LocalAppData || ''}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env.ProgramFiles || 'C:\\Program Files'}\\Microsoft\\Edge\\Application\\msedge.exe`,
        `${process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'}\\Microsoft\\Edge\\Application\\msedge.exe`,
        `${process.env.LocalAppData || ''}\\Microsoft\\Edge\\Application\\msedge.exe`,
      ]
    : [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
      ]

  return candidates.find(candidate => candidate && fs.existsSync(candidate))
}

function isPortFree(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, '127.0.0.1')
  })
}

function createServer() {
  const isWindows = process.platform === 'win32'
  let resolvedUrl = `http://127.0.0.1:${preferredPort}`
  const child = isWindows
    ? spawn('cmd.exe', ['/d', '/s', '/c', `npm run ui:dev -- --host 127.0.0.1 --port ${preferredPort} --strictPort`], {
        cwd: process.cwd(),
        env: { ...process.env, BROWSER: 'none' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    : spawn('npm', ['run', 'ui:dev', '--', '--host', '127.0.0.1', '--port', String(preferredPort), '--strictPort'], {
        cwd: process.cwd(),
        env: { ...process.env, BROWSER: 'none' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })

  let ready = false
  const waitForReady = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for Vite dev server')), 30_000)
    const onData = (chunk: Buffer) => {
      const text = chunk.toString()
      const localMatch = text.match(/https?:\/\/127\.0\.0\.1:(\d+)\//)
      if (localMatch) {
        resolvedUrl = `http://127.0.0.1:${localMatch[1]}`
      }
      if (!ready && (text.includes('ready in') || text.includes('Local:') || text.includes(`:${preferredPort}`))) {
        ready = true
        clearTimeout(timer)
        resolve()
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', (code) => {
      if (!ready) {
        clearTimeout(timer)
        reject(new Error(`Vite dev server exited before ready: ${code}`))
      }
    })
  })

  return {
    child,
    get url() {
      return resolvedUrl
    },
    stop: () => {
      if (child.killed) {
        return
      }
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'inherit' })
      }
      else {
        child.kill()
      }
    },
    waitForReady,
  }
}

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
    id: `results-render-e2e-${Date.now()}`,
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
          at: Date.now(),
          message,
        })
      },
    },
    onDidChange: () => ({ dispose: vi.fn() }),
    __messages: messages,
  }
}

function sanitizeForPage<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, current) => {
    if (typeof current === 'function') {
      return undefined
    }
    return current
  }))
}

describe.skipIf(!enabled)('results render e2e', () => {
  it('bridges real webview frontend and message factory for directory expansion', async () => {
    if (!await isPortFree(preferredPort)) {
      throw new Error(`Port ${preferredPort} is already in use`)
    }

    const { CmdToVscode, CmdToWebview } = await import('~/message/cmd')
    const { VscodeMessageFactory } = await import('~/message/message-factory')

    const server = createServer()
    const panel = createPanel([workspaceRoot]) as any
    const backendUpdates: Array<{ cmd: string, traceId?: string, updateType?: string, payloads?: number }> = []
    const outboundMessages: any[] = []
    const webviewLogs: any[] = []
    let browser: any
    let page: any

    async function dispatchToPage(message: any) {
      await page.evaluate((msg: any) => {
        window.dispatchEvent(new MessageEvent('message', { data: msg }))
      }, sanitizeForPage(message))
    }

    async function flushPanelMessages() {
      while (panel.__messages.length) {
        const next = panel.__messages.shift()
        if (!next) {
          continue
        }
        backendUpdates.push({
          cmd: next.message.cmd,
          payloads: next.message.data?.payloads?.length,
          traceId: next.message.data?.traceId,
          updateType: next.message.data?.updateType,
        })
        await dispatchToPage(next.message)
      }
    }

    async function drainOutbound() {
      const messages = await page.evaluate(() => {
        const store = (window as any).__IM_RESULTS_E2E__
        const pending = Array.isArray(store?.outbound) ? store.outbound.slice() : []
        if (store?.outbound) {
          store.outbound.length = 0
        }
        return pending
      })

      return messages as any[]
    }

    async function processOutbound() {
      const messages = await drainOutbound()
      for (const message of messages) {
        outboundMessages.push(message)
        if (message.cmd === CmdToVscode.webview_log) {
          webviewLogs.push({
            ...message.data,
            elapsedMs: message.elapsedMs,
            traceId: message.traceId,
          })
          continue
        }

        const result = await (VscodeMessageFactory as any)[message.cmd](message.data || {}, panel, message)
        await flushPanelMessages()
        if (message.callbackId) {
          await dispatchToPage({
            callbackId: message.callbackId,
            cmd: CmdToWebview.webview_callback,
            data: result,
            traceId: message.traceId,
          })
        }
      }
      await flushPanelMessages()
      return messages.length
    }

    async function pumpUntil(predicate: () => Promise<boolean>, timeoutMs: number, stepMs = 50) {
      const start = Date.now()
      while (Date.now() - start < timeoutMs) {
        await processOutbound()
        if (await predicate()) {
          return
        }
        await page.waitForTimeout(stepMs)
      }
      const debugState = await page.evaluate(() => {
        const store = (window as any).__IM_RESULTS_E2E__
        return {
          bodyPreview: (document.body.textContent || '').slice(0, 2000),
          headers: Array.from(document.querySelectorAll('.ant-collapse-header'))
            .map(node => (node.textContent || '').trim())
            .filter(Boolean)
            .slice(0, 40),
          outboundTail: Array.isArray(store?.outbound) ? store.outbound.slice(-20) : [],
        }
      })
      throw new Error(`Timed out after ${timeoutMs}ms ${JSON.stringify({
        backendUpdates: backendUpdates.slice(-20),
        debugState,
        outboundMessages: outboundMessages.slice(-20),
        webviewLogs: webviewLogs.slice(-20),
      }, null, 2)}`)
    }

    try {
      await server.waitForReady

      browser = await chromium.launch({
        channel: findSystemBrowser() ? undefined : 'chrome',
        executablePath: findSystemBrowser(),
        headless: true,
      })
      page = await browser.newPage({ viewport: { width: 1440, height: 960 } })

      await page.route('https://marketplace.visualstudio.com/**', (route: any) => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ results: [{ extensions: [{ publisher: { publisherName: 'test' }, versions: [{ version: '0.0.0' }] }] }] }),
      }))

      await page.addInitScript(() => {
        const startedAt = performance.now()
        ;(window as any).__IM_RESULTS_E2E__ = {
          outbound: [],
          startedAt,
        }
        ;(window as any).acquireVsCodeApi = () => ({
          getState: () => undefined,
          setState: (value: unknown) => value,
          postMessage: (message: any) => {
            ;(window as any).__IM_RESULTS_E2E__.outbound.push({
              ...message,
              elapsedMs: Math.round(performance.now() - startedAt),
            })
          },
        })
      })

      await page.goto(server.url, { waitUntil: 'domcontentloaded' })

      await pumpUntil(async () => {
        return await page.getByText(targetLabel, { exact: true }).count() > 0
      }, 30_000)

      const clickHeader = async (label: string) => {
        const clicked = await page.evaluate((target: string) => {
          const normalize = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim()
          const headers = Array.from(document.querySelectorAll<HTMLElement>('.ant-collapse-header'))
          const header = headers.find((node) => {
            const text = normalize(node.textContent)
            const exactish = text === target || text.startsWith(`${target} `) || text.startsWith(`${target}\n`)
            const prefixed = text.startsWith(target) && !text.startsWith(`good_${target}`)
            return exactish || prefixed
          })
          header?.click()
          return !!header
        }, label)
        expect(clicked).toBe(true)
      }

      const expansionChain = targetChain.length ? targetChain : [targetLabel]
      const stepSummaries: any[] = []
      let finalTraceId: string | undefined

      for (let index = 0; index < expansionChain.length; index++) {
        const label = expansionChain[index]
        const expectedDirPath = normalizePath(path.posix.join(
          normalizePath(workspaceRoot),
          ...expansionChain.slice(0, index + 1).filter(item => item !== path.basename(workspaceRoot)),
        ))

        await clickHeader(label)

        await pumpUntil(async () => {
          const requests = outboundMessages.filter(message =>
            message.cmd === CmdToVscode.get_directory_children
            && normalizePath(message.data?.dirPath || '') === expectedDirPath,
          )
          if (!requests.length) {
            return false
          }

          const headerStats = await page.evaluate(() => {
            const normalize = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim()
            return Array.from(document.querySelectorAll<HTMLElement>('.ant-collapse-header'))
              .map(node => normalize(node.textContent))
          })

          if (headerStats.some(text => text === label || text.startsWith(label))) {
            return true
          }

          if (!expectEmptyTarget || index !== expansionChain.length - 1) {
            return false
          }

          const traceId = requests.at(-1)?.traceId
          if (!traceId) {
            return false
          }
          const finalTraceLogs = webviewLogs.filter(log => log.details?.traceId === traceId)
          return finalTraceLogs.some(log => log.message === 'update_images received' && log.details?.childrenLoaded === true)
            && finalTraceLogs.some(log => log.message === 'tree render commit')
        }, 30_000)

        const expandRequest = [...outboundMessages].reverse().find(message =>
          message.cmd === CmdToVscode.get_directory_children
          && normalizePath(message.data?.dirPath || '') === expectedDirPath,
        )
        expect(expandRequest).toBeTruthy()

        const traceId = expandRequest?.traceId
        finalTraceId = traceId
        const traceLogs = webviewLogs.filter(log => log.details?.traceId === traceId)
        const byMessage = (message: string) => traceLogs.find(log => log.message === message)
        const commitLog = byMessage('tree render commit')
        const callbackLog = byMessage('directory request callback')
        const receivedLog = byMessage('update_images received')
        const renderStates = traceLogs.filter(log => log.message === 'directory node render state')

        stepSummaries.push({
          callbackElapsedMs: callbackLog?.details?.elapsedMs,
          commitElapsedMs: commitLog?.elapsedMs,
          dirPath: expectedDirPath,
          label,
          receivedElapsedMs: receivedLog?.elapsedMs,
          renderStates: renderStates.slice(-5).map(log => log.details),
          traceId,
        })
      }

      await pumpUntil(async () => {
        const finalTraceLogs = webviewLogs.filter(log => log.details?.traceId === finalTraceId)
        const hasReceived = finalTraceLogs.some(log => log.message === 'update_images received')
        const hasCommit = finalTraceLogs.some(log => log.message === 'tree render commit')
        if (expectEmptyTarget) {
          return hasReceived && hasCommit
        }
        return hasReceived
          && hasCommit
          && await page.getByText(targetChildLabel, { exact: true }).count() > 0
      }, 30_000)

      const traceLogs = webviewLogs.filter(log => log.details?.traceId === finalTraceId)
      const byMessage = (message: string) => traceLogs.find(log => log.message === message)

      const sendLog = byMessage('directory request send')
      const receivedLog = byMessage('update_images received')
      const applyLog = byMessage('apply tree update')
      const commitLog = byMessage('tree render commit')
      const callbackLog = byMessage('directory request callback')

      const domStats = await page.evaluate(() => {
        const headers = Array.from(document.querySelectorAll('.ant-collapse-header'))
          .map(node => (node.textContent || '').trim())
          .filter(Boolean)
        return {
          collapseHeaders: headers.slice(0, 30),
          bodyPreview: (document.body.textContent || '').slice(0, 4000),
          headerCount: headers.length,
        }
      })

      const latestRenderState = [...webviewLogs]
        .reverse()
        .find(log =>
          log.message === 'directory node render state'
          && normalizePath(log.details?.absPath || '') === normalizePath(
            path.posix.join(
              normalizePath(workspaceRoot),
              ...expansionChain.filter(item => item !== path.basename(workspaceRoot)),
            ),
          ))

      const summary = {
        applyElapsedMs: applyLog?.elapsedMs,
        callbackElapsedMs: callbackLog?.details?.elapsedMs,
        childVisible: await page.getByText(targetChildLabel, { exact: true }).count(),
        commitElapsedMs: commitLog?.elapsedMs,
        domHeaderCount: domStats.headerCount,
        latestRenderState: latestRenderState?.details,
        receivedElapsedMs: receivedLog?.elapsedMs,
        requestElapsedMs: sendLog?.elapsedMs,
        stepSummaries,
        traceId: finalTraceId,
      }

      console.log(`RESULTS_RENDER_E2E ${JSON.stringify({
        domStats,
        summary,
        traceLogs,
      }, null, 2)}`)

      if (expectEmptyTarget) {
        expect(receivedLog?.details?.childrenLoaded).toBe(true)
        expect(commitLog?.elapsedMs).toBeTypeOf('number')
        if (summary.latestRenderState?.childrenLoaded) {
          expect(summary.latestRenderState.childrenLoaded).toBe(true)
          expect(summary.latestRenderState.loadingChildren).toBe(false)
        }
      }
      else {
        expect(summary.childVisible).toBeGreaterThan(0)
      }
      expect(summary.requestElapsedMs).toBeTypeOf('number')
      expect(summary.receivedElapsedMs).toBeTypeOf('number')
      expect(summary.commitElapsedMs).toBeTypeOf('number')
    }
    finally {
      await browser?.close()
      server.stop()
    }
  }, 10 * 60 * 1000)
})
