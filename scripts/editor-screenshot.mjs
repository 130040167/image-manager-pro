/* eslint-disable style/max-statements-per-line */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

// 复用 editor-open-smoke 的 mock 注入，但目标是「截图」而不是断言：
// 打开编辑器后，分别截 100%、放大后、直方图开启、历史面板开启几个状态，
// 方便人工核对上方/下方工具栏的可见性与整合效果。
const preferredPort = Number(process.env.IM_EDITOR_SHOT_PORT || 4557)
const cwd = normalizeSmokePath(process.env.IM_EDITOR_SMOKE_CWD || path.join(os.tmpdir(), 'image-editor-smoke'))
const outDir = normalizeSmokePath(process.env.IM_EDITOR_SHOT_DIR || path.join(os.tmpdir(), 'editor-shots'))
const pngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAhUlEQVR4nBXOgRQAQQxDwaIUZVGCEpSgBKUm/94NwcyM2DFvgqZ4RMZ0wk2ZWbMb3hat8Jps6JZbMfPCvvKe0DN+Ia/0iXtmRmUlnowUrBKJypzCjMXaPAe52CI2dTj/h5hNeCmKcEwSmnL5Dw3b8ipU44a0tOL6H67siXdGF3wlJ3rmLnwIvpvB/AyBIgAAAABJRU5ErkJggg=='

function normalizeSmokePath(value) {
  return value.replace(/\\/g, '/')
}

