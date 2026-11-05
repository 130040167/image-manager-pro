import type { ConfigurationChangeEvent, ExtensionContext, Webview, WebviewPanel } from 'vscode'
import type { ConfigType, VscodeConfigType } from '~/core/config/common'
import type { Watcher } from '~/core/watcher'
import type { MessageType } from '~/message/message-factory'
import path from 'node:path'
import * as cheerio from 'cheerio'
import fs from 'fs-extra'
import { nanoid } from 'nanoid'
import {
  Disposable,
  EventEmitter,
  Uri,
  ViewColumn,
  window,
  workspace,
} from 'vscode'
import { Config } from '~/core/config/config'
import { FileCache } from '~/core/file-cache'
import { Global } from '~/core/global'
import { i18n } from '~/i18n'
import { CmdToWebview } from '~/message/cmd'
import { abortDirectoryWorkForPanel } from '~/message/message-factory'
import { DEV_PORT, EXT_NAMESPACE, PRELOAD_HELPER, REACT_DEVTOOLS_PORT } from '~/meta'
import { Channel } from '~/utils/node/channel'
import { MessageCenter } from './message-center'

export class ImageManagerPanel {
  id: string
  private disposed = false

  // events
  private onDidChanged = new EventEmitter<Webview | false>()
  public onDidChange = this.onDidChanged.event

  watcher: Watcher | null = null

  /**
   * 程序式修改配置
   */
  isProgrammaticChangeConfig = false

  panel: WebviewPanel
  messageCenter: MessageCenter

  private disposables: Disposable[] = []

  constructor(
    readonly ctx: ExtensionContext,
    public initialData: {
      imageReveal: string
      sharpInstalled: boolean
      rootpaths: string[]
    },
  ) {
    this.id = `imageManager-${nanoid()}`
    this.panel = this.createPanel()
    this.messageCenter = new MessageCenter(this)
    this.panel.webview.html = this.getLoadingHtml()

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables)
    this.panel.webview.onDidReceiveMessage((msg: MessageType) => this.handleMessage(msg), null, this.disposables)
    workspace.onDidChangeConfiguration(this.update, null, this.disposables)

