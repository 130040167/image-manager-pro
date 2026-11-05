import assert from 'node:assert/strict'
import path from 'node:path'

export async function checkEditorRotation(page, output, { pattern = true } = {}) {
  await page.waitForFunction(() => window.__IM_EDITOR_INSTANCE__?.state.doc.background)
  await page.locator('.fp-editor-status').waitFor({ state: 'hidden' })
  const stats = { feature: 'image center rotation, exact dimensions and rotated pixel grid', pattern, colors: 0, boundaries: 0, passed: true }
  if (pattern) {
    await page.evaluate(() => {
      window.__IM_EDITOR_INSTANCE__.upsertMeasurementLayer('rotation-measure', 'M 80 70 L 190 115', 1, { kind: 'line', points: [{ x: 80, y: 70 }, { x: 190, y: 115 }], width: 4 })
    })
  }
  // Verify the visible center, including a panned image, through toolbar rotation.
  await page.evaluate(() => {
    const e = window.__IM_EDITOR_INSTANCE__
    e.dispatch(e.newTransaction().setViewport({ panX: 31.25, panY: -24.75 }).setMeta('addToHistory', false))
  })
  const center = () => page.evaluate(() => {
    const c = window.__IM_EDITOR_INSTANCE__.fabricRenderer.canvas
    const p = c.backgroundImage.getCenterPoint()
    const v = c.viewportTransform
    return { x: v[0] * p.x + v[4], y: v[3] * p.y + v[5] }
  })
  const before = await center()
  for (let i = 1; i <= 4; i++) {
    await page.locator('.fp-toolbar button[title="旋转 (R)"]').click()
    await page.waitForTimeout(30)
    const after = await center()
    assert(Math.hypot(after.x - before.x, after.y - before.y) < 0.001, 'Image center moved on rotation')
    const expected = i % 2 ? '426 × 799' : '799 × 426'
    assert.equal(await page.locator('.fp-props-readonly').filter({ hasText: '背景' }).locator('.fp-props-readonly-value').textContent(), expected)
    if (pattern) {
      await page.evaluate(() => window.__IM_EDITOR_INSTANCE__.selectObjects(['rotation-measure']))
      await page.waitForFunction(() => document.querySelectorAll('[data-measurement-id="rotation-measure"]').length === 2)
      const points = [[80, 70], [190, 115]].map(([x, y]) => i % 4 === 1 ? { x: 426 - y, y: x } : i % 4 === 2 ? { x: 799 - x, y: 426 - y } : i % 4 === 3 ? { x: y, y: 799 - x } : { x, y })
      const geometry = await page.evaluate(() => {
        const e = window.__IM_EDITOR_INSTANCE__
        const c = e.fabricRenderer.canvas
        const f = e.fabricRenderer.getObjectsByIds(['rotation-measure'])[0]
        const o = e.state.getObject('rotation-measure')
        const m = f.calcTransformMatrix()
        const v = c.viewportTransform
        const r = c.upperCanvasEl.getBoundingClientRect()
        const nodes = [...document.querySelectorAll('[data-measurement-id="rotation-measure"]')].map((node) => {
          const b = node.getBoundingClientRect()
          return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
        })
        return { points: o.measurementPoints, nodes, rendered: o.measurementPoints.map((p) => {
          const x = p.x - f.pathOffset.x
          const y = p.y - f.pathOffset.y
          return { x: r.x + (m[0] * x + m[2] * y + m[4]) * v[0] + v[4], y: r.y + (m[1] * x + m[3] * y + m[5]) * v[3] + v[5] }
        }) }
      })
      assert.deepEqual(geometry.points, points, 'Rotation left stale measurement points')
      for (let j = 0; j < 2; j++)
        assert(Math.hypot(geometry.nodes[j].x - geometry.rendered[j].x, geometry.nodes[j].y - geometry.rendered[j].y) < 0.05, 'Rotated measurement node detached from path')
      await page.evaluate(() => window.__IM_EDITOR_INSTANCE__.deactivateAll())
    }
  }
  await page.evaluate(() => window.__IM_EDITOR_INSTANCE__.undo())
  assert.equal(await page.evaluate(() => window.__IM_EDITOR_INSTANCE__.getAngle()), 270, 'Rotation must undo in one step')
  await page.evaluate(() => window.__IM_EDITOR_INSTANCE__.redo())
  assert.equal(await page.evaluate(() => window.__IM_EDITOR_INSTANCE__.getAngle()), 0)
  if (pattern)
    await page.evaluate(() => window.__IM_EDITOR_INSTANCE__.removeMeasurementLayer('rotation-measure'))
  await page.screenshot({ path: path.join(output, pattern ? 'editor-rotation-dimensions.png' : 'editor-rotation-user-image.png') })
  if (!pattern) {
    const checks = await page.evaluate(async () => {
      const e = window.__IM_EDITOR_INSTANCE__
      const raw = e.getBackgroundImageData()
      const output = []
      for (const angle of [90, 180, 270, 0]) {
        e.setAngle(angle)
        const image = new Image()
        image.src = e.toDataURL({ type: 'image/png', multiplier: 1 })
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(image, 0, 0)
        for (const [x, y] of [[3, 3], [795, 3], [3, 422], [795, 422], [399, 213]]) {
          const [px, py] = angle === 90 ? [425 - y, x] : angle === 180 ? [798 - x, 425 - y] : angle === 270 ? [y, 798 - x] : [x, y]
          const actual = [...ctx.getImageData(px, py, 1, 1).data]
          const expected = [...raw.data.slice((y * 799 + x) * 4, (y * 799 + x) * 4 + 4)]
          output.push({ angle, x, y, actual, expected, width: canvas.width, height: canvas.height })
        }
      }
      return output
    })
    for (const check of checks) {
      assert.deepEqual(check.actual, check.expected, `Actual image export pixel mismatch: ${JSON.stringify(check)}`)
      assert.equal(check.width, check.angle % 180 ? 426 : 799)
      assert.equal(check.height, check.angle % 180 ? 799 : 426)
    }
    stats.colors = checks.length
    return stats
  }
  for (const angle of [0, 90, 180, 270, 33]) {
    for (const focus of [[2, 2], [796, 2], [2, 423], [796, 423], [399, 213]]) {
      await page.evaluate(({ angle, focus }) => {
        const e = window.__IM_EDITOR_INSTANCE__
        e.setAngle(angle)
        e.setZoom(28.75)
        const c = e.fabricRenderer.canvas
        const f = c.backgroundImage
        const m = f.calcTransformMatrix()
        const [x, y] = [focus[0] + 0.5 - f.width / 2, focus[1] + 0.5 - f.height / 2]
        const p = { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }
        const bg = e.state.doc.background
        const s = c.viewportTransform[0]
        e.dispatch(e.newTransaction().setViewport({ panX: -(p.x - bg.width / 2) * s + 0.375, panY: -(p.y - bg.height / 2) * s - 0.25 }).setMeta('addToHistory', false))
      }, { angle, focus })
      await page.waitForTimeout(40)
      const checks = await page.evaluate((focus) => {
        const e = window.__IM_EDITOR_INSTANCE__
        const c = e.fabricRenderer.canvas
        c.renderAll()
        const f = c.backgroundImage
        const m = f.calcTransformMatrix()
        const v = c.viewportTransform
        const lower = c.lowerCanvasEl
        const rect = lower.getBoundingClientRect()
        const grid = document.querySelector('.fp-pixel-grid')
        const gr = grid.getBoundingClientRect()
        const ctx = lower.getContext('2d')
        const gc = grid.getContext('2d')
        const screen = (x, y) => {
          const dx = x - f.width / 2
          const dy = y - f.height / 2
          return { x: (m[0] * dx + m[2] * dy + m[4]) * v[0] + v[4], y: (m[1] * dx + m[3] * dy + m[5]) * v[3] + v[5] }
        }
        const colors = []
        const boundaries = []
        for (let y = Math.max(0, focus[1] - 2); y <= Math.min(425, focus[1] + 2); y++) {
          for (let x = Math.max(0, focus[0] - 2); x <= Math.min(798, focus[0] + 2); x++) {
            for (const [ox, oy] of [[0.18, 0.18], [0.82, 0.18], [0.18, 0.82], [0.82, 0.82]]) {
              const p = screen(x + ox, y + oy)
              const actual = [...ctx.getImageData(Math.floor(p.x * lower.width / rect.width), Math.floor(p.y * lower.height / rect.height), 1, 1).data]
              colors.push({ x, y, actual, expected: [(x % 8) * 32, (y % 6) * 40, ((x + y) % 16) * 16, 255] })
            }
            for (const [ox, oy] of [[0, 0.15], [0.15, 0]]) {
              const p = screen(x + ox, y + oy)
              const px = Math.round((p.x + rect.x - gr.x) * grid.width / gr.width)
              const py = Math.round((p.y + rect.y - gr.y) * grid.height / gr.height)
              const data = gc.getImageData(px - 1, py - 1, 3, 3).data
              boundaries.push(Math.max(...Array.from({ length: 9 }, (_, i) => data[i * 4 + 3])))
            }
          }
        }
        const pointer = screen(focus[0] + 0.5, focus[1] + 0.5)
        return { colors, boundaries, pointer: { x: rect.x + pointer.x, y: rect.y + pointer.y }, display: getComputedStyle(grid).display }
      }, focus)
      assert.notEqual(checks.display, 'none')
      for (const c of checks.colors)
        assert.deepEqual(c.actual, c.expected, `Rendered pixel mismatch at ${angle}°: ${JSON.stringify(c)}`)
      assert(checks.boundaries.every(alpha => alpha > 20), `Grid boundary offset at ${angle}° / ${focus}`)
      stats.colors += checks.colors.length
      stats.boundaries += checks.boundaries.length
      await page.mouse.move(checks.pointer.x, checks.pointer.y)
      const [x, y] = focus
      await page.waitForTimeout(20)
      const readout = await page.locator('.fp-topbar-pixel').textContent()
      assert(readout.includes(`(${x}, ${y})`) && readout.includes(`${(x % 8) * 32} ${(y % 6) * 40} ${((x + y) % 16) * 16}`), `Rotated pixel readout wrong: ${readout}`)
    }
  }
  await page.screenshot({ path: path.join(output, `editor-rotation-grid-${await page.evaluate(() => devicePixelRatio)}.png`) })
  return stats
}
