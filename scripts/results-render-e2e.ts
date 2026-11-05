import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import { chromium } from 'playwright'
import { Config } from '~/core/config/config'
import { Global } from '~/core/global'
import { CmdToVscode, CmdToWebview } from '~/message/cmd'
import { VscodeMessageFactory } from '~/message/message-factory'

const preferredPort = Number(process.env.IM_RESULTS_E2E_PORT || 4554)
const workspaceRoot = 'f:/workspace/my-de-flow/results'

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

async function main() {
  if (!await isPortFree(preferredPort)) {
    throw new Error(`Port ${preferredPort} is already in use. Set IM_RESULTS_E2E_PORT to a free port.`)
  }

  const server = createServer()
  let browser
  const backendLog: any[] = []

  try {
    await server.waitForReady

    ;(Global as any).context = {
      extensionMode: 2,
    }

    ;(Config as any).getConfig = ((key: string) => {
      const map: Record<string, any> = {
        'core.installDependencies': false,
        'debug.enabled': true,
        'debug.forceInstall': false,
        'file.exclude': [],
        'file.scan': ['png', 'jpg', 'jpeg', 'webp', 'gif', 'tiff', 'tif', 'svg', 'bmp'],
        'file.gitignore': false,
        'viewer.warningSize': 0,
        'viewer.imageWidth': 100,
        'viewer.imageBackgroundColor': '#1a1a1a',
        'viewer.imageRendering': 'auto',
        'viewer.showDetailsOnHover': true,
        'appearance.language': 'en',
        'appearance.theme': 'dark',
        'appearance.reduceMotion': 'off',
        'appearance.primaryColor': '',
      }
      return map[key]
    }) as typeof Config.getConfig

    const panelMessages: Array<{ at: number, message: any }> = []
    const panel = {
      id: `results-render-e2e-${Date.now()}`,
      initialData: {
        imageReveal: '',
        rootpaths: [workspaceRoot],
        sharpInstalled: false,
      },
      isDisposed: false,
      visible: true,
      panel: {
        webview: {
          asWebviewUri: (uri: { fsPath?: string, path?: string }) => ({
            toString: () => `vscode-resource://${String(uri.fsPath || uri.path || '').replace(/\\/g, '/')}`,
          }),
        },
      },
      messageCenter: {
        postMessage: (message: any) => {
          panelMessages.push({
            at: Date.now(),
            message,
          })
        },
      },
      onDidChange: () => ({ dispose() {} }),
    } as any

    const executablePath = findSystemBrowser()
    browser = await chromium.launch({
      channel: executablePath ? undefined : 'chrome',
      executablePath,
      headless: true,
    })
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
    const timeline: Array<{ type: string, text: string }> = []

    page.on('console', (msg) => {
      timeline.push({ type: msg.type(), text: msg.text() })
    })
    page.on('pageerror', (err) => {
      timeline.push({ type: 'pageerror', text: err.stack || err.message })
    })

    await page.route('https://marketplace.visualstudio.com/**', route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ results: [{ extensions: [{ publisher: { publisherName: 'test' }, versions: [{ version: '0.0.0' }] }] }] }),
    }))

    await page.addInitScript(({ cwd }) => {
      const startedAt = performance.now()
      window.localStorage.setItem('debug-mode', JSON.stringify(true))
      ;(window as any).__IM_RESULTS_E2E__ = {
        logs: [],
        outbound: [],
        startedAt,
      }
      ;(window as any).acquireVsCodeApi = () => ({
        getState: () => undefined,
        setState: (value: unknown) => value,
        postMessage: (message: any) => {
          ;(window as any).__IM_RESULTS_E2E__.outbound.push({
            callbackId: message.callbackId,
            cmd: message.cmd,
            data: message.data,
            elapsedMs: Math.round(performance.now() - startedAt),
            traceId: message.traceId,
          })
        },
      })
    }, { cwd: workspaceRoot })

    await page.goto(server.url, { waitUntil: 'domcontentloaded' })

    async function dispatchToPage(message: any) {
      await page.evaluate((msg) => {
        window.dispatchEvent(new MessageEvent('message', { data: msg }))
      }, message)
    }

    async function flushPanelMessages() {
      while (panelMessages.length) {
        const next = panelMessages.shift()!
        backendLog.push({
          cmd: next.message.cmd,
          payloadCount: next.message.data?.payloads?.length,
          traceId: next.message.traceId,
          updateType: next.message.data?.updateType,
        })
        await dispatchToPage(next.message)
      }
    }

    async function callFactory(cmd: CmdToVscode, data: any, traceId = `${cmd}:${Date.now()}`) {
      const callbackId = `${Date.now()}_${Math.random().toString(36).slice(2)}`
      const startedAt = performance.now()
      const result = await (VscodeMessageFactory as any)[cmd](data, panel, {
        callbackId,
        cmd,
        data,
        traceId,
      })
      backendLog.push({
        backendResult: result,
        cmd,
        runMs: Math.round(performance.now() - startedAt),
        traceId,
      })
      await flushPanelMessages()
      await dispatchToPage({
        cmd: CmdToWebview.webview_callback,
        callbackId,
        data: result,
        traceId,
      })
      return result
    }

    await callFactory(CmdToVscode.on_webview_ready, {}, 'bootstrap')
    await callFactory(CmdToVscode.get_all_images_from_cwds, {}, 'initial-load')

    await page.waitForSelector('text=results', { timeout: 30_000 })
    await page.getByText('results', { exact: true }).click()

    const outbound = await page.evaluate(() => (window as any).__IM_RESULTS_E2E__.outbound)
    const expandRequest = outbound.find((item: any) =>
      item.cmd === 'get_directory_children'
      && item.data?.dirPath === 'f:/workspace/my-de-flow/results',
    )

    if (!expandRequest) {
      throw new Error('Did not observe get_directory_children request for results')
    }

    await callFactory(
      CmdToVscode.get_directory_children,
      expandRequest.data,
      expandRequest.traceId || 'results-expand',
    )

    await page.waitForTimeout(1500)

    const bodyText = await page.locator('body').innerText()
    const renderTimeline = timeline.filter(item =>
      item.text.includes('generateTree:')
      || item.text.includes('toNestedArray:')
      || item.text.includes('compactFolders:')
      || item.text.includes('processImages:')
      || item.text.includes('更新图片')
      || item.text.includes('[directory-state]'),
    )

    console.log(JSON.stringify({
      backendLog,
      bodyPreview: bodyText.slice(0, 4000),
      expandRequest,
      outbound: outbound.filter((item: any) =>
        item.cmd === 'get_directory_children'
        || item.cmd === 'get_all_images_from_cwds'
        || item.cmd === 'webview_log'
        || item.cmd === 'on_webview_ready',
      ),
      renderTimeline,
      timelineTail: timeline.slice(-120),
    }, null, 2))
  }
  finally {
    await browser?.close()
    server.stop()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
