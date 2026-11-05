import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

export const DEFAULT_SIMILARITY_FIXTURE_DIR = 'D:\\华为家庭存储\\mySpace\\learning\\图像分割\\数据集\\image-manager-custom-format-test'

export type SimilarityFixtureCase = {
  expectedFor?: string[]
  group: string
  id: string
  kind: 'source' | 'unrelated' | 'variant'
  path: string
  strength?: 'strong' | 'weak'
  transforms: string[]
}

export type SimilarityFixtureMatch = {
  sourceId: string
  strength: 'strong' | 'weak'
  targetId: string
  transforms: string[]
}

export type SimilarityFixtureManifest = {
  cases: SimilarityFixtureCase[]
  datasetRoot: string
  description: string
  generatedAt: string
  matches: SimilarityFixtureMatch[]
  version: 1
}

export type SimilarityFixtureOptions = {
  clean?: boolean
  outDir?: string
}

type MutableManifest = SimilarityFixtureManifest

const WIDTH = 256
const HEIGHT = 256

export async function createSimilarityFixtureDataset(options: SimilarityFixtureOptions = {}): Promise<SimilarityFixtureManifest> {
  const outDir = path.resolve(options.outDir || DEFAULT_SIMILARITY_FIXTURE_DIR)
  if (options.clean)
    await fs.rm(outDir, { force: true, recursive: true })
  await fs.mkdir(outDir, { recursive: true })

  const manifest: MutableManifest = {
    cases: [],
    datasetRoot: normalizePath(outDir),
    description: 'Generated real-image files for vscode-image-manager similarity matching. Binaries are reproducible and intentionally not committed.',
    generatedAt: new Date().toISOString(),
    matches: [],
    version: 1,
  }

  await createStandardGroup(manifest, outDir, 'complex-scene', complexSceneSvg())
  await createStandardGroup(manifest, outDir, 'simple-shapes', simpleShapesSvg())
  await createStandardGroup(manifest, outDir, 'document-layout', documentLayoutSvg())
  await createTextureGroup(manifest, outDir)
  await createLuminanceTrapGroup(manifest, outDir)
  await createUnrelatedImages(manifest, outDir)

  await fs.writeFile(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return manifest
}

async function createStandardGroup(manifest: MutableManifest, outDir: string, group: string, svg: string) {
  const groupDir = path.join(outDir, group)
  const sourcePath = path.join(groupDir, 'source.png')
  await writeSvg(sourcePath, svg)
  addCase(manifest, {
    group,
    id: `${group}/source`,
    kind: 'source',
    path: sourcePath,
    transforms: ['source'],
  })

  await addVariant(manifest, group, sourcePath, 'duplicate.png', 'strong', ['same pixels'], image => image.png())
  await addVariant(manifest, group, sourcePath, 'resize-128.png', 'strong', ['resize'], image => image.resize(128, 128).png())
  await addVariant(manifest, group, sourcePath, 'jpeg-q55.jpg', 'strong', ['compression', 'format conversion'], image => image.jpeg({ quality: 55 }))
  await addVariant(manifest, group, sourcePath, 'webp-q70.webp', 'strong', ['format conversion'], image => image.webp({ quality: 70 }))
  await addVariant(manifest, group, sourcePath, 'brightness-up.png', 'strong', ['brightness'], image => image.modulate({ brightness: 1.14 }).png())
  await addVariant(manifest, group, sourcePath, 'contrast-up.png', 'strong', ['contrast'], image => image.linear(1.18, -12).png())
  await addVariant(manifest, group, sourcePath, 'blur-light.png', 'strong', ['light blur'], image => image.blur(0.8).png())
  await addNoiseVariant(manifest, group, sourcePath, 'noise-light.png', 'strong', ['noise'], 14)
  await addVariant(manifest, group, sourcePath, 'hue-shift.png', 'strong', ['slight color change'], image => image.modulate({ hue: 10, saturation: 1.08 }).png())
  await addVariant(manifest, group, sourcePath, 'crop-light.png', 'weak', ['crop'], image => image.resize(292, 292).extract({ height: HEIGHT, left: 18, top: 18, width: WIDTH }).png())
  await addCompositeVariant(manifest, group, sourcePath, 'text-overlay.png', 'weak', ['text overlay'], overlaySvg('COPY', 18, 24, 92, 34, '#111827', 0.72))
  await addCompositeVariant(manifest, group, sourcePath, 'occlusion.png', 'weak', ['occlusion'], overlaySvg('', 154, 132, 74, 56, '#f8fafc', 0.82))
}

async function createTextureGroup(manifest: MutableManifest, outDir: string) {
  const group = 'complex-texture'
  const groupDir = path.join(outDir, group)
  const sourcePath = path.join(groupDir, 'source.png')
  await fs.mkdir(groupDir, { recursive: true })
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 3)
  let seed = 0xBADC0DE
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      seed = nextSeed(seed)
      const base = (Math.sin(x / 7) + Math.cos(y / 11)) * 24 + (seed >>> 24)
      const index = (y * WIDTH + x) * 3
      pixels[index] = clampByte(base + 50)
      pixels[index + 1] = clampByte(base + 92 + (x % 23))
      pixels[index + 2] = clampByte(base + 128 + (y % 19))
    }
  }
  await sharp(pixels, { raw: { channels: 3, height: HEIGHT, width: WIDTH } }).png().toFile(sourcePath)
  addCase(manifest, {
    group,
    id: `${group}/source`,
    kind: 'source',
    path: sourcePath,
    transforms: ['source', 'complex texture'],
  })

  await addVariant(manifest, group, sourcePath, 'jpeg-q45.jpg', 'strong', ['compression', 'complex texture'], image => image.jpeg({ quality: 45 }))
  await addVariant(manifest, group, sourcePath, 'resize-160.png', 'strong', ['resize', 'complex texture'], image => image.resize(160, 160).png())
  await addVariant(manifest, group, sourcePath, 'blur-light.png', 'strong', ['light blur', 'complex texture'], image => image.blur(0.6).png())
  await addNoiseVariant(manifest, group, sourcePath, 'noise-light.png', 'strong', ['noise', 'complex texture'], 10)
  await addVariant(manifest, group, sourcePath, 'crop-light.png', 'weak', ['crop', 'complex texture'], image => image.resize(286, 286).extract({ height: HEIGHT, left: 15, top: 15, width: WIDTH }).png())
}

