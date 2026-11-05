import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Similarity } from '~/core/analysis/similarity'
import { DEFAULT_CONFIG } from '~/core/config/common'
import { Global } from '~/core/global'
import { Compressed } from '~/meta'
import { createSimilarityFixtureDataset } from '../scripts/generate-similarity-fixtures'

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
        for (const part of parts)
          value = value?.[part]
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

describe('similarity generated dataset', () => {
  let tmpDir: string
  let previousSharp: any

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'im-similarity-dataset-'))
    previousSharp = (Global as any).sharp
    ;(Global as any).sharp = sharp
    Similarity.clearCache()
  })

  afterEach(async () => {
    ;(Global as any).sharp = previousSharp
    Similarity.clearCache()
    await fs.rm(tmpDir, { force: true, recursive: true })
  })

  it('finds strong manifest matches with the default hybrid settings and rejects unrelated images', async () => {
    const manifest = await createSimilarityFixtureDataset({ clean: true, outDir: tmpDir })
    const sourceCase = manifest.cases.find(item => item.id === 'complex-scene/source')
    expect(sourceCase).toBeTruthy()

    const byPath = new Map(manifest.cases.map(item => [item.path.replace(/\\/g, '/'), item.id]))
    const source = await imageOf(sourceCase!.path, tmpDir)
    const candidates = await Promise.all(
      manifest.cases
        .filter(item => item.path !== sourceCase!.path)
        .map(item => imageOf(item.path, tmpDir)),
    )

    const result = await Similarity.findSimilar(source, candidates, {
      algorithm: 'hybrid',
      maxResults: 40,
    })
    const resultIds = result.results.map(item => byPath.get(item.image.path) || item.image.path)
    const strongMatches = manifest.matches
      .filter(item => item.sourceId === sourceCase!.id && item.strength === 'strong')
      .map(item => item.targetId)
    const unrelatedIds = new Set(
      manifest.cases
        .filter(item => item.kind === 'unrelated')
        .map(item => item.id),
    )

    expect(result.threshold).toBe(14)
    expect(resultIds.filter(id => strongMatches.includes(id))).toHaveLength(strongMatches.length)
    expect(resultIds.filter(id => unrelatedIds.has(id))).toEqual([])
  })

  it('uses histogram evidence in hybrid mode to reject a hash-only color trap', async () => {
    const manifest = await createSimilarityFixtureDataset({ clean: true, outDir: tmpDir })
    const sourceCase = manifest.cases.find(item => item.id === 'luminance-trap/source')
    const trapCase = manifest.cases.find(item => item.id === 'luminance-trap/unrelated-same-luminance')
    expect(sourceCase).toBeTruthy()
    expect(trapCase).toBeTruthy()

    const source = await imageOf(sourceCase!.path, tmpDir)
    const trap = await imageOf(trapCase!.path, tmpDir)
    const phashOnly = await Similarity.findSimilar(source, [trap], {
      algorithm: 'phash',
      threshold: 0,
    })
    const hybrid = await Similarity.findSimilar(source, [trap], {
      algorithm: 'hybrid',
    })

    expect(phashOnly.results).toHaveLength(1)
    expect(hybrid.results).toEqual([])
  })
})
