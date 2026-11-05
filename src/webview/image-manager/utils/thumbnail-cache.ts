import { CmdToVscode } from '~/message/cmd'
import { vscodeApi } from '~/webview/vscode-api'
import {
  adaptThumbnailBatchSizeAfterBatch,
  clampThumbnailBatchSize,
  seedThumbnailBatchSizeAfterDirectoryLoad,
  THUMBNAIL_BATCH_BASELINE_SIZE,
  THUMBNAIL_BATCH_MAX_SIZE,
  THUMBNAIL_BATCH_MIN_SIZE,
} from './thumbnail-batch-strategy'

/**
 * 缩略图缓存（webview 侧）。
 *
 * 当 VisibleImage 进入视口时，如果图片尺寸大于阈值，先请求一个小尺寸 WebP 缩略图作为 src，
 * 加载完成后再切换到原图。这样大图（几 MB 的 RAW/PNG）在网格中只需加载几 KB 的缩略图。
 *
 * vscode 端会把 webp 缩略图持久化到磁盘缓存（mtimeMs 校验），返回 webview 可访问的 URI。
 * 同一张图反复打开扩展时无需 sharp 解码，直接走文件系统。
 *
 * 视口内图片进入一个低优先级队列。目录首次先用中等批量做基准探测，
 * 后续再按单张平均耗时逐步放大或收缩，避免 SSHFS 缩略图解码把目录展开和其他窗口拖住。
 */

const thumbCache = new Map<string, string>()
const inflight = new Map<string, Promise<string | undefined>>()
const failedUntil = new Map<string, number>()
const ENABLE_VIEWPORT_THUMBNAILS = true
const PREVIEW_FOCUS_QUIET_MS = 700
let previewFocusQuietUntil = 0

export function getCachedThumbnail(filePath: string): string | undefined {
  return thumbCache.get(filePath)
}

const BATCH_WINDOW_MS = 24
const BATCH_MAX_SIZE = THUMBNAIL_BATCH_MAX_SIZE
const BATCH_MIN_SIZE = THUMBNAIL_BATCH_MIN_SIZE
const MAX_INFLIGHT_BATCHES = 2
const THUMB_MAX_WIDTH = 200
const THUMB_REQUEST_TIMEOUT_MS = 22_000
const THUMB_RETRY_BACKOFF_MS = 1_500
const THUMB_FAILED_BACKOFF_MS = 12_000

type BatchEntry = {
  filePath: string
  resolve: (v: string | undefined) => void
}
let batchQueue: BatchEntry[] = []
let batchTimer: ReturnType<typeof setTimeout> | null = null
let activeBatches = 0

type DirectorySpeed = {
  batchSize: number
  samples: number
  lastDirectoryLoadMs?: number
  lastThumbnailMs?: number
  updatedAt: number
}
const directorySpeeds = new Map<string, DirectorySpeed>()

function normalizePath(filePath: string) {
  return filePath.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '')
}

function dirnameOf(filePath: string) {
  const normalized = normalizePath(filePath)
  const index = normalized.lastIndexOf('/')
  return index === -1 ? normalized : normalized.slice(0, index)
}

function getDirectorySpeed(dirPath: string): DirectorySpeed {
  const key = normalizePath(dirPath).toLowerCase()
  let state = directorySpeeds.get(key)
  if (!state) {
    state = {
      batchSize: THUMBNAIL_BATCH_BASELINE_SIZE,
      samples: 0,
      updatedAt: Date.now(),
    }
    directorySpeeds.set(key, state)
  }
  return state
}

function computeBatchSize(paths: string[]) {
  if (!paths.length) {
    return BATCH_MIN_SIZE
  }
  let limit = BATCH_MAX_SIZE
  for (const filePath of paths) {
    const state = getDirectorySpeed(dirnameOf(filePath))
    limit = Math.min(limit, state.batchSize)
  }
  return clampThumbnailBatchSize(limit)
}