async function createLuminanceTrapGroup(manifest: MutableManifest, outDir: string) {
  const group = 'luminance-trap'
  const groupDir = path.join(outDir, group)
  const sourcePath = path.join(groupDir, 'source.png')
  const trapPath = path.join(groupDir, 'unrelated-same-luminance.png')
  await fs.mkdir(groupDir, { recursive: true })
  const source = Buffer.alloc(192 * 192 * 3)
  const trap = Buffer.alloc(192 * 192 * 3)
  for (let y = 0; y < 192; y++) {
    for (let x = 0; x < 192; x++) {
      const value = 42 + ((Math.floor(x / 12) + Math.floor(y / 12)) % 2) * 150
      const index = (y * 192 + x) * 3
      source[index] = value
      source[index + 1] = value
      source[index + 2] = value
      trap[index] = value
      trap[index + 1] = 0
      trap[index + 2] = 0
    }
  }
  await sharp(source, { raw: { channels: 3, height: 192, width: 192 } }).png().toFile(sourcePath)
  await sharp(trap, { raw: { channels: 3, height: 192, width: 192 } }).png().toFile(trapPath)
  addCase(manifest, {
    group,
    id: `${group}/source`,
    kind: 'source',
    path: sourcePath,
    transforms: ['source', 'hash color trap baseline'],
  })
  addCase(manifest, {
    group,
    id: `${group}/unrelated-same-luminance`,
    kind: 'unrelated',
    path: trapPath,
    transforms: ['same structure', 'different color histogram'],
  })
}

async function createUnrelatedImages(manifest: MutableManifest, outDir: string) {
  const group = 'unrelated'
  const groupDir = path.join(outDir, group)
  await writeSvg(path.join(groupDir, 'checkerboard.png'), checkerboardSvg())
  await writeSvg(path.join(groupDir, 'rings.png'), ringsSvg())
  await writeSvg(path.join(groupDir, 'solid-blocks.png'), solidBlocksSvg())
  await writeRandomNoise(path.join(groupDir, 'random-noise.png'), 0x12345678)

  for (const name of ['checkerboard', 'rings', 'solid-blocks', 'random-noise']) {
    addCase(manifest, {
      group,
      id: `${group}/${name}`,
      kind: 'unrelated',
      path: path.join(groupDir, `${name}.png`),
      transforms: ['unrelated'],
    })
  }
}

