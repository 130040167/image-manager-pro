import { Buffer } from 'node:buffer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { minHashDistance, Similarity } from '~/core/analysis/similarity'
import { getSimilarityDefaultThreshold } from '~/core/analysis/similarity-common'
import { SimilarityRequests } from '~/core/analysis/similarity-requests'
import { Compressed } from '~/meta'

const mockState = vi.hoisted(() => ({
  customFormats: {
    extensionPresets: {},
    folderPresets: {},
  } as any,
  files: new Map<string, Buffer>(),
}))

vi.mock('~/core/config/config', () => ({
  Config: {
    get file_customFormats() {
      return mockState.customFormats
    },
    similarity_precision: 14,
  },
}))

vi.mock('~/core/global', () => ({
  Global: {
    sharp: vi.fn((data: Buffer) => {
      const api = {
        greyscale: () => api,
        resize: () => api,
        rotate: () => api,
        removeAlpha: () => api,
        raw: () => api,
        png: () => ({
          toBuffer: async () => Buffer.from(data),
        }),
        toBuffer: async (options?: { resolveWithObject?: boolean }) => {
          if (options?.resolveWithObject) {
            const width = 64
            const height = Math.max(1, Math.floor(data.length / 3 / width) || 1)
            const pixelCount = width * height
            const rgb = Buffer.alloc(pixelCount * 3)
            for (let index = 0; index < rgb.length; index++) {
              rgb[index] = data[index % data.length] || 0
            }
            return {
              data: rgb,
              info: {
                channels: 3,
                width,
                height,
              },
            }
          }
          return Buffer.from(data)
        },
      }
      return api
    }),
  },
}))

vi.mock('fs-extra', () => ({
  default: {
    readFile: vi.fn(async (filePath: string) => {
      const file = mockState.files.get(normalizePath(filePath))
      if (!file)
        throw new Error(`missing fixture: ${filePath}`)
      return Buffer.from(file)
    }),
    stat: vi.fn(async (filePath: string) => {
      const file = mockState.files.get(normalizePath(filePath))
      if (!file)
        throw new Error(`missing fixture: ${filePath}`)
      return {
        mtimeMs: 1,
        size: file.length,
      }
    }),
  },
}))

vi.mock('~/core/analysis/dhash', () => ({
  dhash: vi.fn(async (input: string | Buffer) => {
    if (Buffer.isBuffer(input)) {
      return Array.from(input.subarray(0, 64))
        .map(value => value >= 128 ? '1' : '0')
        .join('')
        .padEnd(64, '0')
    }
    if (input.includes('throw'))
      throw new Error('hash failed')
    const value = input.includes('near')
      ? '0000000000001111'
      : input.includes('far')
        ? '1111111111111111'
        : '0000000000000000'
    return value.padEnd(64, '0')
  }),
}))

vi.mock('~/core/analysis/phash', () => ({
  hammingDistance: (a: string, b: string) => Array.from(a).reduce((count, value, index) => count + (value === b[index] ? 0 : 1), 0),
  phash: vi.fn(async () => '0'.repeat(64)),
}))

vi.mock('~/utils/node/channel', () => ({
  Channel: {
    debug: vi.fn(),
  },
}))

vi.mock('~/utils/logger', () => ({
  default: {
    error: vi.fn(),
  },
}))

function hammingDistance(a: string, b: string) {
  return Array.from(a).reduce((count, value, index) => count + (value === b[index] ? 0 : 1), 0)
}

function filterSimilar(items: { distance: number, path: string }[], threshold: number, maxResults: number) {
  return items
    .filter(item => item.distance <= threshold)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, maxResults)
}

