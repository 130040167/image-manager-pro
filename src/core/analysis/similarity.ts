import type { SimilarityAlgorithm, SimilaritySliceStrategy } from './similarity-common'
import path from 'node:path'
import { setImmediate as yieldToEvents } from 'node:timers/promises'
import fs from 'fs-extra'
import { customImageCacheKey, decodeCustomImage, isLikelyCustomImageFile } from '~/core/custom-format'
import { Global } from '~/core/global'
import logger from '~/utils/logger'
import { Channel } from '~/utils/node/channel'
import { Config } from '../config/config'
import { ahash } from './ahash'
import { dhash } from './dhash'
import { histogram, histogramDistance } from './histogram'
import { hammingDistance, phash } from './phash'
import { WeightedLruCache } from './similarity-cache'
import {
  getSimilarityDefaultThreshold,
  normalizeSimilarityMaxResults,
  normalizeSimilarityThreshold,

} from './similarity-common'

export type SimilarityOptions = {
  algorithm?: SimilarityAlgorithm
  maxResults?: number
  onProgress?: (progress: SimilarityProgress) => void
  preset?: string
  requestId?: string
  signal?: AbortSignal
  sliceStrategy?: SimilaritySliceStrategy
  threshold?: number
}

export type SimilarityProgress = {
  completed: number
  requestId: string
  scanned: number
  skipped: number
  total: number
  totalMatches: number
}

export type SimilarityResult = {
  algorithm: SimilarityAlgorithm
  distance: number
  image: ImageType
}

export type SimilarityFindResult = {
  algorithm: SimilarityAlgorithm
  maxResults: number
  query: ImageType
  requestId: string
  results: SimilarityResult[]
  scanned: number
  skipped: number
  threshold: number
  totalMatches: number
}

type HybridVector = {
  hash: string
  histogram: number[]
}
type SimilarityVector = string | number[] | HybridVector
type FeatureCacheValue = {
  pageCount?: number
  vector: string | number[]
}
type RankedSimilarityResult = {
  index: number
  result: SimilarityResult
}

const DEFAULT_CACHE_MAX_ENTRIES = 4096
const DEFAULT_CACHE_MAX_BYTES = 32 * 1024 * 1024
const featureCache = new WeightedLruCache<string, FeatureCacheValue>(
  DEFAULT_CACHE_MAX_ENTRIES,
  DEFAULT_CACHE_MAX_BYTES,
  (value, key) => 24 + key.length * 2 + (typeof value.vector === 'string' ? value.vector.length * 2 : value.vector.length * 8),
)

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted)
    return
  const error = new Error(typeof signal.reason === 'string' ? signal.reason : 'Similarity search cancelled')
  error.name = 'AbortError'
  throw error
}

function compareRankedResult(a: RankedSimilarityResult, b: RankedSimilarityResult) {
  return a.result.distance - b.result.distance || a.index - b.index
}

function insertTopResult(results: RankedSimilarityResult[], candidate: RankedSimilarityResult, limit: number) {
  let low = 0
  let high = results.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (compareRankedResult(results[middle], candidate) <= 0)
      low = middle + 1
    else
      high = middle
  }
  results.splice(low, 0, candidate)
  if (results.length > limit)
    results.pop()
}

export function minHashDistance(sourceHashes: string[], candidateHashes: string[]) {
  let bestDistance = Number.POSITIVE_INFINITY
  for (const sourceHash of sourceHashes) {
    for (const candidateHash of candidateHashes) {
      const distance = hammingDistance(sourceHash, candidateHash)
      if (distance < bestDistance)
        bestDistance = distance
    }
  }
  return bestDistance
}

export function minHistogramDistance(sourceHistograms: number[][], candidateHistograms: number[][]) {
  let bestDistance = Number.POSITIVE_INFINITY
  for (const sourceHistogram of sourceHistograms) {
    for (const candidateHistogram of candidateHistograms) {
      const distance = histogramDistance(sourceHistogram, candidateHistogram)
      if (distance < bestDistance)
        bestDistance = distance
    }
  }
  return bestDistance
}