function adaptAfterThumbnailBatch(paths: string[], elapsedMs: number, returnedPaths: Set<string>) {
  const dirCounts = new Map<string, { requested: number, returned: number }>()
  for (const filePath of paths) {
    const dirPath = dirnameOf(filePath)
    const current = dirCounts.get(dirPath) || { requested: 0, returned: 0 }
    current.requested++
    if (returnedPaths.has(filePath)) {
      current.returned++
    }
    dirCounts.set(dirPath, current)
  }

  for (const [dirPath, counts] of dirCounts) {
    const state = getDirectorySpeed(dirPath)
    const decision = adaptThumbnailBatchSizeAfterBatch(state, {
      elapsedMs,
      requested: counts.requested,
      returned: counts.returned,
    })

    state.batchSize = decision.nextBatchSize
    state.lastThumbnailMs = elapsedMs
    state.samples++
    state.updatedAt = Date.now()

    vscodeApi.log('debug', 'thumbnail batch directory adapted', {
      batchSize: state.batchSize,
      dirPath,
      elapsedMs,
      perImageMs: Math.round(decision.perImageMs),
      reason: decision.reason,
      requested: counts.requested,
      returned: counts.returned,
      samples: state.samples,
      successRatio: Number(decision.successRatio.toFixed(2)),
    })
  }
}

function flushBatch() {
  batchTimer = null
  if (!batchQueue.length) {
    return
  }
  if (Date.now() < previewFocusQuietUntil) {
    const delay = Math.max(16, previewFocusQuietUntil - Date.now())
    vscodeApi.log('debug', 'thumbnail batch delayed for preview focus', {
      delay,
      queued: batchQueue.length,
    })
    batchTimer = setTimeout(flushBatch, delay)
    return
  }
  if (activeBatches >= MAX_INFLIGHT_BATCHES) {
    vscodeApi.log('debug', 'thumbnail batch waiting for free slot', {
      activeBatches,
      maxInflightBatches: MAX_INFLIGHT_BATCHES,
      queued: batchQueue.length,
    })
    return
  }

  const allByPath = new Map<string, BatchEntry[]>()
  const uniquePaths: string[] = []
  const queued = batchQueue.splice(0, batchQueue.length)
  for (const e of queued) {
    if (!allByPath.has(e.filePath)) {
      uniquePaths.push(e.filePath)
      allByPath.set(e.filePath, [])
    }
    allByPath.get(e.filePath)!.push(e)
  }
  const limit = computeBatchSize(uniquePaths)
  const selectedPaths = uniquePaths.slice(0, limit)
  const selected = new Set(selectedPaths)
  const deferred: BatchEntry[] = []
  for (const filePath of uniquePaths.slice(limit)) {
    const entries = allByPath.get(filePath) || []
    deferred.push(...entries)
    allByPath.delete(filePath)
  }
  if (deferred.length) {
    batchQueue.unshift(...deferred)
  }

  activeBatches++
  const startedAt = performance.now()
  vscodeApi.log('debug', 'thumbnail batch flush', {
    activeBatches,
    limit,
    remaining: batchQueue.length,
    selected: selectedPaths.length,
    queued: queued.length,
    unique: uniquePaths.length,
  })

  vscodeApi.postMessageWithTimeout(
    {
      cmd: CmdToVscode.get_thumbnails,
      data: { images: selectedPaths, maxWidth: THUMB_MAX_WIDTH },
    },
    THUMB_REQUEST_TIMEOUT_MS,
    (data) => {
      activeBatches = Math.max(0, activeBatches - 1)
      const elapsedMs = Math.round(performance.now() - startedAt)
      const byPath = new Map<string, string>()
      if (Array.isArray(data)) {
        for (const item of data) {
          const url = (item as any)?.thumbPath || (item as any)?.dataUrl
          if (item?.filePath && url) {
            byPath.set(item.filePath, url)
            thumbCache.set(item.filePath, url)
            failedUntil.delete(item.filePath)
          }
        }
      }
      const missingPaths = selectedPaths.filter(filePath => !byPath.has(filePath))
      const responseKind = Array.isArray(data)
        ? data.length === 0
          ? 'empty'
          : missingPaths.length
            ? 'partial'
            : 'complete'
        : 'timeout-or-invalid'
      adaptAfterThumbnailBatch(selectedPaths, elapsedMs, new Set(byPath.keys()))
      vscodeApi.log('debug', 'thumbnail batch result', {
        activeBatches,
        batchSizeByDir: selectedPaths.map(filePath => ({
          batchSize: getDirectorySpeed(dirnameOf(filePath)).batchSize,
          dirPath: dirnameOf(filePath),
        })).slice(0, 3),
        elapsedMs,
        missing: missingPaths.length,
        missingPaths: missingPaths.slice(0, 6),
        remaining: batchQueue.length,
        requested: selectedPaths.length,
        responseKind,
        returned: byPath.size,
        timeoutMs: THUMB_REQUEST_TIMEOUT_MS,
      })
      for (const [filePath, entries] of allByPath) {
        if (!selected.has(filePath)) {
          continue
        }
        const result = byPath.get(filePath)
        if (!result) {
          const backoff = Array.isArray(data) && data.length === 0 ? THUMB_RETRY_BACKOFF_MS : THUMB_FAILED_BACKOFF_MS
          failedUntil.set(filePath, Date.now() + backoff)
          vscodeApi.log('warn', 'thumbnail request missing item', {
            backoff,
            filePath,
            requested: selectedPaths.length,
            responseKind,
            returned: byPath.size,
            returnedBatchSize: Array.isArray(data) ? data.length : -1,
            timeoutMs: THUMB_REQUEST_TIMEOUT_MS,
          })
        }
        for (const e of entries) {
          e.resolve(result)
        }
      }
      if (batchQueue.length) {
        scheduleFlush()
      }
    },
    [],
  )
  if (batchQueue.length && activeBatches < MAX_INFLIGHT_BATCHES) {
    scheduleFlush()
  }
}