describe('similarity', () => {
  beforeEach(() => {
    mockState.files.clear()
    mockState.customFormats = {
      extensionPresets: {},
      folderPresets: {},
    }
    Similarity.clearCache()
    Similarity.configureCache({ maxBytes: 32 * 1024 * 1024, maxEntries: 4096 })
  })

  it('streams ten thousand candidates with identical stable top-K order and bounded features', async () => {
    const scope = Array.from({ length: 10_000 }, (_, i) => image(`c:/img/${['same', 'near', 'far'][i % 3]}-${i}.png`))
    const updates: number[] = []
    const result = await Similarity.findSimilar(image('c:/img/source.png'), scope, {
      algorithm: 'dhash',
      maxResults: 37,
      threshold: 16,
      requestId: 'ten-thousand',
      onProgress: progress => updates.push(progress.completed),
    })
    const reference = scope.map((candidate, index) => ({ candidate, index, distance: [0, 4, 16][index % 3] }))
      .sort((a, b) => a.distance - b.distance || a.index - b.index)
      .slice(0, 37)
    expect(result.results.map(item => [item.image.path, item.distance])).toEqual(reference.map(item => [item.candidate.path, item.distance]))
    expect(result).toMatchObject({ requestId: 'ten-thousand', scanned: 10_000, totalMatches: 10_000 })
    expect(updates[0]).toBe(0)
    expect(updates.at(-1)).toBe(10_000)
    expect(updates.every((value, index) => index === 0 || value >= updates[index - 1])).toBe(true)
    expect(Similarity.getCacheStats().entries).toBeLessThanOrEqual(4096)
    expect(Similarity.getCacheStats().bytes).toBeLessThanOrEqual(32 * 1024 * 1024)
    expect(Similarity.getCacheStats().evictions).toBeGreaterThan(0)
  })

  it('a new panel request cancels a ten-thousand-image scan without canceling other panels', async () => {
    const requests = new SimilarityRequests()
    const old = requests.start('panel', 'old')
    const independent = requests.start('other-panel', 'independent')
    const scope = Array.from({ length: 10_000 }, (_, i) => image(`c:/img/same-${i}.png`))
    let completed = 0
    let newer: AbortController | undefined
    const oldResult = Similarity.findSimilar(image('c:/img/source.png'), scope, {
      algorithm: 'dhash',
      signal: old.signal,
      requestId: 'old',
      onProgress: (progress) => {
        completed = progress.completed
        if (completed === 100)
          newer = requests.start('panel', 'new')
      },
    })
    await expect(oldResult).rejects.toMatchObject({ name: 'AbortError' })
    expect(completed).toBe(100)
    expect(independent.signal.aborted).toBe(false)
    requests.finish('panel', old)
    expect(requests.cancel('panel', 'old')).toBe(false)
    const fresh = await Similarity.findSimilar(image('c:/img/source.png'), scope.slice(0, 10), { algorithm: 'dhash', signal: newer!.signal, requestId: 'new' })
    expect(fresh.scanned).toBe(10)
    expect(requests.cancel('panel', 'new')).toBe(true)
    expect(newer!.signal.aborted).toBe(true)
  })

  it('respects a small byte budget across repeated feature loads', async () => {
    Similarity.configureCache({ maxBytes: 1024, maxEntries: 100 })
    const scope = Array.from({ length: 200 }, (_, i) => image(`c:/img/same-${i}.png`))
    await Similarity.findSimilar(image('c:/img/source.png'), scope, { algorithm: 'dhash' })
    expect(Similarity.getCacheStats().bytes).toBeLessThanOrEqual(1024)
    expect(Similarity.getCacheStats().entries).toBeLessThan(10)
  })

  it('yields fast scans to incoming cancellation events', async () => {
    const controller = new AbortController()
    const scope = Array.from({ length: 10_000 }, (_, i) => image(`c:/img/same-${i}.png`))
    let completed = 0
    const result = Similarity.findSimilar(image('c:/img/source.png'), scope, {
      algorithm: 'dhash',
      signal: controller.signal,
      onProgress: (progress) => {
        completed = progress.completed
        if (completed === 100)
          setTimeout(() => controller.abort(), 0)
      },
    })
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(completed).toBeGreaterThanOrEqual(100)
    expect(completed).toBeLessThan(10_000)
  })

  it('computes hamming distance', () => {
    expect(hammingDistance('10101010', '11110000')).toBe(4)
  })

  it('chooses the best distance across source and candidate slices', () => {
    expect(minHashDistance([
      '0000',
      '1111',
    ], [
      '0011',
      '1111',
    ])).toBe(0)
  })

  it('filters and sorts by threshold', () => {
    expect(filterSimilar([
      { distance: 9, path: 'c.png' },
      { distance: 2, path: 'a.png' },
      { distance: 16, path: 'b.png' },
    ], 10, 10)).toEqual([
      { distance: 2, path: 'a.png' },
      { distance: 9, path: 'c.png' },
    ])
  })

  it('limits max results', () => {
    expect(filterSimilar([
      { distance: 1, path: 'a.png' },
      { distance: 2, path: 'b.png' },
      { distance: 3, path: 'c.png' },
    ], 10, 2)).toEqual([
      { distance: 1, path: 'a.png' },
      { distance: 2, path: 'b.png' },
    ])
  })

  it('keeps zero-result structure possible', () => {
    const results = filterSimilar([{ distance: 12, path: 'a.png' }], 8, 50)
    expect(results).toEqual([])
  })

  it('uses algorithm-specific threshold defaults and clamps invalid input', () => {
    expect(getSimilarityDefaultThreshold('dhash', 40)).toBe(8)
    expect(getSimilarityDefaultThreshold('ahash', 40)).toBe(8)
    expect(getSimilarityDefaultThreshold('hybrid', 12)).toBe(12)
    expect(getSimilarityDefaultThreshold('hybrid', Number.NaN)).toBe(14)
    expect(getSimilarityDefaultThreshold('histogram', Number.POSITIVE_INFINITY)).toBe(14)
  })

  it('finds real similarity results with stats, sorting and max result clamp', async () => {
    const source = image('c:/img/source.png')
    const result = await Similarity.findSimilar(source, [
      source,
      image('c:/img/far.png'),
      image('c:/img/near-a.png'),
      image('c:/img/near-b.png'),
      image('c:/img/readme.txt', 'txt'),
    ], {
      algorithm: 'dhash',
      maxResults: 1.9,
      threshold: 8,
    })

    expect(result.algorithm).toBe('dhash')
    expect(result.maxResults).toBe(1)
    expect(result.scanned).toBe(3)
    expect(result.skipped).toBe(1)
    expect(result.totalMatches).toBe(2)
    expect(result.results).toHaveLength(1)
    expect(result.results[0].distance).toBe(4)
    expect(result.results[0].image.path).toContain('near')
  })

  it('normalizes threshold and maxResults on the production search path', async () => {
    const source = image('c:/img/source.png')
    const result = await Similarity.findSimilar(source, [
      image('c:/img/near-a.png'),
      image('c:/img/near-b.png'),
    ], {
      algorithm: 'dhash',
      maxResults: 0,
      threshold: -100,
    })

    expect(result.maxResults).toBe(1)
    expect(result.threshold).toBe(0)
    expect(result.results).toEqual([])
  })

  it('keeps zero-result response structure from the production path', async () => {
    const result = await Similarity.findSimilar(image('c:/img/source.png'), [
      image('c:/img/far.png'),
    ], {
      algorithm: 'dhash',
      threshold: 1,
    })

    expect(result.results).toEqual([])
    expect(result).toMatchObject({
      algorithm: 'dhash',
      maxResults: 50,
      query: image('c:/img/source.png'),
      scanned: 1,
      skipped: 0,
      threshold: 1,
      totalMatches: 0,
    })
    expect(result.scanned).toBe(1)
    expect(result.skipped).toBe(0)
  })

  it('finds identical random 128x128 raw images at a zero threshold', async () => {
    mockState.customFormats = {
      extensionPresets: {
        raw: {
          kind: 'raw',
          options: { height: 128, layout: 'HW', width: 128 },
        },
      },
      folderPresets: {},
    }
    const random = seededBytes(128 * 128, 0xCAFE)
    const inverse = Buffer.from(Array.from(random, value => 255 - value))
    registerFile('c:/img/source.raw', random)
    registerFile('c:/img/copy.raw', random)
    registerFile('c:/img/inverse.raw', inverse)

    const result = await Similarity.findSimilar(image('c:/img/source.raw', 'raw', random.length), [
      image('c:/img/inverse.raw', 'raw', inverse.length),
      image('c:/img/copy.raw', 'raw', random.length),
    ], {
      algorithm: 'dhash',
      threshold: 0,
    })

    expect(result.scanned).toBe(2)
    expect(result.skipped).toBe(0)
    expect(result.results).toHaveLength(1)
    expect(result.results[0]).toMatchObject({
      distance: 0,
      image: { path: 'c:/img/copy.raw' },
    })
  })

  it('compares custom npy images with different dimensions through decoded pixels', async () => {
    const pixels = Array.from({ length: 16 }, (_, index) => index * 16)
    registerFile('c:/img/source.npy', npyBuffer([4, 4], pixels))
    registerFile('c:/img/reshaped.npy', npyBuffer([2, 8], pixels))

    const result = await Similarity.findSimilar(image('c:/img/source.npy', 'npy'), [
      image('c:/img/reshaped.npy', 'npy'),
    ], {
      algorithm: 'dhash',
      threshold: 0,
    })

    expect(result.results).toEqual([
      expect.objectContaining({
        distance: 0,
        image: expect.objectContaining({ path: 'c:/img/reshaped.npy' }),
      }),
    ])
  })

  it('can search all custom raw slices instead of only the first slice', async () => {
    mockState.customFormats = {
      extensionPresets: {
        raw: {
          kind: 'raw',
          options: { height: 4, layout: 'BHW', pages: 2, width: 4 },
        },
      },
      folderPresets: {},
    }
    const dark = Buffer.alloc(16, 0)
    const bright = Buffer.alloc(16, 255)
    const source = Buffer.concat([dark, bright])
    const candidate = Buffer.concat([bright, bright])
    registerFile('c:/img/source.raw', source)
    registerFile('c:/img/candidate.raw', candidate)

    const firstOnly = await Similarity.findSimilar(image('c:/img/source.raw', 'raw', source.length), [
      image('c:/img/candidate.raw', 'raw', candidate.length),
    ], {
      algorithm: 'dhash',
      sliceStrategy: 'first',
      threshold: 0,
    })
    Similarity.clearCache()
    const allSlices = await Similarity.findSimilar(image('c:/img/source.raw', 'raw', source.length), [
      image('c:/img/candidate.raw', 'raw', candidate.length),
    ], {
      algorithm: 'dhash',
      sliceStrategy: 'all',
      threshold: 0,
    })

    expect(firstOnly.results).toEqual([])
    expect(allSlices.results).toEqual([
      expect.objectContaining({
        distance: 0,
        image: expect.objectContaining({ path: 'c:/img/candidate.raw' }),
      }),
    ])
  })

  it('rejects unsupported source formats and counts vector failures as skipped', async () => {
    await expect(Similarity.findSimilar(image('c:/img/source.txt', 'txt'), [])).rejects.toThrow('format not supported')

    const result = await Similarity.findSimilar(image('c:/img/source.png'), [
      image('c:/img/throw.png'),
      image('c:/img/near.png'),
    ], {
      algorithm: 'dhash',
    })

    expect(result.scanned).toBe(1)
    expect(result.skipped).toBe(1)
  })
})

