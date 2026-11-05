import assert from 'node:assert/strict'

export async function checkPreviewIdle(page) {
  await page.waitForTimeout(500)
  await page.evaluate(() => {
    const img = document.querySelector('.ant-image-preview-img')
    window.__layoutReads = 0
    const original = img.getBoundingClientRect.bind(img)
    img.getBoundingClientRect = () => {
      window.__layoutReads++
      return original()
    }
  })
  await page.waitForTimeout(500)
  assert.equal(await page.evaluate(() => window.__layoutReads), 0, 'Idle preview keeps reading layout')
  await page.evaluate(() => {
    const img = document.querySelector('.ant-image-preview-img')
    img.parentElement.animate([{ transform: 'scale(0.98)' }, { transform: 'scale(1)' }], { duration: 240 })
    img.parentElement.dispatchEvent(new Event('animationstart', { bubbles: true }))
  })
  await page.waitForTimeout(350)
  const during = await page.evaluate(() => window.__layoutReads)
  assert(during > 2, 'Preview failed to track ancestor animation')
  await page.waitForTimeout(400)
  assert.equal(await page.evaluate(() => window.__layoutReads), during, 'Animation completion did not stop layout sampling')
  return { feature: 'preview idle has zero layout polling; finite animation tracked', animationFrames: during, passed: true }
}