export function minHybridDistance(sourceVectors: HybridVector[], candidateVectors: HybridVector[]) {
  let bestDistance = Number.POSITIVE_INFINITY
  for (const sourceVector of sourceVectors) {
    for (const candidateVector of candidateVectors) {
      const hashDistance = hammingDistance(sourceVector.hash, candidateVector.hash)
      const histogramDistanceValue = histogramDistance(sourceVector.histogram, candidateVector.histogram)
      const combined = Math.round(hashDistance * 0.55 + histogramDistanceValue * 0.45)
      if (combined < bestDistance)
        bestDistance = combined
    }
  }
  return bestDistance
}

export class Similarity {
  public static limit: {
    from: string[]
  } = {
    from: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'tiff', 'tif', 'avif', 'heif', 'heic', 'bmp', 'ico', 'npy'],
  }

  static async findSimilar(image: ImageType, scope: ImageType[], options: SimilarityOptions = {}): Promise<SimilarityFindResult> {
    const startedAt = performance.now()
    let sourceVectors: SimilarityVector[]

    const source = image.path
    const algorithm = options.algorithm || 'hybrid'
    const threshold = normalizeSimilarityThreshold(algorithm, options.threshold)
      ?? getSimilarityDefaultThreshold(algorithm, Config.similarity_precision)
    const maxResults = normalizeSimilarityMaxResults(options.maxResults)
    const requestId = options.requestId || ''
    const progress: SimilarityProgress = {
      completed: 0,
      requestId,
      scanned: 0,
      skipped: 0,
      total: scope.length,
      totalMatches: 0,
    }
    const ext = this.getFileExt(source)
    Channel.debug(
      `[similarity] start source=${source} algorithm=${algorithm} threshold=${threshold} `
      + `maxResults=${maxResults} scope=${scope.length} sliceStrategy=${options.sliceStrategy || 'first'}`,
    )
    if (!this.isSupported(source, ext)) {
      Channel.debug(`[similarity] source unsupported source=${source} ext=${ext}`)
      return Promise.reject(new Error('format not supported'))
    }

    try {
      throwIfAborted(options.signal)
      sourceVectors = await this.vectorizeImage(image, algorithm, options.sliceStrategy || 'first', options.signal)
      throwIfAborted(options.signal)
    }
    catch (e) {
      return Promise.reject(e)
    }

    const topResults: RankedSimilarityResult[] = []
    options.onProgress?.({ ...progress })
    const scan = async (candidateImage: ImageType, index: number) => {
      try {
        throwIfAborted(options.signal)
        if (candidateImage.path === source)
          return
        if (!this.isSupported(candidateImage.path, candidateImage.extname)) {
          progress.skipped++
          return
        }
        const vectors = await this.vectorizeImage(candidateImage, algorithm, options.sliceStrategy || 'first', options.signal)
        throwIfAborted(options.signal)
        progress.scanned++
        const distance = this.measureDistance(algorithm, sourceVectors, vectors)
        if (distance <= threshold) {
          progress.totalMatches++
          insertTopResult(topResults, {
            index,
            result: {
              algorithm,
              distance,
              image: candidateImage,
            },
          }, maxResults)
        }
      }
      catch (e) {
        if (options.signal?.aborted || (e instanceof Error && e.name === 'AbortError'))
          throw e
        progress.skipped++
        logger.error(e)
        Channel.debug(`[similarity] skipped ${candidateImage.path}: ${e instanceof Error ? e.message : String(e)}`)
      }
      finally {
        progress.completed++
        if (!options.signal?.aborted)
          options.onProgress?.({ ...progress })
      }
    }
    // Keep only the top-K output; cached scans periodically yield so cancel messages can run.
    let nextIndex = 0
    await Promise.all(Array.from({ length: algorithm === 'hybrid' ? 2 : 4 }, async () => {
      while (nextIndex < scope.length) {
        throwIfAborted(options.signal)
        const index = nextIndex++
        if (index % 64 === 0)
          await yieldToEvents()
        throwIfAborted(options.signal)
        await scan(scope[index], index)
      }
    }))
    throwIfAborted(options.signal)

    const response = {
      algorithm,
      maxResults,
      query: image,
      requestId,
      results: topResults.map(item => item.result),
      scanned: progress.scanned,
      skipped: progress.skipped,
      threshold,
      totalMatches: progress.totalMatches,
    }
    Channel.debug(
      `[similarity] done source=${source} algorithm=${algorithm} threshold=${threshold} `
      + `scanned=${response.scanned} skipped=${response.skipped} results=${response.results.length}/${response.totalMatches} `
      + `cost=${(performance.now() - startedAt).toFixed(0)}ms`,
    )
    return response
  }

  static clearCache() {
    featureCache.clear()
    Channel.debug('[similarity] hash cache cleared')
  }

  static configureCache(limits: { maxBytes?: number, maxEntries?: number }) {
    featureCache.setLimits(limits)
  }

  static getCacheStats() {
    return featureCache.stats()
  }

  private static isSupported(filePath: string, ext: string) {
    return this.limit.from.includes(ext.toLowerCase()) || isLikelyCustomImageFile(filePath, Config.file_customFormats)
  }

  private static measureDistance(algorithm: SimilarityAlgorithm, sourceVectors: SimilarityVector[], candidateVectors: SimilarityVector[]) {
    if (algorithm === 'histogram')
      return minHistogramDistance(sourceVectors as number[][], candidateVectors as number[][])
    if (algorithm === 'hybrid')
      return minHybridDistance(sourceVectors as HybridVector[], candidateVectors as HybridVector[])
    return minHashDistance(sourceVectors as string[], candidateVectors as string[])
  }

  private static async vectorizeImage(image: ImageType, algorithm: SimilarityAlgorithm, sliceStrategy: SimilaritySliceStrategy = 'first', signal?: AbortSignal): Promise<SimilarityVector[]> {
    throwIfAborted(signal)
    const stat = image.stats?.mtimeMs && image.stats?.size
      ? image.stats
      : await fsStatLite(image.path)
    if (algorithm === 'hybrid') {
      if (!isLikelyCustomImageFile(image.path, Config.file_customFormats)) {
        const hashKey = customImageCacheKey(image.path, stat, 'phash', Config.file_customFormats)
        const histogramKey = customImageCacheKey(image.path, stat, 'histogram', Config.file_customFormats)
        let hashVector = featureCache.get(hashKey)?.vector as string | undefined
        let histogramVector = featureCache.get(histogramKey)?.vector as number[] | undefined
        if (!hashVector || !histogramVector) {
          const source = stat.size > 0 && stat.size <= 12 * 1024 * 1024
            ? await fs.readFile(image.path)
            : image.path
          if (!hashVector) {
            hashVector = await phash(source)
            featureCache.set(hashKey, { vector: hashVector })
          }
          if (!histogramVector) {
            throwIfAborted(signal)
            histogramVector = await histogram(source)
            featureCache.set(histogramKey, { vector: histogramVector })
          }
        }
        return [{
          hash: hashVector,
          histogram: histogramVector,
        }]
      }
      const hashVectors = await this.vectorizeImage(image, 'phash', sliceStrategy, signal) as string[]
      const histogramVectors = await this.vectorizeImage(image, 'histogram', sliceStrategy, signal) as number[][]
      return hashVectors.map((hashVector, index) => ({
        hash: hashVector,
        histogram: histogramVectors[index] || histogramVectors[0],
      }))
    }
    if (!isLikelyCustomImageFile(image.path, Config.file_customFormats)) {
      const cacheKey = customImageCacheKey(image.path, stat, algorithm, Config.file_customFormats)
      if (algorithm === 'histogram') {
        const cachedHistogram = featureCache.get(cacheKey)?.vector as number[] | undefined
        if (cachedHistogram) {
          Channel.debug(`[similarity] histogram cache hit path=${image.path} algorithm=${algorithm}`)
          return [cachedHistogram]
        }
        const histogramVector = await histogram(image.path)
        featureCache.set(cacheKey, { vector: histogramVector })
        return [histogramVector]
      }
      const cached = featureCache.get(cacheKey)?.vector as string | undefined
      if (cached) {
        Channel.debug(`[similarity] hash cache hit path=${image.path} algorithm=${algorithm}`)
        return [cached]
      }

      const hash = algorithm === 'phash'
        ? await phash(image.path)
        : algorithm === 'ahash'
          ? await ahash(image.path)
          : await dhash(image.path)
      featureCache.set(cacheKey, { vector: hash })
      return [hash]
    }

    const vectors: SimilarityVector[] = []
    const decodedFirst = await this.vectorizeCustomImagePage(image, algorithm, stat, 0)
    vectors.push(decodedFirst.vector)
    if (sliceStrategy === 'all' && decodedFirst.pageCount > 1) {
      for (let pageIndex = 1; pageIndex < decodedFirst.pageCount; pageIndex++) {
        throwIfAborted(signal)
        const decoded = await this.vectorizeCustomImagePage(image, algorithm, stat, pageIndex)
        vectors.push(decoded.vector)
      }
    }
    return vectors
  }

  private static async vectorizeCustomImagePage(image: ImageType, algorithm: SimilarityAlgorithm, stat: { mtimeMs: number, size: number }, pageIndex: number) {
    const cacheKey = customImageCacheKey(image.path, stat, `${algorithm}:page:${pageIndex}`, Config.file_customFormats, { pageIndex })
    if (algorithm === 'histogram') {
      const cachedEntry = featureCache.get(cacheKey)
      const cachedHistogram = cachedEntry?.vector as number[] | undefined
      if (cachedHistogram) {
        Channel.debug(`[similarity] histogram cache hit path=${image.path} algorithm=${algorithm} pageIndex=${pageIndex}`)
        return {
          vector: cachedHistogram,
          pageCount: cachedEntry?.pageCount ?? 1,
        }
      }
    }
    else {
      const cachedEntry = featureCache.get(cacheKey)
      const cached = cachedEntry?.vector as string | undefined
      if (cached) {
        Channel.debug(`[similarity] hash cache hit path=${image.path} algorithm=${algorithm} pageIndex=${pageIndex}`)
        return {
          vector: cached,
          pageCount: cachedEntry?.pageCount ?? 1,
        }
      }
    }

    Channel.debug(`[similarity] custom decode for hash path=${image.path} algorithm=${algorithm} pageIndex=${pageIndex}`)
    const decoded = await decodeCustomImage(image.path, { pageIndex }, Config.file_customFormats, Global.sharp)
    Channel.debug(
      `[similarity] custom decoded for hash path=${image.path} layout=${decoded.layout} `
      + `axes=${decoded.axes.join('')} shape=${decoded.shape.join('x')} `
      + `page=${decoded.pageIndex + 1}/${decoded.pageCount} channelMode=${decoded.channelMode}`,
    )
    if (!decoded.pixels?.length)
      throw new Error('custom image decode failed')
    const channels = ([1, 2, 3, 4].includes(decoded.channels) ? decoded.channels : 1) as 1 | 2 | 3 | 4
    const rawOptions = {
      failOn: 'none' as const,
      raw: {
        channels,
        height: decoded.height,
        width: decoded.width,
      },
    }
    const vector = algorithm === 'histogram'
      ? await histogram(decoded.pixels, rawOptions)
      : algorithm === 'phash'
        ? await phash(decoded.pixels, rawOptions)
        : algorithm === 'ahash'
          ? await ahash(decoded.pixels, rawOptions)
          : await dhash(decoded.pixels, rawOptions)
    featureCache.set(cacheKey, { pageCount: decoded.pageCount, vector })
    return {
      vector,
      pageCount: decoded.pageCount,
    }
  }

  private static getFileExt(filePath: string) {
    return path.extname(filePath).slice(1)
  }
}

async function fsStatLite(filePath: string) {
  const stat = await fs.stat(filePath)
  return {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
  }
}
