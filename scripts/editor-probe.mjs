/* eslint-disable style/max-statements-per-line */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const port = Number(process.env.IM_PROBE_PORT || 4571)
const cwd = normalizeSmokePath(process.env.IM_EDITOR_SMOKE_CWD || path.join(os.tmpdir(), 'image-editor-smoke'))
// 固定 128x128 PNG，避免 probe 脚本依赖 optional native canvas 包。
const pngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAABmJLR0QA/wD/AP+gvaeTAAABj0lEQVR4nO3csQ2CUBRAUTSsYOco1izmVs5j5wCW3w2g+BXec1pCXnPzEkLyLmOMsex4PL97j5fX/bb7/Mj2/ky9b/7c/OvU25yeAOIEECeAOAHECSBOAHHr0Xc+/80GiBNAnADiBBAngDgBxAkgTgBxAogTQJwA4gQQJ4A4AcStZ/+fbb77AEwQQJwA4gQQJ4A4AcQJIE4AcQKIE0CcAOIEECeAOAHECSDOfYD4fBsgTgBxAogTQJwA4gQQJ4A4AcQJIE4AcQKIE0CcAOIEECeAOPcB4vNtgDgBxAkgTgBxAogTQJwA4gQQJ4A4AcQJIE4AcQKIE0CcAOLcB4jPtwHiBBAngDgBxAkgTgBxAogTQJwA4gQQJ4A4AcQJIE4AcQKIcx8gPt8GiBNAnADiBBAngDgBxAkgTgBxAogTQJwA4gQQJ4A4AcQJIM59gPh8GyBOAHECiBNAnADiBBAngDgBxAkgTgBxAogTQJwA4gQQJ4C4H9nOZmNAMIE3AAAAAElFTkSuQmCC'
const IMG_W = 128
const IMG_H = 128

function normalizeSmokePath(value) {
  return value.replace(/\\/g, '/')
}

