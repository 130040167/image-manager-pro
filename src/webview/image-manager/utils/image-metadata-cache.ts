import { CmdToVscode } from '~/message/cmd'
import { Compressed } from '~/meta'
import { vscodeApi } from '~/webview/vscode-api'

/**
 * Viewport metadata is size-only. Width and height stay on the details panel,
 * which calls get_image_metadata_one for a single image.
 *
 * While a directory read is active the host returns deferred and does no stat.
 * This cache holds that promise and retries on a slow backoff instead of
 * issuing a new request for every remount.
 */

export type CachedImageMeta = {
  metadata: Metadata
  compressed: Compressed
  deferred?: boolean
  stats?: Pick<ImageType['stats'], 'mtimeMs' | 'size'>
}

const metaCache = new Map<string, CachedImageMeta>()
const inflight = new Map<string, Promise<CachedImageMeta>>()
const failedUntil = new Map<string, number>()
const ENABLE_VIEWPORT_IMAGE_METADATA = true

export function getCachedImageMeta(filePath: string): CachedImageMeta | undefined {
  return metaCache.get(filePath)
}

const BATCH_WINDOW_MS = 30
const BATCH_MAX_SIZE = 12
const META_REQUEST_TIMEOUT_MS = 8_000
const META_EMPTY_RETRY_BACKOFF_MS = 10_000
const DEFERRED_RETRY_MS = [4_000, 8_000, 16_000, 16_000]
type BatchEntry = {
  attempt: number
  filePath: string
  resolve: (v: CachedImageMeta) => void
}
const batchQueue: BatchEntry[] = []
const deferredTimers = new Set<ReturnType<typeof setTimeout>>()
let batchTimer: ReturnType<typeof setTimeout> | null = null

function emptyMeta(): CachedImageMeta {
  return {
    compressed: Compressed.unknown,
    metadata: {} as Metadata,
  }
}

function hasDimensions(metadata: Metadata | undefined) {
  return !!(metadata?.width || metadata?.height || metadata?.shape?.length)
}

function scheduleFlush() {
  if (batchQueue.length >= BATCH_MAX_SIZE) {
    if (batchTimer) {
      clearTimeout(batchTimer)
      batchTimer = null
    }
    flushBatch()
    return
  }
  if (!batchTimer)
    batchTimer = setTimeout(flushBatch, BATCH_WINDOW_MS)
}

function flushBatch() {
  batchTimer = null
  if (!batchQueue.length)
    return

  const currentQueue = batchQueue.splice(0, BATCH_MAX_SIZE)
  if (batchQueue.length)
    scheduleFlush()

  const seen = new Set<string>()
  const entries: BatchEntry[] = []
  for (const entry of currentQueue) {
    if (seen.has(entry.filePath))
      continue
    seen.add(entry.filePath)
    entries.push(entry)
  }
  const allByPath = new Map<string, BatchEntry[]>()
  for (const entry of currentQueue) {
    const list = allByPath.get(entry.filePath) ?? []
    list.push(entry)
    allByPath.set(entry.filePath, list)
  }

  vscodeApi.postMessageWithTimeout(
    {
      cmd: CmdToVscode.get_images_metadata,
      data: { images: entries.map(entry => entry.filePath) },
    },
    META_REQUEST_TIMEOUT_MS,
    (data) => {
      const byPath = new Map<string, CachedImageMeta>()
      if (Array.isArray(data)) {
        for (const item of data as Array<{
          compressed?: Compressed
          deferred?: boolean
          filePath?: string
          metadata?: Metadata
          stats?: Pick<ImageType['stats'], 'mtimeMs' | 'size'>
        }>) {
          if (!item || typeof item.filePath !== 'string')
            continue
          const metadata = item.metadata || {}
          byPath.set(item.filePath, {
            compressed: (item.compressed ?? Compressed.unknown) as Compressed,
            deferred: item.deferred === true,
            metadata: {
              channels: metadata.channels,
              height: metadata.height,
              shape: metadata.shape,
              width: metadata.width,
            } as Metadata,
            stats: item.stats,
          })
        }
      }
      const deferredEntries: BatchEntry[] = []
      for (const [filePath, list] of allByPath) {
        const result = byPath.get(filePath) ?? emptyMeta()
        const statKnown = !!result.stats && Number.isFinite(result.stats.size)
        if (!result.deferred && (statKnown || hasDimensions(result.metadata))) {
          metaCache.set(filePath, result)
          failedUntil.delete(filePath)
          for (const entry of list)
            entry.resolve(result)
          continue
        }
        if (result.deferred) {
          const attempt = Math.max(...list.map(entry => entry.attempt))
          if (attempt >= DEFERRED_RETRY_MS.length) {
            failedUntil.set(filePath, Date.now() + META_EMPTY_RETRY_BACKOFF_MS)
            for (const entry of list)
              entry.resolve(emptyMeta())
          }
          else {
            deferredEntries.push(...list)
          }
          continue
        }
        failedUntil.set(filePath, Date.now() + META_EMPTY_RETRY_BACKOFF_MS)
        for (const entry of list)
          entry.resolve(result)
      }
      if (deferredEntries.length) {
        const delay = DEFERRED_RETRY_MS[Math.min(...deferredEntries.map(entry => entry.attempt))] || DEFERRED_RETRY_MS[0]
        const timer = setTimeout(() => {
          deferredTimers.delete(timer)
          for (const entry of deferredEntries)
            batchQueue.push({ ...entry, attempt: entry.attempt + 1 })
          scheduleFlush()
        }, delay)
        deferredTimers.add(timer)
      }
    },
    [],
  )
}

