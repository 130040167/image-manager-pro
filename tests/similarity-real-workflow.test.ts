import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Similarity } from '~/core/analysis/similarity'
import { DEFAULT_CONFIG } from '~/core/config/common'
import { Global } from '~/core/global'
import { Compressed } from '~/meta'
import { getSimilarityCandidateImages, resolveSimilarityOptions } from '~/webview/image-manager/hooks/use-image-similarity/similarity-ui'

vi.mock('vscode', () => ({
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2,
  },
  workspace: {
    getConfiguration: () => ({
      get: (key: string) => {
        const parts = key.split('.')
        let value: any = DEFAULT_CONFIG
        for (const part of parts) {
          value = value?.[part]
        }
        return value
      },
      update: vi.fn(),
    }),
  },
}))

vi.mock('~/utils/node/channel', () => ({
  Channel: {
    debug: vi.fn(),
    warn: vi.fn(),
  },
}))

vi.mock('~/utils/logger', () => ({
  default: {
    error: vi.fn(),
  },
}))

function gradient(width = 64, height = 64, offset = 0) {
  const pixels = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 3
      const value = (x * 3 + y + offset) % 256
      pixels[index] = value
      pixels[index + 1] = (value + 24) % 256
      pixels[index + 2] = (value + 48) % 256
    }
  }
  return pixels
}

function checker(width = 64, height = 64) {
  const pixels = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 3
      const value = ((Math.floor(x / 8) + Math.floor(y / 8)) % 2) * 255
      pixels[index] = value
      pixels[index + 1] = value
      pixels[index + 2] = value
    }
  }
  return pixels
}

async function writePng(filePath: string, pixels: Buffer) {
  await sharp(pixels, {
    raw: {
      channels: 3,
      height: 64,
      width: 64,
    },
  }).png().toFile(filePath)
}

async function imageOf(filePath: string, root: string): Promise<ImageType> {
  const stat = await fs.stat(filePath)
  const normalized = filePath.replace(/\\/g, '/')
  return {
    absDirPath: path.dirname(filePath).replace(/\\/g, '/'),
    absWorkspaceFolder: root.replace(/\\/g, '/'),
    basename: path.basename(filePath),
    dirPath: path.relative(root, path.dirname(filePath)).replace(/\\/g, '/') || '.',
    extname: path.extname(filePath).slice(1),
    info: {
      compressed: Compressed.unknown,
      gitStaged: false,
      metadata: {},
    },
    key: normalized,
    name: path.parse(filePath).name,
    path: normalized,
    relativePath: path.relative(root, filePath).replace(/\\/g, '/'),
    stats: {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    },
    vscodePath: normalized,
    workspaceFolder: path.basename(root),
  }
}

describe('similarity real workflow', () => {
  let tmpDir: string
  let previousSharp: any

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'im-similarity-real-'))
    previousSharp = (Global as any).sharp
    ;(Global as any).sharp = sharp
    Similarity.clearCache()
  })

  afterEach(async () => {
    ;(Global as any).sharp = previousSharp
    Similarity.clearCache()
    await fs.rm(tmpDir, { force: true, recursive: true })
  })

  it('flows from UI candidate normalization into the real dhash implementation', async () => {
    const sameDir = path.join(tmpDir, 'same')
    const otherDir = path.join(tmpDir, 'other')
    await fs.mkdir(sameDir)
    await fs.mkdir(otherDir)

    const sourcePath = path.join(sameDir, 'source.png')
    const duplicatePath = path.join(sameDir, 'source-copy.png')
    const farPath = path.join(sameDir, 'far.png')
    const otherDirPath = path.join(otherDir, 'other-copy.png')
    await writePng(sourcePath, gradient())
    await writePng(duplicatePath, gradient())
    await writePng(farPath, checker())
    await writePng(otherDirPath, gradient())

    const source = await imageOf(sourcePath, tmpDir)
    const duplicate = await imageOf(duplicatePath, tmpDir)
    const far = await imageOf(farPath, tmpDir)
    const other = await imageOf(otherDirPath, tmpDir)
    const resolved = resolveSimilarityOptions({
      algorithm: 'dhash',
      scope: 'same-level',
      threshold: 0,
    })
    const candidates = getSimilarityCandidateImages(source, [source, duplicate, duplicate, far, other], resolved)

    expect(candidates.map(image => path.basename(image.path))).toEqual(['source-copy.png', 'far.png'])

    const result = await Similarity.findSimilar(source, candidates, resolved)

    expect(result.scanned).toBe(2)
    expect(result.skipped).toBe(0)
    expect(result.totalMatches).toBe(1)
    expect(result.results).toHaveLength(1)
    expect(result.results[0]).toMatchObject({
      algorithm: 'dhash',
      distance: 0,
      image: expect.objectContaining({
        basename: 'source-copy.png',
      }),
    })
  })
})