function findSystemBrowser() {
  if (process.env.IM_RENDER_SMOKE_BROWSER && fs.existsSync(process.env.IM_RENDER_SMOKE_BROWSER))
    return process.env.IM_RENDER_SMOKE_BROWSER
  const candidates = [
    `${process.env.ProgramFiles || 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.LocalAppData || ''}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.ProgramFiles || 'C:\\Program Files'}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ]
  return candidates.find(candidate => candidate && fs.existsSync(candidate))
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, '127.0.0.1')
  })
}

function createServer() {
  let resolvedUrl = `http://127.0.0.1:${preferredPort}`
  const child = spawn('cmd.exe', ['/d', '/s', '/c', `npm run ui:dev -- --host 127.0.0.1 --port ${preferredPort} --strictPort`], {
    cwd: process.cwd(),
    env: { ...process.env, BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let ready = false
  const waitForReady = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for Vite dev server')), 30_000)
    const onData = (chunk) => {
      const text = chunk.toString()
      const localMatch = text.match(/https?:\/\/127\.0\.0\.1:(\d+)\//)
      if (localMatch)
        resolvedUrl = `http://127.0.0.1:${localMatch[1]}`
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
    get url() { return resolvedUrl },
    waitForReady,
    stop: () => new Promise((resolve) => {
      if (child.killed) { resolve(); return }
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
      killer.once('exit', () => resolve())
      killer.once('error', () => resolve())
    }),
  }
}

function imagePayload() {
  return {
    absDirPath: cwd,
    absPath: `${cwd}/editor-smoke.png`,
    absWorkspaceFolder: cwd,
    basename: 'editor-smoke.png',
    dirPath: '',
    extname: 'png',
    filename: 'editor-smoke',
    info: { compressed: 3, gitStaged: false, metadata: { channels: 4, height: 8, width: 8 } },
    key: `${cwd}/editor-smoke.png`,
    name: 'editor-smoke.png',
    path: `${cwd}/editor-smoke.png`,
    relativePath: './editor-smoke.png',
    root: cwd,
    stats: { birthtimeMs: 1, ctimeMs: 1, mtimeMs: 1, size: 256 },
    vscodePath: pngDataUrl,
    workspaceFolder: 'image-editor-smoke',
  }
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true })
  if (!await isPortFree(preferredPort))
    throw new Error(`Port ${preferredPort} is already in use. Set IM_EDITOR_SHOT_PORT.`)
  const server = createServer()
  let browser
  try {
    await server.waitForReady
    const executablePath = findSystemBrowser()
    browser = await chromium.launch({ channel: executablePath ? undefined : 'chrome', executablePath, headless: true })
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })

    await page.route('https://marketplace.visualstudio.com/**', route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ results: [{ extensions: [{ publisher: { publisherName: 'test' }, versions: [{ version: '0.0.0' }] }] }] }),
    }))

    await page.addInitScript(({ cwd, image, pngDataUrl }) => {
      const startedAt = performance.now()
      window.__IM_EDITOR_SMOKE__ = { logs: [], messages: [], saved: [] }
      window.acquireVsCodeApi = () => ({
        getState: () => undefined,
        setState: value => value,
        postMessage: (message) => {
          const callback = data => window.dispatchEvent(new MessageEvent('message', {
            data: { callbackId: message.callbackId, cmd: 'webview_callback', data, traceId: message.traceId },
          }))
          const update = data => window.dispatchEvent(new MessageEvent('message', { data: { cmd: 'update_images', data, traceId: data.traceId } }))
          if (message.cmd === 'webview_log') { window.__IM_EDITOR_SMOKE__.logs.push({ elapsedMs: Math.round(performance.now() - startedAt), ...message.data }); return }
          if (message.cmd === 'on_webview_ready') {
            callback({
              config: { ext: {
                appearance: { language: 'en', primaryColor: '', reduceMotion: 'off', theme: 'dark' },
                compression: { errorRange: 0, fileSuffix: '.min', format: '', gif: { colors: 256 }, keepOriginal: false, png: { compressionLevel: 9 }, quality: 75, size: 1, skipCompressed: true, svg: { compressedAttribute: 'c', removeDataAttributes: true } },
                conversion: { format: '', icoSize: [16, 32], keepOriginal: false },
                core: { installDependencies: false, multiplePanels: true },
                debug: { enabled: true, forceInstall: false },
                file: { confirmDelete: false, customFormats: { extensionPresets: {}, folderPresets: {} }, exclude: [], gitignore: false, revealFileInOsDeeply: false, scan: ['png'], trashAfterProcessing: false },
                similarity: { precision: 14 },
                viewer: { imageBackgroundColor: '#1a1a1a', imageRendering: 'auto', imageWidth: 120, showDetailsOnHover: true, warningSize: 0 },
              }, vscode: { language: 'en', reduceMotion: 'off', theme: 'dark' } },
              windowState: { __reveal_image_path__: undefined, __sharp_installed__: true },
              workspaceState: { display_group: [], display_sort: ['name', 'asc'], display_style: 'compact', hide_known_empty_dirs: false, image_filter: { compressed: 0, git_staged: 0, exclude_types: [], size: { max: null, min: null, unit: 'KB' } }, preview_scale: 1, preview_scale_lock: true, recent_image_backgroundColors: [], recent_primary_colors: [], show_cut_tip: false, show_precision_tip: false, show_undo_redo_tip: false },
            })
            return
          }
          if (message.cmd === 'get_all_images_from_cwds') {
            setTimeout(() => {
              update({ absWorkspaceFolder: cwd, id: 'full-root-with-image', payloads: [
                { origin: 'dir', data: { type: 'create', payload: { absDirPath: cwd, absWorkspaceFolder: cwd, canLoadChildren: false, canLoadMoreImages: false, childrenLoaded: true, dirPath: '', directFolderCount: 0, directImageCount: 1, imagesLoaded: true, loadedImageCount: 1, loadingChildren: false, workspaceFolder: 'image-editor-smoke' } } },
                { origin: 'image', data: { type: 'create', payload: image } },
              ], traceId: 'full-root-with-image', updateType: 'full', workspaceFolder: 'image-editor-smoke' })
              callback(true)
            }, 40)
            return
          }
          if (message.cmd === 'copy_image_as_base64') { callback(pngDataUrl); return }
          if (message.cmd === 'get_image_histogram') { callback({ bins: [Array.from({ length: 256 }, (_, i) => i === 0 || i === 255 ? 8 : 0)], channels: 1, domain: [0, 255] }); return }
          if (message.cmd === 'get_images_metadata') { callback((message.data?.images || []).map(filePath => ({ compressed: 3, filePath, metadata: { channels: 4, height: 8, width: 8 }, stats: { mtimeMs: 1, size: 256 } }))); return }
          if (message.cmd === 'get_thumbnails') { callback([]); return }
          if (message.cmd === 'save_edited_image') { window.__IM_EDITOR_SMOKE__.saved.push(message.data); callback({ filename: 'editor-smoke.png', path: `${cwd}/editor-smoke.png` }); return }
          if (message.callbackId)
            callback(true)
        },
      })
    }, { cwd, image: imagePayload(), pngDataUrl })

    await page.goto(server.url, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('text=editor-smoke.png', { timeout: 20_000 })
    const tile = page.locator('[data-image-context-menu="true"]').filter({ hasText: 'editor-smoke.png' }).first()
    await tile.click({ button: 'right' })
    await page.locator('.contexify').first().waitFor({ timeout: 10_000 })
    await page.getByRole('menuitem', { name: 'Edit Image' }).click()
    await page.waitForSelector('.vim-image-editor-page', { timeout: 20_000 })
    await page.waitForSelector('.vim-editor-toolbar', { timeout: 20_000 })
    await page.waitForSelector('.tui-image-editor-menu .tie-btn-filter', { timeout: 20_000 })
    await page.waitForTimeout(800)
    await page.screenshot({ path: `${outDir}/01-editor-100.png` })

    for (let i = 0; i < 5; i++) { await page.getByTitle('Zoom In').click(); await page.waitForTimeout(60) }
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${outDir}/02-editor-zoomed.png` })

    await page.getByTitle('Histogram').click()
    await page.waitForSelector('[data-editor-histogram-panel]', { timeout: 10_000 })
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${outDir}/03-histogram-open.png` })

    await page.locator('.vim-editor-toolbar').getByTitle('History').click()
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${outDir}/04-history-open.png` })

    // 聚焦下方工具栏，单独截一张方便看图标对比度
    const controls = await page.locator('.tui-image-editor-controls').boundingBox()
    if (controls)
      await page.screenshot({ path: `${outDir}/05-bottom-toolbar.png`, clip: { x: 0, y: Math.max(0, controls.y - 8), width: 1440, height: Math.min(120, 960 - controls.y + 8) } })

    console.log(JSON.stringify({ outDir, shots: ['01-editor-100.png', '02-editor-zoomed.png', '03-histogram-open.png', '04-history-open.png', '05-bottom-toolbar.png'] }, null, 2))
  }
  finally {
    await browser?.close()
    await server.stop()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
