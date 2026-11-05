import assert from 'node:assert/strict'
import path from 'node:path'

export async function checkPixelComparison(page, output) {
  const sourcePoint = (x, y) => page.evaluate(({ x, y }) => {
    const canvas = window.__IM_EDITOR_INSTANCE__.fabricRenderer.canvas
    const image = canvas.backgroundImage
    const m = image.calcTransformMatrix()
    const dx = x + 0.5 - image.width / 2
    const dy = y + 0.5 - image.height / 2
    const point = { x: m[0] * dx + m[2] * dy + m[4], y: m[1] * dx + m[3] * dy + m[5] }
    const v = canvas.viewportTransform
    const rect = canvas.upperCanvasEl.getBoundingClientRect()
    return { x: rect.x + point.x * v[0] + v[4], y: rect.y + point.y * v[3] + v[5] }
  }, { x, y })
  const hover = async (x, y) => {
    const point = await sourcePoint(x, y)
    await page.mouse.move(point.x, point.y)
    await page.waitForTimeout(50)
    return page.locator('.fp-topbar-pixel').textContent()
  }
  assert.equal(await hover(245, 350), '(245, 350) 64 120 80')
  await page.evaluate(() => window.__IM_EDITOR_INSTANCE__.setDisplayValueRange([60, 180]))
  assert.match(await hover(245, 350), /^\(245, 350\) 64 120 80 → (8|9) (127|128) (42|43)$/)
  const rangePoint = await sourcePoint(245, 350)
  const renderedRange = await page.evaluate((p) => {
    const canvas = window.__IM_EDITOR_INSTANCE__.fabricRenderer.canvas
    const rect = canvas.lowerCanvasEl.getBoundingClientRect()
    return [...canvas.contextContainer.getImageData(Math.floor(p.x - rect.x), Math.floor(p.y - rect.y), 1, 1).data].slice(0, 3)
  }, rangePoint)
  assert((await hover(245, 350)).endsWith(`→ ${renderedRange.join(' ')}`), 'Range readout differs from rendered pixels')
  await page.evaluate(() => {
    const editor = window.__IM_EDITOR_INSTANCE__
    editor.setDisplayValueRange([0, 255])
    editor.setBackgroundFilters({ invert: true })
  })
  assert.equal(await hover(245, 350), '(245, 350) 64 120 80 → 191 135 175')
  await page.evaluate(() => {
    const editor = window.__IM_EDITOR_INSTANCE__
    editor.resetBackgroundFilters()
    editor.addShape('rect', { left: 245, top: 350, width: 100, height: 100, fill: '#ff0000', strokeWidth: 0 })
    editor.selectObjects([editor.state.doc.objects.at(-1).id])
    editor.setObjectOpacity([...editor.state.selection], 0.5)
  })
  const blended = await hover(245, 350)
  assert.match(blended, /^\(245, 350\) 64 120 80 → (159|160) 60 40$/)
  // Readout must ignore selection handles and remain in source pixels at every zoom/rotation.
  for (const angle of [0, 37, 90, 270]) {
    await page.evaluate(angle => window.__IM_EDITOR_INSTANCE__.setAngle(angle), angle)
    await page.waitForTimeout(30)
    assert.equal(await hover(245, 350), blended)
    const zoom = await page.evaluate(() => {
      const e = window.__IM_EDITOR_INSTANCE__
      e.setZoom(0.5)
      return e.getCompositePixel(245, 350)
    })
    assert(zoom.r >= 159 && zoom.r <= 160 && zoom.g === 60 && zoom.b === 40)
    await page.evaluate(() => window.__IM_EDITOR_INSTANCE__.resetZoom())
  }
  await page.evaluate(() => {
    const e = window.__IM_EDITOR_INSTANCE__
    e.setAngle(0)
    e.clearObjects()
    e.clearUndoStack()
    e.startFreeDrawing({ color: '#ff0000', width: 16 })
  })
  const from = await sourcePoint(215, 350)
  const to = await sourcePoint(275, 350)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up()
  await page.evaluate(() => window.__IM_EDITOR_INSTANCE__.endAll())
  assert.equal(await hover(245, 350), '(245, 350) 64 120 80 → 255 0 0')
  const strokeSamples = []
  for (const zoom of [0.5, 1, 2]) {
    await page.evaluate(zoom => window.__IM_EDITOR_INSTANCE__.setZoom(zoom), zoom)
    await page.waitForTimeout(40)
    strokeSamples.push(await page.evaluate(() => Array.from({ length: 22 }, (_, i) => window.__IM_EDITOR_INSTANCE__.getCompositePixel(245, 340 + i))))
  }
  assert.deepEqual(strokeSamples[0], strokeSamples[1], 'Freehand pixel values depend on viewport cache scale')
  assert.deepEqual(strokeSamples[1], strokeSamples[2], 'Freehand edge values depend on viewport cache scale')
  await page.evaluate(() => {
    const e = window.__IM_EDITOR_INSTANCE__
    // Viewport checks above add history entries; return to the stroke history before undo.
    e.undo()
    e.undo()
    e.undo()
  })
  await page.evaluate(() => window.__IM_EDITOR_INSTANCE__.undo())
  assert.equal(await hover(245, 350), '(245, 350) 64 120 80')
  await page.evaluate(() => window.__IM_EDITOR_INSTANCE__.redo())
  assert.equal(await hover(245, 350), '(245, 350) 64 120 80 → 255 0 0')
  await page.evaluate(() => {
    const e = window.__IM_EDITOR_INSTANCE__
    e.clearObjects()
    e.startMosaicDrawing({ dimensions: 80 })
  })
  const mosaicStart = await sourcePoint(300, 350)
  const mosaicEnd = await sourcePoint(302, 350)
  await page.mouse.move(mosaicStart.x, mosaicStart.y)
  await page.mouse.down()
  await page.mouse.move(mosaicEnd.x, mosaicEnd.y, { steps: 2 })
  await page.mouse.up()
  await page.evaluate(() => window.__IM_EDITOR_INSTANCE__.endAll())
  const mosaic = await page.evaluate(() => window.__IM_EDITOR_INSTANCE__.state.doc.objects.find(o => o.kind === 'mosaic'))
  assert(mosaic && mosaic.rects.length > 0)
  const rgb = mosaic.rects.at(-1).color.match(/\d+/g).map(Number)
  assert.equal(await hover(300, 350), `(300, 350) 96 120 96 → ${rgb.join(' ')}`)
  await page.screenshot({ path: path.join(output, 'editor-pixel-comparison.png') })
  for (const width of [1280, 760, 640, 480]) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForTimeout(40)
    await hover(300, 350)
    const layout = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect()
      return { pixelRight: rect('.fp-topbar-pixel').right, historyLeft: rect('.fp-topbar-history').left }
    })
    assert(layout.pixelRight <= layout.historyLeft, `Pixel comparison overlaps controls at ${width}: ${JSON.stringify(layout)}`)
  }
  return { feature: 'original to composite pixels: range, filters, transparent layers, rotation, zoom, free drawing, mosaic, undo/redo', passed: true }
}