async function addVariant(
  manifest: MutableManifest,
  group: string,
  sourcePath: string,
  fileName: string,
  strength: 'strong' | 'weak',
  transforms: string[],
  transform: (image: sharp.Sharp) => sharp.Sharp,
) {
  const outputPath = path.join(path.dirname(sourcePath), fileName)
  await transform(sharp(sourcePath).rotate()).toFile(outputPath)
  addVariantCase(manifest, group, sourcePath, outputPath, strength, transforms)
}

async function addNoiseVariant(
  manifest: MutableManifest,
  group: string,
  sourcePath: string,
  fileName: string,
  strength: 'strong' | 'weak',
  transforms: string[],
  amount: number,
) {
  const outputPath = path.join(path.dirname(sourcePath), fileName)
  const { data, info } = await sharp(sourcePath)
    .rotate()
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const output = Buffer.from(data)
  let seed = 0xFEEDFACE
  for (let index = 0; index < output.length; index++) {
    seed = nextSeed(seed)
    output[index] = clampByte(output[index] + ((seed >>> 24) % (amount * 2 + 1)) - amount)
  }
  await sharp(output, { raw: { channels: info.channels, height: info.height, width: info.width } }).png().toFile(outputPath)
  addVariantCase(manifest, group, sourcePath, outputPath, strength, transforms)
}

async function addCompositeVariant(
  manifest: MutableManifest,
  group: string,
  sourcePath: string,
  fileName: string,
  strength: 'strong' | 'weak',
  transforms: string[],
  overlay: string,
) {
  const outputPath = path.join(path.dirname(sourcePath), fileName)
  await sharp(sourcePath)
    .rotate()
    .composite([{ input: Buffer.from(overlay) }])
    .png()
    .toFile(outputPath)
  addVariantCase(manifest, group, sourcePath, outputPath, strength, transforms)
}

function addVariantCase(
  manifest: MutableManifest,
  group: string,
  sourcePath: string,
  outputPath: string,
  strength: 'strong' | 'weak',
  transforms: string[],
) {
  const sourceId = `${group}/source`
  const targetId = `${group}/${path.parse(outputPath).name}`
  addCase(manifest, {
    expectedFor: [sourceId],
    group,
    id: targetId,
    kind: 'variant',
    path: outputPath,
    strength,
    transforms,
  })
  manifest.matches.push({
    sourceId,
    strength,
    targetId,
    transforms,
  })
}

function addCase(manifest: MutableManifest, item: SimilarityFixtureCase) {
  manifest.cases.push({
    ...item,
    path: normalizePath(item.path),
  })
}

async function writeSvg(filePath: string, svg: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await sharp(Buffer.from(svg)).png().toFile(filePath)
}

async function writeRandomNoise(filePath: string, seedStart: number) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const pixels = Buffer.alloc(WIDTH * HEIGHT * 3)
  let seed = seedStart
  for (let index = 0; index < pixels.length; index++) {
    seed = nextSeed(seed)
    pixels[index] = seed >>> 24
  }
  await sharp(pixels, { raw: { channels: 3, height: HEIGHT, width: WIDTH } }).png().toFile(filePath)
}

function complexSceneSvg() {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="sky" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#7dd3fc"/><stop offset="1" stop-color="#fef3c7"/></linearGradient>
    <linearGradient id="water" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#0e7490"/><stop offset="1" stop-color="#67e8f9"/></linearGradient>
  </defs>
  <rect width="256" height="256" fill="url(#sky)"/>
  <circle cx="207" cy="47" r="24" fill="#fde047"/>
  <path d="M0 150 L54 82 L93 146 L136 70 L202 152 Z" fill="#475569"/>
  <path d="M43 99 L54 82 L66 104 Z M124 91 L136 70 L150 96 Z" fill="#e2e8f0"/>
  <rect y="150" width="256" height="106" fill="url(#water)"/>
  <path d="M0 178 C42 160 78 190 119 172 S198 166 256 184 V256 H0Z" fill="#166534"/>
  <g fill="#14532d"><rect x="25" y="135" width="8" height="45"/><circle cx="29" cy="130" r="18"/><rect x="222" y="128" width="7" height="44"/><circle cx="225" cy="122" r="15"/></g>
  <g stroke="#f8fafc" stroke-opacity=".55" stroke-width="2"><path d="M8 205 C46 198 82 210 121 202"/><path d="M138 216 C170 208 207 212 244 204"/></g>
</svg>`
}

function simpleShapesSvg() {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="256" height="256" fill="#f8fafc"/>
  <rect x="28" y="34" width="86" height="86" rx="10" fill="#2563eb"/>
  <circle cx="176" cy="78" r="44" fill="#f97316"/>
  <path d="M46 204 L111 139 L176 204 Z" fill="#16a34a"/>
  <rect x="142" y="146" width="72" height="72" rx="16" fill="#db2777"/>
  <path d="M35 35 L219 221" stroke="#0f172a" stroke-width="9" stroke-linecap="round"/>
</svg>`
}

