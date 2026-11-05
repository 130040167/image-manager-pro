import assert from 'node:assert/strict'
import path from 'node:path'
import { checkCustomColors } from './editor-quality-colors.mjs'

export async function checkAnnotations(page, output) {
  const editor = fn => page.evaluate(fn)
  const object = id => page.evaluate(id => window.__IM_EDITOR_INSTANCE__.state.getObject(id), id)
  const point = (x, y) => page.evaluate(({ x, y }) => {
    const c = window.__IM_EDITOR_INSTANCE__.fabricRenderer.canvas
    const r = c.upperCanvasEl.getBoundingClientRect()
    const v = c.viewportTransform
    return { x: r.x + x * v[0] + v[4], y: r.y + y * v[3] + v[5] }
  }, { x, y })
  const click = async (x, y, options) => {
    const p = await point(x, y)
    await page.mouse.click(p.x, p.y, options)
  }
  const drag = async (from, to) => {
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(40)
  }
  const dragHandle = async (locator, dx, dy) => {
    const box = await locator.boundingBox()
    assert(box, 'Handle is missing')
    await drag({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, { x: box.x + box.width / 2 + dx, y: box.y + box.height / 2 + dy })
  }
  const select = async (id) => {
    await page.evaluate(id => window.__IM_EDITOR_INSTANCE__.selectObjects([id]), id)
    await page.waitForTimeout(30)
  }
  assert.equal(await page.locator('.fp-toolbar button[title="箭头 (A)"], .fp-toolbar button[title="直线 (L)"]').count(), 0)

  const zoom = page.getByRole('spinbutton', { name: '缩放百分比', exact: true })
  await zoom.fill('175')
  await zoom.press('Enter')
  assert.equal(await editor(() => window.__IM_EDITOR_INSTANCE__.getZoom()), 1.75)
  await zoom.click()
  assert.equal(await editor(() => window.__IM_EDITOR_INSTANCE__.getZoom()), 1.75)
  await zoom.fill('260')
  await zoom.press('Escape')
  assert.equal(await editor(() => window.__IM_EDITOR_INSTANCE__.getZoom()), 1.75, 'Escape committed zoom draft')
  await zoom.fill('')
  await zoom.press('Tab')
  assert.equal(await zoom.inputValue(), '175')
  await page.getByRole('button', { name: '重置缩放并居中', exact: true }).click()
  assert.equal(await editor(() => window.__IM_EDITOR_INSTANCE__.getZoom()), 1)

  await page.locator('.fp-toolbar button[title="形状 (S)"]').click()
  assert.equal(await page.locator('.fp-shape-kind-group button svg').count(), 5)
  await page.locator('.fp-shape-options button[aria-label="箭头"]').click()
  await page.locator('.fp-shape-options button[aria-label="线型"]').click()
  assert.equal(await page.locator('.fp-dash-menu [role="option"]').count(), 6)
  await page.getByRole('option', { name: '密集虚线', exact: true }).click()
  await page.getByRole('button', { name: '创建箭头起点', exact: true }).click()
  await page.getByRole('option', { name: '空心箭头', exact: true }).click()
  await page.screenshot({ path: path.join(output, 'editor-shape-options.png') })
  await drag(await point(180, 260), await point(520, 260))
  await click(760, 560, { button: 'right' })
  const arrow = await editor(() => window.__IM_EDITOR_INSTANCE__.state.doc.objects.find(o => o.tool === 'arrow'))
  assert(arrow)
  assert.equal(arrow.startHead, 'open')
  assert.equal(arrow.endHead, 'filled')
  assert.deepEqual(arrow.strokeDash, [3, 2])
  assert(Math.abs(arrow.arrowStart.x - 180) < 0.6 && Math.abs(arrow.arrowStart.y - 260) < 0.6, JSON.stringify(arrow.arrowStart))
  await select(arrow.id)
  await page.getByRole('spinbutton', { name: '头部长度', exact: true }).fill('40')
  await page.getByRole('spinbutton', { name: '头部宽度', exact: true }).fill('60')
  await page.getByRole('spinbutton', { name: '头部宽度', exact: true }).press('Enter')
  assert.equal(await page.getByRole('spinbutton', { name: '线宽', exact: true }).evaluate(el => getComputedStyle(el).colorScheme), 'dark')
  const beforeHead = await object(arrow.id)
  await editor(() => window.__IM_EDITOR_INSTANCE__.clearUndoStack())
  await dragHandle(page.locator('[data-arrow-handle="width"]'), 0, 20)
  const afterHead = await object(arrow.id)
  assert(afterHead.headWidth > beforeHead.headWidth + 15, 'Width handle did not change head')
  assert.equal(await editor(() => window.__IM_EDITOR_INSTANCE__.history.undoSize), 1)
  await editor(() => window.__IM_EDITOR_INSTANCE__.undo())
  assert.equal((await object(arrow.id)).headWidth, beforeHead.headWidth)
  await editor(() => window.__IM_EDITOR_INSTANCE__.redo())

  // Render one object without selection chrome or background for exact before/after comparisons.
  await page.evaluate((id) => {
    window.__renderQualityObject = (objectId = id) => {
      const canvas = document.createElement('canvas')
      canvas.width = 1000
      canvas.height = 700
      const ctx = canvas.getContext('2d')
      const f = window.__IM_EDITOR_INSTANCE__.fabricRenderer.getObjectsByIds([objectId])[0]
      f.render(ctx)
      return ctx.getImageData(0, 0, 1000, 700).data
    }
  }, arrow.id)
  // Open heads must not get implicitly closed by Canvas fill().
  const openPixel = await page.evaluate((id) => {
    const o = window.__IM_EDITOR_INSTANCE__.state.getObject(id)
    const p = o.arrowStart
    const data = window.__renderQualityObject()
    const x = Math.round(p.x + o.headLength * 0.6)
    const y = Math.round(p.y + o.headWidth * 0.13)
    return data[(y * 1000 + x) * 4 + 3]
  }, arrow.id)
  assert.equal(openPixel, 0, 'Open arrow was rendered as a filled triangle')

  // A real Fabric side-control gesture exercises nonuniform scaling before release.
  const start = await page.evaluate((id) => {
    const e = window.__IM_EDITOR_INSTANCE__
    const f = e.fabricRenderer.getObjectsByIds([id])[0]
    f.setCoords()
    const r = e.fabricRenderer.canvas.upperCanvasEl.getBoundingClientRect()
    return { x: r.x + f.oCoords.br.x, y: r.y + f.oCoords.br.y }
  }, arrow.id)
  await page.mouse.move(start.x, start.y)
  await page.keyboard.down('Shift')
  await page.mouse.down()
  await page.mouse.move(start.x + 90, start.y, { steps: 8 })
  await page.waitForTimeout(40)
  const live = await page.evaluate((id) => {
    const f = window.__IM_EDITOR_INSTANCE__.fabricRenderer.getObjectsByIds([id])[0]
    window.__liveArrowPixels = window.__renderQualityObject()
    return { scale: f.scaleX, strokeUniform: f.strokeUniform }
  }, arrow.id)
  assert(live.scale > 1.1, 'Side resize did not scale the arrow')
  assert(live.strokeUniform)
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await page.waitForTimeout(50)
  const diff = await editor(() => {
    const committed = window.__renderQualityObject()
    const live = window.__liveArrowPixels
    let changed = 0
    for (let index = 3; index < committed.length; index += 4) {
      if (Math.abs(committed[index] - live[index]) > 8)
        changed++
    }
    return changed
  })
  assert(diff < 35, `Arrow changed ${diff} pixels on pointerup`)
  await page.screenshot({ path: path.join(output, 'editor-arrow-properties.png') })

  const shapeDiffs = {}
  for (const kind of ['rect', 'circle', 'triangle']) {
    const id = await page.evaluate((kind) => {
      const e = window.__IM_EDITOR_INSTANCE__
      e.addShape(kind, { left: 420, top: 80, width: 150, height: 90, fill: 'transparent', stroke: '#22ccff', strokeWidth: 6, strokeDash: [3, 2] })
      return e.state.doc.objects.at(-1).id
    }, kind)
    await select(id)
    const corner = await page.evaluate((id) => {
      const e = window.__IM_EDITOR_INSTANCE__
      const f = e.fabricRenderer.getObjectsByIds([id])[0]
      f.setCoords()
      const r = e.fabricRenderer.canvas.upperCanvasEl.getBoundingClientRect()
      return { x: r.x + f.oCoords.br.x, y: r.y + f.oCoords.br.y }
    }, id)
    await page.mouse.move(corner.x, corner.y)
    await page.keyboard.down('Shift')
    await page.mouse.down()
    await page.mouse.move(corner.x + 60, corner.y + 20, { steps: 8 })
    const scales = await page.evaluate((id) => {
      const e = window.__IM_EDITOR_INSTANCE__
      const f = e.fabricRenderer.getObjectsByIds([id])[0]
      window.__liveShapePixels = window.__renderQualityObject(id)
      return [f.scaleX, f.scaleY, f.strokeUniform]
    }, id)
    assert(scales[0] > 1.1 && Math.abs(scales[0] - scales[1]) > 0.05, `Failed to nonuniformly resize ${kind}`)
    assert(scales[2])
    await page.mouse.up()
    await page.keyboard.up('Shift')
    await page.waitForTimeout(30)
    shapeDiffs[kind] = await page.evaluate((id) => {
      const after = window.__renderQualityObject(id)
      let changed = 0
      for (let i = 3; i < after.length; i += 4) {
        if (Math.abs(after[i] - window.__liveShapePixels[i]) > 8)
          changed++
      }
      return changed
    }, id)
    assert(shapeDiffs[kind] < 35, `${kind} changed ${shapeDiffs[kind]} pixels on release`)
    await editor(() => window.__IM_EDITOR_INSTANCE__.removeActiveObject())
  }

  // New measurements remain in creation mode, but their nodes stay hidden after deselection.
  await page.locator('.fp-toolbar button[title="测量"]').click()
  await page.locator('.fp-measure-options button[aria-label="角度"]').click()
  await click(420, 410)
  await click(200, 410)
  await click(330, 200)
  assert.equal(await page.locator('.fp-measure-options').count(), 1)
  await click(760, 560, { button: 'right' })
  const angle = await editor(() => window.__IM_EDITOR_INSTANCE__.state.doc.objects.find(o => o.measurementKind === 'angle'))
  assert(angle)
  const annotationVisibility = page.getByRole('switch', { name: '在画面上显示标注', exact: true })
  assert.equal(await annotationVisibility.getAttribute('aria-checked'), 'false', 'New measurements should hide canvas labels')
  await annotationVisibility.click()
  await editor(() => window.__IM_EDITOR_INSTANCE__.deactivateAll())
  assert.equal(await page.locator(`[data-measurement-id="${angle.id}"]`).count(), 0)
  await select(angle.id)
  assert.equal(await page.locator(`[data-measurement-id="${angle.id}"]`).count(), 3)
  await page.getByLabel('弧线样式', { exact: true }).selectOption('double')
  assert.equal((await object(angle.id)).path.match(/ A /g).length, 2)
  await editor(() => window.__IM_EDITOR_INSTANCE__.clearUndoStack())
  await dragHandle(page.locator(`[data-measurement-arc="${angle.id}"]`), 35, -15)
  const afterArc = await object(angle.id)
  assert(afterArc.measurementArc.radius > 30)
  assert.equal(await editor(() => window.__IM_EDITOR_INSTANCE__.history.undoSize), 1, 'Arc drag polluted history')
  await editor(() => window.__IM_EDITOR_INSTANCE__.undo())
  assert.equal((await object(angle.id)).measurementArc.radius, 22)
  await editor(() => window.__IM_EDITOR_INSTANCE__.redo())
  await page.getByRole('button', { name: '名称与数值', exact: true }).click()
  await page.getByLabel('名称来源', { exact: true }).selectOption('custom')
  await page.getByRole('textbox', { name: '标注名称', exact: true }).fill('接触角')
  await page.getByRole('spinbutton', { name: '字号', exact: true }).fill('18')
  await page.getByRole('spinbutton', { name: '字号', exact: true }).press('Enter')
  await page.getByRole('button', { name: '标注文字颜色选择', exact: true }).click()
  await page.locator('.fp-color-popover .fp-color-custom').click()
  await page.getByRole('textbox', { name: 'HEX', exact: true }).fill('#ffdd88')
  await page.getByRole('textbox', { name: 'HEX', exact: true }).press('Escape')
  assert.equal(await page.locator('.fp-color-popover .fp-color-custom-active').count(), 1)
  await page.getByRole('button', { name: '标注文字颜色选择', exact: true }).click()
  assert((await page.locator('.fp-layers-panel').textContent()).includes('接触角'))
  const label = page.locator(`[data-measurement-label="${angle.id}"]`)
  const lineValueCheck = await page.evaluate(() => window.__IM_EDITOR_INSTANCE__.state.doc.objects.find(o => o.measurementKind === 'angle')?.measurementLabel)
  assert(lineValueCheck)
  assert(!await page.locator('.fp-measurement-result-number').filter({ hasText: /px/ }).count(), 'Canvas/property number should not include a unit suffix')
  await editor(() => window.__IM_EDITOR_INSTANCE__.clearUndoStack())
  await dragHandle(label, 95, 80)
  const movedLabel = await object(angle.id)
  assert(movedLabel.measurementLabel.offset.x > 60)
  assert.equal(await editor(() => window.__IM_EDITOR_INSTANCE__.history.undoSize), 1)
  await editor(() => window.__IM_EDITOR_INSTANCE__.undo())
  assert.equal((await object(angle.id)).measurementLabel.offset.x, 0)
  await editor(() => window.__IM_EDITOR_INSTANCE__.redo())
  const oldLabel = await label.boundingBox()
  const oldOffset = (await object(angle.id)).measurementLabel.offset
  await drag(await point(280, 410), await point(325, 440))
  const newLabel = await label.boundingBox()
  assert(Math.abs(newLabel.x - oldLabel.x) > 10 && Math.abs(newLabel.y - oldLabel.y) > 10, 'Label failed to follow object')
  assert.deepEqual((await object(angle.id)).measurementLabel.offset, oldOffset)
  await page.screenshot({ path: path.join(output, 'editor-measurement-annotations.png') })
  // Selection exports must include labels even when they extend beyond the shape bbox.
  const exported = await page.evaluate(async (id) => {
    const e = window.__IM_EDITOR_INSTANCE__
    const f = e.fabricRenderer.getObjectsByIds([id])[0]
    const label = f.getAnnotationBounds()
    const shape = f.getBoundingRect()
    const image = new Image()
    image.src = e.toDataURL({ selectionOnly: true })
    await image.decode()
    return { width: image.width, height: image.height, expectedWidth: Math.max(shape.left + shape.width, label.left + label.width) - Math.min(shape.left, label.left), expectedHeight: Math.max(shape.top + shape.height, label.top + label.height) - Math.min(shape.top, label.top) }
  }, angle.id)
  assert(Math.abs(exported.width - exported.expectedWidth) <= 1)
  assert(Math.abs(exported.height - exported.expectedHeight) <= 1)
  await annotationVisibility.click()
  assert.equal(await label.count(), 0)
  assert.equal(await page.evaluate(id => window.__IM_EDITOR_INSTANCE__.fabricRenderer.getObjectsByIds([id])[0].getAnnotationBounds(), angle.id), null)
  assert.equal(await page.getByLabel('属性中显示', { exact: true }).count(), 0)
  assert.equal(await page.locator('.fp-measurement-summary').count(), 1)
  assert.equal(await page.getByRole('group', { name: '标注内容', exact: true }).count(), 0, 'Hidden annotations still expose label settings')
  await annotationVisibility.click()
  await page.getByRole('button', { name: '名称', exact: true }).click()
  assert((await page.locator('.fp-measurement-summary').textContent()).includes('角度'), 'Property value was hidden by name-only canvas content')
  const fontSize = page.getByRole('spinbutton', { name: '字号', exact: true })
  await fontSize.fill('')
  await fontSize.pressSequentially('0.5')
  await fontSize.press('Enter')
  assert.equal((await object(angle.id)).measurementLabel.fontSize, 0.5)
  assert.equal(await page.evaluate(id => window.__IM_EDITOR_INSTANCE__.fabricRenderer.getObjectsByIds([id])[0].getAnnotationBounds().fontSize, angle.id), 0.5)
  await fontSize.fill('')
  await fontSize.press('Tab')
  assert.equal(await fontSize.inputValue(), '0.5')
  await fontSize.fill('14')
  await fontSize.press('Enter')
  await page.getByLabel('标注字体', { exact: true }).selectOption('monospace')
  await page.getByLabel('标注背景', { exact: true }).selectOption('none')
  assert.equal((await object(angle.id)).measurementLabel.background, 'none')
  await page.getByLabel('标注背景', { exact: true }).selectOption('custom')
  await page.getByRole('spinbutton', { name: '背景透明度 (%)', exact: true }).fill('50')
  await page.getByRole('spinbutton', { name: '背景透明度 (%)', exact: true }).press('Enter')
  await page.getByRole('button', { name: '标注背景颜色选择', exact: true }).click()
  await page.locator('.fp-color-popover .fp-color-custom').click()
  await page.getByRole('textbox', { name: 'HEX', exact: true }).fill('#224466')
  await page.getByRole('textbox', { name: 'HEX', exact: true }).press('Escape')
  await page.getByRole('button', { name: '标注背景颜色选择', exact: true }).click()
  const settings = (await object(angle.id)).measurementLabel
  assert.equal(settings.backgroundColor, '#224466')
  assert.equal(settings.backgroundOpacity, 0.5)
  assert.equal(settings.fontFamily, 'monospace')
  const resultNumber = await page.locator('.fp-measurement-result-number').first().boundingBox()
  const resultUnit = await page.locator('.fp-measurement-result-unit').first().boundingBox()
  assert(resultNumber && resultUnit && resultUnit.x - (resultNumber.x + resultNumber.width) >= 12, 'Measurement value and unit are not visually separated')
  const backgroundExport = await page.evaluate(async (id) => {
    const e = window.__IM_EDITOR_INSTANCE__
    const saved = e.state.getObject(id).measurementLabel
    const readPadding = async (background) => {
      e.changeMeasurementAnnotation(id, { measurementLabel: { ...saved, background, offset: { x: 500, y: -500 } } })
      const f = e.fabricRenderer.getObjectsByIds([id])[0]
      const box = f.getAnnotationBounds()
      const shape = f.getBoundingRect()
      const image = new Image()
      image.src = e.toDataURL({ selectionOnly: true })
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(image, 0, 0)
      return [...ctx.getImageData(Math.floor(box.left + box.width / 2 - Math.min(box.left, shape.left)), Math.floor(box.top + 1 - Math.min(box.top, shape.top)), 1, 1).data]
    }
    try {
      return { custom: await readPadding('custom'), default: await readPadding('default'), none: await readPadding('none') }
    }
    finally {
      e.changeMeasurementAnnotation(id, { measurementLabel: saved })
    }
  }, angle.id)
  assert(backgroundExport.custom.every((value, index) => Math.abs(value - [34, 68, 102, 128][index]) <= 1), JSON.stringify(backgroundExport))
  assert(backgroundExport.default.every((value, index) => Math.abs(value - [15, 23, 42, 128][index]) <= 1), JSON.stringify(backgroundExport))
  assert.equal(backgroundExport.none[3], 0, 'Hidden label background remained in export')
  const marker = await page.locator(`[data-measurement-marker="${angle.id}"]`).first().evaluate(el => ({ paths: el.querySelectorAll('path').length, fill: el.querySelector('path').getAttribute('fill') }))
  assert.equal(marker.paths, 2)
  assert.notEqual(marker.fill, (await object(angle.id)).stroke)
  await page.screenshot({ path: path.join(output, 'editor-measurement-compact.png') })
  await page.getByLabel('弧线样式', { exact: true }).selectOption('none')
  assert(!(await object(angle.id)).path.includes(' A '))
  await checkCustomColors(page, output, angle.id)
  return { feature: 'shape icons, dash patterns, arrow endpoints and live rendering, measurement labels/arc/history/export, zoom drafts and dark inputs', passed: true, arrowPointerupPixelDiff: diff, shapeDiffs }
}
