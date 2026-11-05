import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const source = process.argv[2]
if (!source)
  throw new Error('Usage: node scripts/prepare-icon.mjs <transparent-icon.png>')
const assets = path.resolve('assets')
await fs.mkdir(assets, { recursive: true })
const image = sharp(source).ensureAlpha().trim().resize(224, 224, {
  fit: 'contain',
  background: { r: 0, g: 0, b: 0, alpha: 0 },
}).extend({
  top: 16, bottom: 16, left: 16, right: 16,
  background: { r: 0, g: 0, b: 0, alpha: 0 },
})
await image.clone().png().toFile(path.join(assets, 'logo.png'))
await image.clone().webp({ lossless: true }).toFile(path.join(assets, 'logo.webp'))
await fs.copyFile(path.join(assets, 'logo.png'), path.resolve('docs/public/logo.png'))
console.log('Prepared matching transparent PNG, WebP, and documentation icons.')
