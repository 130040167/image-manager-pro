import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const cwd = process.cwd()
const outputDir = path.join(cwd, 'output', 'playwright', 'image-grid-virtualization')
await fs.mkdir(outputDir, { recursive: true })
const server = await createServer({ configFile: 'scripts/image-grid-virtualization-harness/vite.config.ts' })
await server.listen()

try {
  const candidates = [process.env.IM_RENDER_SMOKE_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']
  const browser = await chromium.launch({ executablePath: candidates.find(candidate => candidate && fsSync.existsSync(candidate)), headless: true })
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } })
  await page.goto('http://127.0.0.1:5201', { waitUntil: 'networkidle' })
  const baseline = await page.locator('.item').count()
  const baselineMetrics = await page.locator('#stats').evaluate(element => ({
    height: document.querySelector('#grid').getBoundingClientRect().height,
    renderMs: Number(element.getAttribute('data-baseline-ms')),
  }))
  await page.locator('#toggle').click()
  await page.waitForFunction(() => document.querySelector('#stats')?.textContent === 'virtual')
  await page.waitForTimeout(100)
  const initial = await page.locator('.item').count()
  const virtualizeMs = Number(await page.locator('#stats').getAttribute('data-virtualize-ms'))

  await page.locator('.item[data-index="0"]').click()
  await page.locator('#locate').click()
  await page.waitForFunction(() => document.querySelector('.item[data-index="8765"]'))
  const deepWindow = await page.locator('#stats').getAttribute('data-window')
  const deepCount = await page.locator('.item').count()
  await page.locator('.item[data-index="8765"]').click({ modifiers: ['Shift'] })
  const result = await page.locator('#stats').evaluate(element => ({
    previewIndex: Number(element.getAttribute('data-preview')),
    selectedCount: Number(element.getAttribute('data-selected')),
  }))
  const scrollTop = await page.locator('#viewport').evaluate(element => element.scrollTop)
  const virtualHeight = await page.locator('#grid').evaluate(element => element.getBoundingClientRect().height)
  const output = { baseline, baselineMetrics, deepCount, deepWindow, initial, scrollTop, virtualHeight, virtualizeMs, ...result }
  if (baseline !== 10_000)
    throw new Error(`baseline node count mismatch: ${baseline}`)
  if (initial > 250 || deepCount > 250)
    throw new Error(`virtual node count too high: ${initial}/${deepCount}`)
  if (result.selectedCount !== 8_766 || result.previewIndex !== 8_765)
    throw new Error(`interaction mismatch: ${JSON.stringify(result)}`)
  if (scrollTop < 90_000)
    throw new Error(`deep locate did not scroll: ${scrollTop}`)
  await fs.writeFile(path.join(outputDir, 'results.json'), `${JSON.stringify(output, null, 2)}\n`)
  console.log(JSON.stringify(output, null, 2))
  await browser.close()
}
finally {
  await server.close()
}