function documentLayoutSvg() {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="256" height="256" fill="#f1f5f9"/>
  <rect x="32" y="22" width="192" height="212" rx="4" fill="#ffffff"/>
  <rect x="52" y="46" width="112" height="12" fill="#0f172a"/>
  <rect x="52" y="73" width="152" height="7" fill="#94a3b8"/>
  <rect x="52" y="91" width="132" height="7" fill="#94a3b8"/>
  <rect x="52" y="109" width="148" height="7" fill="#94a3b8"/>
  <rect x="52" y="138" width="56" height="56" fill="#38bdf8"/>
  <rect x="122" y="138" width="82" height="8" fill="#64748b"/>
  <rect x="122" y="156" width="74" height="8" fill="#64748b"/>
  <rect x="122" y="174" width="88" height="8" fill="#64748b"/>
  <rect x="52" y="213" width="152" height="5" fill="#cbd5e1"/>
</svg>`
}

function checkerboardSvg() {
  const cells = Array.from({ length: 16 * 16 }, (_, index) => {
    const x = index % 16
    const y = Math.floor(index / 16)
    const color = (x + y) % 2 ? '#111827' : '#f9fafb'
    return `<rect x="${x * 16}" y="${y * 16}" width="16" height="16" fill="${color}"/>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">${cells}</svg>`
}

function ringsSvg() {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="256" height="256" fill="#020617"/>
  <circle cx="128" cy="128" r="104" fill="none" stroke="#f43f5e" stroke-width="18"/>
  <circle cx="128" cy="128" r="68" fill="none" stroke="#22c55e" stroke-width="18"/>
  <circle cx="128" cy="128" r="32" fill="none" stroke="#38bdf8" stroke-width="18"/>
</svg>`
}

function solidBlocksSvg() {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="128" height="128" fill="#7f1d1d"/>
  <rect x="128" width="128" height="128" fill="#1e3a8a"/>
  <rect y="128" width="128" height="128" fill="#365314"/>
  <rect x="128" y="128" width="128" height="128" fill="#581c87"/>
</svg>`
}

function overlaySvg(text: string, x: number, y: number, width: number, height: number, color: string, opacity: number) {
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="5" fill="${color}" fill-opacity="${opacity}"/>
  <text x="${x + 10}" y="${y + Math.round(height * 0.66)}" fill="#fff" font-size="18" font-family="Arial, sans-serif" font-weight="700">${text}</text>
</svg>`
}

function nextSeed(seed: number) {
  return (seed * 1664525 + 1013904223) >>> 0
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function normalizePath(filePath: string) {
  return filePath.replace(/\\/g, '/')
}

function parseOutDir(argv: string[]) {
  const outIndex = argv.findIndex(item => item === '--out' || item === '-o')
  if (outIndex !== -1 && argv[outIndex + 1])
    return argv[outIndex + 1]
  return DEFAULT_SIMILARITY_FIXTURE_DIR
}

function parseClean(argv: string[]) {
  return argv.includes('--clean')
}

const isCli = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false

if (isCli) {
  createSimilarityFixtureDataset({
    clean: parseClean(process.argv),
    outDir: parseOutDir(process.argv),
  })
    .then((manifest) => {
      console.log(JSON.stringify({
        cases: manifest.cases.length,
        manifest: normalizePath(path.join(manifest.datasetRoot, 'manifest.json')),
        matches: manifest.matches.length,
        outDir: manifest.datasetRoot,
      }, null, 2))
    })
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
}
