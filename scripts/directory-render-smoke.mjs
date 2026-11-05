import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const preferredPort = Number(process.env.IM_RENDER_SMOKE_PORT || 4553)
const cwd = normalizeSmokePath(process.env.IM_RENDER_SMOKE_CWD || path.join(os.tmpdir(), 'image-manager-render-smoke'))
const workspaceFolder = process.env.IM_RENDER_SMOKE_WORKSPACE || 'image-manager-render-smoke'
const thumbnailDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg=='
const unknownImageCount = 6
const metadataDelayMs = 1500
const thumbnailDelayMs = 1500
const fullImageUrls = Array.from({ length: unknownImageCount }, (_, index) => makeFullImageDataUrl(index))

function normalizeSmokePath(value) {
  return value.replace(/\\/g, '/')
}

function makeFullImageDataUrl(index) {
  const colors = ['#d946ef', '#22c55e', '#3b82f6', '#f97316', '#eab308', '#14b8a6']
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="${colors[index % colors.length]}"/></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
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
  const waitForReady = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for Vite dev server')), 30_000)
    const onData = (chunk) => {
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
    waitForReady,
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

async function main() {
  if (!await isPortFree(preferredPort)) {
    throw new Error(`Port ${preferredPort} is already in use. Set IM_RENDER_SMOKE_PORT to a free port.`)
  }
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
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    const timeline = []

    page.on('console', (msg) => {
      const text = msg.text()
      timeline.push({ type: msg.type(), text })
    })
    page.on('pageerror', (err) => {
      timeline.push({ type: 'pageerror', text: err.stack || err.message })
    })

    await page.route('https://marketplace.visualstudio.com/**', route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ results: [{ extensions: [{ publisher: { publisherName: 'test' }, versions: [{ version: '0.0.0' }] }] }] }),
    }))

    await page.addInitScript(({ cwd, fullImageUrls, metadataDelayMs, thumbnailDataUrl, thumbnailDelayMs, unknownImageCount, workspaceFolder }) => {
      const startedAt = performance.now()
      const logs = []
      const unknownSizeImages = Array.from({ length: unknownImageCount }, (_, index) => {
        const basename = `unknown-size-${index}.png`
        return {
          absDirPath: cwd,
          absPath: `${cwd}/${basename}`,
          absWorkspaceFolder: cwd,
          basename,
          dirPath: '',
          extname: 'png',
          filename: `unknown-size-${index}`,
          info: {
            compressed: 0,
            metadata: {},
          },
          key: `${cwd}/${basename}`,
          name: basename,
          path: `${cwd}/${basename}`,
          relativePath: `./${basename}`,
          root: cwd,
          stats: { birthtimeMs: 1, ctimeMs: 1, mtimeMs: 1, size: 0 },
          visible: { compressed: true, exclude_types: true, git_staged: true, size: true },
          vscodePath: fullImageUrls[index],
          workspaceFolder,
        }
      })
      window.__IM_RENDER_SMOKE__ = {
        logs,
        metadataCallbacksCompleted: 0,
        messages: [],
        thumbnailCallbacksCompleted: 0,
        thumbnailRequestsBeforeMetadata: [],
      }
      window.acquireVsCodeApi = () => ({
        getState: () => undefined,
        setState: value => value,
        postMessage: (message) => {
          window.__IM_RENDER_SMOKE__.messages.push({
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
                    scan: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'tiff', 'tif', 'svg', 'bmp'],
                    trashAfterProcessing: false,
                  },
                  similarity: { precision: 14 },
                  viewer: {
                    imageBackgroundColor: '#1a1a1a',
                    imageRendering: 'auto',
                    imageWidth: 100,
                    showDetailsOnHover: true,
                    warningSize: 0,
                  },
                },
                vscode: { language: 'en', reduceMotion: 'off', theme: 'dark' },
              },
              windowState: {
                __reveal_image_path__: undefined,
                __sharp_installed__: false,
              },
              workspaceState: {
                display_group: ['dir'],
                display_sort: ['name', 'asc'],
                display_style: 'compact',
                hide_known_empty_dirs: true,
                image_filter: {
                  compressed: 0,
                  exclude_types: [],
                  size: { max: null, min: null, unit: 'KB' },
                },
                preview_scale: 1,
                recent_image_backgroundColors: [],
                recent_primary_colors: [],
                show_cut_tip: false,
                show_precision_tip: false,
                show_undo_redo_tip: false,
              },
            })
            return
          }

          if (message.cmd === 'get_all_images_from_cwds') {
            setTimeout(() => {
              update({
                absWorkspaceFolder: cwd,
                id: 'full-root',
                payloads: [
                  {
                    origin: 'dir',
                    data: {
                      type: 'create',
                      payload: {
                        absDirPath: cwd,
                        absWorkspaceFolder: cwd,
                        canLoadChildren: true,
                        childrenLoaded: false,
                        dirPath: '',
                        directFolderCount: undefined,
                        directImageCount: undefined,
                        imagesLoaded: false,
                        loadingChildren: false,
                        workspaceFolder,
                      },
                    },
                  },
                ],
                traceId: 'full-root',
                updateType: 'full',
                workspaceFolder,
              })
              callback(true)
            }, 40)
            return
          }

          if (message.cmd === 'get_directory_children') {
            const dirPath = message.data?.dirPath || cwd
            setTimeout(() => {
              update({
                absWorkspaceFolder: cwd,
                id: `patch-${Date.now()}`,
                payloads: [
                  {
                    origin: 'dir',
                    data: {
                      type: 'update',
                      payload: {
                        absDirPath: dirPath,
                        absWorkspaceFolder: cwd,
                        canLoadChildren: true,
                        canLoadMoreImages: false,
                        childrenLoaded: true,
                        dirPath: dirPath === cwd ? '' : dirPath.slice(cwd.length + 1),
                        directFolderCount: 3,
                        directImageCount: dirPath === cwd ? unknownSizeImages.length : 0,
                        imagesLoaded: true,
                        loadedImageCount: dirPath === cwd ? unknownSizeImages.length : 0,
                        loadingChildren: false,
                        workspaceFolder,
                      },
                    },
                  },
                  ...(dirPath === cwd
                    ? unknownSizeImages.map(image => ({
                        origin: 'image',
                        data: {
                          type: 'create',
                          payload: image,
                        },
                      }))
                    : []),
                  {
                    origin: 'dir',
                    data: {
                      type: 'create',
                      payload: {
                        absDirPath: `${cwd}/results`,
                        absWorkspaceFolder: cwd,
                        canLoadChildren: true,
                        childrenLoaded: false,
                        dirPath: 'results',
                        loadingChildren: false,
                        workspaceFolder,
                      },
                    },
                  },
                  {
                    origin: 'dir',
                    data: {
                      type: 'create',
                      payload: {
                        absDirPath: `${cwd}/experiments`,
                        absWorkspaceFolder: cwd,
                        canLoadChildren: true,
                        childrenLoaded: false,
                        dirPath: 'experiments',
                        loadingChildren: false,
                        workspaceFolder,
                      },
                    },
                  },
                  {
                    origin: 'dir',
                    data: {
                      type: 'create',
                      payload: {
                        absDirPath: `${cwd}/datasets`,
                        absWorkspaceFolder: cwd,
                        canLoadChildren: true,
                        childrenLoaded: false,
                        dirPath: 'datasets',
                        loadingChildren: false,
                        workspaceFolder,
                      },
                    },
                  },
                ],
                traceId: message.traceId,
                updateType: 'patch',
                workspaceFolder,
              })
              callback({
                canLoadMoreImages: false,
                childrenLoaded: true,
                count: dirPath === cwd ? 4 + unknownSizeImages.length : 4,
                directFolderCount: 3,
                directImageCount: dirPath === cwd ? unknownSizeImages.length : 0,
                imagesLoaded: true,
                loadedImageCount: dirPath === cwd ? unknownSizeImages.length : 0,
                ok: true,
                timeout: false,
              })
            }, 80)
            return
          }

          if (message.cmd === 'get_images_metadata') {
            setTimeout(() => {
              window.__IM_RENDER_SMOKE__.metadataCallbacksCompleted += 1
              callback((message.data?.images || []).map(filePath => ({
                compressed: 0,
                filePath,
                metadata: { channels: 4, height: 256, width: 256 },
                stats: { mtimeMs: 1, size: 1024 * 1024 },
              })))
            }, metadataDelayMs)
            return
          }

          if (message.cmd === 'get_thumbnails') {
            if (window.__IM_RENDER_SMOKE__.metadataCallbacksCompleted === 0) {
              window.__IM_RENDER_SMOKE__.thumbnailRequestsBeforeMetadata.push(message.data?.images || [])
            }
            setTimeout(() => {
              window.__IM_RENDER_SMOKE__.thumbnailCallbacksCompleted += 1
              callback((message.data?.images || []).map(filePath => ({ filePath, thumbPath: thumbnailDataUrl })))
            }, thumbnailDelayMs)
            return
          }

          if (message.callbackId) {
            callback(true)
          }
        },
      })
    }, { cwd, fullImageUrls, metadataDelayMs, thumbnailDataUrl, thumbnailDelayMs, unknownImageCount, workspaceFolder })

    await page.goto(server.url, { waitUntil: 'domcontentloaded' })
    try {
      await page.waitForSelector(`text=${workspaceFolder}`, { timeout: 20_000 })
    }
    catch (err) {
      const diagnostics = await page.evaluate(() => ({
        bodyText: document.body.textContent.slice(0, 2000),
        html: document.body.innerHTML.slice(0, 2000),
        smoke: window.__IM_RENDER_SMOKE__,
      })).catch(error => ({ evaluateError: String(error) }))
      console.error(JSON.stringify({ diagnostics, timeline }, null, 2))
      throw err
    }
    await page.getByText(workspaceFolder, { exact: true }).click()
    await page.waitForSelector('text=results', { timeout: 10_000 })
    await page.waitForSelector('text=experiments', { timeout: 10_000 })
    await page.waitForSelector('text=unknown-size-0.png', { timeout: 10_000 })
    await page.waitForSelector(`text=unknown-size-${unknownImageCount - 1}.png`, { timeout: 10_000 })
    try {
      await page.waitForFunction(
        ({ expectedCount, sources }) => {
          const imageSources = Array.from(document.querySelectorAll('img')).map(img => img.getAttribute('src') || '')
          return sources.filter(src => imageSources.includes(src)).length >= expectedCount
        },
        { expectedCount: unknownImageCount, sources: fullImageUrls },
        { timeout: 10_000 },
      )
    }
    catch (err) {
      const diagnostics = await page.evaluate(() => ({
        imageSources: Array.from(document.querySelectorAll('img')).map(img => img.getAttribute('src') || ''),
        smoke: window.__IM_RENDER_SMOKE__,
      })).catch(error => ({ evaluateError: String(error) }))
      console.error(JSON.stringify({ diagnostics }, null, 2))
      throw err
    }
    const preThumbnailData = await page.evaluate(() => ({
      imageSources: Array.from(document.querySelectorAll('img')).map(img => img.getAttribute('src') || ''),
      smoke: {
        metadataCallbacksCompleted: window.__IM_RENDER_SMOKE__.metadataCallbacksCompleted,
        thumbnailCallbacksCompleted: window.__IM_RENDER_SMOKE__.thumbnailCallbacksCompleted,
        thumbnailRequestsBeforeMetadata: window.__IM_RENDER_SMOKE__.thumbnailRequestsBeforeMetadata,
      },
    }))
    if (preThumbnailData.smoke.thumbnailCallbacksCompleted !== 0) {
      throw new Error(`Unknown-size images waited for thumbnail completion before rendering: ${JSON.stringify(preThumbnailData)}`)
    }
    if (preThumbnailData.smoke.thumbnailRequestsBeforeMetadata.length) {
      throw new Error(`Unknown-size images requested thumbnails before metadata proved they were large: ${JSON.stringify(preThumbnailData.smoke.thumbnailRequestsBeforeMetadata)}`)
    }
    await page.waitForFunction(() => window.__IM_RENDER_SMOKE__.messages.some(message => message.cmd === 'get_thumbnails'), { timeout: 10_000 })
    await page.waitForFunction(
      ({ thumbSrc, expectedCount }) => Array.from(document.querySelectorAll('img')).filter(img => img.getAttribute('src') === thumbSrc).length >= expectedCount,
      { expectedCount: unknownImageCount, thumbSrc: thumbnailDataUrl },
      { timeout: 10_000 },
    )
    const imageSources = await page.evaluate(() => Array.from(document.querySelectorAll('img')).map(img => img.getAttribute('src') || ''))
    const thumbnailSourceCount = imageSources.filter(src => src === thumbnailDataUrl).length
    if (thumbnailSourceCount < unknownImageCount) {
      throw new Error(`Unknown-size thumbnail did not render: ${JSON.stringify(imageSources)}`)
    }

    const data = await page.evaluate(() => window.__IM_RENDER_SMOKE__)
    const directoryMessages = data.messages.filter(message => message.cmd === 'get_directory_children')
    const thumbnailMessages = data.messages.filter(message => message.cmd === 'get_thumbnails')
    const requestedThumbnailPaths = new Set(thumbnailMessages.flatMap(message => message.data?.images || []))
    if (requestedThumbnailPaths.size !== unknownImageCount) {
      throw new Error(`Expected all unknown-size images to request thumbnails: ${JSON.stringify(Array.from(requestedThumbnailPaths))}`)
    }
    const requestLogs = data.logs.filter((log) => {
      const message = String(log.message || '')
      return message.includes('directory')
        || message.includes('thumbnail')
        || message === 'update_images received'
        || message === 'apply tree update'
        || message === 'tree render commit'
    })

    console.log(JSON.stringify({
      directoryMessages,
      requestLogs,
      thumbnailMessages,
      requestedThumbnailPaths: Array.from(requestedThumbnailPaths),
      timeline,
      visible: {
        datasets: await page.getByText('datasets', { exact: true }).count(),
        experiments: await page.getByText('experiments', { exact: true }).count(),
        preThumbnailData,
        thumbnailSourceCount,
        unknownSizeImages: await page.locator('text=/unknown-size-\\d+\\.png/').count(),
        imageSources,
        results: await page.getByText('results', { exact: true }).count(),
      },
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