export function fetchImageMetadata(filePath: string): Promise<CachedImageMeta> {
  if (!ENABLE_VIEWPORT_IMAGE_METADATA)
    return Promise.resolve(emptyMeta())
  const cached = metaCache.get(filePath)
  if (cached)
    return Promise.resolve(cached)
  const failedBefore = failedUntil.get(filePath)
  if (failedBefore && failedBefore > Date.now())
    return Promise.resolve(emptyMeta())
  const existing = inflight.get(filePath)
  if (existing)
    return existing
  const promise = new Promise<CachedImageMeta>((resolve) => {
    batchQueue.push({ attempt: 0, filePath, resolve })
    scheduleFlush()
  }).finally(() => {
    inflight.delete(filePath)
  })
  inflight.set(filePath, promise)
  return promise
}

export function fetchImageMetadataDetails(filePath: string): Promise<CachedImageMeta> {
  const cached = metaCache.get(filePath)
  if (hasDimensions(cached?.metadata))
    return Promise.resolve(cached as CachedImageMeta)
  return new Promise((resolve) => {
    vscodeApi.postMessageWithTimeout(
      {
        cmd: CmdToVscode.get_image_metadata_one,
        data: { filePath },
      },
      META_REQUEST_TIMEOUT_MS,
      (data) => {
        const item = (data || {}) as {
          compressed?: Compressed
          metadata?: Metadata
          stats?: Pick<ImageType['stats'], 'mtimeMs' | 'size'>
        }
        const metadata = item.metadata || {}
        const result: CachedImageMeta = {
          compressed: (item.compressed ?? cached?.compressed ?? Compressed.unknown) as Compressed,
          metadata: {
            channels: metadata.channels ?? cached?.metadata.channels,
            height: metadata.height ?? cached?.metadata.height,
            shape: metadata.shape ?? cached?.metadata.shape,
            width: metadata.width ?? cached?.metadata.width,
          } as Metadata,
          stats: item.stats || cached?.stats,
        }
        if (hasDimensions(result.metadata) || result.stats)
          metaCache.set(filePath, result)
        resolve(result)
      },
      undefined,
    )
  })
}

export function invalidateImageMeta(filePath: string) {
  metaCache.delete(filePath)
  inflight.delete(filePath)
  failedUntil.delete(filePath)
}

export function clearImageMetaCache() {
  metaCache.clear()
  inflight.clear()
  failedUntil.clear()
  for (const timer of deferredTimers)
    clearTimeout(timer)
  deferredTimers.clear()
  batchQueue.splice(0, batchQueue.length)
  if (batchTimer) {
    clearTimeout(batchTimer)
    batchTimer = null
  }
}
