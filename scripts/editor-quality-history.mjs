import assert from 'node:assert/strict'

export async function checkRangeHistory(page) {
  const read = () => page.evaluate(() => {
    const e = window.__IM_EDITOR_INSTANCE__
    return { range: e.state.doc.background.valueRange ?? [0, 255], filters: e.state.doc.background.filters, undo: e.history.undoSize, pixels: [...e.getBackgroundImageData().data.slice(0, 4)] }
  })
  await page.evaluate(() => {
    const e = window.__IM_EDITOR_INSTANCE__
    e.setDisplayValueRange([0, 255])
    e.resetBackgroundFilters()
    e.clearUndoStack()
  })
  await page.locator('.fp-histogram-btn').click()
  const box = await page.locator('canvas[width="280"]').boundingBox()
  assert(box, 'Histogram not found')
  await page.mouse.move(box.x + 4, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height / 2, { steps: 15 })
  await page.mouse.up()
  await page.waitForTimeout(40)
  const range = await read()
  assert(range.range[0] > 20 && range.range[0] < 60)
  assert.equal(range.undo, 1, 'Range drag should be one history entry')
  await page.evaluate(() => window.__IM_EDITOR_INSTANCE__.setBackgroundFilters({ brightness: 0.2 }))
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(40)
  assert.deepEqual((await read()).range, range.range)
  assert.equal((await read()).filters, undefined)
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(40)
  assert.deepEqual((await read()).range, [0, 255])
  await page.keyboard.press('Control+Shift+z')
  await page.waitForTimeout(40)
  assert.deepEqual((await read()).range, range.range)
  await page.keyboard.press('Control+Shift+z')
  await page.waitForTimeout(40)
  assert.equal((await read()).filters.brightness, 0.2)
  await page.locator('.fp-histogram-btn').click()
  await page.getByRole('button', { name: '导出', expanded: false }).click()
  await page.getByRole('dialog', { name: '导出设置' }).getByRole('button', { name: '导出', exact: true }).click()
  await page.waitForFunction(() => window.__savedImage)
  const exported = await page.evaluate(async () => {
    const e = window.__IM_EDITOR_INSTANCE__
    const saved = window.__savedImage
    const image = new Image()
    image.src = saved.dataUrl
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    context.drawImage(image, 0, 0)
    const expected = e.getBackgroundImageData()
    const x = expected.width - 5
    const y = 5
    const index = (y * expected.width + x) * 4
    return { actual: [...context.getImageData(x, y, 1, 1).data], expected: [...expected.data.slice(index, index + 4)], width: image.naturalWidth, height: image.naturalHeight, prompt: saved.prompt }
  })
  assert.deepEqual(exported.actual, exported.expected, 'Saved output applies the display range more than once')
  assert.equal(exported.prompt, true)
  assert.equal(exported.width, 800)
  assert.equal(exported.height, 600)
  return { feature: 'histogram gesture and filters share chronological keyboard undo/redo', passed: true }
}