    this.getWebviewHtml()
      .then((res) => {
        this.panel.webview.html = res
        this.panel.reveal()
      })
      .catch((err) => {
        const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
        Channel.error(`getWebviewHtml failed: ${msg}`)
        this.panel.webview.html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"></head><body style="font-family:sans-serif;padding:24px;color:#eee;background:#1e1e1e"><h2>Image Manager failed to load the webview</h2><pre style="white-space:pre-wrap;color:#f88">${msg.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))}</pre><p>If you're in dev mode, ensure <code>npm run ui:dev</code> is running on port 4433, then reopen this panel.</p></body></html>`
        this.panel.reveal()
      })
  }

  createPanel() {
    const panel = window.createWebviewPanel(this.id, i18n.t('pkg.title'), ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [
        this.ctx.extensionUri,
        Uri.file(FileCache.cacheDir),
        ...this.initialData.rootpaths.map(rootPath => Uri.file(rootPath)),
      ],
      retainContextWhenHidden: true,
    })
    panel.iconPath = Uri.file(this.ctx.asAbsolutePath('assets/logo.png'))
    return panel
  }

  private getLoadingHtml() {
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta
      name="viewport"
      content="width=device-width,initial-scale=1.0,minimum-scale=1.0,maximum-scale=1.0,user-scalable=0"
    >
    <style>
      :root {
        color-scheme: dark;
      }
      html, body {
        height: 100%;
        margin: 0;
        background: var(--vscode-editor-background, #1e1e1e);
        color: var(--vscode-editor-foreground, #cccccc);
        font-family: var(--vscode-font-family, sans-serif);
      }
      body {
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .im-loading {
        display: flex;
        align-items: center;
        gap: 12px;
        opacity: 0.92;
      }
      .im-loading__spinner {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        border: 2px solid rgba(255, 255, 255, 0.18);
        border-top-color: var(--vscode-progressBar-background, #3794ff);
        animation: im-spin 0.8s linear infinite;
      }
      .im-loading__text {
        font-size: 13px;
      }
      @keyframes im-spin {
        to {
          transform: rotate(360deg);
        }
      }
    </style>
  </head>
  <body>
    <div class="im-loading">
      <div class="im-loading__spinner"></div>
      <div class="im-loading__text">Loading Image Manager...</div>
    </div>
  </body>
</html>`
  }

  show(onShow?: (panel: ImageManagerPanel) => void) {
    this.panel.reveal()
    onShow?.(this)
  }

  private update = (e?: ConfigurationChangeEvent) => {
    let reload = false
    if (e) {
      let affected = false
      const affectedConfigs: Array<Flatten<ConfigType>> = []
      for (const config of Config.reloadConfigs) {
        const key = `${EXT_NAMESPACE}.${config}`
        if (e.affectsConfiguration(key)) {
          affected = true
          reload = true
          affectedConfigs.push(config as Flatten<ConfigType>)
          Channel.info(`[Reload] Config "${key}" changed, reloading`)
          break
        }
      }
      for (const config of Config.refreshConfigs) {
        const key = `${EXT_NAMESPACE}.${config}`
        if (e.affectsConfiguration(key)) {
          affected = true
          affectedConfigs.push(config as Flatten<ConfigType>)
          Channel.info(`[Refresh] Config "${key}" changed`)
        }
      }
      if (!affected)
        return
      if (reload) {
        Channel.debug('Reloading webview')
        this.reloadWebview()
        return
      }
      if (affected) {
        if (this.isProgrammaticChangeConfig) {
          Channel.debug('Programmatic change config, skip update webview')
          return
        }
        this.messageCenter.postMessage({ cmd: CmdToWebview.update_config, data: { keys: affectedConfigs } })
      }
    }
  }

  revealImageInViewer(imageReveal: string) {
    this.messageCenter.postMessage({
      cmd: CmdToWebview.reveal_image_in_viewer,
      data: { imagePath: imageReveal },
    })
  }

  reloadWebview() {
    this.messageCenter.postMessage({
      cmd: CmdToWebview.program_reload_webview,
      data: undefined,
    })
  }

  updateVscodeSettings(settings: VscodeConfigType) {
    this.messageCenter.postMessage({
      cmd: CmdToWebview.update_vscode_settings,
      data: settings,
    })
  }

  private async handleMessage(message: MessageType) {
    if (this.disposed) {
      Channel.debug(`Ignore message after panel disposed: ${message.cmd}`)
      return
    }
    this.messageCenter.handleMessages(message)
  }

  dispose() {
    if (this.disposed) {
      return
    }

    this.disposed = true
    const abortedTasks = 0
    const directoryAbort = abortDirectoryWorkForPanel(this.id)
    Channel.debug(
      `ImageManagerPanel disposed: ${this.id}, abortedTasks=${abortedTasks + directoryAbort.abortedCancelable}, `
      + `queuedForeground=${directoryAbort.queuedForeground}`,
    )
    this.onDidChanged.fire(false)
    this.watcher?.dispose()
    this.watcher = null
    Disposable.from(...this.disposables, this.onDidChanged).dispose()
    this.panel.dispose()
  }

  private async getWebviewHtml() {
    const isProd = Global.isProduction()
    const { webview } = this.panel

    let html = ''
    let content_src = ''
    let script_src = ''

    if (isProd) {
      const { htmlContent, htmlPath } = this.getHtml(['dist-webview', 'index.html'])
      html = this.transformHtml(htmlPath, htmlContent)
    }
    else {
      const localServerUrl = `http://localhost:${DEV_PORT}`
      const reactDevToolsUrl = `http://localhost:${REACT_DEVTOOLS_PORT}`
      const distWebviewHtml = path.resolve(this.ctx.extensionUri.fsPath, 'dist-webview', 'index.html')
      const hasDistFallback = fs.existsSync(distWebviewHtml)

      // Try to reach the Vite dev server. If it's not available within a short
      // window and the pre-built webview exists, fall back to serving that instead
      // of blocking for 60s.
      const fetchHtml = async (): Promise<string | null> => {
        const url = `${localServerUrl}/src/webview/image-manager/index.html`
        const deadline = Date.now() + (hasDistFallback ? 1_200 : 5_000)
        let lastErr: unknown
        let attempt = 0
        while (Date.now() < deadline) {
          attempt++
          try {
            const res = await fetch(url, {
              headers: { 'sec-fetch-dest': 'document' },
            })
            if (!res.ok && res.status >= 500) {
              throw new Error(`vite dev server replied ${res.status}`)
            }
            const text = await res.text()
            if (attempt > 1) {
              Channel.info(`Vite dev server ready after ${attempt} attempts`)
            }
            return text
          }
          catch (err) {
            lastErr = err
            if (attempt === 1) {
              const reason = err instanceof Error ? err.message : String(err)
              Channel.info(`Waiting for vite dev server at ${url} ... (${reason})`)
            }
            await new Promise(r => setTimeout(r, hasDistFallback ? 250 : 500))
          }
        }
        const reason = lastErr instanceof Error ? lastErr.message : String(lastErr ?? 'unknown')
        Channel.info(`Vite dev server not reachable after ${attempt} attempts (${reason})`)
        return null
      }

      const devHtml = await fetchHtml()

      if (devHtml) {
        html = devHtml
        html = html.replace(/(?<=")(\/).*"/g, match => `${localServerUrl}${match}`)

        content_src = `ws://${localServerUrl.replace(/https?:\/\//, '')} ws://localhost:${REACT_DEVTOOLS_PORT}`
        script_src = `${localServerUrl}`
        if (reactDevToolsUrl) {
          script_src += ` ${reactDevToolsUrl}`
        }
      }
      else {
        // Vite dev server unavailable — fall back to pre-built webview if it exists
        if (hasDistFallback) {
          Channel.info('Falling back to pre-built dist-webview (vite dev server not running)')
          const { htmlContent, htmlPath } = this.getHtml(['dist-webview', 'index.html'])
          html = this.transformHtml(htmlPath, htmlContent)
        }
        else {
          Channel.error(`Vite dev server not reachable and dist-webview/index.html not found. Run \`npm run ui:dev\` or \`npm run build\`.`)
          throw new Error('No webview source available')
        }
      }
    }

    const $ = cheerio.load(html)

    const meta = $('<meta></meta>')
    meta.attr('http-equiv', 'Content-Security-Policy')
    meta.attr('content', [
      `default-src 'none'`,
      `connect-src 'self' https://\* http://\* wss://\* ${content_src}`,
      `font-src 'self' vscode-webview://* https://* blob: data:`,
      `frame-src ${webview.cspSource} vscode-webview://* https://* blob: data:`,
      `media-src 'self' https://* blob: data:`,
      `script-src ${webview.cspSource} vscode-webview://* 'unsafe-inline' 'unsafe-eval' https://\* ${script_src}`,
      `img-src ${webview.cspSource} vscode-webview://* https://* http://* blob: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline' https://* http://*`,
    ].join('; '))

    $('head').prepend(meta)

    const script = $('<script></script>')
    script.text(`${PRELOAD_HELPER} = '${this.getUri(['dist-webview']).toString()}'`)
    $('head').prepend(script)

    return $.html()
  }

  private transformHtml(htmlPath: string, html: string) {
    Channel.debug(`htmlPath: ${htmlPath}`)
    const htmlDirPath = path.dirname(htmlPath)

    html = html.replace(/(<link.+?href="|<script.+?src="|<img.+?src=")(.+?)"/g, (_, $1: string, $2: string) => {
      $2 = $2.startsWith('.') ? $2 : `.${$2}`
      const vscodeResourcePath = this.panel.webview.asWebviewUri(Uri.file(path.resolve(htmlDirPath, $2))).toString()
      return `${$1 + vscodeResourcePath}"`
    })

    return html
  }

  private getUri(pathList: string[]) {
    return this.panel.webview.asWebviewUri(Uri.joinPath(this.ctx.extensionUri, ...pathList))
  }

  private getHtml(htmlPath: string[]) {
    const htmlWebviewPath = this.getUri(htmlPath).fsPath
    const htmlContent = fs.readFileSync(htmlWebviewPath, 'utf-8')
    Channel.debug(`htmlPath: ${htmlWebviewPath}`)
    return {
      htmlPath: htmlWebviewPath,
      htmlContent,
    }
  }

  get visible() {
    return !this.disposed && this.panel.visible
  }

  get isDisposed() {
    return this.disposed
  }
}
