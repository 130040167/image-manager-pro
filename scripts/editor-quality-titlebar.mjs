import assert from 'node:assert/strict'
import path from 'node:path'

export async function checkEditorTitlebar(page, output) {
  const results = []
  for (const width of [1280, 760, 640, 480]) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForTimeout(80)
    const imagePoint = await page.evaluate(() => {
      const e = window.__IM_EDITOR_INSTANCE__
      const c = e.fabricRenderer.canvas
      const r = c.upperCanvasEl.getBoundingClientRect()
      const v = c.viewportTransform
      return { x: r.x + v[0] * 250 + v[4], y: r.y + v[3] * 350 + v[5] }
    })
    await page.mouse.move(imagePoint.x, imagePoint.y)
    await page.waitForTimeout(50)
    const readout = page.locator('.fp-topbar-pixel')
    assert((await readout.textContent()).includes('(250, 350)'), `Readout missing at width ${width}`)
    assert((await readout.textContent()).includes('64 120 80'))
    const layout = await page.evaluate(() => {
      const rect = s => document.querySelector(s).getBoundingClientRect().toJSON()
      const pixel = document.querySelector('.fp-topbar-pixel')
      return { top: rect('.fp-topbar'), name: rect('.fp-topbar-name'), pixel: rect('.fp-topbar-pixel'), zoom: rect('.fp-topbar .fp-zoom-controls'), actions: rect('.fp-topbar-actions'), mount: rect('.fp-canvas-mount'), pixelScroll: pixel.scrollWidth, pixelClient: pixel.clientWidth }
    })
    assert(layout.pixel.y >= layout.top.y && layout.pixel.bottom <= layout.top.bottom, 'Pixel readout outside titlebar')
    assert(layout.zoom.y >= layout.top.y && layout.zoom.bottom <= layout.top.bottom, 'Zoom outside titlebar')
    assert(layout.zoom.right <= layout.actions.x, 'Zoom overlaps action buttons')
    if (width > 560) {
      assert(layout.pixel.x >= layout.name.right, 'Pixel readout should follow filename')
      assert(layout.pixel.y > layout.name.y, 'Smaller readout should sit lower than filename')
      assert(Math.abs(layout.pixel.bottom - layout.name.bottom) <= 2, `Text lower edges differ: ${JSON.stringify(layout)}`)
    }
    assert(layout.pixelScroll <= layout.pixelClient + 1, `Pixel text clipped at width ${width}: ${JSON.stringify(layout)}`)
    assert(layout.mount.y >= layout.top.bottom, 'Titlebar overlays image')
    assert.equal(await page.locator('.fp-canvas-view .fp-zoom-controls, .vim-editor-file-info').count(), 0)
    if (width > 560) {
      await page.locator('.fp-topbar [aria-label="放大"]').click()
      assert(await page.evaluate(() => window.__IM_EDITOR_INSTANCE__.getZoom()) > 1)
    }
    await page.locator('.fp-topbar [aria-label="重置缩放并居中"]').click()
    assert.equal(await page.evaluate(() => window.__IM_EDITOR_INSTANCE__.getZoom()), 1)
    results.push({ feature: 'editor titlebar pixel and zoom layout', width, passed: true })
    await page.mouse.move(imagePoint.x, imagePoint.y)
    await page.waitForTimeout(40)
    if (width === 1280 || width === 640)
      await page.screenshot({ path: path.join(output, `editor-titlebar-${width}.png`) })
  }
  await page.setViewportSize({ width: 1280, height: 900 })
  return results
}
