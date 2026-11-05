import assert from 'node:assert/strict'
import path from 'node:path'
import sharp from 'sharp'

export async function checkLargePreview(browser, url, output) {
  const results = []
  const errors = []
  for (const dpr of [1, 1.25, 2]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: dpr })
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${url}/?preview-large`)
    await page.waitForFunction(() => document.querySelector('.ant-image-preview-img')?.naturalWidth === 3073)
    await page.waitForTimeout(350)
    const regions = [
      { name: 'center', x: 1536, y: 1024, rotate: 0, flipX: false, flipY: false, scale: 120 },
      { name: 'top-left', x: 8, y: 8, rotate: 0, flipX: false, flipY: false, scale: 99.375 },
      { name: 'top-right', x: 3064, y: 8, rotate: 90, flipX: true, flipY: false, scale: 120.125 },
      { name: 'bottom-left', x: 8, y: 2040, rotate: 270, flipX: false, flipY: true, scale: 150.25 },
      { name: 'bottom-right', x: 3064, y: 2040, rotate: 0, flipX: false, flipY: false, scale: 120 },
    ]
    for (const region of regions) {
      await page.evaluate((t) => {
        const img = document.querySelector('.ant-image-preview-img')
        const w = Number.parseFloat(getComputedStyle(img).width)
        const h = Number.parseFloat(getComputedStyle(img).height)
        const rad = t.rotate * Math.PI / 180
        const dx = (t.x + 0.5 - 3073 / 2) * w / 3073 * t.scale
        const dy = (t.y + 0.5 - 2049 / 2) * h / 2049 * t.scale
        window.__previewActions.onSetTransform({ ...t, x: -(dx * Math.cos(rad) - dy * Math.sin(rad)) * (t.flipX ? -1 : 1) + 0.375, y: -(dx * Math.sin(rad) + dy * Math.cos(rad)) * (t.flipY ? -1 : 1) - 0.125 }, 'test')
      }, region)
      await page.waitForTimeout(100)
      const checks = await page.evaluate((t) => {
        const image = document.querySelector('.ant-image-preview-img')
        const r = image.getBoundingClientRect()
        const quarterTurn = t.rotate === 90 || t.rotate === 270
        const sx = (quarterTurn ? r.height : r.width) / 3073
        const sy = (quarterTurn ? r.width : r.height) / 2049
        const rad = t.rotate * Math.PI / 180
        const toScreen = (x, y) => {
          const dx = (x - 3073 / 2) * sx
          const dy = (y - 2049 / 2) * sy
          return { x: r.left + r.width / 2 + (dx * Math.cos(rad) - dy * Math.sin(rad)) * (t.flipX ? -1 : 1), y: r.top + r.height / 2 + (dx * Math.sin(rad) + dy * Math.cos(rad)) * (t.flipY ? -1 : 1) }
        }
        const grid = document.querySelector('[data-preview-pixel-grid]')
        const ctx = grid.getContext('2d')
        const boundaries = []
        const samples = []
        for (let y = t.y - 3; y <= t.y + 3; y++) {
          for (let x = t.x - 3; x <= t.x + 3; x++) {
            const expected = [x % 8 * 32, y % 6 * 40, (x + y) % 16 * 16]
            // Both sides of every visible pixel: an image/grid offset cannot pass by matching only centers.
            for (const [fx, fy] of [[0.08, 0.08], [0.92, 0.08], [0.08, 0.92], [0.92, 0.92], [0.5, 0.5]])
              samples.push({ point: toScreen(x + fx, y + fy), expected })
            for (const point of [toScreen(x, y + 0.25), toScreen(x + 0.25, y)]) {
              const px = Math.round(point.x * grid.width / innerWidth)
              const py = Math.round(point.y * grid.height / innerHeight)
              const data = ctx.getImageData(px - 1, py - 1, 3, 3).data
              boundaries.push(Math.max(...Array.from({ length: 9 }, (_, i) => data[i * 4 + 3])))
            }
          }
        }
        return { samples, boundaries, pointer: toScreen(t.x + 0.5, t.y + 0.5), opacity: getComputedStyle(image).opacity }
      }, region)
      assert.equal(checks.opacity, '0', 'High-zoom preview must use precise viewport pixels')
      assert(checks.boundaries.every(alpha => alpha >= 30), `Large grid boundary failed: ${dpr} ${region.name}`)
      await page.mouse.move(checks.pointer.x, checks.pointer.y)
      await page.waitForTimeout(35)
      const expectedText = `${region.x % 8 * 32} ${region.y % 6 * 40} ${(region.x + region.y) % 16 * 16}`
      assert((await page.locator('.ant-image-preview-wrap').textContent()).includes(`(${region.x}, ${region.y})`), `Pointer coordinates: ${region.name}`)
      assert((await page.locator('.ant-image-preview-wrap').textContent()).includes(expectedText), `Pointer value: ${region.name}`)
      if (dpr === 1)
        await page.screenshot({ path: path.join(output, `preview-large-${region.name}.png`) })
      await page.locator('[data-preview-pixel-grid]').evaluate(canvas => canvas.style.visibility = 'hidden')
      const { data, info } = await sharp(await page.screenshot()).removeAlpha().raw().toBuffer({ resolveWithObject: true })
      for (const sample of checks.samples) {
        const index = (Math.floor(sample.point.y * dpr) * info.width + Math.floor(sample.point.x * dpr)) * info.channels
        assert.deepEqual(Array.from(data.slice(index, index + 3)), sample.expected, `Large-image source pixel: DPR ${dpr} ${region.name}, ${JSON.stringify(sample)}`)
      }
      await page.locator('[data-preview-pixel-grid]').evaluate(canvas => canvas.style.visibility = '')
      results.push({ feature: 'large preview actual Ant Image layout', dpr, region: region.name, verifiedSamples: checks.samples.length, verifiedBoundaries: checks.boundaries.length })
    }
    // The invisible native image must still receive the drag gesture.
    const before = await page.locator('.ant-image-preview-img').boundingBox()
    await page.mouse.move(600, 400)
    await page.mouse.down()
    await page.mouse.move(650, 440, { steps: 5 })
    await page.waitForTimeout(60)
    const after = await page.locator('.ant-image-preview-img').boundingBox()
    assert(Math.abs(after.x - before.x - 50) < 1 && Math.abs(after.y - before.y - 40) < 1, `Native drag broke with pixel viewport ${JSON.stringify({ before, after })}`)
    await page.mouse.up()
    await page.evaluate(() => window.__previewActions.onSetTransform({ x: 0, y: 0, scale: 1, rotate: 0, flipX: false, flipY: false }, 'test'))
    await page.waitForTimeout(80)
    assert.equal(await page.locator('.ant-image-preview-img').evaluate(i => getComputedStyle(i).opacity), '1', 'Low zoom must restore native image')
    assert.equal(await page.locator('[data-preview-pixel-image]').evaluate(c => c.getContext('2d').getImageData(640, 450, 1, 1).data[3]), 0)
    await page.close()
  }
  assert.deepEqual(errors, [])
  return results
}
