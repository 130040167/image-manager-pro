import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import sharp from 'sharp'
import { createServer } from 'vite'
import { checkAnnotations } from './editor-quality-annotations.mjs'
import { checkDrawingQuality } from './editor-quality-drawing.mjs'
import { checkRangeHistory } from './editor-quality-history.mjs'
import { checkPreviewIdle } from './editor-quality-idle.mjs'
import { checkLargePreview } from './editor-quality-large-preview.mjs'
import { checkMeasurements } from './editor-quality-measurements.mjs'
import { checkPixelComparison } from './editor-quality-pixels.mjs'
import { checkEditorRotation } from './editor-quality-rotation.mjs'
import { checkEditorTitlebar } from './editor-quality-titlebar.mjs'

const output = path.resolve('output/playwright/editor-quality')
fs.mkdirSync(output, { recursive: true })
const externalUrl = process.env.IM_QUALITY_URL
const server = externalUrl ? null : await createServer({ configFile: 'scripts/editor-quality-harness/vite.config.ts' })
await server?.listen()
const url = externalUrl || 'http://127.0.0.1:5199'
const candidates = [process.env.IM_RENDER_SMOKE_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome']
const browser = await chromium.launch({ executablePath: candidates.find(p => p && fs.existsSync(p)), headless: true })
const failures = []
const results = []
try {
  for (const dpr of [1, 1.25, 2]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: dpr, colorScheme: 'dark' })
    page.on('pageerror', error => failures.push(error.message))
    await page.goto(`${url}/?rotation`)
    results.push({ dpr, ...await checkEditorRotation(page, output) })
    await page.goto(`${url}/?preview`)
    await page.locator('[data-preview-pixel-grid]').waitFor()
    await page.waitForTimeout(450)
    results.push(await checkPreviewIdle(page))
    const cases = [
      { x: 0, y: 0, scale: 1, rotate: 0, flipX: false, flipY: false },
      { x: 67.375, y: -48.125, scale: 1.55, rotate: 0, flipX: false, flipY: false },
      { x: -93.5, y: 61.25, scale: 1.2, rotate: 90, flipX: true, flipY: false },
      { x: 40.25, y: -24.5, scale: 1.35, rotate: 270, flipX: false, flipY: true },
    ]
    for (const [caseIndex, transform] of cases.entries()) {
      await page.evaluate(t => window.__previewActions.onSetTransform(t, 'test'), transform)
      await page.waitForTimeout(100)
      const checks = await page.evaluate((t) => {
        const image = document.querySelector('.ant-image-preview-img')
        const rect = image.getBoundingClientRect()
        const scaleX = 257.375 * t.scale / 8
        const scaleY = 193.03125 * t.scale / 6
        const radians = t.rotate * Math.PI / 180
        const cos = Math.cos(radians)
        const sin = Math.sin(radians)
        const toScreen = (x, y) => {
          const dx = (x - 4) * scaleX
          const dy = (y - 3) * scaleY
          return { x: rect.left + rect.width / 2 + (dx * cos - dy * sin) * (t.flipX ? -1 : 1), y: rect.top + rect.height / 2 + (dx * sin + dy * cos) * (t.flipY ? -1 : 1) }
        }
        const canvas = document.querySelector('[data-preview-pixel-grid]')
        const context = canvas.getContext('2d')
        const alphaNear = (point) => {
          const px = Math.round(point.x * canvas.width / innerWidth)
          const py = Math.round(point.y * canvas.height / innerHeight)
          const data = context.getImageData(px - 1, py - 1, 3, 3).data
          return Math.max(...Array.from({ length: 9 }, (_, i) => data[i * 4 + 3]))
        }
        const boundaries = []
        for (let x = 1; x < 8; x++)
          boundaries.push(alphaNear(toScreen(x, 1.23)))
        for (let y = 1; y < 6; y++)
          boundaries.push(alphaNear(toScreen(1.23, y)))
        return {
          boundaries,
          samples: Array.from({ length: 48 }, (_, i) => {
            const x = i % 8
            const y = Math.floor(i / 8)
            return { point: toScreen(x + 0.25, y + 0.25), expected: [x * 32, y * 40, (x + y) * 16] }
          }),
          pointer: toScreen(2.5, 3.5),
        }
      }, transform)
      assert(checks.boundaries.every(alpha => alpha >= 30), `Grid missed a boundary: DPR ${dpr} case ${caseIndex}: ${checks.boundaries}`)
      await page.mouse.move(checks.pointer.x, checks.pointer.y)
      await page.waitForTimeout(50)
      assert.match(await page.locator('.ant-image-preview-wrap').textContent(), /\(2, 3\)\s*64 120 80/)
      await page.locator('[data-preview-pixel-grid]').evaluate(canvas => canvas.style.visibility = 'hidden')
      const screenshot = await page.screenshot()
      const { data, info } = await sharp(screenshot).removeAlpha().raw().toBuffer({ resolveWithObject: true })
      for (const sample of checks.samples) {
        const index = (Math.floor(sample.point.y * dpr) * info.width + Math.floor(sample.point.x * dpr)) * info.channels
        assert.deepEqual(Array.from(data.slice(index, index + 3)), sample.expected, `Source cell colour: DPR ${dpr}, case ${caseIndex}`)
      }
      await page.locator('[data-preview-pixel-grid]').evaluate(canvas => canvas.style.visibility = '')
      results.push({ feature: 'preview standard RGB pattern', dpr, caseIndex, verifiedCells: checks.samples.length, verifiedBoundaries: checks.boundaries.length })
      if (dpr === 1 && caseIndex === 2)
        await page.screenshot({ path: path.join(output, 'preview-rotated-flipped.png') })
    }
    await page.close()
  }
  results.push(...await checkLargePreview(browser, url, output))

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' })
  page.on('pageerror', error => failures.push(error.message))
  await page.goto(url)
  await page.waitForFunction(() => window.__IM_EDITOR_INSTANCE__?.state.doc.background)
  await page.locator('.fp-editor-status').waitFor({ state: 'hidden' })
  const controls = await page.locator('.fp-histogram-btn').evaluate(button => getComputedStyle(button).color)
  assert.equal(controls, 'rgb(255, 255, 255)')
  await page.locator('.fp-histogram-btn').click()
  // The histogram canvas has fixed intrinsic dimensions; editor/pixel canvases follow the viewport.
  const histogramCanvas = page.locator('canvas[width="280"][height="160"]')
  await histogramCanvas.waitFor()
  const original = await histogramCanvas.evaluate(canvas => canvas.toDataURL())
  await page.evaluate(() => window.__IM_EDITOR_INSTANCE__.setBackgroundFilters({ brightness: 0.25, contrast: 0.2, saturation: -0.3 }))
  await page.waitForTimeout(100)
  assert.equal(await histogramCanvas.evaluate(canvas => canvas.toDataURL()), original, 'Original histogram changed with filters')
  await page.getByText('im.pixel_values_adjusted', { exact: true }).click()
  await page.waitForTimeout(100)
  const adjusted = await histogramCanvas.evaluate(canvas => canvas.toDataURL())
  assert.notEqual(adjusted, original, 'Adjusted histogram ignored filters')
  await page.getByText('im.pixel_values_raw', { exact: true }).click()
  await page.waitForTimeout(50)
  assert.equal(await histogramCanvas.evaluate(canvas => canvas.toDataURL()), original, 'Original histogram not restored')
  await page.getByText('im.pixel_values_adjusted', { exact: true }).click()
  const beforeRange = await page.evaluate(() => Array.from(window.__IM_EDITOR_INSTANCE__.getBackgroundImageData().data))
  const rangeInputs = page.locator('[data-editor-histogram-panel] input')
  await rangeInputs.nth(0).fill('64')
  await rangeInputs.nth(0).press('Enter')
  await rangeInputs.nth(1).fill('192')
  await rangeInputs.nth(1).press('Enter')
  await page.waitForTimeout(100)
  const afterRange = await page.evaluate(() => Array.from(window.__IM_EDITOR_INSTANCE__.getBackgroundImageData().data))
  for (let i = 0; i < afterRange.length; i += 400) {
    for (let channel = 0; channel < 3; channel++)
      assert(Math.abs(afterRange[i + channel] - Math.round(Math.max(0, Math.min(255, (beforeRange[i + channel] - 64) * 255 / 128)))) <= 1, 'Range mapping accumulates or diverges from rendered pixels')
  }
  const rangedHistogram = await histogramCanvas.evaluate(canvas => canvas.toDataURL())
  await page.getByText('im.pixel_values_raw', { exact: true }).click()
  await page.waitForTimeout(40)
  const rawRangedHistogram = await histogramCanvas.evaluate(canvas => canvas.toDataURL())
  assert.notEqual(rawRangedHistogram, rangedHistogram, 'Raw and adjusted histogram ignore range')
  await page.evaluate(() => window.__IM_EDITOR_INSTANCE__.setBackgroundFilters({ brightness: -0.15, contrast: -0.25, saturation: 0.5 }))
  await page.waitForTimeout(70)
  assert.equal(await histogramCanvas.evaluate(canvas => canvas.toDataURL()), rawRangedHistogram, 'Raw histogram changed with range and filters')
  await page.evaluate(() => window.__IM_EDITOR_INSTANCE__.setBackgroundFilters({ brightness: 0.25, contrast: 0.2, saturation: -0.3 }))
  await page.getByText('im.pixel_values_adjusted', { exact: true }).click()
  await page.waitForTimeout(70)
  assert.equal(await histogramCanvas.evaluate(canvas => canvas.toDataURL()), rangedHistogram, 'Repeated adjustments accumulate')
  await page.getByText('im.reset', { exact: true }).click()
  await page.waitForTimeout(70)
  assert.equal(await histogramCanvas.evaluate(canvas => canvas.toDataURL()), adjusted, 'Range reset failed to restore filtered histogram')
  results.push({ feature: 'histogram raw/adjusted filters, range changes, reset and white toolbar icon', passed: true })
  await page.screenshot({ path: path.join(output, 'editor-histogram.png') })
  await page.close()
  const measurementPage = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' })
  measurementPage.on('pageerror', error => failures.push(error.message))
  await measurementPage.goto(url)
  await measurementPage.waitForFunction(() => window.__IM_EDITOR_INSTANCE__?.state.doc.background)
  await measurementPage.locator('.fp-editor-status').waitFor({ state: 'hidden' })
  results.push(...await checkEditorTitlebar(measurementPage, output))
  results.push(await checkMeasurements(measurementPage, output))
  results.push(await checkRangeHistory(measurementPage))
  await measurementPage.close()
  const annotationPage = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' })
  annotationPage.on('pageerror', error => failures.push(error.message))
  await annotationPage.goto(url)
  await annotationPage.waitForFunction(() => window.__IM_EDITOR_INSTANCE__?.state.doc.background)
  await annotationPage.locator('.fp-editor-status').waitFor({ state: 'hidden' })
  results.push(await checkAnnotations(annotationPage, output))
  await annotationPage.close()
  const drawingPage = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' })
  drawingPage.on('pageerror', error => failures.push(error.message))
  await drawingPage.goto(url)
  await drawingPage.waitForFunction(() => window.__IM_EDITOR_INSTANCE__?.state.doc.background)
  await drawingPage.locator('.fp-editor-status').waitFor({ state: 'hidden' })
  results.push(await checkDrawingQuality(drawingPage, output))
  await drawingPage.close()
  const pixelPage = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' })
  pixelPage.on('pageerror', error => failures.push(error.message))
  await pixelPage.goto(url)
  await pixelPage.waitForFunction(() => window.__IM_EDITOR_INSTANCE__?.state.doc.background)
  await pixelPage.locator('.fp-editor-status').waitFor({ state: 'hidden' })
  results.push(await checkPixelComparison(pixelPage, output))
  await pixelPage.close()
  assert.deepEqual(failures, [], 'Browser errors')
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results, null, 2))
}
finally {
  await browser.close()
  await server?.close()
}