function scheduleFlush() {
  if (Date.now() < previewFocusQuietUntil) {
    if (!batchTimer) {
      const delay = Math.max(16, previewFocusQuietUntil - Date.now())
      batchTimer = setTimeout(flushBatch, delay)
    }
    return
  }
  if (batchQueue.length >= BATCH_MAX_SIZE) {
    if (batchTimer) {
      clearTimeout(batchTimer)
      batchTimer = null
    }
    flushBatch()
    return
  }
  if (!batchTimer) {
    batchTimer = setTimeout(flushBatch, BATCH_WINDOW_MS)
  }
}

export function recordThumbnailDirectoryLoad(dirPath: string, elapsedMs: number, ok = true) {
  if (!dirPath) {
    return
  }
  const state = getDirectorySpeed(dirPath)
  state.lastDirectoryLoadMs = elapsedMs
  state.updatedAt = Date.now()
  const decision = seedThumbnailBatchSizeAfterDirectoryLoad(state.batchSize, elapsedMs, ok)
  state.batchSize = decision.nextBatchSize
  state.samples = 0
  vscodeApi.log('debug', 'thumbnail directory speed updated', {
    batchSize: state.batchSize,
    dirPath,
    elapsedMs,
    ok,
    reason: decision.reason,
  })
}

export function fetchThumbnail(filePath: string): Promise<string | undefined> {
  if (!ENABLE_VIEWPORT_THUMBNAILS) {
    return Promise.resolve(undefined)
  }
  if (!filePath) {
    return Promise.resolve(undefined)
  }

  const cached = thumbCache.get(filePath)
  if (cached) {
    return Promise.resolve(cached)
  }

  const failedBefore = failedUntil.get(filePath)
  if (failedBefore && failedBefore > Date.now()) {
    vscodeApi.log('debug', 'thumbnail request skipped during backoff', {
      filePath,
      remainingMs: failedBefore - Date.now(),
    })
    return Promise.resolve(undefined)
  }

  const existing = inflight.get(filePath)
  if (existing) {
    return existing
  }

  const promise = new Promise<string | undefined>((resolve) => {
    batchQueue.push({ filePath, resolve })
    vscodeApi.log('debug', 'thumbnail request queued', {
      activeBatches,
      filePath,
      queued: batchQueue.length,
    })
    scheduleFlush()
  }).finally(() => {
    inflight.delete(filePath)
  })
  inflight.set(filePath, promise)
  return promise
}

export function invalidateThumbnail(filePath: string) {
  thumbCache.delete(filePath)
  inflight.delete(filePath)
  failedUntil.delete(filePath)
}

export function pauseThumbnailsForPreview() {
  previewFocusQuietUntil = Math.max(previewFocusQuietUntil, Date.now() + PREVIEW_FOCUS_QUIET_MS)
}

export function clearThumbnailCache() {
  thumbCache.clear()
  inflight.clear()
  failedUntil.clear()
  directorySpeeds.clear()
  batchQueue = []
  activeBatches = 0
  if (batchTimer) {
    clearTimeout(batchTimer)
    batchTimer = null
  }
}
