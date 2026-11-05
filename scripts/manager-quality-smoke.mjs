import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const output = path.resolve('output/playwright/manager-quality')
fs.mkdirSync(output, { recursive: true })
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
const errors = []
page.on('pageerror', error => errors.push(error.message))
const base = process.env.IM_QUALITY_URL || 'http://127.0.0.1:5199'
const result = {}
try {
  await page.goto(`${base}/?manager`)
  await page.locator('[data-image-grid-item="19"]').waitFor()
  await page.waitForTimeout(300)
  await page.evaluate(() => window.__managerMeasure())
  const first = await page.locator('[data-image-grid-item="0"]').boundingBox()
  const second = await page.locator('[data-image-grid-item="1"]').boundingBox()
  assert(Math.abs(first.y - second.y) < 1, 'Small directories lost row layout')
  result.item = first
  await page.locator('[data-manager-large]').click()
  await page.waitForFunction(() => document.querySelector('[data-image-grid-count="10000"][data-image-grid-virtualized="true"]'))
  await page.waitForTimeout(200)
  result.initial = await page.locator('[data-image-grid-item]').count()
  assert(result.initial < 400)
  await page.locator('[data-image-grid-item="0"]').click({ modifiers: ['Control'] })
  await page.locator('[data-manager-reveal]').click()
  await page.locator('[data-image-grid-item="8765"]').waitFor()
  await page.waitForTimeout(200)
  result.deep = await page.locator('[data-image-grid-item]').count()
  assert(result.deep < 400)
  await page.locator('[data-image-grid-item="8765"]').click({ modifiers: ['Shift'] })
  result.selected = Number(await page.locator('[data-manager-stats]').getAttribute('data-selected'))
  assert.equal(result.selected, 8766)
  await page.locator('[data-image-grid-item="8765"] [data-disable-dbclick]').first().click()
  await page.locator('.ant-image-preview-img').waitFor()
  result.previewSrc = await page.locator('.ant-image-preview-img').getAttribute('src')
  assert(result.previewSrc.endsWith('#8765'))
  await page.screenshot({ path: path.join(output, 'grid-preview.png') })

  await page.goto(`${base}/?manager&similarity`)
  await page.locator('[data-manager-search]').click()
  await page.locator('[data-similarity-progress]').waitFor()
  await page.evaluate(() => {
    const request = window.__managerSearches[0]
    window.dispatchEvent(new MessageEvent('message', { data: { cmd: 'similarity_progress', data: { requestId: request.requestId, completed: 3000, total: 9999, scanned: 3000, skipped: 0, totalMatches: 2 } } }))
  })
  await page.getByText('3000 / 9999', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'im.search', exact: true }).click()
  await page.waitForFunction(() => window.__managerSearches.length === 2)
  assert.equal(await page.evaluate(() => window.__managerCancellations.includes(window.__managerSearches[0].requestId)), true)
  await page.evaluate(() => {
    const old = window.__managerSearches[0]
    window.dispatchEvent(new MessageEvent('message', { data: { cmd: 'similarity_progress', data: { requestId: old.requestId, completed: 9000, total: 9999 } } }))
    old.reply({ requestId: old.requestId, results: [], scanned: 9999 })
  })
  assert.equal(await page.getByText('9000 / 9999', { exact: true }).count(), 0)
  await page.getByRole('button', { name: 'im.cancel', exact: true }).click()
  await page.waitForFunction(() => window.__managerCancellations.includes(window.__managerSearches[1].requestId))
  await page.locator('[data-similarity-progress]').waitFor({ state: 'detached' })
  await page.getByRole('button', { name: 'im.search', exact: true }).click()
  await page.waitForFunction(() => window.__managerSearches.length === 3)
  await page.locator('.ant-modal-close').click()
  await page.waitForFunction(() => window.__managerCancellations.includes(window.__managerSearches[2].requestId))
  result.similarity = 'progress, supersede, cancel, stale reply, close passed'
  assert.deepEqual(errors, [])
  fs.writeFileSync(path.join(output, 'results.json'), `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify(result))
}
catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') })
  console.error(errors)
  throw error
}
finally {
  await browser.close()
}