function browserPath() {
  return [`${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`, `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`].find(p => fs.existsSync(p))
}
function isFree(p) { return new Promise((r) => { const s = net.createServer(); s.once('error', () => r(false)); s.once('listening', () => s.close(() => r(true))); s.listen(p, '127.0.0.1') }) }
function server() {
  let url = `http://127.0.0.1:${port}`
  const child = spawn('cmd.exe', ['/d', '/s', '/c', `npm run ui:dev -- --host 127.0.0.1 --port ${port} --strictPort`], { env: { ...process.env, BROWSER: 'none' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let ready = false
  const wait = new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout')), 30000); const on = (c) => {
      const s = c.toString(); const m = s.match(/https?:\/\/127\.0\.0\.1:(\d+)\//); if (m)
        url = `http://127.0.0.1:${m[1]}`; if (!ready && (s.includes('ready in') || s.includes('Local:') || s.includes(`:${port}`))) { ready = true; clearTimeout(t); res() }
    }; child.stdout.on('data', on); child.stderr.on('data', on); child.on('exit', (c) => { if (!ready) { clearTimeout(t); rej(new Error(`exit ${c}`)) } })
  })
  return { child, get url() { return url }, wait, stop: () => new Promise((r) => { const k = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' }); k.once('exit', r); k.once('error', r) }) }
}
function img() { return { absDirPath: cwd, absPath: `${cwd}/editor-smoke.png`, absWorkspaceFolder: cwd, basename: 'editor-smoke.png', dirPath: '', extname: 'png', filename: 'editor-smoke', info: { compressed: 3, gitStaged: false, metadata: { channels: 4, height: IMG_H, width: IMG_W } }, key: `${cwd}/editor-smoke.png`, name: 'editor-smoke.png', path: `${cwd}/editor-smoke.png`, relativePath: './editor-smoke.png', root: cwd, stats: { birthtimeMs: 1, ctimeMs: 1, mtimeMs: 1, size: 4096 }, vscodePath: pngDataUrl, workspaceFolder: 'image-editor-smoke' } }

async function main() {
  if (!await isFree(port))
    throw new Error(`port ${port} busy`)
  const srv = server()
  let browser
  try {
    await srv.wait
    const exe = browserPath()
    browser = await chromium.launch({ executablePath: exe, headless: true })
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
    await page.route('https://marketplace.visualstudio.com/**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: [{ extensions: [{ publisher: { publisherName: 'test' }, versions: [{ version: '0.0.0' }] }] }] }) }))
    await page.addInitScript(({ cwd, image, png }) => {
      window.acquireVsCodeApi = () => ({ getState: () => undefined, setState: v => v, postMessage: (m) => {
        const cb = d => window.dispatchEvent(new MessageEvent('message', { data: { callbackId: m.callbackId, cmd: 'webview_callback', data: d, traceId: m.traceId } }))
        const up = d => window.dispatchEvent(new MessageEvent('message', { data: { cmd: 'update_images', data: d, traceId: d.traceId } }))
        if (m.cmd === 'webview_log')
          return
        if (m.cmd === 'on_webview_ready') { cb({ config: { ext: { appearance: { language: 'en', primaryColor: '', reduceMotion: 'off', theme: 'dark' }, compression: { errorRange: 0, fileSuffix: '.min', format: '', gif: { colors: 256 }, keepOriginal: false, png: { compressionLevel: 9 }, quality: 75, size: 1, skipCompressed: true, svg: { compressedAttribute: 'c', removeDataAttributes: true } }, conversion: { format: '', icoSize: [16, 32], keepOriginal: false }, core: { installDependencies: false, multiplePanels: true }, debug: { enabled: true, forceInstall: false }, file: { confirmDelete: false, customFormats: { extensionPresets: {}, folderPresets: {} }, exclude: [], gitignore: false, revealFileInOsDeeply: false, scan: ['png'], trashAfterProcessing: false }, similarity: { precision: 14 }, viewer: { imageBackgroundColor: '#1a1a1a', imageRendering: 'auto', imageWidth: 120, showDetailsOnHover: true, warningSize: 0 } }, vscode: { language: 'en', reduceMotion: 'off', theme: 'dark' } }, windowState: { __reveal_image_path__: undefined, __sharp_installed__: true }, workspaceState: { display_group: [], display_sort: ['name', 'asc'], display_style: 'compact', hide_known_empty_dirs: false, image_filter: { compressed: 0, git_staged: 0, exclude_types: [], size: { max: null, min: null, unit: 'KB' } }, preview_scale: 1, preview_scale_lock: true, recent_image_backgroundColors: [], recent_primary_colors: [], show_cut_tip: false, show_precision_tip: false, show_undo_redo_tip: false } }); return }
        if (m.cmd === 'get_all_images_from_cwds') { setTimeout(() => { up({ absWorkspaceFolder: cwd, id: 'r', payloads: [{ origin: 'dir', data: { type: 'create', payload: { absDirPath: cwd, absWorkspaceFolder: cwd, canLoadChildren: false, canLoadMoreImages: false, childrenLoaded: true, dirPath: '', directFolderCount: 0, directImageCount: 1, imagesLoaded: true, loadedImageCount: 1, loadingChildren: false, workspaceFolder: 'image-editor-smoke' } } }, { origin: 'image', data: { type: 'create', payload: image } }], traceId: 'r', updateType: 'full', workspaceFolder: 'image-editor-smoke' }); cb(true) }, 40); return }
        if (m.cmd === 'copy_image_as_base64') { cb(png); return }
        if (m.cmd === 'get_images_metadata') { cb((m.data?.images || []).map(f => ({ compressed: 3, filePath: f, metadata: { channels: 4, height: 128, width: 128 }, stats: { mtimeMs: 1, size: 4096 } }))); return }
        if (m.cmd === 'get_thumbnails') { cb([]); return }
        if (m.callbackId)
          cb(true)
      } })
    }, { cwd, image: img(), png: pngDataUrl })

    await page.goto(srv.url, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('text=editor-smoke.png', { timeout: 20000 })
    const tile = page.locator('[data-image-context-menu="true"]').filter({ hasText: 'editor-smoke.png' }).first()
    await tile.click({ button: 'right' })
    await page.locator('.contexify').first().waitFor({ timeout: 10000 })
    await page.getByRole('menuitem', { name: 'Edit Image' }).click()
    await page.waitForSelector('.tui-image-editor-menu .tie-btn-filter', { timeout: 20000 })
    await page.waitForTimeout(900)

    const probe = () => page.evaluate(() => {
      const q = s => document.querySelector(s)
      const wrap = q('.tui-image-editor-wrap')
      const tie = q('.tui-image-editor')
      const lower = q('.tui-image-editor-canvas-container .lower-canvas')
      const tieRect = tie?.getBoundingClientRect()
      return {
        zoomBtn: q('.vim-editor-zoom-button')?.textContent,
        tieZoom: tie?.style?.zoom || '(none)',
        tieRenderedWH: tieRect ? [Math.round(tieRect.width), Math.round(tieRect.height)] : null,
        wrap: wrap ? { scrollW: wrap.scrollWidth, scrollH: wrap.scrollHeight, clientW: wrap.clientWidth, clientH: wrap.clientHeight, scrollable: wrap.scrollWidth > wrap.clientWidth + 1 || wrap.scrollHeight > wrap.clientHeight + 1 } : null,
        lowerCanvasAttr: lower ? [lower.width, lower.height] : null,
        lowerCanvasBox: lower ? [Math.round(lower.getBoundingClientRect().width), Math.round(lower.getBoundingClientRect().height)] : null,
      }
    })

    await probe()

    const getObjInfo = () => page.evaluate(() => {
      const ed = window.__IM_EDITOR_INSTANCE__
      if (!ed || !ed._graphics)
        return { err: 'no editor' }
      const canvas = ed._graphics.getCanvas()
      const objs = canvas.getObjects().filter(o => o.type !== 'image')
      const last = objs[objs.length - 1]
      return {
        count: objs.length,
        last: last
          ? {
              type: last.type,
              left: Math.round(last.left),
              top: Math.round(last.top),
              width: Math.round((last.width || 0) * (last.scaleX || 1)),
              height: Math.round((last.height || 0) * (last.scaleY || 1)),
            }
          : null,
        canvasWH: [canvas.width, canvas.height],
      }
    })
    const getPointerProbe = () => page.evaluate(() => {
      const ed = window.__IM_EDITOR_INSTANCE__
      if (!ed?._graphics)
        return { err: 'no editor' }
      const canvas = ed._graphics.getCanvas()
      const el = canvas.upperCanvasEl
      const rect = el.getBoundingClientRect()
      const samples = [
        { label: 'left-top-ish', clientX: rect.left + rect.width * 0.22, clientY: rect.top + rect.height * 0.28 },
        { label: 'center', clientX: rect.left + rect.width * 0.5, clientY: rect.top + rect.height * 0.5 },
        { label: 'right-bottom-ish', clientX: rect.left + rect.width * 0.74, clientY: rect.top + rect.height * 0.63 },
      ]
      return {
        canvasWH: [canvas.width, canvas.height],
        rect: { height: rect.height, left: rect.left, top: rect.top, width: rect.width },
        samples: samples.map((sample) => {
          const expected = {
            x: (sample.clientX - rect.left) * (canvas.width / rect.width),
            y: (sample.clientY - rect.top) * (canvas.height / rect.height),
          }
          const actual = canvas.getPointer({ clientX: sample.clientX, clientY: sample.clientY }, false)
          return {
            actual: { x: Math.round(actual.x * 100) / 100, y: Math.round(actual.y * 100) / 100 },
            diff: { x: Math.round((actual.x - expected.x) * 100) / 100, y: Math.round((actual.y - expected.y) * 100) / 100 },
            expected: { x: Math.round(expected.x * 100) / 100, y: Math.round(expected.y * 100) / 100 },
            label: sample.label,
          }
        }),
        viewportTransform: canvas.viewportTransform,
      }
    })
    const getVisibleCanvasPoint = (fx = 0.62, fy = 0.44) => page.evaluate(({ fx, fy }) => {
      const canvas = document.querySelector('.tui-image-editor-canvas-container .lower-canvas')
      const wrap = document.querySelector('.tui-image-editor-wrap')
      const canvasRect = canvas.getBoundingClientRect()
      const wrapRect = wrap.getBoundingClientRect()
      const left = Math.max(canvasRect.left, wrapRect.left)
      const top = Math.max(canvasRect.top, wrapRect.top)
      const right = Math.min(canvasRect.right, wrapRect.right)
      const bottom = Math.min(canvasRect.bottom, wrapRect.bottom)
      const clientX = left + Math.max(1, right - left) * fx
      const clientY = top + Math.max(1, bottom - top) * fy
      return {
        clientX,
        clientY,
        expectedX: (clientX - canvasRect.left) / canvasRect.width * 128,
        expectedY: (clientY - canvasRect.top) / canvasRect.height * 128,
      }
    }, { fx, fy })
    const getFileInfoPoint = () => page.evaluate(() => {
      const text = document.querySelector('[data-editor-file-info]')?.textContent || ''
      const match = text.match(/x\s+(\d+),\s*y\s+(\d+)/)
      return match
        ? { text, x: Number(match[1]), y: Number(match[2]) }
        : { text, x: null, y: null }
    })
    const enterFreeDraw = async () => {
      const mainClass = await page.evaluate(() => document.querySelector('.tui-image-editor-main')?.className || '')
      if (!mainClass.includes('tui-image-editor-menu-draw'))
        await page.locator('.tui-image-editor-menu .tie-btn-draw').click()
      await page.waitForTimeout(400)
      const freeActive = await page.evaluate(() => document.querySelector('.tie-draw-line-select-button')?.classList.contains('free'))
      if (!freeActive) {
        try {
          await page.locator('.tui-image-editor-submenu .tie-draw-line-select-button .tui-image-editor-button.free').click({ timeout: 2000 })
        }
        catch {}
      }
      await page.waitForTimeout(200)
      return page.evaluate(() => document.querySelector('.tui-image-editor-main')?.className)
    }
    const strokeAt = async (cx, cy) => {
      await page.mouse.move(cx - 25, cy - 25)
      await page.mouse.down()
      await page.mouse.move(cx, cy, { steps: 6 })
      await page.mouse.move(cx + 25, cy + 25, { steps: 6 })
      await page.mouse.up()
      await page.waitForTimeout(300)
    }
    const dragAt = async (cx, cy, dx = 28, dy = 24) => {
      await page.mouse.move(cx - dx, cy - dy)
      await page.mouse.down()
      await page.mouse.move(cx + dx, cy + dy, { steps: 8 })
      await page.mouse.up()
      await page.waitForTimeout(350)
    }
    const assertNearPoint = (info, label, expectedX, expectedY, tolerance = 18) => {
      const last = info.last
      if (!last)
        throw new Error(`${label} did not create an object`)
      const cx = last.left + (last.width || 0) / 2
      const cy = last.top + (last.height || 0) / 2
      if (Math.abs(cx - expectedX) > tolerance || Math.abs(cy - expectedY) > tolerance)
        throw new Error(`${label} object is far from pointer: ${JSON.stringify({ expectedX, expectedY, last })}`)
    }
    const assertFileInfoNearPoint = async (clientX, clientY, label, expectedX, expectedY, tolerance = 2) => {
      await page.mouse.move(clientX, clientY)
      await page.waitForTimeout(80)
      const info = await getFileInfoPoint()
      if (typeof info.x !== 'number' || typeof info.y !== 'number')
        throw new Error(`${label} did not update file info: ${JSON.stringify(info)}`)
      if (Math.abs(info.x - expectedX) > tolerance || Math.abs(info.y - expectedY) > tolerance)
        throw new Error(`${label} file info is far from pointer: ${JSON.stringify({ expectedX, expectedY, info })}`)
      return info
    }

    const drawMenu100 = await enterFreeDraw()
    const objBefore100 = await getObjInfo()
    const box100 = await page.locator('.tui-image-editor-canvas-container .lower-canvas').boundingBox()
    await strokeAt(box100.x + box100.width / 2, box100.y + box100.height / 2)
    const objAfter100 = await getObjInfo()

    await page.locator('.vim-editor-zoom-input input').click()
    await page.locator('.vim-editor-zoom-input input').fill('800')
    await page.locator('.vim-editor-zoom-input input').press('Enter')
    await page.waitForTimeout(400)
    const drawMenuZoom = await enterFreeDraw()
    const pointerProbeZoom = await getPointerProbe()
    for (const sample of pointerProbeZoom.samples || []) {
      if (Math.abs(sample.diff.x) > 1.5 || Math.abs(sample.diff.y) > 1.5)
        throw new Error(`getPointer mismatch at ${sample.label}: ${JSON.stringify(pointerProbeZoom)}`)
    }
    const objBeforeZoom = await getObjInfo()
    const lowerRect = await page.evaluate(() => {
      const c = document.querySelector('.tui-image-editor-canvas-container .lower-canvas')
      const r = c.getBoundingClientRect()
      return {
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
        pointX: r.left + r.width * 0.72,
        pointY: r.top + r.height * 0.38,
      }
    })
    const fileInfoZoomPoint = await assertFileInfoNearPoint(lowerRect.pointX, lowerRect.pointY, 'file-info@800 off-center', Math.floor(IMG_W * 0.72), Math.floor(IMG_H * 0.38))
    const zoomDiagnostics = await page.evaluate(({ x, y }) => {
      const ed = window.__IM_EDITOR_INSTANCE__
      const canvas = ed?._graphics?.getCanvas?.()
      const lower = document.querySelector('.tui-image-editor-canvas-container .lower-canvas')
      const upper = document.querySelector('.tui-image-editor-canvas-container .upper-canvas')
      const container = document.querySelector('.tui-image-editor-canvas-container')
      const fabricContainer = document.querySelector('.tui-image-editor-canvas-container .canvas-container')
      const element = document.elementFromPoint(x, y)
      const elements = document.elementsFromPoint(x, y).slice(0, 8)
      const toRect = (el) => {
        const r = el?.getBoundingClientRect?.()
        return r ? { height: Math.round(r.height), left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width) } : null
      }
      return {
        drawingMode: ed?.getDrawingMode?.(),
        elementAtPoint: element ? { className: element.className, tagName: element.tagName } : null,
        elementsAtPoint: elements.map(el => ({ className: el.className, tagName: el.tagName })),
        fabricIsDrawingMode: canvas?.isDrawingMode,
        lowerRect: toRect(lower),
        upperRect: toRect(upper),
        containerRect: toRect(container),
        fabricContainerRect: toRect(fabricContainer),
        canvasOffset: canvas?._offset,
        canvasWH: canvas ? [canvas.width, canvas.height] : null,
      }
    }, { x: lowerRect.pointX, y: lowerRect.pointY })
    await strokeAt(lowerRect.cx, lowerRect.cy)
    const objAfterZoom = await getObjInfo()
    const objBeforeZoomPoint = await getObjInfo()
    await strokeAt(lowerRect.pointX, lowerRect.pointY)
    const objAfterZoomPoint = await getObjInfo()
    assertNearPoint(objAfterZoomPoint, 'draw@800 off-center', IMG_W * 0.72, IMG_H * 0.38, 20)

    await page.locator('.tui-image-editor-menu .tie-btn-shape').click()
    await page.waitForTimeout(250)
    await page.locator('.tie-shape-button .tui-image-editor-button.rect svg').click()
    await page.waitForTimeout(200)
    const objBeforeShape = await getObjInfo()
    await dragAt(lowerRect.pointX, lowerRect.pointY)
    const objAfterShape = await getObjInfo()
    assertNearPoint(objAfterShape, 'shape@800', IMG_W * 0.72, IMG_H * 0.38)

    await page.locator('.tui-image-editor-menu .tie-btn-icon').click()
    await page.waitForTimeout(250)
    await page.locator('.tie-icon-add-button .tui-image-editor-button[data-icontype="icon-star"] svg').click()
    await page.waitForTimeout(200)
    const objBeforeIcon = await getObjInfo()
    await dragAt(lowerRect.pointX, lowerRect.pointY, 22, 22)
    const objAfterIcon = await getObjInfo()
    assertNearPoint(objAfterIcon, 'icon@800', IMG_W * 0.72, IMG_H * 0.38)

    await page.locator('.vim-editor-zoom-input input').click()
    await page.locator('.vim-editor-zoom-input input').fill('1600')
    await page.locator('.vim-editor-zoom-input input').press('Enter')
    await page.waitForTimeout(350)
    await page.evaluate(() => {
      const wrap = document.querySelector('.tui-image-editor-wrap')
      wrap.scrollLeft = Math.max(0, wrap.scrollWidth - wrap.clientWidth) * 0.58
      wrap.scrollTop = Math.max(0, wrap.scrollHeight - wrap.clientHeight) * 0.42
    })
    await page.waitForTimeout(120)
    const pointerProbeScrolled = await getPointerProbe()
    for (const sample of pointerProbeScrolled.samples || []) {
      if (Math.abs(sample.diff.x) > 1.5 || Math.abs(sample.diff.y) > 1.5)
        throw new Error(`getPointer mismatch after scroll at ${sample.label}: ${JSON.stringify(pointerProbeScrolled)}`)
    }
    await page.locator('.tui-image-editor-menu .tie-btn-shape').click()
    await page.waitForTimeout(250)
    await page.locator('.tie-shape-button .tui-image-editor-button.rect svg').click()
    await page.waitForTimeout(200)
    const scrolledPoint = await getVisibleCanvasPoint(0.67, 0.41)
    const fileInfoScrolledPoint = await assertFileInfoNearPoint(scrolledPoint.clientX, scrolledPoint.clientY, 'file-info@1600 scrolled', Math.floor(scrolledPoint.expectedX), Math.floor(scrolledPoint.expectedY))
    const objBeforeScrolledShape = await getObjInfo()
    await dragAt(scrolledPoint.clientX, scrolledPoint.clientY, 24, 20)
    const objAfterScrolledShape = await getObjInfo()
    assertNearPoint(objAfterScrolledShape, 'shape@1600 scrolled', scrolledPoint.expectedX, scrolledPoint.expectedY, 14)

    console.log(JSON.stringify({
      imgWH: [IMG_W, IMG_H],
      drawMenu100,
      drawMenuZoom,
      drew100: { before: objBefore100.count, after: objAfter100.count, last: objAfter100.last, canvasWH: objAfter100.canvasWH, ok: objAfter100.count > objBefore100.count },
      drewZoom: { before: objBeforeZoom.count, after: objAfterZoom.count, last: objAfterZoom.last, ok: objAfterZoom.count > objBeforeZoom.count },
      drewZoomPoint: { before: objBeforeZoomPoint.count, after: objAfterZoomPoint.count, last: objAfterZoomPoint.last, ok: objAfterZoomPoint.count > objBeforeZoomPoint.count },
      fileInfoZoomPoint,
      pointerProbeZoom,
      zoomDiagnostics,
      shapeZoom: { before: objBeforeShape.count, after: objAfterShape.count, last: objAfterShape.last, ok: objAfterShape.count > objBeforeShape.count },
      iconZoom: { before: objBeforeIcon.count, after: objAfterIcon.count, last: objAfterIcon.last, ok: objAfterIcon.count > objBeforeIcon.count },
      fileInfoScrolledPoint,
      pointerProbeScrolled,
      shapeScrolledZoom: { before: objBeforeScrolledShape.count, after: objAfterScrolledShape.count, expected: scrolledPoint, last: objAfterScrolledShape.last, ok: objAfterScrolledShape.count > objBeforeScrolledShape.count },
    }, null, 2))
    await browser.close()
    await srv.stop()
  }
  catch (e) {
    console.error(e); try { await browser?.close() }
    catch {} await srv.stop(); process.exit(1)
  }
}
main()
