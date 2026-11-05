import assert from 'node:assert/strict'
import path from 'node:path'

export async function checkDrawingQuality(page, output) {
  const read = () => page.evaluate(() => {
    const e = window.__IM_EDITOR_INSTANCE__
    return { objects: e.state.doc.objects, selection: e.state.selection }
  })
  const point = (x, y) => page.evaluate(({ x, y }) => {
    const c = window.__IM_EDITOR_INSTANCE__.fabricRenderer.canvas
    const r = c.upperCanvasEl.getBoundingClientRect()
    const v = c.viewportTransform
    return { x: r.x + x * v[0] + v[4], y: r.y + y * v[3] + v[5] }
  }, { x, y })
  const click = async (x, y, options) => {
    const p = await point(x, y)
    await page.mouse.click(p.x, p.y, options)
    await page.waitForTimeout(35)
  }
  const drag = async (x, y, endX, endY) => {
    const a = await point(x, y)
    const b = await point(endX, endY)
    await page.mouse.move(a.x, a.y)
    await page.mouse.down()
    await page.mouse.move(b.x, b.y, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(40)
  }
  const histogram = await page.locator('.fp-histogram-btn').boundingBox()
  const theme = await page.getByRole('button', { name: '切换主题', exact: true }).boundingBox()
  assert(histogram.x < theme.x, 'Histogram should precede theme')

  await page.locator('.fp-toolbar button[title="形状 (S)"]').click()
  assert.equal(await page.getByLabel('形状线宽', { exact: true }).inputValue(), '1')
  await drag(140, 100, 290, 210)
  let state = await read()
  const first = state.objects.at(-1)
  assert.equal(first.strokeWidth, 1)
  assert.deepEqual(state.selection, [first.id], 'Created shape is not selected in properties')
  const color = page.locator('.fp-shape-options button[aria-label^="色板 " ]').first()
  // Preset color changes must target the next shape despite auto-selection.
  await color.click()
  assert.equal((await read()).objects.find(o => o.id === first.id).stroke, first.stroke)
  await drag(380, 100, 550, 210)
  state = await read()
  assert.deepEqual(state.selection, [state.objects.at(-1).id])
  await click(740, 550, { button: 'right' })

  await page.locator('.fp-toolbar button[title="测量"]').click()
  assert.equal(await page.locator('.fp-measure-options select[aria-label="线宽"]').inputValue(), '1')
  await click(140, 320)
  await click(500, 320)
  state = await read()
  const line = state.objects.at(-1)
  assert.equal(line.strokeWidth, 1)
  assert.deepEqual(state.selection, [line.id])
  assert.equal(await page.getByLabel('在画面上显示', { exact: true }).isChecked(), false)
  assert.equal(await page.locator(`[data-measurement-label="${line.id}"]`).count(), 0)
  assert.equal(await page.locator('.fp-measure-options').count(), 1)
  await click(140, 410)
  await click(500, 410)
  state = await read()
  assert.equal(state.objects.filter(o => o.tool === 'measurement').length, 2)
  assert.deepEqual(state.selection, [state.objects.at(-1).id])
  await click(740, 550, { button: 'right' })
  await page.evaluate(id => window.__IM_EDITOR_INSTANCE__.selectObjects([id]), line.id)
  const node = page.locator(`[data-measurement-id="${line.id}"][data-measurement-node="0"]`)
  await node.hover()
  await page.waitForTimeout(130)
  assert.equal(await node.locator('..').locator('.fp-measure-node-halo').evaluate(el => getComputedStyle(el).opacity), '1')
  const separation = await page.evaluate((id) => {
    const e = window.__IM_EDITOR_INSTANCE__
    const f = e.fabricRenderer.getObjectsByIds([id])[0]
    const p = e.state.getObject(id).measurementPoints[0]
    const v = e.fabricRenderer.canvas.viewportTransform
    const screen = { x: p.x * v[0] + v[4], y: p.y * v[3] + v[5] }
    f.setCoords()
    return Math.min(...Object.values(f.oCoords).map(c => Math.hypot(c.x - screen.x, c.y - screen.y)))
  }, line.id)
  assert(separation >= 13, `Box controls overlap measurement nodes: ${separation}`)

  const chooseEndpoint = async (label, value) => {
    await page.getByRole('button', { name: label, exact: true }).click()
    await page.getByRole('option', { name: value, exact: true }).click()
  }
  await chooseEndpoint('起点样式', '空心圆')
  await chooseEndpoint('终点样式', '实心箭头')
  await page.getByRole('spinbutton', { name: '端点大小', exact: true }).fill('18.5')
  await page.getByRole('spinbutton', { name: '端点大小', exact: true }).press('Enter')
  const measurement = (await read()).objects.find(o => o.id === line.id)
  assert.equal(measurement.measurementEndpoints.start, 'hollow-circle')
  assert.equal(measurement.measurementEndpoints.end, 'filled-arrow')
  assert.equal(measurement.measurementEndpoints.size, 18.5)
  assert.match(await page.locator('.fp-measurement-summary').textContent(), /360\.00/)
  await page.getByRole('spinbutton', { name: '小数位数', exact: true }).fill('4')
  await page.getByRole('spinbutton', { name: '小数位数', exact: true }).press('Enter')
  assert.match(await page.locator('.fp-measurement-summary').textContent(), /360\.0000/)

  const endpointPixels = await page.evaluate(async (id) => {
    const e = window.__IM_EDITOR_INSTANCE__
    const result = []
    const render = (f) => {
      const canvas = document.createElement('canvas')
      canvas.width = 800
      canvas.height = 600
      const ctx = canvas.getContext('2d')
      f.render(ctx)
      return ctx.getImageData(0, 0, 800, 600).data
    }
    for (const style of ['filled-arrow', 'simple-arrow', 'hollow-circle', 'filled-circle', 'bar']) {
      e.changeMeasurementAnnotation(id, { measurementEndpoints: { start: style, end: style, size: 24 } })
      const f = e.fabricRenderer.getObjectsByIds([id])[0]
      const data = render(f)
      const center = data[(320 * 800 + 140) * 4 + 3]
      const image = new Image()
      image.src = e.toDataURL({ selectionOnly: true })
      await image.decode()
      result.push({ style, center, exportHeight: image.height, bbox: f.getBoundingRect() })
    }
    return result
  }, line.id)
  for (const result of endpointPixels)
    assert(result.exportHeight >= 24, `Endpoint export clipped ${JSON.stringify(result)}`)
  assert.equal(endpointPixels.find(p => p.style === 'hollow-circle').center, 0, 'Hollow circle contains the shaft')
  assert(endpointPixels.find(p => p.style === 'filled-circle').center > 240)
  await page.screenshot({ path: path.join(output, 'editor-drawing-quality.png') })

  // Display precision must not quantize geometry on an untouched focus/blur.
  await page.locator('.fp-toolbar button[title="形状 (S)"]').click()
  await page.locator('.fp-shape-options button[aria-label="箭头"]').click()
  await page.getByRole('button', { name: '创建箭头起点', exact: true }).click()
  await page.getByRole('option', { name: '实心箭头', exact: true }).click()
  await drag(170, 490, 530, 490)
  const arrow = (await read()).objects.at(-1)
  assert.equal(arrow.strokeWidth, 1)
  assert.deepEqual((await read()).selection, [arrow.id])
  await click(740, 550, { button: 'right' })
  await page.evaluate(() => window.__IM_EDITOR_INSTANCE__.changeArrowStyle({ headLength: 17.3456789, headWidth: 35.6789123 }))
  const length = page.getByRole('spinbutton', { name: '头部长度', exact: true })
  assert.equal(await length.inputValue(), '17.3')
  await length.focus()
  await length.press('Tab')
  assert.equal((await read()).objects.find(o => o.id === arrow.id).headLength, 17.3456789)
  await length.fill('')
  await length.press('Tab')
  assert.equal(await length.inputValue(), '17.3')
  assert.equal((await read()).objects.find(o => o.id === arrow.id).headLength, 17.3456789)
  for (const handle of ['start-width', 'start-length', 'width', 'length'])
    assert.equal(await page.locator(`[data-arrow-handle="${handle}"]`).count(), 1)
  const startWidth = page.locator('[data-arrow-handle="start-width"]')
  await startWidth.hover()
  await page.waitForTimeout(140)
  assert.notEqual(await startWidth.locator('.fp-geometry-handle-visible').evaluate(el => getComputedStyle(el).filter), 'none')
  const box = await startWidth.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 15, { steps: 6 })
  await page.mouse.up()
  assert.notEqual((await read()).objects.find(o => o.id === arrow.id).headWidth, 35.6789123)

  const smoothing = await page.evaluate(() => {
    const e = window.__IM_EDITOR_INSTANCE__
    const result = []
    for (const zoom of [0.6, 1, 20]) {
      e.setZoom(zoom)
      const c = e.fabricRenderer.canvas
      result.push({ scale: c.viewportTransform[0], smooth: c.backgroundImage.imageSmoothing, retina: c.getRetinaScaling(), quality: c.getContext().imageSmoothingQuality })
    }
    e.setZoom(1)
    return result
  })
  assert(smoothing.slice(0, 2).every(s => s.smooth && s.quality === 'high'))
  assert.equal(smoothing[2].smooth, false)
  return { feature: 'drawing defaults, selection, hover, endpoints, precision and zoom quality', passed: true, separation, endpointPixels, smoothing }
}
