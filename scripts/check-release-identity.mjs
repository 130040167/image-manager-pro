import assert from 'node:assert/strict'
import fs from 'node:fs'

const manifest = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
assert(manifest.publisher && manifest.publisher.toLowerCase() !== 'minko',
  'Set package.json publisher to your own verified Marketplace publisher ID before publishing. Minko belongs to the upstream project.')
assert(manifest.name === 'image-manager-pro', 'Unexpected extension name')
console.log(`Release identity: ${manifest.publisher}.${manifest.name}`)
