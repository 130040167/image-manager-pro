import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const preferredPort = Number(process.env.IM_EDITOR_SMOKE_PORT || 4554)
const cwd = normalizeSmokePath(process.env.IM_EDITOR_SMOKE_CWD || path.join(os.tmpdir(), 'image-editor-smoke'))
const pngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAACXBIWXMAAAPoAAAD6AG1e1JrAAADxElEQVR4nO3SAUczCgCG0SRJkiRJkiRJkiRJkiRJkiRJkiRJkiRJEklmZpJJZjKZmZlMkpkkMzOTJDOZSZLJZDKZyeT9XO7PeM5vOAUFBQUqLCxUUVGRiouLVVJSotLSUpWVlam8vFwVFRWqrKxUVVWVqqurVVNTo9raWtXV1am+vl4NDQ1qbGxUU1OTmpub1dLSotbWVrW1tam9vV0dHR3q7OxUV1eXuru71dPTo97eXvX19am/v18DAwMaHBzU0NCQhoeHNTIyotHRUY2NjWl8fFwTExOanJzU1NSUpqenNTMzo9nZWc3NzWl+fl4LCwtaXFzU0tKSlpeXtbKyotXVVa2trWl9fV0bGxva3NzU1taWtre3tbOzo93dXe3t7Wl/f18HBwc6PDzU0dGRDAaDjEajTCaTzGazjo+PdXJyIovFotPTU52dnclqtcpms+n8/Fx2u10XFxdyOBxyOp1yuVxyu93yeDy6vLyU1+vV1dWVrq+vdXNzI5/PJ7/fr9vbW93d3en+/l6BQEDBYFChUEjhcFiRSEQPDw96fHzU09OTnp+fFY1GFYvF9PLyong8rkQiodfXV729ven9/V0fHx9KJpP6/PxUKpXS19eX0um0vr+/lclk9PPzo2w2q1wup9/fX+Xzef39/ek/BQQ4IAABDglAgCMCEMBAAAIYCUAAEwEIYCYAAY4JQIATAhDAQgACnBKAAGcEIICVAASwEYAA5wQggJ0ABLggAAEcBCCAkwAEcBGAAG4CEMBDAAJcEoAAXgIQ4IoABLgmAAFuCEAAHwEI4CcAAW4JQIA7AhDgngAECBCAAEECECBEAAKECUCACAEI8EAAAjwSgABPBCDAMwEIECUAAWIEIMALAQgQJwABEgQgwCsBCPBGAAK8E4AAHwQgQJIABPgkAAFSBCDAFwEIkCYAAb4JQIAMAQjwQwACZAlAgBwBCPBLAALkCUCAPwLsE4AABwQgwCEBCHBEAAIYCEAAIwEIYCIAAcwEIMAxAQhwQgACWAhAgFMCEOCMAASwEoAANgIQ4JwABLATgAAXBCCAgwAEcBKAAC4CEMBNAAJ4CECASwIQwEsAAlwRgADXBCDADQEI4CMAAfwEIMAtAQhwRwAC3BOAAAECECBIAAKECECAMAEIECEAAR4IQIBHAhDgiQAEeCYAAaIEIECMAAR4IQAB4gQgQIIABHglAAHeCECAdwIQ4IMABEgSgACfBCBAigAE+CIAAdIEIMA3AQiQIQABfghAgCwBCJAjAAF+CUCAPAEI8Pd/gH+2q2lSowipZgAAAABJRU5ErkJggg=='

function normalizeSmokePath(value) {
  return value.replace(/\\/g, '/')
}

function findSystemBrowser() {
  if (process.env.IM_RENDER_SMOKE_BROWSER && fs.existsSync(process.env.IM_RENDER_SMOKE_BROWSER))
    return process.env.IM_RENDER_SMOKE_BROWSER

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
  let resolvedUrl = `http://127.0.0.1:${preferredPort}`
  const child = process.platform === 'win32'
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
    get url() {
      return resolvedUrl
    },
    waitForReady,
    stop: () => new Promise((resolve) => {
      if (child.killed) {
        resolve()
        return
      }
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' })
        killer.once('exit', () => resolve())
        killer.once('error', () => resolve())
        return
      }

      const timer = setTimeout(resolve, 2_000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
      child.kill()
    }),
  }
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, '127.0.0.1')
  })
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
    info: {
      compressed: 3,
      gitStaged: false,
      metadata: { channels: 4, height: 128, width: 128 },
    },
    key: `${cwd}/editor-smoke.png`,
    name: 'editor-smoke.png',
    path: `${cwd}/editor-smoke.png`,
    relativePath: './editor-smoke.png',
    root: cwd,
    stats: {
      birthtimeMs: 1,
      ctimeMs: 1,
      mtimeMs: 1,
      size: 256,
    },
    vscodePath: pngDataUrl,
    workspaceFolder: 'image-editor-smoke',
  }
}