function normalizePath(filePath: string) {
  return filePath.replace(/\\/g, '/')
}

function registerFile(filePath: string, buffer: Buffer) {
  mockState.files.set(normalizePath(filePath), Buffer.from(buffer))
}

function seededBytes(length: number, seed: number) {
  const bytes = Buffer.alloc(length)
  let state = seed >>> 0
  for (let index = 0; index < bytes.length; index++) {
    state = (state * 1664525 + 1013904223) >>> 0
    bytes[index] = state >>> 24
  }
  return bytes
}

function npyHeader(descr: string, shape: number[]) {
  const shapeText = `(${shape.join(', ')}${shape.length === 1 ? ',' : ''})`
  const dict = `{'descr': '${descr}', 'fortran_order': False, 'shape': ${shapeText}, }`
  const magic = Buffer.from([0x93, 0x4E, 0x55, 0x4D, 0x50, 0x59, 0x01, 0x00])
  const rawHeaderLen = dict.length + 1
  const padding = (16 - ((magic.length + 2 + rawHeaderLen) % 16)) % 16
  const header = `${dict}${' '.repeat(padding)}\n`
  const len = Buffer.alloc(2)
  len.writeUInt16LE(header.length, 0)
  return Buffer.concat([magic, len, Buffer.from(header, 'latin1')])
}

function npyBuffer(shape: number[], data: number[]) {
  return Buffer.concat([npyHeader('|u1', shape), Buffer.from(data)])
}

function image(path: string, extname = path.split('.').pop() || 'png', size = 10): ImageType {
  return {
    absDirPath: 'c:/img',
    absWorkspaceFolder: 'c:/',
    basename: path.split('/').pop() || path,
    dirPath: 'img',
    extname,
    info: {
      compressed: Compressed.unknown,
      gitStaged: false,
      metadata: {},
    },
    key: path,
    name: path,
    path,
    relativePath: path,
    stats: {
      mtimeMs: 1,
      size,
    },
    vscodePath: path,
    workspaceFolder: 'img',
  }
}
