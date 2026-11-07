import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const root = process.cwd()
const runtime = path.join(root, '.tmp', 'release-capture')
const workspace = path.join(runtime, 'Image Showcase')
const userData = path.join(runtime, 'user-data')
const output = path.join(root, 'screenshots', 'release')
const port = 9347
await fs.mkdir(path.join(userData, 'User'), { recursive: true })
await fs.mkdir(workspace, { recursive: true })
await fs.mkdir(output, { recursive: true })
await fs.mkdir(path.join(runtime, 'extensions'), { recursive: true })
await fs.mkdir(path.join(runtime, 'home'), { recursive: true })
await fs.writeFile(path.join(userData, 'User', 'settings.json'), JSON.stringify({
  'workbench.startupEditor': 'none',
  'workbench.colorTheme': 'Default Dark Modern',
  'workbench.enableExperiments': false,
  'window.commandCenter': false,
  'window.zoomLevel': 0,
  'window.newWindowDimensions': 'maximized',
  'security.workspace.trust.enabled': false,
  'extensions.autoCheckUpdates': false,
  'extensions.autoUpdate': false,
  'update.mode': 'none',
  'telemetry.telemetryLevel': 'off',
  'git.openRepositoryInParentFolders': 'never',
  'git.enabled': false,
  'image-manager.appearance.language': 'en',
  'image-manager.appearance.theme': 'dark',
  'image-manager.viewer.imageWidth': 200,
  'image-manager.core.installDependencies': true,
}, null, 2))
const demoFiles = [
  ['C:/Windows/Web/Screen/img100.jpg', 'Cliffside.jpg'],
  ['C:/Windows/Web/Screen/img101.jpg', 'Coastline.jpg'],
  ['C:/Windows/Web/Screen/img102.jpg', 'Landscape.jpg'],
  ['C:/Windows/Web/Screen/img102.jpg', 'Landscape-copy.jpg'],
  ['C:/Windows/Web/Screen/img103.jpg', 'Mountain.jpg'],
  ['C:/Windows/Web/Screen/img104.jpg', 'Sunlight.jpg'],
  ['C:/Windows/Web/Screen/img105.jpg', 'Nature.jpg'],
  [path.join(root, 'assets', 'logo.png'), 'Image Manager Pro.png'],
]
for (const [source, filename] of demoFiles)
  await fs.copyFile(source, path.join(workspace, filename))