async function main() {
  if (!await isPortFree(preferredPort))
    throw new Error(`Port ${preferredPort} is already in use. Set IM_EDITOR_SMOKE_PORT to a free port.`)

  const server = createServer()
  let browser
  let page
  try {
    await server.waitForReady
    const executablePath = findSystemBrowser()
    browser = await chromium.launch({
      channel: executablePath ? undefined : 'chrome',
      executablePath,
      headless: true,
    })
    page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
    const timeline = []

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

    await page.addInitScript(({ cwd, image, pngDataUrl }) => {
      const startedAt = performance.now()
      const logs = []
      window.__IM_EDITOR_SMOKE__ = { logs, messages: [], saved: [] }
      window.acquireVsCodeApi = () => ({
        getState: () => undefined,
        setState: value => value,
        postMessage: (message) => {
          window.__IM_EDITOR_SMOKE__.messages.push({
            cmd: message.cmd,
            data: message.data,
            elapsedMs: Math.round(performance.now() - startedAt),
            traceId: message.traceId,
          })
          const callback = data => window.dispatchEvent(new MessageEvent('message', {
            data: {
              callbackId: message.callbackId,
              cmd: 'webview_callback',
              data,
              traceId: message.traceId,
            },
          }))
          const update = data => window.dispatchEvent(new MessageEvent('message', {
            data: {
              cmd: 'update_images',
              data,
              traceId: data.traceId,
            },
          }))

          if (message.cmd === 'webview_log') {
            logs.push({
              elapsedMs: Math.round(performance.now() - startedAt),
              ...message.data,
            })
            return
          }

          if (message.cmd === 'on_webview_ready') {
            callback({
              config: {
                ext: {
                  appearance: { language: 'en', primaryColor: '', reduceMotion: 'off', theme: 'dark' },
                  compression: {
                    errorRange: 0,
                    fileSuffix: '.min',
                    format: '',
                    gif: { colors: 256 },
                    keepOriginal: false,
                    png: { compressionLevel: 9 },
                    quality: 75,
                    size: 1,
                    skipCompressed: true,
                    svg: { compressedAttribute: 'c', removeDataAttributes: true },
                  },
                  conversion: { format: '', icoSize: [16, 32], keepOriginal: false },
                  core: { installDependencies: false, multiplePanels: true },
                  debug: { enabled: true, forceInstall: false },
                  file: {
                    confirmDelete: false,
                    customFormats: { extensionPresets: {}, folderPresets: {} },
                    exclude: [],
                    gitignore: false,
                    revealFileInOsDeeply: false,
                    scan: ['png'],
                    trashAfterProcessing: false,
                  },
                  similarity: { precision: 14 },
                  viewer: {
                    imageBackgroundColor: '#1a1a1a',
                    imageRendering: 'auto',
                    imageWidth: 120,
                    showDetailsOnHover: true,
                    warningSize: 0,
                  },
                },
                vscode: { language: 'en', reduceMotion: 'off', theme: 'dark' },
              },
              windowState: {
                __reveal_image_path__: undefined,
                __sharp_installed__: true,
              },
              workspaceState: {
                display_group: [],
                display_sort: ['name', 'asc'],
                display_style: 'compact',
                hide_known_empty_dirs: false,
                image_filter: {
                  compressed: 0,
                  git_staged: 0,
                  exclude_types: [],
                  size: { max: null, min: null, unit: 'KB' },
                },
                preview_scale: 1,
                preview_scale_lock: true,
                recent_image_backgroundColors: [],
                recent_primary_colors: [],
                show_cut_tip: false,
                show_precision_tip: false,
                show_undo_redo_tip: false,
              },
            })
            return
          }

          if (message.cmd === 'get_compressor') {
            callback({
              limit: { from: ['png'], to: ['png', 'webp'] },
              option: { quality: 75, size: 1, skipCompressed: true, keepOriginal: false, png: { compressionLevel: 9 }, gif: { colors: 256 }, svg: { compressedAttribute: 'c', removeDataAttributes: true } },
            })
            return
          }

          if (message.cmd === 'get_format_converter') {
            callback({
              limit: { from: ['png'], to: ['png', 'webp', 'jpg'] },
              option: { format: 'webp', keepOriginal: false, icoSize: [16, 32] },
            })
            return
          }

          if (message.cmd === 'get_all_images_from_cwds') {
            setTimeout(() => {
              update({
                absWorkspaceFolder: cwd,
                id: 'full-root-with-image',
                payloads: [
                  {
                    origin: 'dir',
                    data: {
                      type: 'create',
                      payload: {
                        absDirPath: cwd,
                        absWorkspaceFolder: cwd,
                        canLoadChildren: false,
                        canLoadMoreImages: false,
                        childrenLoaded: true,
                        dirPath: '',
                        directFolderCount: 0,
                        directImageCount: 1,
                        imagesLoaded: true,
                        loadedImageCount: 1,
                        loadingChildren: false,
                        workspaceFolder: 'image-editor-smoke',
                      },
                    },
                  },
                  { origin: 'image', data: { type: 'create', payload: image } },
                ],
                traceId: 'full-root-with-image',
                updateType: 'full',
                workspaceFolder: 'image-editor-smoke',
              })
              callback(true)
            }, 40)
            return
          }

          if (message.cmd === 'copy_image_as_base64') {
            callback(pngDataUrl)
            return
          }

          if (message.cmd === 'get_image_histogram') {
            callback({
              bins: [Array.from({ length: 256 }, (_, index) => index === 0 || index === 255 ? 8 : 0)],
              channels: 1,
              domain: [0, 255],
            })
            return
          }

          if (message.cmd === 'get_images_metadata') {
            callback((message.data?.images || []).map(filePath => ({
              compressed: 3,
              filePath,
              metadata: { channels: 4, height: 128, width: 128 },
              stats: { mtimeMs: 1, size: 256 },
            })))
            return
          }

          if (message.cmd === 'get_thumbnails') {
            callback([])
            return
          }

          if (message.cmd === 'save_edited_image') {
            window.__IM_EDITOR_SMOKE__.saved.push(message.data)
            callback({ filename: 'editor-smoke.png', path: `${cwd}/editor-smoke.png` })
            return
          }

          if (message.callbackId)
            callback(true)
        },
      })
    }, { cwd, image: imagePayload(), pngDataUrl })

    const diagnostics = async stage => page.evaluate(stage => ({
      bodyText: document.body.textContent.slice(0, 2500),
      contexifyCount: document.querySelectorAll('.contexify').length,
      editorCount: document.querySelectorAll('.vim-image-editor-page').length,
      html: document.body.innerHTML.slice(0, 2500),
      imageContextTiles: document.querySelectorAll('[data-image-context-menu="true"]').length,
      lazyImages: document.querySelectorAll('.ant-image, [data-image-context-menu="true"] img').length,
      smoke: window.__IM_EDITOR_SMOKE__,
      stage,
      toastUiCount: document.querySelectorAll('.tui-image-editor-container').length,
    }), stage).catch(error => ({ evaluateError: String(error), stage }))

    const waitWithDiagnostics = async (stage, task) => {
      try {
        return await task()
      }
      catch (err) {
        console.error(JSON.stringify({
          diagnostics: await diagnostics(stage),
          timeline,
        }, null, 2))
        throw err
      }
    }

    await page.goto(server.url, { waitUntil: 'domcontentloaded' })
    await waitWithDiagnostics('image tile visible', async () => {
      await page.waitForSelector('text=editor-smoke.png', { timeout: 20_000 })
      await page.locator('[data-image-context-menu="true"]').first().waitFor({ timeout: 10_000 })
    })

    const tile = page
      .locator('[data-image-context-menu="true"]')
      .filter({ hasText: 'editor-smoke.png' })
      .first()

    await waitWithDiagnostics('thumbnail preview opens', async () => {
      await tile.hover()
      const previewTrigger = tile.locator('[data-disable-dbclick]').filter({ hasText: 'Preview' }).first()
      await previewTrigger.waitFor({ timeout: 10_000 })
      await previewTrigger.click({ force: true })
      await page.locator('.ant-image-preview-img, .rc-image-preview-img').first().waitFor({ timeout: 10_000 })
    })
    const previewImageBox = await page.locator('.ant-image-preview-img, .rc-image-preview-img').first().boundingBox()
    if (!previewImageBox)
      throw new Error('Preview image has no bounding box')
    await page.mouse.move(previewImageBox.x + previewImageBox.width / 2, previewImageBox.y + previewImageBox.height / 2)
    await page.mouse.wheel(0, -900)
    await page.waitForTimeout(180)
    await page.mouse.down()
    await page.mouse.move(previewImageBox.x + previewImageBox.width / 2 - 120, previewImageBox.y + previewImageBox.height / 2 - 80, { steps: 8 })
    await page.mouse.up()
    const previewTransformBeforeWheel = await page.evaluate(() => {
      const img = document.querySelector('.ant-image-preview-img, .rc-image-preview-img')
      const transform = window.getComputedStyle(img).transform
      const matrix = new DOMMatrixReadOnly(transform === 'none' ? undefined : transform)
      return { x: Math.round(matrix.e), y: Math.round(matrix.f), scale: Number(matrix.a.toFixed(3)) }
    })
    const previewWheelAnchor = {
      x: previewImageBox.x + previewImageBox.width * 0.65,
      y: previewImageBox.y + previewImageBox.height * 0.35,
    }
    const readPreviewAnchorState = anchor => page.evaluate((anchor) => {
      const img = document.querySelector('.ant-image-preview-img, .rc-image-preview-img')
      const rect = img.getBoundingClientRect()
      const transform = window.getComputedStyle(img).transform
      const matrix = new DOMMatrixReadOnly(transform === 'none' ? undefined : transform)
      return {
        height: Number(rect.height.toFixed(3)),
        localX: Number((((anchor.x - rect.left) / rect.width) * img.offsetWidth).toFixed(3)),
        localY: Number((((anchor.y - rect.top) / rect.height) * img.offsetHeight).toFixed(3)),
        overflows: rect.width > window.innerWidth - 64 || rect.height > window.innerHeight - 128,
        scale: Number(matrix.a.toFixed(3)),
        width: Number(rect.width.toFixed(3)),
        x: Math.round(matrix.e),
        y: Math.round(matrix.f),
      }
    }, previewWheelAnchor)
    const readPreviewDebugState = () => page.evaluate(() => {
      const img = document.querySelector('.ant-image-preview-img, .rc-image-preview-img')
      const transform = img ? window.getComputedStyle(img).transform : 'none'
      const matrix = new DOMMatrixReadOnly(transform === 'none' ? undefined : transform)
      const zoomInput = document.querySelector('.ant-image-preview-root input, .rc-image-preview-root input')
      const logs = (window.__IM_EDITOR_SMOKE__?.logs || []).filter(item => item?.message?.includes('[preview]')).slice(-20)
      return {
        activeElement: document.activeElement instanceof HTMLElement
          ? {
              className: document.activeElement.className,
              tagName: document.activeElement.tagName,
              text: document.activeElement.textContent?.slice(0, 120) || '',
            }
          : null,
        imgRect: img
          ? {
              height: Number(img.getBoundingClientRect().height.toFixed(3)),
              left: Number(img.getBoundingClientRect().left.toFixed(3)),
              top: Number(img.getBoundingClientRect().top.toFixed(3)),
              width: Number(img.getBoundingClientRect().width.toFixed(3)),
            }
          : null,
        logs,
        toolbarText: document.querySelector('.ant-image-preview-operations-wrapper, .rc-image-preview-operations-wrapper')?.textContent || '',
        transform: {
          scale: Number(matrix.a.toFixed(3)),
          x: Math.round(matrix.e),
          y: Math.round(matrix.f),
        },
        zoomInputValue: zoomInput instanceof HTMLInputElement ? zoomInput.value : '',
      }
    })
    await page.mouse.move(previewWheelAnchor.x, previewWheelAnchor.y)
    await page.mouse.wheel(0, -500)
    await page.waitForTimeout(180)
    const previewTransformAfterWheel = await page.evaluate(() => {
      const img = document.querySelector('.ant-image-preview-img, .rc-image-preview-img')
      const transform = window.getComputedStyle(img).transform
      const matrix = new DOMMatrixReadOnly(transform === 'none' ? undefined : transform)
      return { x: Math.round(matrix.e), y: Math.round(matrix.f), scale: Number(matrix.a.toFixed(3)) }
    })
    if (previewTransformAfterWheel.scale <= previewTransformBeforeWheel.scale) {
      throw new Error(`Preview wheel did not zoom in: ${JSON.stringify({
        after: previewTransformAfterWheel,
        before: previewTransformBeforeWheel,
        debug: await readPreviewDebugState(),
      })}`)
    }

    let previewOverflowState = await readPreviewAnchorState(previewWheelAnchor)
    for (let i = 0; i < 16 && !previewOverflowState.overflows; i++) {
      await page.mouse.wheel(0, -900)
      await page.waitForTimeout(80)
      previewOverflowState = await readPreviewAnchorState(previewWheelAnchor)
    }
    if (!previewOverflowState.overflows)
      throw new Error(`Preview did not reach an oversized state for anchor testing: ${JSON.stringify(previewOverflowState)}`)

    const previewAnchorBeforeOversizedWheel = await readPreviewAnchorState(previewWheelAnchor)
    await page.mouse.wheel(0, -500)
    await page.waitForTimeout(180)
    const previewAnchorSettled = await readPreviewAnchorState(previewWheelAnchor)
    if (previewAnchorSettled.scale <= previewAnchorBeforeOversizedWheel.scale)
      throw new Error(`Preview high zoom did not continue zooming: ${JSON.stringify({ before: previewAnchorBeforeOversizedWheel, settled: previewAnchorSettled })}`)
    if (Math.abs(previewAnchorSettled.localX - previewAnchorBeforeOversizedWheel.localX) > 2 || Math.abs(previewAnchorSettled.localY - previewAnchorBeforeOversizedWheel.localY) > 2)
      throw new Error(`Preview high zoom drifted away from the mouse anchor: ${JSON.stringify({ before: previewAnchorBeforeOversizedWheel, settled: previewAnchorSettled })}`)
    if (Math.abs(previewAnchorSettled.x) <= 4 && Math.abs(previewAnchorSettled.y) <= 4)
      throw new Error(`Preview high zoom settled back to center: ${JSON.stringify(previewAnchorSettled)}`)
    const previewContextPoint = await page.evaluate(() => {
      const img = document.querySelector('.ant-image-preview-img, .rc-image-preview-img')
      const rect = img.getBoundingClientRect()
      const left = Math.max(rect.left, window.innerWidth * 0.14)
      const right = Math.min(rect.right, window.innerWidth * 0.86)
      const top = Math.max(rect.top, 32)
      const bottom = Math.min(rect.bottom, window.innerHeight - 120)
      return {
        x: left + Math.max(1, right - left) / 2,
        y: top + Math.max(1, bottom - top) / 2,
      }
    })
    await page.mouse.click(previewContextPoint.x, previewContextPoint.y, { button: 'right' })
    await waitWithDiagnostics('preview context menu visible', async () => {
      await page.locator('.contexify[role="menu"], .contexify').first().waitFor({ timeout: 10_000 })
      await page.getByRole('menuitem', { name: 'Edit Image' }).waitFor({ timeout: 10_000 })
      await page.locator('.contexify_item[aria-haspopup="true"]').filter({ hasText: 'More Tools' }).first().waitFor({ timeout: 10_000 })
    })
    const previewMenuState = await page.evaluate(() => {
      const root = document.querySelector('.contexify')
      const topLevelItems = Array.from(root?.querySelectorAll(':scope > .contexify_item') || [])
        .map(el => (el.textContent || '').trim())
      const moreTools = topLevelItems.find(text => text.includes('More Tools')) || ''
      return {
        hasEdit: topLevelItems.some(text => text.includes('Edit Image')),
        hasMoreTools: !!moreTools,
        hasTopLevelPreview: topLevelItems.includes('Preview'),
        hasTopLevelRename: topLevelItems.some(text => text.includes('Rename')),
        moreTools,
      }
    })
    if (!previewMenuState.hasEdit || !previewMenuState.hasMoreTools)
      throw new Error(`Preview context menu did not expose expected actions: ${JSON.stringify(previewMenuState)}`)
    if (previewMenuState.hasTopLevelPreview || previewMenuState.hasTopLevelRename)
      throw new Error(`Preview context menu contains disallowed top-level items: ${JSON.stringify(previewMenuState)}`)
    await page.keyboard.press('Escape')
    await page.locator('.contexify').waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {})
    await page.keyboard.press('Escape')
    await page.locator('.ant-image-preview-root, .rc-image-preview-root').waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {})
    await page.waitForTimeout(100)

    const openTileContextMenu = async (stage = 'context menu visible') => {
      await tile.click({ button: 'right' })
      await page.locator('.contexify[role="menu"], .contexify').first().waitFor({ timeout: 10_000 })
    }

    const closeLatestAntdModal = async (formSelector) => {
      await page.locator('.ant-modal .ant-modal-close').last().click()
      await page.locator(formSelector).waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {})
      await page.waitForTimeout(100)
    }

    const openMoreToolModal = async ({ beforeClose, formSelector, menuItem, stage }) => {
      await waitWithDiagnostics(`${stage} context menu visible`, async () => {
        await openTileContextMenu()
      })
      const startedAt = Date.now()
      await page.locator('.contexify_item[aria-haspopup="true"]').filter({ hasText: 'More Tools' }).first().hover()
      await page.locator('.contexify_submenu .contexify_item').filter({ hasText: menuItem }).first().click()
      await waitWithDiagnostics(`${stage} form visible`, async () => {
        await page.locator(formSelector).waitFor({ timeout: 12_000 })
      })
      const elapsedMs = Date.now() - startedAt
      if (beforeClose)
        await beforeClose()
      await closeLatestAntdModal(formSelector)
      return elapsedMs
    }

    const compressOpenMs = await openMoreToolModal({
      formSelector: 'form#image-compressor',
      menuItem: 'Compress',
      stage: 'compress modal',
    })
    const convertOpenMs = await openMoreToolModal({
      formSelector: 'form#image-converter',
      menuItem: 'Convert Format',
      stage: 'convert modal',
    })
    const similarityOpenMs = await openMoreToolModal({
      beforeClose: async () => {
        const panel = page.locator('[data-similarity-panel]').first()
        const text = await panel.textContent()
        for (const expected of ['Algorithm', 'Threshold', 'Max results', 'Scope', 'Balanced structure + color', 'Range 0-64']) {
          if (!text?.includes(expected))
            throw new Error(`Similarity panel missing "${expected}": ${text}`)
        }
        if (text?.includes('Slices'))
          throw new Error(`Similarity panel still shows removed slice control: ${text}`)
        const modalText = await page.locator('.ant-modal-content').last().textContent()
        if (!modalText?.includes('Results'))
          throw new Error(`Similarity modal missing result summary label: ${modalText}`)

        await panel.locator('.ant-select').first().click()
        await page.locator('.ant-select-item-option').filter({ hasText: 'Histogram' }).last().click()
        await page.waitForFunction(() => {
          const panelText = document.querySelector('[data-similarity-panel]')?.textContent || ''
          return panelText.includes('Color distribution') && panelText.includes('color distance')
        }, { timeout: 10_000 })
        await page.locator('button[aria-label="Similarity help"]').last().click()
        await page.waitForFunction(() => {
          const bodyText = document.body.textContent || ''
          return bodyText.includes('Histogram compares RGB') && bodyText.includes('Lower values are stricter')
        }, { timeout: 10_000 })
      },
      formSelector: '[data-similarity-panel]',
      menuItem: 'Find Similar Images - All Directories',
      stage: 'similarity modal',
    })

    await waitWithDiagnostics('context menu visible', async () => {
      await openTileContextMenu()
    })
    const editorStartedAt = Date.now()
    await page.getByRole('menuitem', { name: 'Edit Image' }).click()

    await waitWithDiagnostics('editor visible', async () => {
      await page.waitForSelector('.vim-image-editor-page', { timeout: 20_000 })
      await page.waitForSelector('.tui-image-editor-container', { timeout: 20_000 })
      await page.waitForSelector('.vim-editor-toolbar', { timeout: 20_000 })
      await page.waitForSelector('.tui-image-editor-menu .tie-btn-crop', { timeout: 20_000 })
      await page.waitForSelector('.tui-image-editor-menu .tie-btn-filter', { timeout: 20_000 })

      await page.waitForFunction(() => {
        const canvas = document.querySelector('.tui-image-editor-canvas-container canvas')
        return !!canvas && canvas.getBoundingClientRect().width > 0 && canvas.getBoundingClientRect().height > 0
      }, { timeout: 20_000 })
    })
    const editorOpenMs = Date.now() - editorStartedAt

    await page.waitForSelector('[data-editor-file-info] >> text=editor-smoke.png', { timeout: 10_000 })
    await page.waitForFunction(() => {
      const text = document.querySelector('[data-editor-file-info]')?.textContent || ''
      return text.includes('(-, -)')
    }, { timeout: 10_000 })
    const firstCanvasBox = await page.locator('.tui-image-editor-canvas-container canvas').first().boundingBox()
    if (!firstCanvasBox)
      throw new Error('Editor canvas has no bounding box for pixel overlay')
    await page.mouse.move(firstCanvasBox.x + firstCanvasBox.width / 2, firstCanvasBox.y + firstCanvasBox.height / 2)
    await page.waitForFunction(() => {
      const text = document.querySelector('[data-editor-file-info]')?.textContent || ''
      return /\(\d+,\s*\d+\)\s+/.test(text)
    }, { timeout: 10_000 })
    const fileInfoTextAfterHover = await page.locator('[data-editor-file-info]').textContent()

    // 缩放值现在是一个可编辑的 InputNumber（.vim-editor-zoom-input），读它的 input value。
    const readZoom = () => page.evaluate(() => {
      const input = document.querySelector('.vim-editor-zoom-input input')
      return input ? input.value : ''
    })
    const readCanvasW = () => page.evaluate(() => {
      const c = document.querySelector('.tui-image-editor-canvas-container .lower-canvas')
      return c ? Math.round(c.getBoundingClientRect().width) : 0
    })

    const beforeWheel = await readZoom()
    const canvasWBefore = await readCanvasW()
    await page.locator('.vim-image-editor-page').hover()
    await page.mouse.wheel(0, -400)
    await page.waitForFunction((before) => {
      const input = document.querySelector('.vim-editor-zoom-input input')
      return !!input && input.value !== before
    }, beforeWheel, { timeout: 10_000 })
    const afterWheel = await readZoom()
    if (afterWheel !== '125%')
      throw new Error(`Editor wheel zoom did not use the preview zoom ladder: ${beforeWheel} -> ${afterWheel}`)
    await page.getByTitle('Zoom In').click()
    await page.waitForFunction(() => document.querySelector('.vim-editor-zoom-input input')?.value === '150%', { timeout: 10_000 })
    await page.getByTitle('Zoom Out').click()
    await page.waitForFunction(() => document.querySelector('.vim-editor-zoom-input input')?.value === '125%', { timeout: 10_000 })
    await page.getByTitle('Reset Zoom').click()
    await page.waitForFunction(() => document.querySelector('.vim-editor-zoom-input input')?.value === '100%', { timeout: 10_000 })

    // CSS-zoom 模型验证：放大后画布元素本身（lower-canvas 的渲染尺寸）应真的变大，
    // 而不是停留在原尺寸（旧 fabric zoom 那种「固定窗口套放大图」的裁剪）。
    await page.getByTitle('Zoom In').click()
    await page.waitForFunction(() => document.querySelector('.vim-editor-zoom-input input')?.value === '125%', { timeout: 10_000 })
    const canvasWZoomed = await readCanvasW()
    if (!(canvasWZoomed > canvasWBefore * 1.1))
      throw new Error(`CSS zoom did not grow the canvas element: ${canvasWBefore} -> ${canvasWZoomed}`)
    await page.getByTitle('Reset Zoom').click()
    await page.waitForFunction(() => document.querySelector('.vim-editor-zoom-input input')?.value === '100%', { timeout: 10_000 })

    // 可以缩小到 100% 以下（CSS zoom 支持收缩）。
    const resetCanvasBox = await page.locator('.tui-image-editor-canvas-container .lower-canvas').boundingBox()
    if (resetCanvasBox)
      await page.mouse.move(resetCanvasBox.x + resetCanvasBox.width / 2, resetCanvasBox.y + resetCanvasBox.height / 2)
    await page.mouse.wheel(0, 400)
    await page.waitForFunction(() => {
      const v = document.querySelector('.vim-editor-zoom-input input')?.value || ''
      const n = Number(v.replace('%', ''))
      return Number.isFinite(n) && n < 100 && n > 0
    }, { timeout: 10_000 })
    await readZoom()
    await page.getByTitle('Reset Zoom').click()
    await page.waitForFunction(() => document.querySelector('.vim-editor-zoom-input input')?.value === '100%', { timeout: 10_000 })

    // 手动输入缩放值（单击不再重置为 100%，而是可编辑）。
    await page.locator('.vim-editor-zoom-input input').click()
    await page.locator('.vim-editor-zoom-input input').fill('300')
    await page.locator('.vim-editor-zoom-input input').press('Enter')
    await page.waitForFunction(() => document.querySelector('.vim-editor-zoom-input input')?.value === '300%', { timeout: 10_000 })

    // 缩放阶梯统一到 5000%。
    for (let i = 0; i < 25; i++) {
      const current = await readZoom()
      if (current === '5000%')
        break
      await page.getByTitle('Zoom In').click()
      await page.waitForTimeout(40)
    }
    const maxZoom = await readZoom()
    if (maxZoom !== '5000%')
      throw new Error(`Editor zoom ladder did not reach 5000%: ${maxZoom}`)
    await page.getByTitle('Reset Zoom').click()
    await page.waitForFunction(() => document.querySelector('.vim-editor-zoom-input input')?.value === '100%', { timeout: 10_000 })

    // 原生 TOAST help-menu 的「按钮」（旧 zoom/hand/history/undo/redo/delete）应不可见，
    // 它们已并入右上角自定义工具栏。help-menu 容器本身保留（零尺寸），
    // 因为 history 面板是它的子节点，由自定义「历史」按钮复用。
    const nativeHelpButtonsVisible = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.tui-image-editor-help-menu > .tui-image-editor-item'))
      return items.some((item) => {
        const rect = item.getBoundingClientRect()
        return rect.width > 2 && rect.height > 2
      })
    })
    if (nativeHelpButtonsVisible)
      throw new Error('Native TOAST help-menu buttons are still visible; they should be replaced by the custom toolbar')

    await page.getByTitle('Histogram').click()
    await page.waitForSelector('[data-editor-histogram-panel]', { timeout: 10_000 })
    const histogramCanvas = page.locator('[data-editor-histogram-panel] canvas.cursor-ew-resize').first()
    await histogramCanvas.waitFor({ timeout: 10_000 })
    const histogramBox = await histogramCanvas.boundingBox()
    if (!histogramBox)
      throw new Error('Histogram canvas has no bounding box')
    const editorCanvasContainer = page.locator('.tui-image-editor-canvas-container').first()
    const histogramImageBefore = await editorCanvasContainer.screenshot()
    await page.mouse.move(histogramBox.x + histogramBox.width - 2, histogramBox.y + histogramBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(histogramBox.x + histogramBox.width * 0.72, histogramBox.y + histogramBox.height / 2)
    await page.mouse.up()
    await page.waitForFunction(() => {
      const values = Array.from(document.querySelectorAll('[data-editor-histogram-panel] input')).map(input => Number(input.value))
      return values.length >= 2 && values[1] < 255
    }, { timeout: 10_000 })
    await page.waitForFunction(() => {
      const canvas = document.querySelector('.tui-image-editor-canvas-container .lower-canvas')
      const filter = canvas ? window.getComputedStyle(canvas).filter : ''
      return !!filter && filter !== 'none'
    }, { timeout: 10_000 })
    await page.waitForFunction((beforeBase64) => {
      const canvas = document.querySelector('.tui-image-editor-canvas-container .lower-canvas')
      if (!canvas)
        return false
      const filter = window.getComputedStyle(canvas).filter
      return !!beforeBase64 && !!filter && filter !== 'none'
    }, histogramImageBefore.toString('base64'), { timeout: 10_000 })
    const histogramImageAfter = await editorCanvasContainer.screenshot()
    if (histogramImageBefore.equals(histogramImageAfter)) {
      const histogramRenderDiagnostics = await page.evaluate(() => {
        const canvas = document.querySelector('.tui-image-editor-canvas-container .lower-canvas')
        const values = Array.from(document.querySelectorAll('[data-editor-histogram-panel] input')).map(input => Number(input.value))
        return {
          filter: canvas ? window.getComputedStyle(canvas).filter : '',
          histogramLogs: (window.__IM_EDITOR_SMOKE__?.logs || []).filter(item => item?.message?.includes('[editor]')).slice(-20),
          toolbarText: document.querySelector('.vim-editor-toolbar')?.textContent || '',
          values,
        }
      })
      throw new Error(`Histogram range changed controls but not rendered editor output: ${JSON.stringify(histogramRenderDiagnostics)}`)
    }
    // undo/redo 已并入右上角自定义工具栏，旧的 .tie-btn-undo / .tie-btn-redo 已随 help-menu 隐藏。
    await page.waitForFunction(() => {
      const btn = Array.from(document.querySelectorAll('.vim-editor-toolbar button')).find(el => el.getAttribute('title') === 'Undo')
      return !!btn && !btn.disabled
    }, { timeout: 10_000 })
    await page.locator('.vim-editor-toolbar').getByTitle('Undo').click()
    await page.waitForFunction(() => {
      const values = Array.from(document.querySelectorAll('[data-editor-histogram-panel] input')).map(input => Number(input.value))
      return values.length >= 2 && values[0] === 0 && values[1] === 255
    }, { timeout: 10_000 })
    await page.waitForFunction(() => {
      const btn = Array.from(document.querySelectorAll('.vim-editor-toolbar button')).find(el => el.getAttribute('title') === 'Redo')
      return !!btn && !btn.disabled
    }, { timeout: 10_000 })
    await page.locator('.vim-editor-toolbar').getByTitle('Redo').click()
    await page.waitForFunction(() => {
      const values = Array.from(document.querySelectorAll('[data-editor-histogram-panel] input')).map(input => Number(input.value))
      return values.length >= 2 && values[1] < 255
    }, { timeout: 10_000 })

    // 直方图面板应可拖动（pointer 拖动面板本体，而不是画布上的范围拖动）。
    const histogramPanel = page.locator('[data-editor-histogram-panel]').first()
    const histogramPanelBefore = await histogramPanel.boundingBox()
    if (!histogramPanelBefore)
      throw new Error('Histogram panel has no bounding box')
    await page.mouse.move(histogramPanelBefore.x + Math.min(80, histogramPanelBefore.width / 2), histogramPanelBefore.y + 12)
    await page.mouse.down()
    await page.mouse.move(histogramPanelBefore.x - 120, histogramPanelBefore.y - 90)
    await page.mouse.up()
    const histogramPanelAfter = await histogramPanel.boundingBox()
    if (!histogramPanelAfter || Math.abs(histogramPanelAfter.x - histogramPanelBefore.x) < 40 || Math.abs(histogramPanelAfter.y - histogramPanelBefore.y) < 40)
      throw new Error(`Histogram panel did not drag: ${JSON.stringify({ before: histogramPanelBefore, after: histogramPanelAfter })}`)

    const activatedToastMenus = []
    const editorTopBeforeSubmenu = await page.evaluate(() => Math.round(document.querySelector('.tui-image-editor')?.getBoundingClientRect().top || 0))
    for (const menuName of ['resize', 'crop', 'flip', 'rotate', 'draw', 'shape', 'icon', 'text', 'mask', 'filter']) {
      await page.locator(`.tui-image-editor-menu .tie-btn-${menuName}`).click()
      await page.waitForFunction((name) => {
        return document.querySelector('.tui-image-editor-main')?.classList.contains(`tui-image-editor-menu-${name}`)
      }, menuName, { timeout: 10_000 })
      const editorTopAfterSubmenu = await page.evaluate(() => Math.round(document.querySelector('.tui-image-editor')?.getBoundingClientRect().top || 0))
      if (Math.abs(editorTopAfterSubmenu - editorTopBeforeSubmenu) > 2)
        throw new Error(`Opening ${menuName} submenu moved the editor image: ${editorTopBeforeSubmenu} -> ${editorTopAfterSubmenu}`)
      if (menuName === 'crop') {
        await page.locator('.tie-crop-preset-button .tui-image-editor-button.preset-square svg').click()
        await page.waitForFunction(() => document.querySelector('.tui-image-editor-main')?.classList.contains('tui-image-editor-menu-crop'), { timeout: 10_000 })
      }
      if (menuName === 'flip') {
        await page.locator('.tie-flip-button .tui-image-editor-button.flipX svg').click()
        await page.waitForFunction(() => document.querySelector('.tui-image-editor-main')?.classList.contains('tui-image-editor-menu-flip'), { timeout: 10_000 })
        await page.locator('.tie-flip-button .tui-image-editor-button.resetFlip svg').click()
        await page.waitForFunction(() => document.querySelector('.tui-image-editor-main')?.classList.contains('tui-image-editor-menu-flip'), { timeout: 10_000 })
      }
      activatedToastMenus.push(menuName)
    }
    const submenuBeforeBlankClick = await page.evaluate(() => document.querySelector('.tui-image-editor-main')?.className || '')
    if (!submenuBeforeBlankClick.includes('tui-image-editor-menu-filter'))
      throw new Error(`Expected filter submenu to be active before blank click: ${submenuBeforeBlankClick}`)
    await page.mouse.click(24, 180)
    await page.waitForFunction(() => !/tui-image-editor-menu-/.test(document.querySelector('.tui-image-editor-main')?.className || ''), { timeout: 10_000 })

    const editorRectBeforePanel = await page.locator('.vim-image-editor-page').boundingBox()
    await page.getByTitle('Measure', { exact: true }).first().click()
    await page.waitForSelector('[data-editor-measure-panel] >> text=Measure', { timeout: 10_000 })
    await page.waitForSelector('[data-editor-measure-palette]', { timeout: 10_000 })
    const editorRectWithPanel = await page.locator('.vim-image-editor-page').boundingBox()
    if (!editorRectBeforePanel || !editorRectWithPanel
      || Math.round(editorRectBeforePanel.width) !== Math.round(editorRectWithPanel.width)
      || Math.round(editorRectBeforePanel.height) !== Math.round(editorRectWithPanel.height)) {
      throw new Error(`Measurement panel changed editor layout: ${JSON.stringify({ before: editorRectBeforePanel, after: editorRectWithPanel })}`)
    }
    const palette = page.locator('[data-editor-measure-palette]').first()
    const paletteBefore = await palette.boundingBox()
    if (!paletteBefore)
      throw new Error('Measure palette has no bounding box')
    const paletteHandle = page.locator('[data-editor-measure-palette-handle]').first()
    const handleBox = await paletteHandle.boundingBox()
    if (!handleBox)
      throw new Error('Measure palette drag handle has no bounding box')
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(paletteBefore.x - 80, paletteBefore.y + 45)
    await page.mouse.up()
    const paletteAfter = await palette.boundingBox()
    if (!paletteAfter || Math.abs(paletteAfter.x - paletteBefore.x) < 20 || Math.abs(paletteAfter.y - paletteBefore.y) < 20)
      throw new Error(`Measure palette did not drag: ${JSON.stringify({ before: paletteBefore, after: paletteAfter })}`)
    await page.locator('[data-editor-measure-palette]').getByTitle('Polygon').click()
    await page.waitForFunction(() => document.querySelector('[data-editor-measure-palette]')?.textContent?.includes('Polygon'), { timeout: 10_000 })
    const canvasBoxForMeasure = await page.locator('.tui-image-editor-canvas-container canvas').first().boundingBox()
    if (!canvasBoxForMeasure)
      throw new Error('Editor canvas has no bounding box for polygon measurement')
    const polygonPoints = [
      [canvasBoxForMeasure.x + canvasBoxForMeasure.width * 0.25, canvasBoxForMeasure.y + canvasBoxForMeasure.height * 0.25],
      [canvasBoxForMeasure.x + canvasBoxForMeasure.width * 0.72, canvasBoxForMeasure.y + canvasBoxForMeasure.height * 0.25],
      [canvasBoxForMeasure.x + canvasBoxForMeasure.width * 0.72, canvasBoxForMeasure.y + canvasBoxForMeasure.height * 0.72],
      [canvasBoxForMeasure.x + canvasBoxForMeasure.width * 0.25, canvasBoxForMeasure.y + canvasBoxForMeasure.height * 0.72],
    ]
    for (const [x, y] of polygonPoints) {
      await page.mouse.click(x, y)
      await page.waitForTimeout(50)
    }
    await page.waitForFunction(() => {
      const panelText = document.querySelector('[data-editor-measure-panel]')?.textContent || ''
      return /polygon/i.test(panelText) && panelText.includes('Add point: 4')
    }, { timeout: 10_000 })
    await page.waitForFunction(() => !!document.querySelector('svg polygon'), { timeout: 10_000 })
    await page.locator('[data-editor-measure-palette]').getByText('Confirm').click()
    await page.waitForSelector('[data-editor-measure-palette]', { timeout: 10_000 })
    await page.locator('svg circle').first().click()
    await page.waitForFunction(() => document.querySelector('svg circle')?.getAttribute('fill') === '#faad14', { timeout: 10_000 })
    const nodeBeforeNudge = await page.evaluate(() => {
      const node = document.querySelector('svg circle')
      return node ? { fill: node.getAttribute('fill'), x: Number(node.getAttribute('cx')), y: Number(node.getAttribute('cy')) } : null
    })
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowDown')
    const nodeAfterNudge = await page.evaluate(() => {
      const node = document.querySelector('svg circle')
      return node ? { fill: node.getAttribute('fill'), x: Number(node.getAttribute('cx')), y: Number(node.getAttribute('cy')) } : null
    })
    if (!nodeBeforeNudge || !nodeAfterNudge || nodeBeforeNudge.fill !== '#faad14' || nodeAfterNudge.x <= nodeBeforeNudge.x || nodeAfterNudge.y <= nodeBeforeNudge.y)
      throw new Error(`Measurement node edit did not select and nudge the clicked node: ${JSON.stringify({ before: nodeBeforeNudge, after: nodeAfterNudge })}`)
    const measurementStyleState = await page.evaluate(() => {
      const panel = document.querySelector('[data-editor-measure-panel]')
      const radii = Array.from(document.querySelectorAll('[data-editor-overlay] svg circle')).map(node => Number(node.getAttribute('r') || 0))
      return {
        maxNodeRadius: radii.length ? Math.max(...radii) : 0,
        sliderCount: panel ? panel.querySelectorAll('.ant-slider').length : 0,
      }
    })
    if (measurementStyleState.sliderCount < 3 || measurementStyleState.maxNodeRadius > 4.5)
      throw new Error(`Measurement style controls/default node size are not active: ${JSON.stringify(measurementStyleState)}`)
    await page.getByTitle('Create angle from edges').first().click()
    await page.waitForFunction(() => {
      const panelText = document.querySelector('[data-editor-measure-panel]')?.textContent || ''
      return /angle/i.test(panelText) && /Angle:\s*\d/.test(panelText)
    }, { timeout: 10_000 })
    await page.waitForFunction(() => Array.from(document.querySelectorAll('svg text')).some(node => node.textContent?.includes('°')), { timeout: 10_000 })
    await page.getByTitle('Measurements').click()
    await page.locator('[data-editor-measure-panel]').waitFor({ state: 'detached', timeout: 10_000 })
    await page.getByTitle('Measurements').click()
    await page.waitForSelector('[data-editor-measure-panel] >> text=Measure', { timeout: 10_000 })
    await page.waitForSelector('[data-editor-measure-palette]', { timeout: 10_000 })
    const selectedMeasureSegmentsAfterPanelReopen = await page.locator('[data-editor-measure-palette] .ant-segmented-item-selected').count()
    if (selectedMeasureSegmentsAfterPanelReopen !== 0)
      throw new Error(`Measure palette should not select a drawing mode just by being shown: ${selectedMeasureSegmentsAfterPanelReopen}`)
    await page.mouse.click(24, 180)
    await page.waitForSelector('[data-editor-measure-palette]', { timeout: 10_000 })
    await page.getByTitle('Hide measurement toolbar').click()
    await page.locator('[data-editor-measure-palette]').waitFor({ state: 'detached', timeout: 10_000 })
    await page.getByTitle('Show measurement toolbar').click()
    await page.waitForSelector('[data-editor-measure-palette]', { timeout: 10_000 })
    const selectedMeasureSegmentsAfterManualShow = await page.locator('[data-editor-measure-palette] .ant-segmented-item-selected').count()
    if (selectedMeasureSegmentsAfterManualShow !== 0)
      throw new Error(`Measure palette should be mode-neutral after manual show: ${selectedMeasureSegmentsAfterManualShow}`)

    await page.locator('[data-editor-measure-palette]').getByTitle('Line').click()
    await page.waitForSelector('[data-editor-measurement-item][data-measurement-kind="line"][data-measurement-points="0"][data-measurement-active="true"]', { timeout: 10_000 })
    const lineMeasurementId = await page.locator('[data-editor-measurement-item][data-measurement-kind="line"][data-measurement-points="0"][data-measurement-active="true"]').first().getAttribute('data-measurement-id')
    if (!lineMeasurementId)
      throw new Error('Could not find newly created line measurement')
    const oldMeasureNode = page.locator(`[data-measurement-node]:not([data-measurement-id="${lineMeasurementId}"])`).first()
    const oldMeasureNodeBox = await oldMeasureNode.boundingBox()
    if (!oldMeasureNodeBox)
      throw new Error('Existing measurement node was not visible for add-point interception test')
    await page.mouse.click(oldMeasureNodeBox.x + oldMeasureNodeBox.width / 2, oldMeasureNodeBox.y + oldMeasureNodeBox.height / 2)
    await page.waitForSelector(`[data-editor-measurement-item][data-measurement-id="${lineMeasurementId}"][data-measurement-points="1"][data-measurement-active="true"]`, { timeout: 10_000 })
    await page.locator(`[data-editor-measurement-item][data-measurement-id="${lineMeasurementId}"]`).getByTitle('Delete').click()
    await page.locator(`[data-editor-measurement-item][data-measurement-id="${lineMeasurementId}"]`).waitFor({ state: 'detached', timeout: 10_000 })
    await page.waitForFunction(measurementId => !document.querySelector(`[data-editor-overlay] [data-measurement-id="${measurementId}"]`), lineMeasurementId, { timeout: 10_000 })

    // 高倍放大触发像素网格（图像小，需要很大的 zoom 才能看清网格与数值）。
    await page.locator('.vim-editor-zoom-input input').click()
    await page.locator('.vim-editor-zoom-input input').fill('3200')
    await page.locator('.vim-editor-zoom-input input').press('Enter')
    await page.waitForFunction(() => document.querySelector('.vim-editor-zoom-input input')?.value === '3200%', { timeout: 10_000 })
    await page.waitForSelector('[data-editor-pixel-grid]', { timeout: 10_000 })
    await page.waitForFunction(() => {
      const canvas = document.querySelector('[data-editor-pixel-grid]')
      return !!canvas && canvas.width > 0 && canvas.height > 0
    }, { timeout: 10_000 })
    try {
      await page.waitForFunction(() => {
        const canvas = document.querySelector('[data-editor-pixel-grid]')
        const ctx = canvas?.getContext('2d')
        if (!canvas || !ctx)
          return false
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
        let nonZeroAlpha = 0
        for (let i = 3; i < data.length; i += 4) {
          if (data[i] > 0)
            nonZeroAlpha++
        }
        return nonZeroAlpha >= 400
      }, { timeout: 10_000 })
    }
    catch (error) {
      const gridDiagnostics = await page.evaluate(() => {
        const canvas = document.querySelector('[data-editor-pixel-grid]')
        const editorCanvas = document.querySelector('.tui-image-editor-canvas-container canvas')
        const gridRect = canvas?.getBoundingClientRect()
        const editorRect = editorCanvas?.getBoundingClientRect()
        const ctx = canvas?.getContext('2d')
        let nonZeroAlpha = 0
        if (canvas && ctx) {
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
          for (let i = 3; i < data.length; i += 4) {
            if (data[i] > 0)
              nonZeroAlpha++
          }
        }
        return {
          canvas: canvas
            ? {
                height: canvas.height,
                rect: gridRect ? { height: gridRect.height, left: gridRect.left, top: gridRect.top, width: gridRect.width } : null,
                width: canvas.width,
              }
            : null,
          editorCanvas: editorCanvas
            ? {
                rect: editorRect ? { height: editorRect.height, left: editorRect.left, top: editorRect.top, width: editorRect.width } : null,
              }
            : null,
          nonZeroAlpha,
          smokeLogs: window.__IM_EDITOR_SMOKE__?.logs?.filter(item => item?.message?.includes('[editor]')).slice(-20),
          toolbarText: document.querySelector('.vim-editor-toolbar')?.textContent,
        }
      })
      throw new Error(`Pixel grid did not draw visible content: ${JSON.stringify(gridDiagnostics)}`)
    }
    const gridStats = await page.evaluate(() => {
      const canvas = document.querySelector('[data-editor-pixel-grid]')
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx)
        return { nonZeroAlpha: 0 }
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      let nonZeroAlpha = 0
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] > 0)
          nonZeroAlpha++
      }
      return { nonZeroAlpha }
    })
    if (gridStats.nonZeroAlpha < 400)
      throw new Error(`Pixel grid did not draw enough visible grid/value pixels: ${JSON.stringify(gridStats)}`)

    // 手型平移：放大后用手型拖动滚动 wrap（CSS-zoom 模型下，平移=改 scrollLeft/Top）。
    // 此时处于高倍缩放（像素网格测试后 = 3200%），wrap 必定可滚动。
    await page.locator('.vim-editor-toolbar').getByTitle('Pan').click()
    await page.waitForFunction(() => {
      const btn = Array.from(document.querySelectorAll('.vim-editor-toolbar button')).find(el => el.getAttribute('title') === 'Pan')
      return !!btn && btn.classList.contains('ant-btn-primary')
    }, { timeout: 10_000 })
    const wrapState = await page.evaluate(() => {
      const w = document.querySelector('.tui-image-editor-wrap')
      return w ? { scrollable: w.scrollWidth > w.clientWidth + 1 || w.scrollHeight > w.clientHeight + 1, scrollLeft: w.scrollLeft, scrollTop: w.scrollTop } : null
    })
    // 在视口中心区域拖动（不要用画布 bounding box——高倍缩放时画布大半在视口外）。
    const paneBox = await page.locator('.vim-image-editor-page').boundingBox()
    if (paneBox) {
      const cx = paneBox.x + paneBox.width / 2
      const cy = paneBox.y + paneBox.height / 2
      await page.mouse.move(cx, cy)
      await page.mouse.down()
      await page.mouse.move(cx - 220, cy - 160, { steps: 8 })
      await page.mouse.up()
    }
    await page.waitForTimeout(150)
    if (wrapState?.scrollable) {
      const after = await page.evaluate(() => {
        const w = document.querySelector('.tui-image-editor-wrap')
        return w ? { scrollLeft: w.scrollLeft, scrollTop: w.scrollTop } : null
      })
      if (!after || (Math.abs(after.scrollLeft - wrapState.scrollLeft) < 2 && Math.abs(after.scrollTop - wrapState.scrollTop) < 2))
        throw new Error(`Hand/pan mode did not scroll the zoomed viewport: ${JSON.stringify({ before: wrapState, after })}`)
    }
    // 关掉 hand 模式，避免影响后续交互。
    await page.locator('.vim-editor-toolbar').getByTitle('Pan').click()

    // 历史面板：自定义「历史」按钮应能弹出原生 history 面板（复用其记录）。
    await page.locator('.vim-editor-toolbar').getByTitle('History').click()
    await page.waitForFunction(() => {
      const panel = document.querySelector('.tui-image-editor-help-menu .tie-panel-history')
      if (!panel)
        return false
      const rect = panel.getBoundingClientRect()
      return window.getComputedStyle(panel).display !== 'none' && rect.width > 0 && rect.height > 0
    }, { timeout: 10_000 })
    const historyItemCount = await page.evaluate(() => document.querySelectorAll('.tie-panel-history .history-list .history-item').length)
    if (historyItemCount < 1)
      throw new Error(`History panel opened but shows no history items: ${historyItemCount}`)
    const historyGeometry = await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll('.vim-editor-toolbar button')).find(el => el.getAttribute('title') === 'History')
      const panel = document.querySelector('.tui-image-editor-help-menu .tie-panel-history')
      const buttonRect = button?.getBoundingClientRect()
      const panelRect = panel?.getBoundingClientRect()
      return buttonRect && panelRect
        ? {
            buttonBottom: Math.round(buttonRect.bottom),
            buttonLeft: Math.round(buttonRect.left),
            panelLeft: Math.round(panelRect.left),
            panelTop: Math.round(panelRect.top),
          }
        : null
    })
    if (!historyGeometry || historyGeometry.panelTop < historyGeometry.buttonBottom || Math.abs(historyGeometry.panelLeft - historyGeometry.buttonLeft) > 24)
      throw new Error(`History panel is not anchored below the History button: ${JSON.stringify(historyGeometry)}`)
    await page.locator('.vim-editor-toolbar').getByTitle('History').click()

    await page.locator('.vim-editor-toolbar').getByTitle('Save').click()
    await page.waitForFunction(() => (window.__IM_EDITOR_SMOKE__?.saved || []).length > 0, { timeout: 10_000 })

    const result = await page.evaluate(() => {
      const rect = document.querySelector('.vim-image-editor-page')?.getBoundingClientRect()
      const download = document.querySelector('.tui-image-editor-download-btn')
      return {
        bodyText: document.body.textContent.slice(0, 1000),
        canvasCount: document.querySelectorAll('.tui-image-editor-canvas-container canvas').length,
        deleteHidden: Array.from(document.querySelectorAll('.tie-btn-delete, .tie-btn-deleteAll')).every(el => el.hasAttribute('hidden')),
        downloadHidden: !download || window.getComputedStyle(download).display === 'none' || download.hasAttribute('hidden'),
        editorRect: rect
          ? {
              height: Math.round(rect.height),
              width: Math.round(rect.width),
            }
          : null,
        hasHeaderLogo: !!document.querySelector('.tui-image-editor-header-logo:not([hidden]), .tui-image-editor-controls-logo:not([hidden])'),
        hasFileInfo: !!document.querySelector('[data-editor-file-info]'),
        fileInfoText: document.querySelector('[data-editor-file-info]')?.textContent || '',
        measurePanelRect: document.querySelector('[data-editor-measure-panel]')
          ? {
              bottom: Math.round(document.querySelector('[data-editor-measure-panel]').getBoundingClientRect().bottom),
              height: Math.round(document.querySelector('[data-editor-measure-panel]').getBoundingClientRect().height),
              right: Math.round(document.querySelector('[data-editor-measure-panel]').getBoundingClientRect().right),
              top: Math.round(document.querySelector('[data-editor-measure-panel]').getBoundingClientRect().top),
              width: Math.round(document.querySelector('[data-editor-measure-panel]').getBoundingClientRect().width),
            }
          : null,
        pixelGrid: document.querySelector('[data-editor-pixel-grid]')
          ? {
              height: document.querySelector('[data-editor-pixel-grid]').height,
              width: document.querySelector('[data-editor-pixel-grid]').width,
            }
          : null,
        hasToolbar: !!document.querySelector('.vim-editor-toolbar'),
        menuItems: Array.from(document.querySelectorAll('.tui-image-editor-menu > li')).map(el => Array.from(el.classList).find(cls => cls.startsWith('tie-btn-'))),
        toolbarTitles: Array.from(document.querySelectorAll('.vim-editor-toolbar button')).map(el => el.getAttribute('title')),
        smoke: window.__IM_EDITOR_SMOKE__,
        toolbarText: document.querySelector('.vim-editor-toolbar')?.textContent,
      }
    })

    console.log(JSON.stringify({
      afterWheel,
      beforeWheel,
      compressOpenMs,
      convertOpenMs,
      similarityOpenMs,
      editorOpenMs,
      historyGeometry,
      previewTransformAfterWheel,
      previewAnchorBeforeOversizedWheel,
      previewOverflowState,
      previewAnchorSettled,
      previewTransformBeforeWheel,
      previewMenuState,
      result,
      activatedToastMenus,
      gridStats,
      fileInfoTextAfterHover,
      timeline: timeline.filter(item => item.type === 'error' || item.type === 'pageerror'),
    }, null, 2))

    if (!result.editorRect || result.editorRect.width < 1300 || result.editorRect.height < 900)
      throw new Error(`Editor is not full-screen enough: ${JSON.stringify(result.editorRect)}`)
    if (result.hasHeaderLogo)
      throw new Error('TOAST UI logo/header is still visible')
    if (!result.deleteHidden)
      throw new Error('TOAST UI delete controls are not hidden')
    if (!result.hasToolbar)
      throw new Error('Custom editor toolbar was not injected')
    if (!result.hasFileInfo)
      throw new Error('Editor file/pixel info overlay was not rendered')
    if (!fileInfoTextAfterHover?.includes('editor-smoke.png') || !/\(\d+,\s*\d+\)\s+/.test(fileInfoTextAfterHover))
      throw new Error(`Editor file/pixel overlay did not show expected content: ${fileInfoTextAfterHover}`)
    const layoutRects = await page.evaluate(() => {
      const panel = document.querySelector('[data-editor-measure-panel]')?.getBoundingClientRect()
      const toolbar = document.querySelector('.vim-editor-toolbar-inner')?.getBoundingClientRect()
      const controls = document.querySelector('.tui-image-editor-controls')?.getBoundingClientRect()
      return panel && toolbar && controls
        ? {
            controlsTop: Math.round(controls.top),
            panelBottom: Math.round(panel.bottom),
            panelTop: Math.round(panel.top),
            toolbarBottom: Math.round(toolbar.bottom),
          }
        : null
    })
    if (!result.measurePanelRect || !layoutRects || layoutRects.panelTop <= layoutRects.toolbarBottom || layoutRects.panelBottom >= layoutRects.controlsTop)
      throw new Error(`Measurement panel does not avoid editor toolbars: ${JSON.stringify({ layoutRects, measurePanelRect: result.measurePanelRect })}`)
    if (!result.pixelGrid || result.pixelGrid.width <= 0 || result.pixelGrid.height <= 0)
      throw new Error(`Pixel grid overlay was not rendered at high zoom: ${JSON.stringify(result.pixelGrid)}`)
    if (!result.downloadHidden)
      throw new Error('Native TOAST UI download button is still visible')
    const requiredToolbarTitles = ['Undo', 'Redo', 'Reset', 'History', 'Zoom Out', 'Reset Zoom', 'Zoom In', 'Pan', 'Measure', 'Measurements', 'Histogram', 'Save', 'Close']
    const missingToolbarTitles = requiredToolbarTitles.filter(title => !result.toolbarTitles.includes(title))
    if (missingToolbarTitles.length)
      throw new Error(`Editor toolbar is missing expected titled actions: missing=${JSON.stringify(missingToolbarTitles)} got=${JSON.stringify(result.toolbarTitles)}`)
    if (!beforeWheel || !afterWheel || beforeWheel === afterWheel)
      throw new Error(`Wheel zoom did not change toolbar zoom text: ${beforeWheel} -> ${afterWheel}`)
    if (compressOpenMs > 12_000)
      throw new Error(`Compress modal took too long to open: ${compressOpenMs}ms`)
    if (convertOpenMs > 12_000)
      throw new Error(`Convert modal took too long to open: ${convertOpenMs}ms`)
    if (similarityOpenMs > 12_000)
      throw new Error(`Similarity modal took too long to open: ${similarityOpenMs}ms`)
    if (editorOpenMs > 12_000)
      throw new Error(`Editor took too long to open on first click: ${editorOpenMs}ms`)
    if (!(result.smoke?.logs || []).some(item => item?.message === '[editor] histogram range applied'))
      throw new Error('Histogram range did not apply to the editor image')
    const histogramRequests = (result.smoke?.messages || []).filter(item => item?.cmd === 'get_image_histogram')
    const lastHistogramRequest = histogramRequests.at(-1)
    if (!lastHistogramRequest || lastHistogramRequest.data?.filePath !== `${cwd}/editor-smoke.png`)
      throw new Error(`Histogram did not stay anchored to the original image path: ${JSON.stringify(histogramRequests)}`)
    const saved = result.smoke?.saved?.at(-1)
    if (!saved || saved.prompt !== true || saved.suffix !== '.download' || saved.image?.path !== `${cwd}/editor-smoke.png`)
      throw new Error(`Save did not request a prompted image-derived save: ${JSON.stringify(saved)}`)
    for (const required of ['tie-btn-resize', 'tie-btn-crop', 'tie-btn-flip', 'tie-btn-rotate', 'tie-btn-draw', 'tie-btn-shape', 'tie-btn-icon', 'tie-btn-text', 'tie-btn-mask', 'tie-btn-filter']) {
      if (!result.menuItems.includes(required))
        throw new Error(`Missing TOAST UI menu item: ${required}`)
    }
    for (const required of ['resize', 'crop', 'flip', 'rotate', 'draw', 'shape', 'icon', 'text', 'mask', 'filter']) {
      if (!activatedToastMenus.includes(required))
        throw new Error(`TOAST UI menu did not activate: ${required}`)
    }
  }
  finally {
    await browser?.close()
    await server.stop()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
