import assert from 'node:assert/strict'
import path from 'node:path'

export async function checkMeasurements(page, output) {
  const editorObjects = () => page.evaluate(() => window.__IM_EDITOR_INSTANCE__.state.doc.objects.filter(o => o.tool === 'measurement'))
  const point = async (x, y) => page.evaluate(({ x, y }) => {
    const c = window.__IM_EDITOR_INSTANCE__.fabricRenderer.canvas
    const r = c.upperCanvasEl.getBoundingClientRect()
    const v = c.viewportTransform
    return { x: r.x + v[0] * x + v[4], y: r.y + v[3] * y + v[5] }
  }, { x, y })
  const click = async (x, y, options) => {
    const p = await point(x, y)
    await page.mouse.click(p.x, p.y, options)
    await page.waitForTimeout(25)
  }
  const begin = async (kind) => {
    if (!await page.locator('.fp-measure-options').count())
      await page.locator('.fp-toolbar button[title="测量"]').click()
    await page.locator(`.fp-measure-options button[aria-label="${kind}"]`).click()
  }
  await begin('多边形')
  await page.locator('.fp-measure-options .fp-color-custom').click()
  await page.getByRole('textbox', { name: 'HEX', exact: true }).fill('#ff8800')
  await page.getByRole('textbox', { name: 'HEX', exact: true }).press('Escape')
  assert.equal(await page.locator('.fp-measure-color').count(), 0, 'Redundant current-color row remains')
  assert.equal(await page.locator('.fp-measure-options .fp-color-custom-active').count(), 1, 'Custom creation color has no selection frame')
  await page.locator('.fp-measure-options select').selectOption('4')
  await page.locator('.fp-measure-options button[aria-label="线型"]').click()
  await page.getByRole('option', { name: '虚线', exact: true }).click()
  await click(140, 160)
  await click(350, 170)
  await click(370, 330)
  await click(160, 360)
  let objects = await editorObjects()
  assert.equal(objects.length, 1)
  assert.equal(objects[0].measurementPoints.length, 4, 'Polygon third/fourth vertex lost')
  await click(450, 400, { button: 'right' })
  await page.waitForTimeout(40)
  objects = await editorObjects()
  assert.equal(objects[0].stroke, '#ff8800')
  assert.equal(objects[0].strokeWidth, 4)
  assert.deepEqual(objects[0].strokeDash, [8, 4])
  const polygonId = objects[0].id
  await page.evaluate(id => window.__IM_EDITOR_INSTANCE__.selectObjects([id]), polygonId)
  await page.waitForTimeout(50)
  const annotationVisibility = page.getByRole('switch', { name: '在画面上显示标注', exact: true })
  assert.equal(await annotationVisibility.getAttribute('aria-checked'), 'false')
  await annotationVisibility.click()
  const perimeter = page.getByRole('button', { name: '显示周长', exact: true })
  const area = page.getByRole('button', { name: '显示面积', exact: true })
  assert.equal(await perimeter.getAttribute('aria-pressed'), 'true')
  assert.equal(await area.getAttribute('aria-pressed'), 'true')
  await perimeter.click()
  const polygonObject = await page.evaluate(id => window.__IM_EDITOR_INSTANCE__.state.getObject(id), polygonId)
  assert.equal(polygonObject.measurementLabel.showPerimeter, false)
  assert.equal(polygonObject.measurementLabel.showArea, true)
  await area.click()
  assert.equal((await page.evaluate(id => window.__IM_EDITOR_INSTANCE__.state.getObject(id), polygonId)).measurementLabel.showArea, false)
  await perimeter.click()
  await area.click()
  assert.equal(await page.locator(`[data-measurement-label="${polygonId}-perimeter"]`).count(), 1, 'Perimeter label box missing')
  assert.equal(await page.locator(`[data-measurement-label="${polygonId}-area"]`).count(), 1, 'Area label box missing')
  const metricOffsetsBefore = await page.evaluate(id => {
    const label = window.__IM_EDITOR_INSTANCE__.state.getObject(id).measurementLabel
    return { perimeter: label.metricLabels?.perimeter?.offset, area: label.metricLabels?.area?.offset }
  }, polygonId)
  const perimeterLabel = page.locator(`[data-measurement-label="${polygonId}-perimeter"]`)
  const perimeterBox = await perimeterLabel.boundingBox()
  assert(perimeterBox, 'Perimeter label box has no hit area')
  await page.mouse.move(perimeterBox.x + perimeterBox.width / 2, perimeterBox.y + perimeterBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(perimeterBox.x + perimeterBox.width / 2 + 18, perimeterBox.y + perimeterBox.height / 2 + 10, { steps: 4 })
  await page.mouse.up()
  await page.waitForTimeout(50)
  const metricOffsetsAfter = await page.evaluate(id => {
    const label = window.__IM_EDITOR_INSTANCE__.state.getObject(id).measurementLabel
    return { perimeter: label.metricLabels?.perimeter?.offset, area: label.metricLabels?.area?.offset }
  }, polygonId)
  assert.notDeepEqual(metricOffsetsAfter.perimeter, metricOffsetsBefore.perimeter, 'Perimeter label did not move independently')
  assert.deepEqual(metricOffsetsAfter.area, metricOffsetsBefore.area, 'Moving perimeter label moved area label')
  await page.getByRole('button', { name: '编辑周长标注', exact: true }).click()
  await page.getByRole('spinbutton', { name: '字号', exact: true }).fill('8')
  assert.equal((await page.evaluate(id => window.__IM_EDITOR_INSTANCE__.state.getObject(id), polygonId)).measurementLabel.metricLabels.perimeter.fontSize, 8)
  // Selecting the actual canvas box routes the shared style controls to that metric.
  const labelSelectionBefore = await page.evaluate(id => ({
    label: window.__IM_EDITOR_INSTANCE__.state.getObject(id).measurementLabel,
    undoSize: window.__IM_EDITOR_INSTANCE__.history.undoSize,
  }), polygonId)
  const areaBox = page.locator(`[data-measurement-label="${polygonId}-area"]`)
  await areaBox.click()
  assert.equal(await page.evaluate(() => window.__IM_EDITOR_INSTANCE__.history.undoSize), labelSelectionBefore.undoSize, 'Selecting a label created an undo entry')
  assert.equal(await page.getByRole('button', { name: '编辑面积标注', exact: true }).getAttribute('aria-pressed'), 'true')
  assert.equal(await areaBox.getAttribute('data-label-selected'), 'true')
  await page.getByRole('spinbutton', { name: '字号', exact: true }).fill('11')
  const selectedLabel = await page.evaluate(id => window.__IM_EDITOR_INSTANCE__.state.getObject(id).measurementLabel, polygonId)
  assert.equal(selectedLabel.metricLabels.area.fontSize, 11)
  assert.equal(selectedLabel.metricLabels.perimeter.fontSize, 8)
  assert.deepEqual(selectedLabel.metricLabels.area.offset, labelSelectionBefore.label.metricLabels?.area?.offset)
  // Restore the size so subsequent movement/geometry checks retain their fixture layout.
  await page.evaluate(({ id, label }) => window.__IM_EDITOR_INSTANCE__.changeMeasurementAnnotation(id, { measurementLabel: label }), { id: polygonId, label: labelSelectionBefore.label })
  await perimeterLabel.click()
  assert.equal(await page.getByRole('button', { name: '编辑周长标注', exact: true }).getAttribute('aria-pressed'), 'true')
  await page.locator('.fp-props-panel [aria-label="颜色颜色选择"]').click()
  assert.equal(await page.locator('.fp-color-popover .fp-color-custom-active').count(), 1, 'Custom layer color has no selection frame')
  await page.locator('.fp-props-panel [aria-label="颜色颜色选择"]').click()
  const row = await page.locator('.fp-inspector-path-style').evaluate(el => ({ width: el.querySelector('input').getBoundingClientRect().width, inputs: el.getBoundingClientRect().toJSON() }))
  assert(row.width <= 60, 'Measurement stroke input too wide')
  const verifyNodes = async (id, live) => {
    const check = await page.evaluate(({ id, live }) => {
      const e = window.__IM_EDITOR_INSTANCE__
      const o = e.state.getObject(id)
      const f = e.fabricRenderer.getObjectsByIds([id])[0]
      const m = f.calcTransformMatrix()
      const offset = f.pathOffset
      const expected = live ? o.measurementPoints.map(p => ({ x: m[0] * (p.x - offset.x) + m[2] * (p.y - offset.y) + m[4], y: m[1] * (p.x - offset.x) + m[3] * (p.y - offset.y) + m[5] })) : o.measurementPoints
      const nodes = [...document.querySelectorAll(`[data-measurement-id="${id}"]`)].map(n => ({ x: n.cx.baseVal.value, y: n.cy.baseVal.value }))
      return { expected, nodes }
    }, { id, live })
    assert.equal(check.nodes.length, check.expected.length)
    for (let i = 0; i < check.nodes.length; i++) {
      assert(Math.hypot(check.nodes[i].x - check.expected[i].x, check.nodes[i].y - check.expected[i].y) < 0.05, `Node ${i} not aligned: ${JSON.stringify(check)}`)
    }
  }
  const transform = async (id, handle, dx, dy) => {
    if (await page.locator('.fp-measure-options').count())
      await click(760, 560, { button: 'right' })
    await page.evaluate(id => window.__IM_EDITOR_INSTANCE__.selectObjects([id]), id)
    const start = await page.evaluate(({ id, handle }) => {
      const e = window.__IM_EDITOR_INSTANCE__
      const c = e.fabricRenderer.canvas
      const f = e.fabricRenderer.getObjectsByIds([id])[0]
      const r = c.upperCanvasEl.getBoundingClientRect()
      f.setCoords()
      window.__qualityTransformObject = f
      const p = handle ? f.oCoords[handle] : { x: (f.oCoords.tl.x + f.oCoords.tr.x) / 2, y: (f.oCoords.tl.y + f.oCoords.tr.y) / 2 + 8 }
      return { x: r.x + p.x, y: r.y + p.y }
    }, { id, handle })
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x + dx, start.y + dy, { steps: 8 })
    await page.waitForTimeout(40)
    await verifyNodes(id, true)
    const live = await page.evaluate((id) => {
      const e = window.__IM_EDITOR_INSTANCE__
      const o = e.state.getObject(id)
      const f = e.fabricRenderer.getObjectsByIds([id])[0]
      const m = f.calcTransformMatrix()
      const q = f.pathOffset
      return o.measurementPoints.map(p => ({ x: m[0] * (p.x - q.x) + m[2] * (p.y - q.y) + m[4], y: m[1] * (p.x - q.x) + m[3] * (p.y - q.y) + m[5] }))
    }, id)
    await page.mouse.up()
    await page.waitForTimeout(50)
    await verifyNodes(id, false)
    const committed = await page.evaluate(id => window.__IM_EDITOR_INSTANCE__.state.getObject(id).measurementPoints, id)
    for (let i = 0; i < live.length; i++)
      assert(Math.hypot(live[i].x - committed[i].x, live[i].y - committed[i].y) < 0.05, 'Geometry jumps on mouseup')
    assert(await page.evaluate(id => window.__qualityTransformObject === window.__IM_EDITOR_INSTANCE__.fabricRenderer.getObjectsByIds([id])[0], id), 'Fabric object replaced during commit')
    await page.mouse.move(start.x + dx + 75, start.y + dy + 45, { steps: 4 })
    await page.waitForTimeout(40)
    assert.deepEqual(await page.evaluate(id => window.__IM_EDITOR_INSTANCE__.state.getObject(id).measurementPoints, id), committed, 'Measurement follows mouse after release')
  }
  const widthInput = page.locator('.fp-inspector-path-style input')
  const strokeWidth = () => page.evaluate(id => window.__IM_EDITOR_INSTANCE__.state.getObject(id).strokeWidth, polygonId)
  await widthInput.fill('2')
  await widthInput.fill('')
  await page.mouse.move(800, 700)
  assert.equal(await widthInput.inputValue(), '', 'Empty width draft was overwritten')
  assert.equal(await strokeWidth(), 2, 'Clearing width changed the object')
  await widthInput.press('Tab')
  assert.equal(await widthInput.inputValue(), '2', 'Empty width did not restore on blur')
  await widthInput.fill('')
  await widthInput.pressSequentially('6')
  assert.equal(await strokeWidth(), 6, 'Replacement width did not apply live')
  await widthInput.press('Enter')
  assert.equal(await widthInput.inputValue(), '6')
  await page.evaluate(() => window.__IM_EDITOR_INSTANCE__.undo())
  assert.equal(await widthInput.inputValue(), String(await strokeWidth()), 'Width input ignored undo')
  await widthInput.fill('12')
  await widthInput.press('Enter')
  await page.waitForTimeout(60)
  await verifyNodes(polygonId, true)
  await widthInput.fill('4')
  await widthInput.press('Enter')
  await page.waitForTimeout(60)
  await verifyNodes(polygonId, true)
  await transform(polygonId, null, 42, 30)
  await transform(polygonId, 'br', 65, 45)
  await transform(polygonId, 'mtr', 55, 25)
  // Undo and redo must restore the same layer and its nodes without echoing old geometry.
  const afterTransform = await editorObjects()
  await page.evaluate(() => window.__IM_EDITOR_INSTANCE__.undo())
  await page.waitForTimeout(60)
  assert.notDeepEqual((await editorObjects())[0].measurementPoints, afterTransform[0].measurementPoints, 'Undo did not restore geometry')
  await verifyNodes(polygonId, false)
  await page.evaluate(() => window.__IM_EDITOR_INSTANCE__.redo())
  await page.waitForTimeout(60)
  assert.deepEqual((await editorObjects())[0].measurementPoints, afterTransform[0].measurementPoints)
  await page.evaluate((id) => {
    const e = window.__IM_EDITOR_INSTANCE__
    e.selectObjects([id])
    e.removeActiveObject()
  }, polygonId)
  await page.waitForTimeout(60)
  assert.equal((await editorObjects()).length, 0, 'Deleted measurement resurrected')
  await page.evaluate(() => window.__IM_EDITOR_INSTANCE__.undo())
  await page.waitForTimeout(60)
  assert.equal((await editorObjects()).length, 1, 'Undo failed to restore measurement')
  await verifyNodes(polygonId, false)
  await begin('角度')
  await click(450, 150)
  await click(480, 300)
  await click(650, 300)
  assert.equal((await editorObjects()).filter(o => o.measurementKind === 'angle')[0].measurementPoints.length, 3)
  const angle = (await editorObjects()).find(o => o.measurementKind === 'angle')
  await transform(angle.id, 'br', 20, 15)
  // Switching between path objects with the same width must discard an empty draft.
  await page.evaluate(id => window.__IM_EDITOR_INSTANCE__.selectObjects([id]), polygonId)
  await widthInput.fill('')
  await page.evaluate(id => window.__IM_EDITOR_INSTANCE__.selectObjects([id]), angle.id)
  assert.equal(await widthInput.inputValue(), String(angle.strokeWidth), 'Empty draft leaked to another layer')
  await page.evaluate(() => window.__IM_EDITOR_INSTANCE__.undo())
  await page.waitForTimeout(60)
  assert.deepEqual((await editorObjects()).find(o => o.id === angle.id).measurementPoints, angle.measurementPoints, 'Angle transform should undo in one step')
  await page.evaluate(() => window.__IM_EDITOR_INSTANCE__.redo())
  await page.waitForTimeout(60)
  await begin('椭圆')
  const start = await point(470, 390)
  const end = await point(650, 500)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(70)
  objects = await editorObjects()
  const ellipse = objects.find(o => o.measurementKind === 'ellipse')
  assert.equal(ellipse.measurementPoints.length, 3, 'Dragged ellipse missing center/axes')
  await transform(ellipse.id, 'mtr', 50, 20)
  await transform(ellipse.id, 'br', 30, 30)
  const beforeCenter = (await editorObjects()).find(o => o.id === ellipse.id).measurementPoints
  const centerNode = page.locator(`[data-measurement-id="${ellipse.id}"][data-measurement-node="0"]`)
  const centerBox = await centerNode.boundingBox()
  await page.mouse.move(centerBox.x + centerBox.width / 2, centerBox.y + centerBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(centerBox.x + centerBox.width / 2 + 15, centerBox.y + centerBox.height / 2 - 20, { steps: 4 })
  await page.mouse.up()
  await page.waitForTimeout(60)
  const afterCenter = (await editorObjects()).find(o => o.id === ellipse.id).measurementPoints
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(50)
  assert.deepEqual((await editorObjects()).find(o => o.id === ellipse.id).measurementPoints, beforeCenter, 'Node drag must undo as one whole gesture')
  await page.keyboard.press('Control+Shift+z')
  await page.waitForTimeout(50)
  assert.deepEqual((await editorObjects()).find(o => o.id === ellipse.id).measurementPoints, afterCenter, 'Node gesture redo failed')
  for (let i = 1; i < 3; i++) {
    assert(Math.abs((afterCenter[i].x - afterCenter[0].x) - (beforeCenter[i].x - beforeCenter[0].x)) < 0.05, 'Moving ellipse center changed its axis')
    assert(Math.abs((afterCenter[i].y - afterCenter[0].y) - (beforeCenter[i].y - beforeCenter[0].y)) < 0.05, 'Moving ellipse center changed its axis')
  }
  const interruptedCenter = await centerNode.boundingBox()
  await page.mouse.move(interruptedCenter.x + interruptedCenter.width / 2, interruptedCenter.y + interruptedCenter.height / 2)
  await page.mouse.down()
  await page.mouse.move(interruptedCenter.x + interruptedCenter.width / 2 + 12, interruptedCenter.y + interruptedCenter.height / 2 + 8, { steps: 4 })
  await page.mouse.down({ button: 'right' })
  await page.mouse.up({ button: 'right' })
  await page.mouse.up()
  await page.waitForTimeout(40)
  const rightClickCommit = (await editorObjects()).find(o => o.id === ellipse.id).measurementPoints
  await page.mouse.move(interruptedCenter.x + 80, interruptedCenter.y + 80)
  await page.waitForTimeout(40)
  assert.deepEqual((await editorObjects()).find(o => o.id === ellipse.id).measurementPoints, rightClickCommit, 'Node follows pointer after right-click')
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(40)
  assert.deepEqual((await editorObjects()).find(o => o.id === ellipse.id).measurementPoints, afterCenter, 'Interrupted node gesture should undo once')
  await begin('椭圆')
  await click(80, 430)
  await click(240, 540)
  assert.equal((await editorObjects()).filter(o => o.measurementKind === 'ellipse').length, 2, 'Click ellipse creation failed')
  await begin('椭圆')
  const a = await point(330, 420)
  const b = await point(405, 530)
  await page.keyboard.down('Shift')
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 5 })
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await page.waitForTimeout(70)
  const circle = (await editorObjects()).at(-1).measurementPoints
  assert(Math.abs(Math.hypot(circle[1].x - circle[0].x, circle[1].y - circle[0].y) - Math.hypot(circle[2].x - circle[0].x, circle[2].y - circle[0].y)) < 0.05, 'Shift ellipse is not circular')
  await click(760, 560, { button: 'right' })
  await page.evaluate(ids => window.__IM_EDITOR_INSTANCE__.selectObjects(ids), [polygonId, ellipse.id])
  const groupHandle = await page.evaluate(() => {
    const c = window.__IM_EDITOR_INSTANCE__.fabricRenderer.canvas
    const g = c.getActiveObject()
    const r = c.upperCanvasEl.getBoundingClientRect()
    g.setCoords()
    return { x: r.x + g.oCoords.br.x, y: r.y + g.oCoords.br.y }
  })
  await page.mouse.move(groupHandle.x, groupHandle.y)
  await page.mouse.down()
  await page.mouse.move(groupHandle.x + 20, groupHandle.y + 20, { steps: 5 })
  await page.waitForTimeout(50)
  await verifyNodes(polygonId, true)
  await verifyNodes(ellipse.id, true)
  await page.mouse.up()
  await page.waitForTimeout(60)
  await verifyNodes(polygonId, false)
  await verifyNodes(ellipse.id, false)
  await page.screenshot({ path: path.join(output, 'editor-measurements.png') })
  for (const title of ['箭头 (A)', '直线 (L)', '画笔 (P)', '形状 (S)', '文字 (T)', '马赛克 (M)', '裁剪 (C)']) {
    if (title === '箭头 (A)' || title === '直线 (L)') {
      await page.locator('.fp-toolbar button[title="形状 (S)"]').click()
      await page.locator(`.fp-shape-options button[aria-label="${title.startsWith('箭头') ? '箭头' : '直线'}"]`).click()
    }
    else {
      await page.locator(`.fp-toolbar button[title="${title}"]`).click()
    }
    await click(760, 560, { button: 'right' })
    assert.equal(await page.evaluate(() => window.__IM_EDITOR_INSTANCE__.state.mode), 'normal', `Right-click failed to exit ${title}`)
    assert.equal(await page.locator('.fp-floating-options').count(), 0)
  }
  for (const title of ['箭头 (A)', '直线 (L)', '画笔 (P)', '形状 (S)', '马赛克 (M)', '裁剪 (C)']) {
    const before = await page.evaluate(() => window.__IM_EDITOR_INSTANCE__.state.doc.objects.length)
    if (title === '箭头 (A)' || title === '直线 (L)') {
      await page.locator('.fp-toolbar button[title="形状 (S)"]').click()
      await page.locator(`.fp-shape-options button[aria-label="${title.startsWith('箭头') ? '箭头' : '直线'}"]`).click()
    }
    else {
      await page.locator(`.fp-toolbar button[title="${title}"]`).click()
    }
    const p = await point(720, 60)
    await page.mouse.move(p.x, p.y)
    await page.mouse.down()
    await page.mouse.move(p.x + 30, p.y + 50, { steps: 3 })
    await page.mouse.down({ button: 'right' })
    await page.mouse.up({ button: 'right' })
    await page.mouse.up()
    await page.mouse.move(p.x + 55, p.y + 75)
    await page.waitForTimeout(40)
    assert.equal(await page.evaluate(() => window.__IM_EDITOR_INSTANCE__.state.mode), 'normal', `Right-click during gesture failed to exit ${title}`)
    assert.equal(await page.evaluate(() => window.__IM_EDITOR_INSTANCE__.state.doc.objects.length), before, `Canceled ${title} committed an object`)
    const redPreviewPixels = await page.evaluate(() => {
      const c = window.__IM_EDITOR_INSTANCE__.fabricRenderer.canvas
      const ctx = c.contextTop
      const data = ctx.getImageData(0, 0, c.width, c.height).data
      let count = 0
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 200 && data[i + 1] < 100 && data[i + 2] < 100 && data[i + 3] > 0)
          count++
      }
      return count
    })
    assert.equal(redPreviewPixels, 0, `Canceled ${title} left a preview on the canvas`)
  }
  await begin('多边形')
  await click(50, 50)
  await click(70, 70, { button: 'right' })
  assert.equal(await page.locator('.fp-floating-options').count(), 0)
  for (const [label, kind, vertices] of [
    ['直线', 'line', [[90, 100], [260, 150]]],
    ['角度', 'angle', [[320, 100], [350, 200], [460, 180]]],
    ['椭圆', 'ellipse', [[100, 410], [260, 510]]],
    ['多边形', 'polygon', [[470, 390], [610, 390], [560, 490]]],
  ]) {
    await begin(label)
    const before = (await editorObjects()).length
    let firstCompleted
    for (let i = 0; i < 2; i++) {
      if (kind === 'ellipse' && i === 1) {
        const a = await point(vertices[0][0] + 15, vertices[0][1] + 15)
        const b = await point(vertices[1][0] + 15, vertices[1][1] + 15)
        await page.mouse.move(a.x, a.y)
        await page.mouse.down()
        await page.mouse.move(b.x, b.y, { steps: 5 })
        await page.mouse.up()
        await page.waitForTimeout(50)
      }
      else {
        for (let j = 0; j < vertices.length; j++) {
          const [x, y] = vertices[j]
          await click(x + i * 15, y + i * 15, kind === 'polygon' && j === vertices.length - 1 ? { clickCount: 2 } : undefined)
        }
      }
      const completed = await editorObjects()
      assert.equal(completed.length, before + i + 1, `${label} consecutive creation reused an object`)
      assert.equal(completed.at(-1).measurementKind, kind)
      assert.equal(completed.at(-1).measurementPoints.length, kind === 'line' ? 2 : 3, `${label} unexpected points: ${JSON.stringify(completed.at(-1).measurementPoints)}`)
      assert.equal(await page.locator('.fp-measure-options').count(), 1, `${label} completion exited creation`)
      if (i === 0)
        firstCompleted = completed.at(-1)
      else
        assert.deepEqual(completed.find(o => o.id === firstCompleted.id), firstCompleted, `${label} next creation modified the previous object`)
    }
    // Tool changes finish creation without discarding completed objects.
    const completed = await editorObjects()
    await page.locator('.fp-toolbar button[title="形状 (S)"]').click()
    assert.equal(await page.locator('.fp-measure-options').count(), 0)
    assert.deepEqual(await editorObjects(), completed)
    await click(760, 560, { button: 'right' })
  }
  await begin('多边形')
  await click(650, 450)
  await click(700, 500)
  const withDraft = (await editorObjects()).length
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.fp-measure-options').count(), 0)
  assert.equal((await editorObjects()).length, withDraft - 1, 'Escape kept unfinished measurement')
  await page.screenshot({ path: path.join(output, 'editor-measurements.png') })
  return { feature: 'continuous measurements, numeric drafts, styles, live transforms, undo/delete and explicit tool exits', passed: true }
}