const launchEnv = { ...process.env }
delete launchEnv.ELECTRON_RUN_AS_NODE
launchEnv.USERPROFILE = path.join(runtime, 'home')
const child = spawn('C:/Program Files/Microsoft VS Code/Code.exe', [
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userData}`,
  `--extensions-dir=${path.join(runtime, 'extensions')}`,
  `--extensionDevelopmentPath=${root}`,
  '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust',
  '--disable-gpu', '--new-window', workspace,
], { stdio: 'ignore', windowsHide: true, env: launchEnv })
let browser
try {
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
      break
    }
    catch {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
  assert(browser, 'Could not connect to isolated VS Code')
  const context = browser.contexts()[0]
  let page
  for (let attempt = 0; attempt < 60; attempt++) {
    page = context.pages().find(candidate => candidate.url().includes('workbench'))
    if (page)
      break
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  assert(page, 'VS Code workbench not found')
  await page.setViewportSize({ width: 1600, height: 1000 })
  const cdp = await context.newCDPSession(page)
  const capture = async (filename) => {
    const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    await fs.writeFile(path.join(output, filename), Buffer.from(result.data, 'base64'))
  }
  await page.locator('.monaco-workbench').waitFor({ timeout: 60000 })
  await page.waitForTimeout(5000)
  await page.keyboard.press('Shift+Alt+j')
  let frame
  for (let attempt = 0; attempt < 180; attempt++) {
    frame = page.frames().find(candidate => candidate.url().includes('webview') && candidate.url().includes('index.html'))
    const allFrames = page.frames()
    for (const candidate of allFrames) {
      if (await candidate.locator('[data-im-layout-root]').count().catch(() => 0)) {
        frame = candidate
        break
      }
    }
    if (frame && await frame.locator('[data-image-context-menu="true"]').count().catch(() => 0))
      break
    await page.waitForTimeout(1000)
  }
  assert(frame, 'Image Manager webview not found')
  await frame.locator('[data-image-context-menu="true"]').first().waitFor({ timeout: 30000 })
  await frame.waitForFunction(() => Array.from(document.images).some(image => image.naturalWidth > 100), { timeout: 30000 })
  await page.waitForTimeout(3000)
  await frame.waitForFunction(() => {
    const logo = document.querySelector('img[alt="Image Manager Pro"]')
    return logo?.complete && logo.naturalWidth > 0
  })
  await capture('home.png')
  await frame.locator('button').nth(4).click()
  const searchDialog = frame.locator('.ant-modal').filter({ hasText: 'Search' }).last()
  await searchDialog.waitFor({ timeout: 15000 })
  await searchDialog.locator('input[placeholder="Search images by name"]').fill('Landscape')
  await page.waitForTimeout(900)
  await capture('search.png')
  await searchDialog.locator('.ant-modal-close').click()

  const tile = frame.locator('[data-image-context-menu="true"]').filter({ hasText: 'Landscape.jpg' }).first()
  await tile.click({ button: 'right' })
  await frame.getByText('More Tools', { exact: true }).last().click()
  await frame.getByRole('menuitem', { name: 'Compress', exact: true }).click()
  const compressionDialog = frame.locator('.ant-modal').filter({ hasText: 'Image Compression' }).last()
  await compressionDialog.waitFor({ timeout: 30000 })
  await capture('compression.png')
  await compressionDialog.locator('.ant-modal-close').click()

  await tile.click({ button: 'right' })
  await frame.getByText('More Tools', { exact: true }).last().click()
  await frame.getByRole('menuitem', { name: 'Find Similar Images - Current Directory', exact: true }).click()
  const similarityDialog = frame.locator('.ant-modal').filter({ hasText: 'Find Similar Images' }).last()
  await similarityDialog.waitFor({ timeout: 30000 })
  await page.waitForTimeout(1200)
  await capture('similarity.png')
  await similarityDialog.locator('.ant-modal-close').click()

  await tile.dblclick()
  await frame.locator('.ant-image-preview-img').waitFor({ timeout: 15000 })
  await page.waitForTimeout(1500)
  await capture('preview.png')
  const previewZoomInput = frame.locator('.ant-image-preview-operations-wrapper .ant-input-number-input').first()
  await previewZoomInput.fill('5000')
  await previewZoomInput.press('Enter')
  await page.waitForTimeout(1200)
  const previewButtons = frame.locator('.ant-image-preview-operations-wrapper button')
  let histogramOpened = false
  for (let index = 0; index < await previewButtons.count(); index++) {
    await previewButtons.nth(index).hover()
    await page.waitForTimeout(250)
    if (await frame.getByRole('tooltip').filter({ hasText: 'Histogram' }).isVisible().catch(() => false)) {
      await previewButtons.nth(index).click()
      histogramOpened = true
      break
    }
  }
  assert(histogramOpened, 'Preview histogram control not found')
  await frame.locator('[data-editor-histogram-panel]').waitFor()
  await frame.waitForFunction(() => {
    const canvas = document.querySelector('[data-editor-histogram-panel] canvas')
    if (!canvas)
      return false
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    return pixels.some((value, index) => index % 4 === 3 && value > 0)
  }, { timeout: 30000 })
  const previewImage = await frame.locator('.ant-image-preview-img').boundingBox()
  assert(previewImage, 'Preview image bounds not found after 5000% zoom')
  await page.mouse.move(previewImage.x + previewImage.width * 0.5, previewImage.y + previewImage.height * 0.5)
  await page.waitForTimeout(800)
  await capture('preview-details.png')
  await frame.locator('.ant-image-preview-close').click()
  await tile.click({ button: 'right' })
  await frame.getByRole('menuitem', { name: 'Edit Image', exact: true }).click()
  await frame.locator('.vim-image-editor-page').waitFor({ timeout: 30000 })
  await frame.locator('.fp-editor-status').waitFor({ state: 'hidden', timeout: 30000 })
  await page.waitForTimeout(2000)
  const editorCanvas = frame.locator('.fp-canvas-mount .upper-canvas')
  const editorCanvasBounds = await editorCanvas.boundingBox()
  assert(editorCanvasBounds, 'Editor canvas bounds not found')
  const dragOnEditor = async (fromX, fromY, toX, toY) => {
    await page.mouse.move(editorCanvasBounds.x + editorCanvasBounds.width * fromX, editorCanvasBounds.y + editorCanvasBounds.height * fromY)
    await page.mouse.down()
    await page.mouse.move(editorCanvasBounds.x + editorCanvasBounds.width * toX, editorCanvasBounds.y + editorCanvasBounds.height * toY, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(300)
  }
  const setShapeStroke = async (color, width = '8') => {
    await frame.locator('.fp-shape-width select').selectOption(width)
    await frame.locator('.fp-floating-options .fp-color-custom').click()
    await frame.locator('.fp-floating-options input[aria-label="HEX"]').fill(color)
    await page.keyboard.press('Escape')
  }
  const setSelectedShapeStyle = async (fill, stroke, opacity = '68') => {
    const panel = frame.locator('.fp-props-object-shape')
    await panel.waitFor({ timeout: 5000 })
    const chooseColor = async (fieldIndex, color) => {
      await panel.locator('.fp-color-field').nth(fieldIndex).locator('.fp-current-color').click()
      const popover = frame.locator('.fp-color-popover-v2').last()
      await popover.locator('.fp-color-custom').click()
      const input = frame.locator('.fp-custom-color-panel').last().locator('input[aria-label="HEX"]')
      await input.fill(color)
      await input.press('Enter')
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
    }
    await chooseColor(0, fill)
    await chooseColor(1, stroke)
    const opacityInput = panel.locator('input[type="range"]').last()
    await opacityInput.evaluate((element, value) => {
      const input = element
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }, opacity)
  }
  await frame.locator('.fp-toolbar button[title="Shapes (S)"]').click()
  await frame.locator('.fp-shape-kind-btn[aria-label="Rectangle"]').click()
  await setShapeStroke('#854d0e')
  await dragOnEditor(0.08, 0.13, 0.31, 0.46)
  await setSelectedShapeStyle('#fde68a', '#854d0e')
  await frame.locator('.fp-shape-kind-btn[aria-label="Circle"]').click()
  await setShapeStroke('#155e75')
  await dragOnEditor(0.38, 0.11, 0.61, 0.42)
  await setSelectedShapeStyle('#a5f3fc', '#155e75')
  await frame.locator('.fp-shape-kind-btn[aria-label="Triangle"]').click()
  await setShapeStroke('#86198f')
  await dragOnEditor(0.66, 0.42, 0.91, 0.79)
  await setSelectedShapeStyle('#f5d0fe', '#86198f')
  await frame.locator('.fp-shape-kind-btn[aria-label="Arrow"]').click()
  await setShapeStroke('#166534', '8')
  await dragOnEditor(0.13, 0.62, 0.57, 0.32)
  await frame.locator('.fp-toolbar button[title="Text (T)"]').click()
  await page.mouse.click(editorCanvasBounds.x + editorCanvasBounds.width * 0.62, editorCanvasBounds.y + editorCanvasBounds.height * 0.23)
  await frame.locator('.fp-text-field textarea').fill('Editable annotation')
  await frame.getByRole('spinbutton', { name: 'Font size', exact: true }).fill('120')
  await frame.getByRole('spinbutton', { name: 'Font size', exact: true }).press('Enter')
  await frame.locator('.fp-color-field button').first().click()
  await frame.locator('.fp-color-popover button[aria-label*="#ffffff"]').click()
  await frame.locator('.fp-toolbar button[title="Select (V)"]').click()
  await page.waitForTimeout(700)
  await capture('editor.png')
  await frame.locator('.fp-toolbar button[title="Measurement"]').click()
  const overlay = await frame.locator('[data-editor-overlay]').boundingBox()
  assert(overlay, 'Measurement canvas not found')
  const pointOnOverlay = (x, y) => ({ x: overlay.x + overlay.width * x, y: overlay.y + overlay.height * y })
  const clickOverlay = async (x, y) => {
    const point = pointOnOverlay(x, y)
    await page.mouse.click(point.x, point.y)
    await page.waitForTimeout(250)
  }
  const doubleClickOverlay = async (x, y) => {
    const point = pointOnOverlay(x, y)
    await page.mouse.dblclick(point.x, point.y)
    await page.waitForTimeout(350)
  }
  const setMeasurementStyle = async (color, width = '4') => {
    await frame.locator('.fp-measure-options select[aria-label="Line width"]').selectOption(width)
    await frame.locator('.fp-measure-options .fp-color-custom').click()
    await frame.locator('.fp-measure-options input[aria-label="HEX"]').fill(color)
    await page.keyboard.press('Escape')
  }
  await frame.locator('.fp-measure-options button[aria-label="Line"]').click()
  await setMeasurementStyle('#facc15')
  await clickOverlay(0.18, 0.63)
  await clickOverlay(0.42, 0.63)
  await frame.locator('.fp-measure-options button[aria-label="Polygon"]').click()
  await setMeasurementStyle('#f472b6', '8')
  await clickOverlay(0.64, 0.18)
  await clickOverlay(0.77, 0.12)
  await clickOverlay(0.90, 0.23)
  await clickOverlay(0.85, 0.39)
  await doubleClickOverlay(0.68, 0.37)
  await frame.locator('.fp-measure-options button[aria-label="Ellipse"]').click()
  await setMeasurementStyle('#22d3ee')
  const ellipseStart = pointOnOverlay(0.34, 0.73)
  const ellipseEnd = pointOnOverlay(0.51, 0.88)
  await page.mouse.move(ellipseStart.x, ellipseStart.y)
  await page.mouse.down()
  await page.mouse.move(ellipseEnd.x, ellipseEnd.y, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  await frame.locator('.fp-measure-options button[aria-label="Angle"]').click()
  await setMeasurementStyle('#ffffff')
  await clickOverlay(0.72, 0.72)
  await clickOverlay(0.79, 0.60)
  await clickOverlay(0.88, 0.72)
  await frame.getByRole('switch', { name: 'Show labels on canvas', exact: true }).click()
  await frame.getByRole('button', { name: 'Name and value', exact: true }).click()
  await frame.getByRole('spinbutton', { name: 'Line width', exact: true }).last().fill('4')
  await frame.getByRole('spinbutton', { name: 'Line width', exact: true }).last().press('Enter')
  await frame.getByRole('spinbutton', { name: 'Font size', exact: true }).last().fill('30')
  await frame.getByRole('spinbutton', { name: 'Font size', exact: true }).last().press('Enter')
  await frame.locator('.fp-toolbar button[title="Select (V)"]').click()
  await frame.locator('.fp-layer-item').filter({ hasText: 'Measurement-Polygon' }).first().click()
  await frame.waitForTimeout(500)
  assert.equal(await frame.locator('[data-measurement-node]').count(), 5, 'Polygon vertices are not visible')
  await frame.locator('.fp-histogram-btn').click()
  await frame.locator('[data-editor-histogram-panel]').waitFor()
  await page.waitForTimeout(800)
  await capture('editor-measurements.png')
  const canvas = await frame.locator('.fp-canvas-mount canvas').first().elementHandle()
  const layerCount = await frame.locator('.fp-layer-item').count()
  const settingsPath = path.join(userData, 'User', 'settings.json')
  const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'))
  settings['image-manager.appearance.language'] = 'zh-CN'
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2))
  await frame.locator('.fp-toolbar button[title="测量"]').waitFor({ timeout: 30000 })
  assert(await canvas.evaluate(element => element.isConnected), 'Language change recreated the canvas')
  assert.equal(await frame.locator('.fp-layer-item').count(), layerCount, 'Language change lost layers')
  await frame.getByRole('switch', { name: '在画面上显示标注', exact: true }).waitFor()
  settings['image-manager.appearance.language'] = 'en'
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2))
  await frame.locator('.fp-toolbar button[title="Measurement"]').waitFor({ timeout: 30000 })
  assert(await canvas.evaluate(element => element.isConnected), 'Language change recreated the canvas')
  console.log('Verified live EN -> ZH -> EN switching with the same canvas and layer count')
  console.log(JSON.stringify({ output, host: 'isolated real VS Code extension host', files: ['home.png', 'search.png', 'compression.png', 'similarity.png', 'preview.png', 'preview-details.png', 'editor.png', 'editor-measurements.png'] }, null, 2))
}
catch (error) {
  const page = browser?.contexts()[0]?.pages().find(candidate => candidate.url().includes('workbench'))
  if (page) {
    await page.screenshot({ path: path.join(runtime, 'failure.png') }).catch(() => {})
    console.error((await page.locator('body').innerText()).slice(-7000))
    console.error(page.frames().map(item => item.url()))
  }
  throw error
}
finally {
  await browser?.close()
  if (child.pid) {
    await new Promise(resolve => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true })
      killer.once('exit', resolve)
      killer.once('error', resolve)
    })
  }
}
