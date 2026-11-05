import type { GlobEntry } from 'globby'
import type { Dir, Dirent } from 'node:fs'
import type { ConfigurationTarget } from 'vscode'
import type { DirectoryIoPriority as SchedulerDirectoryIoPriority, DirectoryRequestReason as SchedulerDirectoryRequestReason } from './directory-foreground-scheduler'
import type { CancelToken, DirectoryIoPool } from './directory-io-pool'
import type { ThumbnailWorkerPool } from './thumbnail-worker-pool'
import type { SharpNS } from '~/@types/global'
import type { SimilarityOptions, SimilarityProgress } from '~/core/analysis/similarity'
import type { ConfigType } from '~/core/config/common'
import type { CompressionOptions } from '~/core/operator/compressor/type'
import type { FormatConverterOptions } from '~/core/operator/format-converter'
import type { OperatorResult } from '~/core/operator/operator'
import type { WorkspaceStateKey } from '~/core/persist/workspace/common'
import type { UpdatePayload } from '~/webview/image-manager/utils/tree/tree-manager'
import type { ImageManagerPanel } from '~/webview/panel'
import { Buffer } from 'node:buffer'
import { readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { flatten } from 'es-toolkit'
import { toString } from 'es-toolkit/compat'
import fs from 'fs-extra'
import { globby } from 'globby'
import micromatch from 'micromatch'
import mime from 'mime/lite'
import { nanoid } from 'nanoid'
import pMap from 'p-map'
import { commands, Uri, ViewColumn, window, workspace } from 'vscode'
import { Commands } from '~/commands'
import { Similarity } from '~/core/analysis/similarity'
import { SimilarityRequests } from '~/core/analysis/similarity-requests'
import { commandCache } from '~/core/commander'
import { Config } from '~/core/config/config'
import { customImageCacheKey, decodeCustomImage, encodeRawPixelsToJpeg, getCustomFormatScanExtensions, isLikelyCustomImageFile, toCustomImageProbe } from '~/core/custom-format'
import { FileCache } from '~/core/file-cache'
import { Global } from '~/core/global'
import { SvgCompressor } from '~/core/operator/compressor/svg'
import { UsualCompressor } from '~/core/operator/compressor/usual'
import { FormatConverter } from '~/core/operator/format-converter'
import { Svgo } from '~/core/operator/svgo'
import { WorkspaceState } from '~/core/persist/workspace/workspace-state'
import { SharpOperator } from '~/core/sharp/sharp-operator'
import { i18n } from '~/i18n'
import { Compressed } from '~/meta'
import { slashPath } from '~/utils'
import { AbortError, cancelablePromise } from '~/utils/abort-promise'
import logger from '~/utils/logger'
import { generateOutputPath, resolveDirPath } from '~/utils/node'
import { Channel } from '~/utils/node/channel'
import { convertPatternToGlob, imageGlob } from '~/utils/node/glob'
import {
  bufferTobase64,
  buildJpegThumbnail,
  buildPreviewJpeg,
  convertImageToBase64,
  getImageHistogram,
  isBrowserSupportImageType,
  PREVIEW_MAX_EDGE,
  toBase64,
} from '~/utils/node/image-type'
import { UpdateEvent, UpdateOrigin, UpdateType } from '~/webview/image-manager/utils/tree/const'
import { CmdToVscode, CmdToWebview } from './cmd'
import {
  createDirectoryForegroundScheduler,

} from './directory-foreground-scheduler'
import {

  createCancelToken,
  createDirectoryIoPool,

} from './directory-io-pool'
import { clearAll as clearGlobbyCache, clearByCwd as clearGlobbyCacheByCwd, withCache as withGlobbyCache } from './globby-cache'
import { getImageMetadata, getStagedImages } from './message-factory.fn'
import { createThumbnailWorkerPool } from './thumbnail-worker-pool'

type MessageFactoryType = typeof VscodeMessageFactory
type MessageMethodType<K extends KeyofMessage> = MessageFactoryType[K]

const IMAGE_SCAN_BATCH_SIZE = 300
const DIRECTORY_IMAGE_PAGE_SIZE = 128
const DIRECTORY_SNAPSHOT_CACHE_TTL = 45_000
const DIRECTORY_SNAPSHOT_CACHE_MAX = 3000
// 单次前台目录读取的上限。健康的 SSHFS readdir 只要个位数毫秒；真正卡到几秒一定是
// 连接被占满或远端挂起。从 14s 缩短到 9s，让用户更快看到失败（前端自动重试一次），
// 而不是盯着空白等十几秒。
const DIRECTORY_USER_READ_TIMEOUT = 9_000
const DIRECTORY_WARMUP_READ_TIMEOUT = 1800
const DIRECTORY_PREFETCH_CONCURRENCY = Math.max(1, Math.min(2, Math.ceil(os.cpus().length / 4)))
const DIRECTORY_WARMUP_CONCURRENCY = 1
const DIRECTORY_WARMUP_MAX_DEPTH = 0
const DIRECTORY_WARMUP_IMAGE_DEPTH = -1
const DIRECTORY_WARMUP_MAX_BATCHES = 200
const DIRECTORY_WARMUP_FLUSH_PAYLOADS = 50
const DIRECTORY_WARMUP_MAX_REQUEST_DEPTH = 1
const DIRECTORY_WARMUP_MAX_START_DIRS = 80
const DIRECTORY_PAGE_READ_TIMEOUT = 5_000
const DIRECTORY_FAST_PAGE_READ_TIMEOUT = 900
const DIRECTORY_STREAM_BUFFER_SIZE = 256
const DIRECTORY_FAST_INITIAL_IMAGE_PAGE_SIZE = DIRECTORY_IMAGE_PAGE_SIZE
const DIRECTORY_FAST_INITIAL_IMAGE_BUFFER_SIZE = 32
const DIRECTORY_SKELETON_LOOKAHEAD_LIMIT = 24
const DIRECTORY_SIBLING_LOOKAHEAD_LIMIT = 8
const DIRECTORY_SKELETON_LOOKAHEAD_TIMEOUT = 1_200
const DIRECTORY_SKELETON_LOOKAHEAD_CONCURRENCY = 1
const DIRECTORY_SINGLE_CHILD_LOOKAHEAD_MAX_DEPTH = 12
const DIRECTORY_SINGLE_CHILD_LOOKAHEAD_TIMEOUT = 6_000
const METADATA_BATCH_TIMEOUT = 7_000
// 缩略图批/单项超时。正常一张 .tif sharp 解码 ~0.5s；缩略图归一化路径已在
// normalizeTiffToThumbnailBuffer 内部加了 4s 硬超时 + float 走 .linear(255, 0) 避免
// libvips 卡死，所以这里的 deadline 只是最后兜底（worker 真卡死时 terminate 回收线程）。
// 不能再设成 18s——那只会把"某张图卡死"放大成"整列缩略图排队几十秒"（worker pool
// 只有 2 个，单项卡 18s 会让后续 n=1 请求排队 24-28s，实测一片空白）。
const THUMBNAIL_BATCH_TIMEOUT = 15_000
const THUMBNAIL_ITEM_TIMEOUT = 10_000
const THUMBNAIL_CACHE_VERSION = 'v6'
const THUMBNAIL_DIAGNOSTIC_BUILD = 'thumb-debug-20260609-0915'
const PREVIEW_DIAGNOSTIC_BUILD = 'preview-linear-20260609-0840'
const THUMBNAIL_FOREGROUND_WAIT_MS = 4_000
const THUMBNAIL_IN_BATCH_WAIT_MS = 1_200
// 显式用户动作（复制为 base64 / 直方图）经 SSHFS 时的硬超时。
// 这类请求不会被静默丢弃，但必须有上限，避免一次卡死的读把单连接占满几十秒。
const COPY_BASE64_TIMEOUT = 20_000
const PREVIEW_CACHE_VERSION = 'preview-v1'
const METADATA_STAT_TIMEOUT = 800

function previewCacheHash(value: string) {
  let hash = 5381
  for (let index = 0; index < value.length; index++)
    hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0
  return (hash >>> 0).toString(36)
}

function metadataFilePath(image: string | GlobEntry) {
  return typeof image === 'string' ? image : image.path
}

function deferredImageMetadata(image: string | GlobEntry) {
  return {
    compressed: Compressed.unknown,
    deferred: true,
    filePath: metadataFilePath(image),
    metadata: {} as Metadata,
  }
}

async function readPreviewJpegCache(
  filePath: string,
  panel: ImageManagerPanel | undefined,
  decodeOptions?: Parameters<typeof decodeCustomImage>[1],
  predecoded?: Awaited<ReturnType<typeof decodeCustomImage>>,
) {
  if (!filePath || !Global.sharp)
    return null
  const stat = await withTimeout(fs.stat(filePath), 3_000, null)
  if (!stat)
    return null
  const custom = isLikelyCustomImageFile(filePath, Config.file_customFormats)
  const identity = custom
    ? customImageCacheKey(filePath, stat, 'preview', Config.file_customFormats, decodeOptions)
    : `${filePath}|${PREVIEW_MAX_EDGE}`
  const cacheName = `${path.basename(filePath, path.extname(filePath))}.${previewCacheHash(identity)}.${Math.round(stat.mtimeMs)}.${PREVIEW_CACHE_VERSION}.jpg`
  const cachePath = path.join(FileCache.cacheDir, 'previews', cacheName)
  await fs.ensureDir(path.dirname(cachePath))
  let cacheStat = await fs.stat(cachePath).catch(() => null)
  if (!cacheStat) {
    const decoded = custom
      ? (predecoded || await decodeCustomImage(filePath, decodeOptions || { pageIndex: 0 }, Config.file_customFormats, Global.sharp))
      : null
    const jpeg = decoded
      ? await encodeRawPixelsToJpeg(decoded, Global.sharp, PREVIEW_MAX_EDGE, 'inside', 75)
      : await buildPreviewJpeg(filePath, Global.sharp, PREVIEW_MAX_EDGE)
    if (!jpeg?.length)
      return null
    await fs.writeFile(cachePath, jpeg)
    cacheStat = await fs.stat(cachePath).catch(() => null)
  }
  if (!cacheStat)
    return null
  const uri = panel && !panel.isDisposed
    ? panel.panel.webview.asWebviewUri(Uri.file(slashPath(cachePath))).toString()
    : ''
  return { cachePath, uri }
}

async function previewSourceForWebview(
  filePath: string,
  panel: ImageManagerPanel | undefined,
  delivery: 'data-url' | 'uri',
  decodeOptions?: Parameters<typeof decodeCustomImage>[1],
  predecoded?: Awaited<ReturnType<typeof decodeCustomImage>>,
) {
  const cached = await readPreviewJpegCache(filePath, panel, decodeOptions, predecoded)
  if (!cached)
    return ''
  if (delivery === 'uri')
    return cached.uri
  return toBase64('image/jpeg', await fs.readFile(cached.cachePath))
}

const HISTOGRAM_TIMEOUT = 15_000
const FILE_RENAME_TIMEOUT = 15_000
const FILE_DELETE_TIMEOUT = 20_000
const FILE_COPY_MOVE_TIMEOUT = 30_000
const FILE_STAT_AFTER_OPERATION_TIMEOUT = 2_000
const FILE_SIBLING_RESOURCE_TIMEOUT = 4_000
const BACKGROUND_IO_GRACE_MS = 2_500
const FOREGROUND_IO_IDLE_GRACE_MS = 700
const DIRECTORY_FOREGROUND_READ_CONCURRENCY = 1
const DIRECTORY_EXPAND_DISABLE_FAST_PAGE = false
// Foreground expansion should behave like a file manager: resolve the current
// directory's entries as a complete skeleton. Fast-page is kept for image pages
// and background work only; using a 900ms fast-page for foreground expansion can
// turn a merely slow SSHFS directory into an empty "childrenLoaded=false" shell.
const DIRECTORY_EXPAND_DISABLE_SNAPSHOT_COMPLETION = true
const DIRECTORY_EXPAND_DISABLE_WARMUP = false
const DIRECTORY_EXPAND_DISABLE_THUMBNAILS = false
const DIRECTORY_EXPAND_DISABLE_METADATA = false
const DIRECTORY_IO_WORKER_POOL_SIZE = 4
const DIRECTORY_IO_USE_WORKERS = true
const THUMBNAIL_WORKER_POOL_SIZE = 2
const THUMBNAIL_USE_WORKERS = true
let backgroundIoAbortController = new AbortController()
let backgroundIoGeneration = 0

let directoryIoPool: DirectoryIoPool | null = null
let directoryIoPoolGeneration = 0
function getDirectoryIoPool(): DirectoryIoPool | null {
  if (!DIRECTORY_IO_USE_WORKERS)
    return null
  if (directoryIoPool)
    return directoryIoPool
  try {
    const ctx = Global.context
    // 生产构建：dist/directory-io-worker.js；开发模式 (extensionUri = src 根)：tsup watch 也输出到 dist/
    const candidatePaths = [
      path.join(ctx.extensionUri.fsPath, 'dist', 'directory-io-worker.js'),
      path.join(ctx.extensionUri.fsPath, 'directory-io-worker.js'),
    ]
    let workerScript: string | null = null
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        workerScript = p
        break
      }
    }
    if (!workerScript) {
      Channel.warn(`directory-io worker script not found in: ${candidatePaths.join(', ')} — falling back to main-thread reads`)
      return null
    }
    directoryIoPoolGeneration++
    const generation = directoryIoPoolGeneration
    Channel.debug(`directory-io worker script: ${workerScript} (generation=${generation})`)
    directoryIoPool = createDirectoryIoPool({
      workerScript,
      poolSize: DIRECTORY_IO_WORKER_POOL_SIZE,
      log: msg => Channel.debug(`[dir-pool:${generation}] ${msg}`),
    })
    return directoryIoPool
  }
  catch (err) {
    Channel.warn(`directory-io worker pool init failed: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

const directoryIoCancelTokens = new Map<string, ReturnType<typeof createCancelToken>>()
const activeSimilarityRequests = new SimilarityRequests()

function similarityPanelKey(imageManagerPanel?: ImageManagerPanel) {
  return imageManagerPanel?.id || '__default__'
}

function cancelSimilarityRequest(panelKey: string, requestId?: string) {
  return activeSimilarityRequests.cancel(panelKey, requestId)
}

function createSimilarityProgressPublisher(imageManagerPanel: ImageManagerPanel | undefined) {
  let lastCompleted = -1
  let lastPublishedAt = 0
  return (progress: SimilarityProgress) => {
    if (!imageManagerPanel)
      return
    const now = performance.now()
    const isBoundary = progress.completed === 0 || progress.completed === progress.total
    if (!isBoundary && progress.completed - lastCompleted < 50 && now - lastPublishedAt < 100)
      return
    lastCompleted = progress.completed
    lastPublishedAt = now
    imageManagerPanel.messageCenter.postMessage({
      cmd: CmdToWebview.similarity_progress,
      data: progress,
    })
  }
}

let thumbnailWorkerPool: ThumbnailWorkerPool | null = null
let thumbnailWorkerPoolGeneration = 0

function getBundledSharpPath(): string | null {
  const candidatePaths = [
    path.join(FileCache.cacheDir, 'lib', 'sharp', 'index.js'),
    path.join(Global.context.extensionUri.fsPath, 'dist', 'lib', 'sharp', 'index.js'),
  ]
  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  Channel.warn(`sharp worker entry not found in: ${candidatePaths.join(', ')}`)
  return null
}

function getThumbnailWorkerPool(): ThumbnailWorkerPool | null {
  if (!THUMBNAIL_USE_WORKERS) {
    return null
  }
  if (thumbnailWorkerPool) {
    return thumbnailWorkerPool
  }
  try {
    const ctx = Global.context
    const candidatePaths = [
      path.join(ctx.extensionUri.fsPath, 'dist', 'thumbnail-worker.js'),
      path.join(ctx.extensionUri.fsPath, 'thumbnail-worker.js'),
    ]
    let workerScript: string | null = null
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        workerScript = p
        break
      }
    }
    if (!workerScript) {
      Channel.warn(`thumbnail worker script not found in: ${candidatePaths.join(', ')} — falling back to main-thread thumbnails`)
      return null
    }
    thumbnailWorkerPoolGeneration++
    const generation = thumbnailWorkerPoolGeneration
    Channel.debug(
      `thumbnail worker script: ${workerScript} (generation=${generation}, build=${THUMBNAIL_DIAGNOSTIC_BUILD}, `
      + `poolSize=${THUMBNAIL_WORKER_POOL_SIZE})`,
    )
    thumbnailWorkerPool = createThumbnailWorkerPool({
      log: msg => Channel.debug(`[thumb-pool:${generation}] ${msg}`),
      poolSize: THUMBNAIL_WORKER_POOL_SIZE,
      workerScript,
    })
    return thumbnailWorkerPool
  }
  catch (err) {
    Channel.warn(`thumbnail worker pool init failed: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

function disposeThumbnailWorkerPool(reason = 'dispose') {
  if (!thumbnailWorkerPool) {
    return
  }
  const stats = thumbnailWorkerPool.stats()
  Channel.debug(`Disposing thumbnail worker pool: ${reason} stats=${JSON.stringify(stats)}`)
  thumbnailWorkerPool.dispose()
  thumbnailWorkerPool = null
}

function cancelThumbnailWork(reason: string) {
  const cancelled = thumbnailWorkerPool?.cancelAll(reason) || 0
  if (cancelled > 0) {
    Channel.debug(`Thumbnail work cancelled: ${reason} n=${cancelled}`)
  }
  return cancelled
}

function makeDirectoryReadCancelKey(panelId: string | undefined, dirPath: string) {
  return `${panelId || ''}::${dirPath}`
}

/**
 * 在用户点击新目录时，可以调用这个函数取消同 panel 中尚未完成的所有 worker IO，
 * 等价于"我已经不再关心这些目录的结果了"。
 */
function cancelDirectoryIoForPanel(panelId: string, reasonStr: string) {
  for (const [key, holder] of directoryIoCancelTokens) {
    if (key.startsWith(`${panelId}::`)) {
      holder.cancel(reasonStr)
      directoryIoCancelTokens.delete(key)
    }
  }
}

function cancelAllDirectoryIoTokens(reasonStr: string) {
  for (const [key, holder] of directoryIoCancelTokens) {
    holder.cancel(reasonStr)
    directoryIoCancelTokens.delete(key)
  }
}

type DirectoryRequestReason = SchedulerDirectoryRequestReason
type DirectoryIoPriority = SchedulerDirectoryIoPriority

const foregroundDirectoryScheduler = createDirectoryForegroundScheduler({
  concurrency: DIRECTORY_FOREGROUND_READ_CONCURRENCY,
  waitForSharpQuiet: maxMs => waitForSharpQuiet(maxMs),
  log: msg => Channel.debug(msg),
})

function clearForegroundDirectoryIoQueueForPanel(panelId: string) {
  return foregroundDirectoryScheduler.clearForPanel(panelId)
}

function clearAllForegroundDirectoryIoQueue() {
  return foregroundDirectoryScheduler.clearAll()
}

export function abortDirectoryWorkForPanel(panelId: string, reason = 'panel-disposed') {
  const queuedForeground = clearForegroundDirectoryIoQueueForPanel(panelId)
  directoryIoPool?.cancelNonClickTasks(`panel-abort:${reason}:${panelId}`)
  cancelThumbnailWork(`panel-abort:${reason}:${panelId}`)
  resetForegroundDirectoryNavigation()
  let abortedCancelable = 0
  cancelablePromise.abortPromiseMap.forEach((controller, key) => {
    if (key.startsWith(panelId)) {
      controller.abort()
      abortedCancelable++
    }
  })
  cancelDirectoryIoForPanel(panelId, `${reason}:${panelId}`)
  cancelSimilarityRequest(panelId)
  requestBackgroundIoAbort(`${reason}:${panelId}`)
  clearDirectoryChildrenRequestsForPanel(panelId)
  const hasOtherPanels = Global.imageManagerPanels.some(panel => panel.id !== panelId && !panel.isDisposed)
  if (!hasOtherPanels) {
    Channel.debug(`No remaining image manager panels; disposing directory IO pool (${reason}:${panelId})`)
    disposeDirectoryIoPool(`last-panel:${reason}:${panelId}`)
    disposeThumbnailWorkerPool(`last-panel:${reason}:${panelId}`)
  }
  return {
    abortedCancelable,
    queuedForeground,
  }
}

/**
 * 在扩展 deactivate 时调用，关闭所有 worker。
 */
export function disposeDirectoryIoPool(reason = 'dispose') {
  cancelAllDirectoryIoTokens(`pool-disposed:${reason}`)
  if (directoryIoPool) {
    const stats = directoryIoPool.stats()
    Channel.debug(`Disposing directory IO pool: ${reason} stats=${JSON.stringify(stats)}`)
    directoryIoPool.dispose()
    directoryIoPool = null
  }
}

export function resetDirectoryIoRuntime(reason: string) {
  const queuedForeground = clearAllForegroundDirectoryIoQueue()
  resetNonEssentialIo(reason)
  disposeDirectoryIoPool(reason)
  clearDirectorySnapshotCaches()
  clearGlobbyCache()
  Channel.debug(`Directory IO runtime reset: ${reason} queuedForeground=${queuedForeground}`)
}

function requestBackgroundIoAbort(reason: string) {
  backgroundIoGeneration++
  if (!backgroundIoAbortController.signal.aborted) {
    backgroundIoAbortController.abort()
    Channel.debug(`Background image IO aborted: ${reason}`)
  }
  backgroundIoAbortController = new AbortController()
}

function abortBackgroundIoForForegroundDirectory(dirPath: string) {
  requestBackgroundIoAbort(`directory-read:${dirPath}`)
  cancelThumbnailWork(`directory-read:${dirPath}`)
}

function currentBackgroundIoSignal() {
  return backgroundIoAbortController.signal
}

function currentBackgroundIoGeneration() {
  return backgroundIoGeneration
}

function hasRecentForegroundDirectoryIo() {
  return foregroundDirectoryScheduler.activeCount > 0
    || foregroundDirectoryScheduler.queueLength > 0
    || Date.now() - foregroundDirectoryScheduler.lastFinishedAt < FOREGROUND_IO_IDLE_GRACE_MS
    || isDirectoryNavigationActive()
}

// 前台目录导航活跃度追踪。
//
// 背景：目录读取走 worker pool 时**完全绕过**了 foregroundDirectoryScheduler，
// 所以 hasRecentForegroundDirectoryIo() 仅凭调度器状态根本感知不到"用户正在展开目录"，
// 导致 get_thumbnails / metadata / base64 等重 IO 的让路逻辑形同虚设——它们照常
// 在用户点目录的同一时刻发起，把单条 SSH 连接占满，readdir 排队卡死。
//
// 这里用一个独立计数器 + 最近活跃时间窗，由 get_directory_children handler 在每次
// 前台读取的起止显式打点。
//
// 两个粒度的判断要分清楚，否则会矫枉过正：
// - isDirectoryNavigationActive()（含 700ms recency 窗）：用于重 IO **入口**的让路
//   判断（waitForForegroundDirectoryIo）。短暂窗口让一次点击的连锁读取先过。
// - isForegroundDirectoryIoInFlight()（仅看是否真有读在飞）：用于重 IO **批内逐项**
//   的中止判断。一旦读完立刻放行，避免"最近 700ms 有过导航就把整批缩略图全 abort"
//   导致大目录里图片永远刷不出来（1602 张 .tif 全空白就是这么来的）。
let foregroundDirectoryNavInFlight = 0
let foregroundDirectoryNavLastActive = 0

function resetForegroundDirectoryNavigation() {
  foregroundDirectoryNavInFlight = 0
  foregroundDirectoryNavLastActive = 0
}

function beginDirectoryNavigation() {
  foregroundDirectoryNavInFlight++
  foregroundDirectoryNavLastActive = Date.now()
}

function endDirectoryNavigation() {
  foregroundDirectoryNavInFlight = Math.max(0, foregroundDirectoryNavInFlight - 1)
  foregroundDirectoryNavLastActive = Date.now()
}

function isDirectoryNavigationActive() {
  return foregroundDirectoryNavInFlight > 0
    || Date.now() - foregroundDirectoryNavLastActive < FOREGROUND_IO_IDLE_GRACE_MS
}

// 是否真的有前台目录读取正在飞行（不含 recency 宽限窗）。
// 批内逐项的重 IO 中止只看这个：读完即放行。
function isForegroundDirectoryIoInFlight() {
  return foregroundDirectoryNavInFlight > 0
    || foregroundDirectoryScheduler.activeCount > 0
    || foregroundDirectoryScheduler.queueLength > 0
}

function shouldDisableNonEssentialDirectoryWork() {
  return false
}

function isSilentDirectoryCancellation(reason: string | undefined) {
  return !!reason && (
    reason.startsWith('superseded-')
    || reason.startsWith('preempted-')
    || reason.startsWith('panel-abort')
    || reason.startsWith('panel-disposed')
    || reason.startsWith('pool-disposed')
    || reason === 'pool disposed'
    || reason.startsWith('reset-nonessential')
    || reason.startsWith('signal-aborted')
  )
}

async function waitForForegroundDirectoryIo(signal?: AbortSignal, maxMs = BACKGROUND_IO_GRACE_MS) {
  const start = Date.now()
  while (hasRecentForegroundDirectoryIo()) {
    if (signal?.aborted)
      return false
    if (Date.now() - start >= maxMs)
      return false
    await yieldToEventLoop(50)
  }
  return !signal?.aborted
}

async function waitForForegroundDirectoryIoInBatch(signal?: AbortSignal, maxMs = THUMBNAIL_IN_BATCH_WAIT_MS) {
  const start = Date.now()
  while (isForegroundDirectoryIoInFlight()) {
    if (signal?.aborted)
      return false
    if (Date.now() - start >= maxMs)
      return false
    await yieldToEventLoop(50)
  }
  return !signal?.aborted
}

function startBackgroundIo(kind: BackgroundIoKind, timeoutMs: number) {
  const parentSignal = currentBackgroundIoSignal()
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined

  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort()
    }
  }

  if (parentSignal.aborted) {
    abort()
  }
  else {
    parentSignal.addEventListener('abort', abort, { once: true })
  }

  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      Channel.debug(`Background image IO timed out: ${kind} (${timeoutMs}ms)`)
      abort()
    }, timeoutMs)
  }

  return {
    signal: controller.signal,
    dispose: () => {
      if (timer) {
        clearTimeout(timer)
      }
      parentSignal.removeEventListener('abort', abort)
    },
  }
}

async function runForegroundDirectoryIo<T>(
  dirPath: string,
  run: () => Promise<T>,
  options: {
    panelId?: string
    priority?: DirectoryIoPriority
    reason?: DirectoryRequestReason
  } = {},
): Promise<T> {
  abortBackgroundIoForForegroundDirectory(dirPath)
  return await foregroundDirectoryScheduler.enqueue(dirPath, run, {
    panelId: options.panelId,
    priority: options.priority,
    reason: options.reason,
  })
}

// sharp (libvips) 操作共享 libuv 线程池。如果缩略图/metadata 请求并发太高，
// 会饿死 fs.readdir/stat，导致目录展开卡住。
// 用一个简单的信号量限制同时在飞的 sharp 操作数。
const SHARP_MAX_CONCURRENCY = Math.max(2, Math.min(4, Math.ceil(os.cpus().length / 4)))
let sharpInFlight = 0
const sharpWaiters: (() => void)[] = []

async function waitForSharpQuiet(maxMs: number): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    if (sharpInFlight <= 0 && sharpWaiters.length <= 0) {
      return
    }
    await yieldToEventLoop(25)
  }
}

async function acquireSharp(signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) {
    return false
  }
  if (sharpInFlight < SHARP_MAX_CONCURRENCY) {
    sharpInFlight++
    return true
  }
  return await new Promise<boolean>((resolve) => {
    let settled = false
    let onAbort: () => void
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort)
    }
    const done = (value: boolean) => {
      if (settled)
        return
      settled = true
      cleanup()
      resolve(value)
    }
    const waiter = () => {
      if (signal?.aborted) {
        done(false)
        return
      }
      sharpInFlight++
      done(true)
    }
    onAbort = () => {
      const index = sharpWaiters.indexOf(waiter)
      if (index !== -1) {
        sharpWaiters.splice(index, 1)
      }
      done(false)
    }

    signal?.addEventListener('abort', onAbort, { once: true })
    sharpWaiters.push(waiter)
  })
}

function releaseSharp(): void {
  sharpInFlight--
  const next = sharpWaiters.shift()
  if (next)
    next()
}

type DirectorySnapshot = {
  createdAt: number
  dirs: string[]
  imagePaths: string[]
  readMs: number
  directImageCount?: number
  imageOffset?: number
  imageLimit?: number
  /** false when streaming mode hit deadline — imagePaths is partial, more may exist */
  complete?: boolean
}

type DirectoryFastPage = {
  canLoadMoreImages?: boolean
  complete: boolean
  directFolderCount?: number
  directImageCount?: number
  dirs: string[]
  imagePaths: string[]
  loadedImageCount: number
  readMs: number
  scannedEntries: number
  /**
   * 当 fast-page 完全失败（opendir 都没成功），且原因是 IO 卡住（远端连接慢/挂起），
   * 这个标记会被设为 true。调用方（getDirectoryChildrenPayloads）应当**避免**继续尝试
   * 完整 readdir 的 snapshot 路径——因为底层是同一 SSH 连接，opendir 都卡的情况下
   * readdir 几乎肯定也会卡满 14s 然后超时，徒增等待。
   */
  ioStalled?: boolean
}

type BackgroundIoKind = 'metadata' | 'thumbnail' | 'directory-page' | 'warmup'
type Base64RequestPriority = 'high' | 'normal' | 'idle'

class OperationTimeoutError extends Error {
  code = 'OperationTimeout'

  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`)
    this.name = 'OperationTimeoutError'
  }
}

type DirectoryWarmupTarget = {
  startDirs?: string[]
  maxDepth?: number
  imageDepth?: number
  reason?: string
}

type DirectoryWarmupStats = {
  aborted: boolean
  processedBatches: number
  processedDirs: number
  queuedDirs: number
  reason: 'done' | 'aborted' | 'hidden' | 'batch-limit' | 'foreground-active'
}

type DirectoryChildrenResult = {
  canLoadMoreImages?: boolean
  childrenLoaded: boolean
  count: number
  directFolderCount?: number
  directImageCount?: number
  imagesLoaded?: boolean
  loadedImageCount?: number
  ok: boolean
  pending?: boolean
  timeout: boolean
}

function normalizeWarmupTargets(targets: DirectoryWarmupTarget[]) {
  return targets.flatMap((target): DirectoryWarmupTarget[] => {
    const maxDepth = Math.max(
      0,
      Math.min(target.maxDepth ?? DIRECTORY_WARMUP_MAX_DEPTH, DIRECTORY_WARMUP_MAX_REQUEST_DEPTH),
    )
    const startDirLimit = target.reason === 'opened-dir-siblings'
      ? Math.min(DIRECTORY_SIBLING_LOOKAHEAD_LIMIT, DIRECTORY_WARMUP_MAX_START_DIRS)
      : DIRECTORY_WARMUP_MAX_START_DIRS
    const startDirs = target.startDirs?.slice(0, startDirLimit)
    if ((target.startDirs?.length || 0) > startDirLimit) {
      Channel.debug(
        `Warmup target truncated: reason=${target.reason || 'default'}, `
        + `from=${target.startDirs?.length || 0}, to=${startDirLimit}`,
      )
    }

    return [{
      ...target,
      maxDepth,
      startDirs,
    }]
  })
}

const directorySnapshotCache = new Map<string, DirectorySnapshot>()
const directorySnapshotInflight = new Map<string, { promise: Promise<DirectorySnapshot | null>, startedAt: number }>()
const directorySnapshotCompletionInflight = new Set<string>()
const directoryChildrenRequestInflight = new Map<string, { promise: Promise<DirectoryChildrenResult>, startedAt: number }>()
const directoryLookaheadInflight = new Set<string>()

function clearDirectoryChildrenRequestsForPanel(panelId: string) {
  directoryChildrenRequestInflight.forEach((_, key) => {
    if (key.startsWith(`${panelId}:`)) {
      directoryChildrenRequestInflight.delete(key)
    }
  })
}

function resetNonEssentialIo(reason: string) {
  requestBackgroundIoAbort(reason)
  cancelThumbnailWork(`reset-nonessential:${reason}`)
  directoryIoPool?.cancelNonClickTasks(`reset-nonessential:${reason}`)
  directorySnapshotInflight.clear()
  directorySnapshotCompletionInflight.clear()
  directoryLookaheadInflight.clear()
  directoryChildrenRequestInflight.clear()
  resetForegroundDirectoryNavigation()
  Channel.debug(`Non-essential image manager IO reset: ${reason}`)
}

function withTimeout<T, F = T>(promise: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  return new Promise<T | F>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        clearTimeout(timer)
        resolve(fallback)
      },
    )
  })
}

function withRejectingTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new OperationTimeoutError(label, ms))
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

async function withTimedStep<T>(promise: Promise<T>, deadline: number): Promise<{ timedOut: true } | { timedOut: false, value: T }> {
  const remainingMs = deadline - performance.now()
  if (remainingMs <= 0) {
    return { timedOut: true }
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ timedOut: true }), remainingMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve({ timedOut: false, value })
      },
      () => {
        clearTimeout(timer)
        resolve({ timedOut: true })
      },
    )
  })
}

function imageFromPath(
  filePath: string,
  cwd: string,
  imageManagerPanel: ImageManagerPanel,
  stats?: Pick<fs.Stats, 'mtimeMs' | 'size'>,
): ImageType {
  const slashed = slashPath(filePath)
  const projectPath = slashPath(path.dirname(cwd))
  const absWorkspaceFolder = slashPath(cwd)
  const workspaceFolder = slashPath(path.basename(cwd))
  const vscodePath = imageManagerPanel.panel.webview.asWebviewUri(Uri.file(slashed)).toString()
  const mtimeMs = stats?.mtimeMs ?? 0
  const vscodePathWithQuery = mtimeMs ? `${vscodePath}?t=${mtimeMs}` : vscodePath
  const absDirPath = slashPath(path.dirname(slashed))
  const relativePath
    = imageManagerPanel.initialData.rootpaths.length > 1
      ? slashPath(path.relative(projectPath, slashed))
      : slashPath(path.relative(absWorkspaceFolder, slashed))
  const parsedPath = path.parse(slashed)

  return {
    basename: path.basename(slashed),
    name: parsedPath.name,
    path: slashed,
    extname: parsedPath.ext.replace('.', ''),
    stats: { mtimeMs, size: stats?.size ?? 0 },
    dirPath: resolveDirPath(slashed, cwd),
    absDirPath,
    workspaceFolder,
    vscodePath: vscodePathWithQuery,
    key: `${slashed}:${mtimeMs}`,
    absWorkspaceFolder,
    relativePath: slashPath(`./${relativePath}`),
    info: {
      metadata: { width: undefined, height: undefined },
      compressed: Compressed.unknown,
      gitStaged: false,
    },
  }
}

function imagePayloads(images: ImageType[]) {
  return images.map(image => ({
    data: {
      payload: image,
      type: UpdateEvent.create,
    },
    origin: UpdateOrigin.image,
  }))
}

function normalizeImagePage(offset?: number, limit?: number) {
  const safeOffset = Math.max(0, Math.floor(offset || 0))
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit || DIRECTORY_IMAGE_PAGE_SIZE)))
  return {
    limit: safeLimit,
    offset: safeOffset,
  }
}

function directoryPayload(
  absDirPath: string,
  cwd: string,
  options: {
    type?: UpdateEvent.create | UpdateEvent.update | UpdateEvent.delete
    childrenLoaded?: boolean
    imagesLoaded?: boolean
    loadingChildren?: boolean
    canLoadChildren?: boolean
    canLoadMoreImages?: boolean
    directFolderCount?: number
    directImageCount?: number
    loadedImageCount?: number
    imagePageOffset?: number
    imagePageLimit?: number
  } = {},
): UpdatePayload {
  const slashedDirPath = slashPath(absDirPath)
  const slashedCwd = slashPath(cwd)

  const payload = {
    absDirPath: slashedDirPath,
    absWorkspaceFolder: slashedCwd,
    canLoadChildren: options.canLoadChildren ?? true,
    canLoadMoreImages: options.canLoadMoreImages,
    childrenLoaded: options.childrenLoaded,
    dirPath: resolveDirPath(slashedDirPath, slashedCwd, true),
    directFolderCount: options.directFolderCount,
    directImageCount: options.directImageCount,
    imagePageLimit: options.imagePageLimit,
    imagePageOffset: options.imagePageOffset,
    imagesLoaded: options.imagesLoaded,
    loadedImageCount: options.loadedImageCount,
    loadingChildren: options.loadingChildren,
    workspaceFolder: path.basename(slashedCwd),
  }

  return {
    data: {
      payload,
      type: options.type ?? UpdateEvent.create,
    },
    origin: UpdateOrigin.dir,
  }
}

function uniquePayloads(payloads: UpdatePayload[]) {
  const map = new Map<string, UpdatePayload>()
  payloads.forEach((payload) => {
    const key = payload.origin === UpdateOrigin.image
      ? `${payload.origin}:${payload.data.payload.path}`
      : `${payload.origin}:${payload.data.payload.absDirPath}`
    map.set(key, payload)
  })
  return Array.from(map.values())
}

function buildDirectorySnapshotFromDirents(
  entries: Dirent[],
  options: {
    dirPath: string
    excludePatterns: string[]
    imageLimit: number
    imageOffset: number
    readMs: number
  },
): DirectorySnapshot {
  const dirPath = slashPath(options.dirPath)
  const dirs: string[] = []
  const imagePaths: string[] = []
  let directImageCount = 0
  const requestedImageEnd = options.imageLimit === Number.POSITIVE_INFINITY
    ? Number.POSITIVE_INFINITY
    : options.imageOffset + options.imageLimit

  for (const entry of entries) {
    if (entry.isSymbolicLink?.())
      continue

    const entryPath = slashPath(path.join(dirPath, entry.name))

    if (entry.isDirectory()) {
      if (!isExcludedPath(entryPath, options.excludePatterns)) {
        dirs.push(entryPath)
      }
      continue
    }

    if (entry.isFile() && isScanImage(entryPath) && !isExcludedPath(entryPath, options.excludePatterns)) {
      if (directImageCount >= options.imageOffset && directImageCount < requestedImageEnd) {
        imagePaths.push(entryPath)
      }
      directImageCount++
    }
  }

  sortDirectoryPaths(dirs)
  sortDirectoryPaths(imagePaths)

  return {
    complete: true,
    createdAt: Date.now(),
    directImageCount,
    dirs,
    imageLimit: options.imageLimit,
    imageOffset: options.imageOffset,
    imagePaths,
    readMs: options.readMs,
  }
}

function isPathInside(target: string, root: string) {
  const relative = path.relative(root, target)
  return !relative || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function isScanImage(filePath: string) {
  const ext = path.extname(filePath).slice(1).toLowerCase()
  return getCustomFormatScanExtensions(Config.file_scan, Config.file_customFormats).map(t => t.toLowerCase()).includes(ext)
}

function isExcludedPath(filePath: string, patterns: string[]) {
  const normalized = slashPath(filePath).replace(/\/+$/, '')
  return patterns.some((pattern) => {
    const positivePattern = slashPath(pattern.startsWith('!') ? pattern.slice(1) : pattern)
    return micromatch.isMatch(normalized, positivePattern, { dot: true })
      || micromatch.isMatch(`${normalized}/`, positivePattern, { dot: true })
      || micromatch.isMatch(`${normalized}/__image_manager_child__`, positivePattern, { dot: true })
  })
}

/**
 * 从 file_exclude 列表里抽出"纯 basename"模式（如 "node_modules", ".git"）传给 worker，
 * 让 worker 在读盘时直接过滤掉这些常见目录，减少传回主线程的 entry 数量。
 * 主线程会再用 micromatch 做完整路径过滤兜底。
 */
function extractBasenameExcludeList(patterns: string[]): string[] {
  const out: string[] = []
  for (const raw of patterns) {
    if (!raw || raw.startsWith('!'))
      continue
    const p = slashPath(raw).replace(/^\.\//, '').replace(/\/+$/, '')
    // 跳过任何含 wildcard 或路径分隔的复杂模式
    if (p.includes('/') || p.includes('*') || p.includes('?') || p.includes('[') || p.includes('{'))
      continue
    out.push(p)
  }
  return out
}

function directorySnapshotKey(cwd: string, dirPath: string) {
  return `${slashPath(cwd)}::${slashPath(dirPath)}`
}

function directorySnapshotHasImagePage(
  cached: DirectorySnapshot | undefined,
  imageOffset: number,
  imageLimit: number,
) {
  if (!cached) {
    return false
  }
  if (imageLimit === 0) {
    return true
  }
  if (cached.imageLimit === undefined) {
    return true
  }
  const cachedOffset = cached.imageOffset || 0
  return cachedOffset <= imageOffset
    && cachedOffset + (cached.imageLimit || 0) >= imageOffset + imageLimit
}

function directoryChildrenRequestKey(
  panelId: string,
  cwd: string,
  dirPath: string,
  includeImages: boolean,
  imageOffset: number,
  imageLimit: number,
) {
  return [
    panelId,
    slashPath(cwd),
    slashPath(dirPath),
    includeImages ? 'images' : 'skeleton',
    imageOffset,
    imageLimit,
  ].join('::')
}

function getCachedDirectorySnapshot(cwd: string, dirPath: string, options: { allowStale?: boolean } = {}) {
  const cached = directorySnapshotCache.get(directorySnapshotKey(cwd, dirPath))
  if (!cached) {
    return undefined
  }
  if (options.allowStale || Date.now() - cached.createdAt < DIRECTORY_SNAPSHOT_CACHE_TTL) {
    return cached
  }
  return undefined
}

function clearDirectorySnapshotCachesForPath(targetPath: string, cwdHint?: string) {
  const normalizedTarget = slashPath(targetPath).replace(/\/+$/, '')
  const normalizedCwd = cwdHint ? slashPath(cwdHint).replace(/\/+$/, '') : undefined
  let snapshots = 0
  let inflight = 0
  let completions = 0
  let children = 0
  let lookahead = 0

  const isRelated = (key: string) => {
    const [cwd, dirPath] = key.split('::')
    if (normalizedCwd && slashPath(cwd).replace(/\/+$/, '') !== normalizedCwd) {
      return false
    }
    const normalizedDir = slashPath(dirPath || '').replace(/\/+$/, '')
    return normalizedDir === normalizedTarget
      || normalizedDir.startsWith(`${normalizedTarget}/`)
      || normalizedTarget.startsWith(`${normalizedDir}/`)
  }

  for (const key of Array.from(directorySnapshotCache.keys())) {
    if (isRelated(key)) {
      directorySnapshotCache.delete(key)
      snapshots++
    }
  }
  for (const key of Array.from(directorySnapshotInflight.keys())) {
    if (isRelated(key)) {
      directorySnapshotInflight.delete(key)
      inflight++
    }
  }
  for (const key of Array.from(directorySnapshotCompletionInflight.keys())) {
    if (isRelated(key)) {
      directorySnapshotCompletionInflight.delete(key)
      completions++
    }
  }
  for (const key of Array.from(directoryLookaheadInflight.keys())) {
    if (isRelated(key)) {
      directoryLookaheadInflight.delete(key)
      lookahead++
    }
  }
  for (const key of Array.from(directoryChildrenRequestInflight.keys())) {
    if (key.includes(`::${normalizedTarget}::`) || key.includes(`::${normalizedTarget}/`)) {
      directoryChildrenRequestInflight.delete(key)
      children++
    }
  }

  if (snapshots || inflight || completions || children || lookahead) {
    Channel.debug(
      `Directory caches cleared: target=${normalizedTarget} cwd=${normalizedCwd || ''} `
      + `(snapshots=${snapshots}, inflight=${inflight}, completions=${completions}, children=${children}, lookahead=${lookahead})`,
    )
  }
}

function clearDirectorySnapshotCachesForCwd(cwd: string) {
  const normalizedCwd = slashPath(cwd).replace(/\/+$/, '')
  let snapshots = 0
  let inflight = 0
  let completions = 0
  let children = 0
  let lookahead = 0

  const hasCwd = (key: string) => slashPath(key.split('::')[0] || '').replace(/\/+$/, '') === normalizedCwd

  for (const key of Array.from(directorySnapshotCache.keys())) {
    if (hasCwd(key)) {
      directorySnapshotCache.delete(key)
      snapshots++
    }
  }
  for (const key of Array.from(directorySnapshotInflight.keys())) {
    if (hasCwd(key)) {
      directorySnapshotInflight.delete(key)
      inflight++
    }
  }
  for (const key of Array.from(directorySnapshotCompletionInflight.keys())) {
    if (hasCwd(key)) {
      directorySnapshotCompletionInflight.delete(key)
      completions++
    }
  }
  for (const key of Array.from(directoryLookaheadInflight.keys())) {
    if (hasCwd(key)) {
      directoryLookaheadInflight.delete(key)
      lookahead++
    }
  }
  for (const key of Array.from(directoryChildrenRequestInflight.keys())) {
    if (key.includes(`::${normalizedCwd}::`) || key.includes(`${normalizedCwd}::`)) {
      directoryChildrenRequestInflight.delete(key)
      children++
    }
  }

  Channel.debug(
    `Directory cwd caches cleared: cwd=${normalizedCwd} `
    + `(snapshots=${snapshots}, inflight=${inflight}, completions=${completions}, children=${children}, lookahead=${lookahead})`,
  )
}

function clearDirectorySnapshotCaches() {
  const snapshots = directorySnapshotCache.size
  const inflight = directorySnapshotInflight.size
  const completions = directorySnapshotCompletionInflight.size
  const children = directoryChildrenRequestInflight.size
  const lookahead = directoryLookaheadInflight.size

  directorySnapshotCache.clear()
  directorySnapshotInflight.clear()
  directorySnapshotCompletionInflight.clear()
  directoryChildrenRequestInflight.clear()
  directoryLookaheadInflight.clear()

  if (snapshots || inflight || completions || children || lookahead) {
    Channel.debug(
      `Directory caches cleared: all `
      + `(snapshots=${snapshots}, inflight=${inflight}, completions=${completions}, children=${children}, lookahead=${lookahead})`,
    )
  }
}

function trimDirectorySnapshotCache() {
  if (directorySnapshotCache.size <= DIRECTORY_SNAPSHOT_CACHE_MAX) {
    return
  }

  const removeCount = directorySnapshotCache.size - DIRECTORY_SNAPSHOT_CACHE_MAX
  let removed = 0
  for (const key of directorySnapshotCache.keys()) {
    directorySnapshotCache.delete(key)
    removed++
    if (removed >= removeCount) {
      break
    }
  }
}

function sortDirectoryPaths(paths: string[]) {
  return paths.sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, {
    numeric: true,
    sensitivity: 'base',
  }))
}

async function readDirectorySnapshotStreamed(
  options: {
    cwd: string
    dirPath: string
    signal?: AbortSignal
    timeoutMs?: number
    refresh?: boolean
    background?: boolean
    panelId?: string
    priority?: DirectoryIoPriority
    reason?: DirectoryRequestReason
    cancelToken?: CancelToken
    imageOffset?: number
    imageLimit?: number
  },
): Promise<DirectorySnapshot | null> {
  const cwd = slashPath(options.cwd)
  const dirPath = slashPath(options.dirPath || cwd)
  const cached = getCachedDirectorySnapshot(cwd, dirPath, { allowStale: options.background })
  const requestedImageOffset = Math.max(0, Math.floor(options.imageOffset || 0))
  const requestedImageLimit = Math.max(0, Math.floor(options.imageLimit ?? DIRECTORY_IMAGE_PAGE_SIZE))
  const excludePatterns = Config.file_exclude
  const start = performance.now()
  const deadline = options.timeoutMs && options.timeoutMs > 0 ? start + options.timeoutMs : Number.POSITIVE_INFINITY

  // 单一读取路径 — 走 Worker pool。
  //
  // 历史上这里有一个 workspace.fs / worker / node.fs 三路竞速，意图是"谁先返回用谁"。
  // 但实测推翻了这个设计：目标盘 F: 是 SSHFS-Win 单 SSH 连接挂载，三条路径最终都排在
  // 同一条 SSH 连接后面，竞速只会把一次点击放大成 3 个并发读，加重单连接争抢，没有任何收益
  // （日志实证：三路同时卡满 14s）。真正的瓶颈从来不是 readdir 本身（健康时只要 8ms），
  // 而是 sharp/base64 等重 IO 把单连接占满造成的 head-of-line blocking。
  //
  // 因此这里只保留 worker 一条路径：它的价值是 worker.terminate() 能真正取消在飞的
  // readdir，避免我们进程内 libuv 槽位被卡死的读堆积。
  const pool = getDirectoryIoPool()
  if (pool) {
    const timeoutLeft = options.timeoutMs && options.timeoutMs > 0
      ? Math.max(0, deadline - performance.now())
      : undefined

    // Foreground directory expansion should behave like a file manager: show a
    // complete folder skeleton when it is cheap, but don't wait forever on huge
    // image folders over SSHFS. Streaming still returns child folders first and
    // a bounded first image page, with childrenLoaded=false if the deadline hits.
    const mode = options.background || requestedImageLimit === 0 ? 'snapshot' : 'streaming'

    const runWorker = async (signal?: AbortSignal) => {
      const ioRes = await pool.read({
        dirPath,
        mode,
        scanExts: getCustomFormatScanExtensions(Config.file_scan, Config.file_customFormats),
        excludeBasenames: extractBasenameExcludeList(excludePatterns),
        fastImageLimit: undefined,
        imageLimit: requestedImageLimit,
        imageOffset: requestedImageOffset,
        deadlineMs: timeoutLeft,
        panelId: options.panelId,
        priority: options.priority || (options.background ? 'background' : 'normal'),
        reason: options.reason,
      }, options.cancelToken)

      if (signal?.aborted || options.cancelToken?.cancelled) {
        const reason = options.cancelToken?.reason
        if (isSilentDirectoryCancellation(reason)) {
          throw new AbortError(reason)
        }
        return null
      }

      if (!ioRes.ok) {
        if (ioRes.cancelled) {
          Channel.debug(`Directory worker read cancelled: ${dirPath} (${ioRes.error}, ${ioRes.readMs.toFixed(0)}ms)`)
          if (isSilentDirectoryCancellation(ioRes.error)) {
            throw new AbortError(ioRes.error)
          }
          return null
        }
        Channel.warn(`Directory worker read failed: ${dirPath} ${ioRes.error} (${ioRes.readMs.toFixed(0)}ms)`)
        return cached && !options.refresh ? cached : null
      }

      if (mode === 'streaming' && !ioRes.complete && ioRes.dirs.length === 0 && ioRes.imagePaths.length === 0) {
        Channel.warn(
          `Directory worker streaming produced no visible entries: ${dirPath} `
          + `(scanned=${ioRes.scannedEntries}, cost=${ioRes.readMs.toFixed(0)}ms)`,
        )
        return cached && !options.refresh ? cached : null
      }

      // 二次过滤：worker 只做了 basename 排除，主线程用 micromatch 做完整路径排除
      const dirs = ioRes.dirs.filter(p => !isExcludedPath(p, excludePatterns))
      const imagePaths = ioRes.imagePaths.filter(p => !isExcludedPath(p, excludePatterns))
      const directImageCount = ioRes.complete
        ? ioRes.directImageCount
        : undefined
      sortDirectoryPaths(dirs)
      sortDirectoryPaths(imagePaths)

      const snapshot: DirectorySnapshot = {
        createdAt: Date.now(),
        dirs,
        imagePaths,
        readMs: ioRes.readMs,
        directImageCount,
        imageLimit: requestedImageLimit,
        imageOffset: requestedImageOffset,
        complete: ioRes.complete,
      }

      Channel.debug(
        `Directory worker snapshot: ${dirPath} `
        + `(dirs=${dirs.length}, images=${imagePaths.length}/${directImageCount ?? 'n/a'}, scanned=${ioRes.scannedEntries}, `
        + `complete=${ioRes.complete}, cost=${ioRes.readMs.toFixed(0)}ms)`,
      )

      return snapshot
    }

    const snapshot = await runWorker(options.signal)

    if (!snapshot) {
      return cached && !options.refresh ? cached : null
    }

    if (snapshot.complete !== false) {
      directorySnapshotCache.set(directorySnapshotKey(cwd, dirPath), snapshot)
      trimDirectorySnapshotCache()
    }
    return snapshot
  }

  const dirs: string[] = []
  const imagePaths: string[] = []
  let directImageCount = 0
  const requestedImageEnd = requestedImageLimit === Number.POSITIVE_INFINITY
    ? Number.POSITIVE_INFINITY
    : requestedImageOffset + requestedImageLimit

  try {
    const readResult = await withTimedStep(readdir(dirPath, { withFileTypes: true }) as Promise<Dirent[]>, deadline)
    if (readResult.timedOut) {
      Channel.warn(`Directory streamed snapshot read timed out: ${dirPath}`)
      return cached && !options.refresh ? cached : null
    }
    for (const entry of readResult.value) {
      if (options.signal?.aborted) {
        return null
      }
      if (performance.now() >= deadline) {
        Channel.debug(`Directory streamed snapshot timed out: ${dirPath}`)
        return cached && !options.refresh ? cached : null
      }
      if (entry.isSymbolicLink?.())
        continue

      const entryPath = slashPath(path.join(dirPath, entry.name))

      if (entry.isDirectory()) {
        if (!isExcludedPath(entryPath, excludePatterns)) {
          dirs.push(entryPath)
        }
        continue
      }

      if (entry.isFile() && isScanImage(entryPath) && !isExcludedPath(entryPath, excludePatterns)) {
        if (directImageCount >= requestedImageOffset && directImageCount < requestedImageEnd) {
          imagePaths.push(entryPath)
        }
        directImageCount++
      }
    }
  }
  catch (err) {
    Channel.warn(`Read streamed directory failed: ${dirPath} ${toString(err)}`)
    return cached && !options.refresh ? cached : null
  }

  if (options.signal?.aborted) {
    return null
  }

  sortDirectoryPaths(dirs)
  sortDirectoryPaths(imagePaths)

  const snapshot: DirectorySnapshot = {
    createdAt: Date.now(),
    dirs,
    imagePaths,
    readMs: performance.now() - start,
    directImageCount,
    imageLimit: requestedImageLimit,
    imageOffset: requestedImageOffset,
  }

  Channel.debug(
    `Directory streamed snapshot: ${dirPath} `
    + `(dirs=${dirs.length}, images=${imagePaths.length}, cost=${snapshot.readMs}ms)`,
  )

  directorySnapshotCache.set(directorySnapshotKey(cwd, dirPath), snapshot)
  trimDirectorySnapshotCache()
  return snapshot
}

async function readDirectoryPageFast(
  options: {
    cwd: string
    dirPath: string
    background?: boolean
    signal?: AbortSignal
    imageOffset?: number
    imageLimit?: number
    includeImages?: boolean
    timeoutMs?: number
    cancelToken?: CancelToken
    panelId?: string
    priority?: DirectoryIoPriority
    reason?: DirectoryRequestReason
  },
): Promise<DirectoryFastPage | null> {
  const cwd = slashPath(options.cwd)
  const dirPath = slashPath(options.dirPath || cwd)
  const includeImages = options.includeImages ?? true
  const { offset: imageOffset, limit: imageLimit } = normalizeImagePage(options.imageOffset, options.imageLimit)
  const excludePatterns = Config.file_exclude
  const start = performance.now()
  const deadline = start + Math.max(300, options.timeoutMs || DIRECTORY_FAST_PAGE_READ_TIMEOUT)
  const initialImageTarget = imageOffset === 0
    ? Math.min(imageLimit, DIRECTORY_FAST_INITIAL_IMAGE_PAGE_SIZE)
    : imageLimit
  const minImageCandidates = includeImages ? imageOffset + initialImageTarget + 1 : 0
  const maxImageCandidates = includeImages
    ? imageOffset === 0
      ? imageOffset + initialImageTarget + DIRECTORY_FAST_INITIAL_IMAGE_BUFFER_SIZE
      : minImageCandidates + DIRECTORY_STREAM_BUFFER_SIZE
    : 0

  // Worker pool 路径：跑在独立 libuv pool 上，不会被主线程的 sharp/globby 饿死。
  const pool = getDirectoryIoPool()
  if (pool) {
    const ioRes = await pool.read({
      dirPath,
      mode: 'fast',
      scanExts: getCustomFormatScanExtensions(Config.file_scan, Config.file_customFormats),
      excludeBasenames: extractBasenameExcludeList(excludePatterns),
      fastImageLimit: maxImageCandidates || initialImageTarget || imageLimit,
      imageLimit: maxImageCandidates || initialImageTarget || imageLimit,
      imageOffset: 0,
      deadlineMs: Math.max(0, deadline - performance.now()),
      panelId: options.panelId,
      priority: options.priority || (options.background ? 'background' : 'normal'),
      reason: options.reason,
    }, options.cancelToken)

    if (options.signal?.aborted || options.cancelToken?.cancelled) {
      return null
    }

    if (!ioRes.ok) {
      if (ioRes.cancelled) {
        Channel.debug(`Directory worker fast-page cancelled: ${dirPath} (${ioRes.error})`)
        if (isSilentDirectoryCancellation(ioRes.error)) {
          throw new AbortError(ioRes.error)
        }
        if (ioRes.error.startsWith('deadline:')) {
          return {
            canLoadMoreImages: false,
            complete: false,
            dirs: [],
            imagePaths: [],
            loadedImageCount: 0,
            readMs: performance.now() - start,
            scannedEntries: 0,
            ioStalled: true,
          }
        }
        return null
      }
      // 区分超时（IO 卡住）vs 真正失败：超时返回 ioStalled，由上层走兜底
      const looksLikeTimeout = performance.now() >= deadline
      if (looksLikeTimeout) {
        Channel.warn(`Directory worker fast-page timed out: ${dirPath} (${ioRes.error})`)
        return {
          canLoadMoreImages: false,
          complete: false,
          dirs: [],
          imagePaths: [],
          loadedImageCount: 0,
          readMs: performance.now() - start,
          scannedEntries: 0,
          ioStalled: true,
        }
      }
      Channel.warn(`Directory worker fast-page failed: ${dirPath} ${ioRes.error}`)
      return null
    }

    const dirsFiltered = ioRes.dirs.filter(p => !isExcludedPath(p, excludePatterns))
    const imageCandidates = ioRes.imagePaths.filter(p => !isExcludedPath(p, excludePatterns))
    const directImageCount = ioRes.complete ? ioRes.directImageCount : undefined

    const returnedImageLimit = imageOffset === 0 && !ioRes.complete
      ? initialImageTarget
      : imageLimit
    const selectedImagePaths = includeImages
      ? imageCandidates.slice(imageOffset, imageOffset + returnedImageLimit)
      : []

    sortDirectoryPaths(dirsFiltered)
    sortDirectoryPaths(selectedImagePaths)

    const loadedImageCount = includeImages && selectedImagePaths.length > 0
      ? imageOffset + selectedImagePaths.length
      : 0

    return {
      canLoadMoreImages: includeImages && (ioRes.complete ? loadedImageCount < (directImageCount as number) : true),
      complete: ioRes.complete,
      directFolderCount: ioRes.complete ? dirsFiltered.length : undefined,
      directImageCount,
      dirs: dirsFiltered,
      imagePaths: selectedImagePaths,
      loadedImageCount,
      readMs: ioRes.readMs,
      scannedEntries: ioRes.scannedEntries,
    }
  }

  const dirs: string[] = []
  const imageCandidates: string[] = []
  let directImageCount = 0
  let scannedEntries = 0
  let complete = false
  let stoppedEarly = false

  const shouldStopEarly = () => {
    if (!includeImages || imageCandidates.length < minImageCandidates) {
      return performance.now() >= deadline
    }
    return imageCandidates.length >= maxImageCandidates || performance.now() >= deadline
  }

  let handle: Dir | undefined
  try {
    const openResult = await withTimedStep(fs.opendir(dirPath) as Promise<Dir>, deadline)
    if (openResult.timedOut) {
      Channel.warn(`Fast directory page open timed out: ${dirPath}`)
      // 标记 IO 卡住，让调用方跳过 readdir 兜底（同一 SSH 连接也几乎肯定卡）
      return {
        canLoadMoreImages: false,
        complete: false,
        dirs: [],
        imagePaths: [],
        loadedImageCount: 0,
        readMs: performance.now() - start,
        scannedEntries: 0,
        ioStalled: true,
      }
    }
    handle = openResult.value
    while (true) {
      const readResult = await withTimedStep(handle.read(), deadline)
      if (readResult.timedOut) {
        stoppedEarly = true
        break
      }
      const entry = readResult.value
      if (!entry) {
        break
      }
      if (options.signal?.aborted) {
        return null
      }
      scannedEntries++
      if (performance.now() >= deadline) {
        stoppedEarly = true
        break
      }
      if (entry.isSymbolicLink?.())
        continue

      const entryPath = slashPath(path.join(dirPath, entry.name))

      if (entry.isDirectory()) {
        if (!isExcludedPath(entryPath, excludePatterns)) {
          dirs.push(entryPath)
        }
        if (shouldStopEarly()) {
          stoppedEarly = true
          break
        }
        continue
      }

      if (entry.isFile() && isScanImage(entryPath) && !isExcludedPath(entryPath, excludePatterns)) {
        directImageCount++
        if (includeImages && imageCandidates.length < maxImageCandidates) {
          imageCandidates.push(entryPath)
        }
      }

      if (shouldStopEarly()) {
        stoppedEarly = true
        break
      }
    }

    complete = !stoppedEarly
  }
  catch (err) {
    Channel.warn(`Fast directory page failed: ${dirPath} ${toString(err)}`)
    return null
  }
  finally {
    void handle?.close().catch(() => undefined)
  }

  if (options.signal?.aborted) {
    return null
  }

  const returnedImageLimit = imageOffset === 0 && !complete
    ? initialImageTarget
    : imageLimit
  const selectedImagePaths = includeImages
    ? imageCandidates.slice(imageOffset, imageOffset + returnedImageLimit)
    : []
  sortDirectoryPaths(dirs)
  sortDirectoryPaths(selectedImagePaths)
  const loadedImageCount = includeImages
    ? imageOffset + selectedImagePaths.length
    : 0

  return {
    canLoadMoreImages: includeImages && (complete ? loadedImageCount < directImageCount : true),
    complete,
    directFolderCount: complete ? dirs.length : undefined,
    directImageCount: complete ? directImageCount : undefined,
    dirs,
    imagePaths: selectedImagePaths,
    loadedImageCount,
    readMs: performance.now() - start,
    scannedEntries,
  }
}

function buildDirectoryPayloadsFromPage(
  page: DirectoryFastPage,
  options: {
    cwd: string
    dirPath: string
    imageOffset: number
    imageLimit: number
    includeImages: boolean
  },
  imageManagerPanel: ImageManagerPanel,
): UpdatePayload[] {
  const images = options.includeImages
    ? page.imagePaths.map(filePath => imageFromPath(filePath, options.cwd, imageManagerPanel))
    : []
  const imagesLoaded = page.complete
    ? !page.canLoadMoreImages
    : false

  return [
    directoryPayload(options.dirPath, options.cwd, {
      canLoadMoreImages: page.canLoadMoreImages,
      // fast page 只是首批流式结果；如果没扫完，不能把 childrenLoaded 置 true，
      // 否则前端会把“部分/空结果”误当成完整展开成功，出现展开后空白的问题。
      childrenLoaded: page.complete,
      directFolderCount: page.directFolderCount,
      directImageCount: page.directImageCount,
      imagePageLimit: options.imageLimit,
      imagePageOffset: options.imageOffset,
      imagesLoaded,
      loadedImageCount: page.loadedImageCount,
      loadingChildren: false,
      type: UpdateEvent.update,
    }),
    ...page.dirs.map(dir => directoryPayload(dir, options.cwd, {
      canLoadChildren: true,
      childrenLoaded: false,
      loadingChildren: false,
      type: UpdateEvent.create,
    })),
    ...imagePayloads(images),
  ]
}

function scheduleDirectorySnapshotCompletion(
  options: {
    cwd: string
    dirPath: string
    imageLimit: number
    traceId?: string
  },
  imageManagerPanel: ImageManagerPanel,
) {
  if (DIRECTORY_EXPAND_DISABLE_SNAPSHOT_COMPLETION || shouldDisableNonEssentialDirectoryWork()) {
    Channel.debug(`Directory snapshot completion disabled: ${slashPath(options.dirPath || options.cwd)}`)
    return
  }

  const cwd = slashPath(options.cwd)
  const dirPath = slashPath(options.dirPath || cwd)
  const key = directorySnapshotKey(cwd, dirPath)

  if (directorySnapshotCompletionInflight.has(key) || imageManagerPanel.isDisposed) {
    return
  }

  directorySnapshotCompletionInflight.add(key)
  const workspaceFolder = path.basename(cwd)

  setTimeout(() => {
    const backgroundIo = startBackgroundIo('directory-page', DIRECTORY_USER_READ_TIMEOUT)
    void (async () => {
      try {
        if (!await waitForForegroundDirectoryIo(backgroundIo.signal)) {
          Channel.debug(`Directory snapshot completion skipped: foreground IO active (${dirPath})`)
          return
        }
        const snapshot = await readDirectorySnapshotStreamed({
          cwd,
          dirPath,
          background: true,
          signal: backgroundIo.signal,
          timeoutMs: DIRECTORY_USER_READ_TIMEOUT,
        })

        if (!snapshot || backgroundIo.signal.aborted || imageManagerPanel.isDisposed) {
          return
        }

        const snapshotImageCount = snapshot.directImageCount ?? snapshot.imagePaths.length
        const loadedImageCount = Math.min(snapshotImageCount, options.imageLimit)
        postWorkspaceUpdate(imageManagerPanel, {
          updateType: UpdateType.patch,
          payloads: buildDirectoryPayloadsFromSnapshot(
            snapshot,
            {
              cwd,
              dirPath,
              imageLimit: options.imageLimit,
              imageOffset: 0,
              includeImages: true,
            },
            imageManagerPanel,
          ),
          workspaceFolder,
          absWorkspaceFolder: cwd,
          traceId: options.traceId,
        })
        Channel.debug(
          `Directory snapshot completion posted: ${dirPath} `
          + `(dirs=${snapshot.dirs.length}, images=${snapshot.imagePaths.length}/${snapshotImageCount}, trace=${options.traceId || ''})`,
        )
      }
      finally {
        backgroundIo.dispose()
        directorySnapshotCompletionInflight.delete(key)
      }
    })()
  }, 0)
}

function buildDirectoryPayloadsFromSnapshot(
  snapshot: DirectorySnapshot,
  options: {
    cwd: string
    dirPath: string
    imageOffset: number
    imageLimit: number
    includeImages: boolean
  },
  imageManagerPanel: ImageManagerPanel,
) {
  const isPartial = snapshot.complete === false
  const selectedImagePaths = options.includeImages
    ? snapshot.imagePaths.slice(0, options.imageLimit)
    : []
  const totalImageCount = snapshot.directImageCount ?? snapshot.imagePaths.length
  const loadedImageCount = options.includeImages
    ? Math.min(totalImageCount, options.imageOffset + selectedImagePaths.length)
    : 0
  const images = options.includeImages
    ? selectedImagePaths.map(filePath => imageFromPath(filePath, options.cwd, imageManagerPanel))
    : []

  // When streaming returned partial results, we don't know the true total image count.
  // Report canLoadMoreImages=true so the frontend knows to fetch more pages.
  const imagesLoaded = !isPartial && options.includeImages
    && (totalImageCount === 0 || loadedImageCount >= totalImageCount)
  const canLoadMoreImages = options.includeImages
    ? (isPartial ? true : loadedImageCount < totalImageCount)
    : undefined

  return [
    directoryPayload(options.dirPath, options.cwd, {
      canLoadMoreImages,
      childrenLoaded: true,
      directFolderCount: snapshot.dirs.length,
      // When partial, don't report directImageCount — we don't know the true total
      directImageCount: isPartial ? undefined : totalImageCount,
      imagePageLimit: options.imageLimit,
      imagePageOffset: options.imageOffset,
      imagesLoaded,
      loadedImageCount,
      loadingChildren: false,
      type: UpdateEvent.update,
    }),
    ...snapshot.dirs.map(dir => directoryPayload(dir, options.cwd, {
      canLoadChildren: true,
      childrenLoaded: false,
      loadingChildren: false,
      type: UpdateEvent.create,
    })),
    ...imagePayloads(images),
  ]
}

function snapshotFromFastPage(page: DirectoryFastPage): DirectorySnapshot {
  return {
    complete: page.complete,
    createdAt: Date.now(),
    dirs: page.dirs,
    directImageCount: page.directImageCount,
    imagePaths: page.imagePaths,
    readMs: page.readMs,
  }
}

function isSingleChildDirectoryChain(snapshot: DirectorySnapshot) {
  return snapshot.complete !== false && snapshot.dirs.length === 1 && (snapshot.directImageCount ?? snapshot.imagePaths.length) === 0
}

async function buildSingleChildDescendantPayloads(
  snapshot: DirectorySnapshot,
  options: {
    cwd: string
    dirPath: string
    signal?: AbortSignal
    traceId?: string
  },
  imageManagerPanel: ImageManagerPanel,
) {
  const payloads: UpdatePayload[] = []
  const visited = new Set<string>()
  let current = snapshot
  let currentDir = slashPath(options.dirPath)
  const deadline = performance.now() + DIRECTORY_SINGLE_CHILD_LOOKAHEAD_TIMEOUT

  for (let depth = 0; depth < DIRECTORY_SINGLE_CHILD_LOOKAHEAD_MAX_DEPTH; depth++) {
    if (
      options.signal?.aborted
      || imageManagerPanel.isDisposed
      || performance.now() >= deadline
      || !isSingleChildDirectoryChain(current)
    ) {
      break
    }

    const childDir = current.dirs[0]
    if (visited.has(childDir)) {
      break
    }
    visited.add(childDir)

    const childTimeout = Math.max(250, Math.min(DIRECTORY_SKELETON_LOOKAHEAD_TIMEOUT, deadline - performance.now()))
    const childStart = performance.now()
    const child = await readDirectorySnapshot({
      cwd: options.cwd,
      dirPath: childDir,
      background: true,
      imageLimit: 0,
      imageOffset: 0,
      preferFresh: false,
      signal: options.signal,
      timeoutMs: childTimeout,
    })

    if (!child || options.signal?.aborted || imageManagerPanel.isDisposed) {
      break
    }

    payloads.push(...buildDirectoryPayloadsFromSnapshot(
      child,
      {
        cwd: options.cwd,
        dirPath: childDir,
        imageLimit: 0,
        imageOffset: 0,
        includeImages: false,
      },
      imageManagerPanel,
    ))
    Channel.debug(
      `Directory single-child lookahead: ${currentDir} -> ${childDir} `
      + `(depth=${depth + 1}, dirs=${child.dirs.length}, images=${child.imagePaths.length}/${child.directImageCount ?? child.imagePaths.length}, `
      + `cost=${(performance.now() - childStart).toFixed(0)}ms, trace=${options.traceId || ''})`,
    )

    current = child
    currentDir = childDir
  }

  if (payloads.length) {
    Channel.debug(
      `Directory single-child lookahead built: ${options.dirPath} `
      + `(payloads=${payloads.length}, trace=${options.traceId || ''})`,
    )
  }
  return payloads
}

async function buildDirectoryLookaheadPayloads(
  snapshot: DirectorySnapshot,
  options: {
    cwd: string
    dirPath: string
    signal?: AbortSignal
    traceId?: string
  },
  imageManagerPanel: ImageManagerPanel,
) {
  if (snapshot.complete === false || !snapshot.dirs.length || options.signal?.aborted || imageManagerPanel.isDisposed) {
    return []
  }

  const childDirs = snapshot.dirs.slice(0, DIRECTORY_SKELETON_LOOKAHEAD_LIMIT)
  const settled = await pMap(
    childDirs,
    async (childDir) => {
      if (options.signal?.aborted || imageManagerPanel.isDisposed) {
        return null
      }
      const childStart = performance.now()
      const child = await readDirectorySnapshot({
        cwd: options.cwd,
        dirPath: childDir,
        background: true,
        imageLimit: 0,
        imageOffset: 0,
        preferFresh: false,
        signal: options.signal,
        timeoutMs: DIRECTORY_SKELETON_LOOKAHEAD_TIMEOUT,
      })
      if (!child || options.signal?.aborted || imageManagerPanel.isDisposed) {
        return null
      }
      Channel.debug(
        `Directory lookahead child skeleton: ${childDir} `
        + `(dirs=${child.dirs.length}, images=${child.imagePaths.length}/${child.directImageCount ?? child.imagePaths.length}, complete=${child.complete !== false}, `
        + `cost=${(performance.now() - childStart).toFixed(0)}ms, trace=${options.traceId || ''})`,
      )
      return buildDirectoryPayloadsFromSnapshot(
        child,
        {
          cwd: options.cwd,
          dirPath: childDir,
          imageLimit: 0,
          imageOffset: 0,
          includeImages: false,
        },
        imageManagerPanel,
      )
    },
    { concurrency: DIRECTORY_SKELETON_LOOKAHEAD_CONCURRENCY },
  )

  const payloads = settled.flatMap(item => item || [])
  if (isSingleChildDirectoryChain(snapshot)) {
    payloads.push(...await buildSingleChildDescendantPayloads(snapshot, options, imageManagerPanel))
  }
  Channel.debug(
    `Directory lookahead skeleton built: ${options.dirPath} `
    + `(children=${childDirs.length}, payloads=${payloads.length}, trace=${options.traceId || ''})`,
  )
  return payloads
}

function scheduleDirectoryLookaheadPayloads(
  snapshot: DirectorySnapshot,
  options: {
    cwd: string
    dirPath: string
    traceId?: string
  },
  imageManagerPanel: ImageManagerPanel,
) {
  if (
    snapshot.complete === false
    || !snapshot.dirs.length
    || imageManagerPanel.isDisposed
  ) {
    return
  }

  const cwd = slashPath(options.cwd)
  const dirPath = slashPath(options.dirPath || cwd)
  const key = directorySnapshotKey(cwd, dirPath)

  if (directoryLookaheadInflight.has(key)) {
    Channel.debug(`Directory lookahead skipped: already running (${dirPath}, trace=${options.traceId || ''})`)
    return
  }

  directoryLookaheadInflight.add(key)
  const workspaceFolder = path.basename(cwd)
  const childCount = Math.min(snapshot.dirs.length, DIRECTORY_SKELETON_LOOKAHEAD_LIMIT)
  Channel.debug(
    `Directory lookahead scheduled: ${dirPath} `
    + `(children=${childCount}/${snapshot.dirs.length}, trace=${options.traceId || ''})`,
  )

  const scheduledGeneration = currentBackgroundIoGeneration()
  setTimeout(() => {
    if (scheduledGeneration !== currentBackgroundIoGeneration() || imageManagerPanel.isDisposed) {
      directoryLookaheadInflight.delete(key)
      Channel.debug(
        `Directory lookahead skipped before start: ${dirPath} `
        + `(reason=background-generation, trace=${options.traceId || ''})`,
      )
      return
    }
    const lookaheadTimeout = isSingleChildDirectoryChain(snapshot)
      ? DIRECTORY_SINGLE_CHILD_LOOKAHEAD_TIMEOUT + 500
      : DIRECTORY_SKELETON_LOOKAHEAD_TIMEOUT + 500
    const backgroundIo = startBackgroundIo('directory-page', lookaheadTimeout)
    void (async () => {
      const startedAt = performance.now()
      try {
        const payloads = await buildDirectoryLookaheadPayloads(snapshot, {
          cwd,
          dirPath,
          signal: backgroundIo.signal,
          traceId: options.traceId,
        }, imageManagerPanel)

        if (!payloads.length || backgroundIo.signal.aborted || imageManagerPanel.isDisposed) {
          Channel.debug(
            `Directory lookahead skipped post: ${dirPath} `
            + `(payloads=${payloads.length}, aborted=${backgroundIo.signal.aborted}, disposed=${imageManagerPanel.isDisposed}, `
            + `cost=${(performance.now() - startedAt).toFixed(0)}ms, trace=${options.traceId || ''})`,
          )
          return
        }

        postWorkspaceUpdate(imageManagerPanel, {
          updateType: UpdateType.patch,
          payloads: uniquePayloads(payloads),
          workspaceFolder,
          absWorkspaceFolder: cwd,
          traceId: options.traceId,
        })
        Channel.debug(
          `Directory lookahead posted: ${dirPath} `
          + `(payloads=${payloads.length}, cost=${(performance.now() - startedAt).toFixed(0)}ms, trace=${options.traceId || ''})`,
        )
      }
      catch (err) {
        Channel.warn(`Directory lookahead failed: ${dirPath} ${toString(err)}`)
      }
      finally {
        backgroundIo.dispose()
        directoryLookaheadInflight.delete(key)
      }
    })()
  }, 0)
}

async function readDirectorySnapshot(
  options: {
    cwd: string
    dirPath: string
    signal?: AbortSignal
    timeoutMs?: number
    refresh?: boolean
    background?: boolean
    panelId?: string
    priority?: DirectoryIoPriority
    reason?: DirectoryRequestReason
    cancelToken?: CancelToken
    imageOffset?: number
    imageLimit?: number
    // preferFresh=true: 即使有 warmup 等后台任务的 inflight 在飞，也另起一条独立 readdir。
    // 用户主动操作（点击展开）必须走这条，避免被 SSHFS 上慢的 warmup IO 拖住。
    // warmup 那条 promise 仍会跑完并把结果写入缓存，没有数据浪费。
    preferFresh?: boolean
  },
): Promise<DirectorySnapshot | null> {
  const cwd = slashPath(options.cwd)
  const dirPath = slashPath(options.dirPath || cwd)
  const key = directorySnapshotKey(cwd, dirPath)
  const now = Date.now()
  const cached = getCachedDirectorySnapshot(cwd, dirPath, { allowStale: options.background })
  const requestedImageOffset = Math.max(0, Math.floor(options.imageOffset || 0))
  const requestedImageLimit = Math.max(0, Math.floor(options.imageLimit ?? DIRECTORY_IMAGE_PAGE_SIZE))

  if (options.signal?.aborted) {
    return null
  }

  const cachedHasRequestedImagePage = directorySnapshotHasImagePage(cached, requestedImageOffset, requestedImageLimit)

  if (!options.refresh && cached && cachedHasRequestedImagePage && (options.background || now - cached.createdAt < DIRECTORY_SNAPSHOT_CACHE_TTL)) {
    return cached
  }

  if (options.background && !await waitForForegroundDirectoryIo(options.signal)) {
    Channel.debug(`Directory snapshot background skipped: foreground IO active (${dirPath})`)
    return cached ?? null
  }

  if (options.background && shouldDisableNonEssentialDirectoryWork()) {
    Channel.debug(`Directory snapshot background skipped: nonessential IO disabled (${dirPath})`)
    return cached ?? null
  }

  if (!options.preferFresh) {
    const inflight = directorySnapshotInflight.get(key)
    if (inflight && Date.now() - inflight.startedAt < DIRECTORY_USER_READ_TIMEOUT) {
      return inflight.promise
    }
    if (inflight) {
      directorySnapshotInflight.delete(key)
    }
  }

  // 用 worker pool 时，直接跳过 runForegroundDirectoryIo 的串行队列：
  // pool 自己有 4 个独立 worker，已经实现了真正的并行 + 可取消语义。
  // 没有 pool 时（比如 pool 初始化失败）回退到原来的串行队列。
  const usingWorkerPool = !!getDirectoryIoPool()

  // 为本次 read 创建一个 cancel token；同时把它登记到 panel 级注册表，
  // 让新 click 进来时可以批量取消同 panel 的旧请求。
  const cancelHolder = createCancelToken()
  const cancelKey = makeDirectoryReadCancelKey(options.panelId, dirPath)
  if (options.panelId && options.preferFresh) {
    directoryIoCancelTokens.set(cancelKey, cancelHolder)
  }

  // 把外部 signal abort 同步到 cancel token
  let signalListener: (() => void) | undefined
  if (options.signal) {
    if (options.signal.aborted) {
      cancelHolder.cancel('signal-aborted-before-start')
    }
    else {
      signalListener = () => cancelHolder.cancel('signal-aborted')
      options.signal.addEventListener('abort', signalListener, { once: true })
    }
  }

  const promise = (async () => {
    const enriched = {
      ...options,
      cancelToken: cancelHolder.token,
    }
    if (options.preferFresh && !options.background && !usingWorkerPool) {
      const directStart = performance.now()
      const directTimeoutMs = Math.min(750, Math.max(250, options.timeoutMs || DIRECTORY_USER_READ_TIMEOUT))
      const directResult = await withTimedStep(
        readdir(dirPath, { withFileTypes: true }) as Promise<Dirent[]>,
        directStart + directTimeoutMs,
      )
      if (directResult.timedOut) {
        Channel.warn(
          `Directory foreground direct read timed out: ${dirPath} `
          + `(${directTimeoutMs}ms), falling back to worker`,
        )
      }
      else if (!cancelHolder.token.cancelled && !options.signal?.aborted) {
        const snapshot = buildDirectorySnapshotFromDirents(directResult.value, {
          dirPath,
          excludePatterns: Config.file_exclude,
          imageLimit: requestedImageLimit,
          imageOffset: requestedImageOffset,
          readMs: performance.now() - directStart,
        })
        directorySnapshotCache.set(directorySnapshotKey(cwd, dirPath), snapshot)
        trimDirectorySnapshotCache()
        Channel.debug(
          `Directory foreground direct snapshot: ${dirPath} `
          + `(dirs=${snapshot.dirs.length}, images=${snapshot.imagePaths.length}/${snapshot.directImageCount ?? 'n/a'}, `
          + `cost=${snapshot.readMs.toFixed(1)}ms)`,
        )
        return snapshot
      }
    }
    if (usingWorkerPool) {
      // Worker pool 路径：完全并行，无队列等待
      if (options.preferFresh) {
        const stats = getDirectoryIoPool()?.stats()
        Channel.debug(
          `Directory foreground snapshot via worker: ${dirPath} `
          + `(priority=${options.priority || 'normal'}, reason=${options.reason || 'unknown'}, `
          + `pool=${stats ? JSON.stringify(stats) : 'n/a'})`,
        )
      }
      return await readDirectorySnapshotStreamed(enriched)
    }
    if (options.preferFresh) {
      Channel.debug(`Directory foreground snapshot direct: ${dirPath}`)
    }
    return await readDirectorySnapshotStreamed(enriched)
  })()

  // preferFresh 的请求不写入 inflight，避免后续 warmup 复用这条用户优先级高的 promise；
  // warmup 自己排队即可，缓存命中后续读自动会跳过 inflight。
  if (!options.preferFresh) {
    directorySnapshotInflight.set(key, { promise, startedAt: Date.now() })
  }
  try {
    return await promise
  }
  finally {
    if (!options.preferFresh) {
      directorySnapshotInflight.delete(key)
    }
    if (signalListener && options.signal) {
      options.signal.removeEventListener('abort', signalListener)
    }
    if (options.panelId && options.preferFresh && directoryIoCancelTokens.get(cancelKey) === cancelHolder) {
      directoryIoCancelTokens.delete(cancelKey)
    }
  }
}

function cleanRevealPath(imageReveal: string | undefined) {
  return slashPath((imageReveal || '').split('?')[0] || '')
}

function getRevealDirs(cwd: string, imageReveal: string | undefined) {
  const revealPath = cleanRevealPath(imageReveal)
  const slashedCwd = slashPath(cwd)
  if (!revealPath || !isPathInside(revealPath, slashedCwd)) {
    return [slashedCwd]
  }

  const revealDir = isScanImage(revealPath) ? slashPath(path.dirname(revealPath)) : revealPath
  const relative = slashPath(path.relative(slashedCwd, revealDir))
  if (!relative || relative === '.') {
    return [slashedCwd]
  }

  const dirs = [slashedCwd]
  const parts = relative.split('/').filter(Boolean)
  parts.forEach((_, index) => {
    dirs.push(slashPath(path.join(slashedCwd, ...parts.slice(0, index + 1))))
  })

  return Array.from(new Set(dirs))
}

async function getDirectoryChildrenPayloads(
  options: {
    dirPath: string
    cwd: string
    traceId?: string
    signal?: AbortSignal
    includeImages?: boolean
    imageOffset?: number
    imageLimit?: number
    refresh?: boolean
    timeoutMs?: number
    preferFresh?: boolean
    background?: boolean
    panelId?: string
    priority?: DirectoryIoPriority
    reason?: DirectoryRequestReason
    cancelToken?: CancelToken
  },
  imageManagerPanel: ImageManagerPanel,
): Promise<UpdatePayload[]> {
  const cwd = slashPath(options.cwd)
  const dirPath = slashPath(options.dirPath || cwd)
  const includeImages = options.includeImages ?? true
  const { offset: imageOffset, limit: imageLimit } = normalizeImagePage(options.imageOffset, options.imageLimit)
  const snapshotImageLimit = includeImages ? imageLimit : 0

  if (options.signal?.aborted || imageManagerPanel.isDisposed) {
    return []
  }

  if (!isPathInside(dirPath, cwd)) {
    Channel.warn(`Skip directory outside workspace: ${dirPath} (cwd=${cwd})`)
    return []
  }

  const rawCachedSnapshot = !options.refresh
    ? getCachedDirectorySnapshot(cwd, dirPath, { allowStale: options.background })
    : undefined
  const cachedSnapshot = rawCachedSnapshot && (
    !includeImages || directorySnapshotHasImagePage(rawCachedSnapshot, imageOffset, imageLimit)
  )
    ? rawCachedSnapshot
    : undefined
  const useFastPage = !cachedSnapshot
    && includeImages
    && !options.refresh
    && !DIRECTORY_EXPAND_DISABLE_FAST_PAGE
    && (options.background || imageOffset > 0)

  if (useFastPage) {
    const fastPage = await readDirectoryPageFast({
      cwd,
      dirPath,
      background: options.background,
      imageLimit,
      imageOffset,
      includeImages,
      signal: options.signal,
      cancelToken: options.cancelToken,
      panelId: options.panelId,
      priority: options.priority,
      reason: options.reason,
      timeoutMs: options.background ? DIRECTORY_PAGE_READ_TIMEOUT : DIRECTORY_FAST_PAGE_READ_TIMEOUT,
    })

    if (options.signal?.aborted || imageManagerPanel.isDisposed) {
      return []
    }

    if (fastPage) {
      if (fastPage.ioStalled) {
        Channel.warn(
          `Directory fast page IO stalled: ${dirPath} `
          + `(opendir timed out in ${fastPage.readMs}ms; skipping snapshot fallback to avoid duplicate SSH wait)`,
        )
        // SSH 连接卡死时，readdir 几乎肯定也会等满 14s 才返回。
        // 直接返回一个 childrenLoaded:false 的占位 payload，让前端尽快显示错误并允许重试。
        return [
          directoryPayload(dirPath, cwd, {
            canLoadChildren: true,
            childrenLoaded: false,
            imagesLoaded: false,
            loadingChildren: false,
            type: UpdateEvent.update,
          }),
        ]
      }

      const hasVisibleFastPage = fastPage.complete
        || fastPage.dirs.length > 0
        || fastPage.imagePaths.length > 0
        || options.background
        || imageOffset > 0

      if (!fastPage.complete && hasVisibleFastPage) {
        scheduleDirectorySnapshotCompletion({
          cwd,
          dirPath,
          imageLimit,
          traceId: options.traceId,
        }, imageManagerPanel)
      }

      Channel.debug(
        `Directory fast page: ${dirPath} `
        + `(offset=${imageOffset}, limit=${imageLimit}, initialTarget=${imageOffset === 0 ? Math.min(imageLimit, DIRECTORY_FAST_INITIAL_IMAGE_PAGE_SIZE) : imageLimit}, dirs=${fastPage.dirs.length}, images=${fastPage.imagePaths.length}, `
        + `complete=${fastPage.complete}, scanned=${fastPage.scannedEntries}, cost=${fastPage.readMs}ms)`,
      )

      if (hasVisibleFastPage) {
        const payloads = buildDirectoryPayloadsFromPage(
          fastPage,
          {
            cwd,
            dirPath,
            imageLimit,
            imageOffset,
            includeImages,
          },
          imageManagerPanel,
        )
        if (
          !options.background
          && imageOffset === 0
          && includeImages
          && fastPage.complete
          && fastPage.dirs.length > 0
        ) {
          scheduleDirectoryLookaheadPayloads(snapshotFromFastPage(fastPage), {
            cwd,
            dirPath,
            traceId: options.traceId,
          }, imageManagerPanel)
        }
        return payloads
      }

      Channel.debug(`Directory fast page had no visible entries, falling back to snapshot: ${dirPath}`)
    }

    Channel.debug(`Directory fast page unavailable, falling back to snapshot: ${dirPath}`)
  }
  else if (!cachedSnapshot && includeImages && !options.refresh) {
    Channel.debug(
      `Directory fast page bypassed: ${dirPath} `
      + `(background=${!!options.background}, offset=${imageOffset})`,
    )
  }

  const snapshot = await readDirectorySnapshot({
    cwd,
    dirPath,
    background: options.background,
    cancelToken: options.cancelToken,
    preferFresh: options.preferFresh,
    panelId: options.panelId,
    priority: options.priority,
    reason: options.reason,
    refresh: options.refresh,
    imageLimit: snapshotImageLimit,
    imageOffset,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  })

  if (options.signal?.aborted || imageManagerPanel.isDisposed) {
    return []
  }

  if (!snapshot) {
    if (options.background) {
      return []
    }
    return [
      directoryPayload(dirPath, cwd, {
        canLoadChildren: true,
        childrenLoaded: false,
        loadingChildren: false,
        type: UpdateEvent.update,
      }),
    ]
  }

  const payloads = buildDirectoryPayloadsFromSnapshot(
    snapshot,
    {
      cwd,
      dirPath,
      imageLimit,
      imageOffset,
      includeImages,
    },
    imageManagerPanel,
  )

  if (
    !options.background
    && imageOffset === 0
    && includeImages
    && snapshot.complete !== false
    && snapshot.dirs.length > 0
  ) {
    scheduleDirectoryLookaheadPayloads(snapshot, {
      cwd,
      dirPath,
      traceId: options.traceId,
    }, imageManagerPanel)
  }

  return payloads
}

async function prefetchVisibleDirectories(
  dirs: string[],
  cwd: string,
  imageManagerPanel: ImageManagerPanel,
  options: {
    includeImages?: boolean
    imageLimit?: number
    panelId?: string
    priority?: DirectoryIoPriority
    reason?: DirectoryRequestReason
    signal?: AbortSignal
    timeoutMs?: number
    preferFresh?: boolean
  } = {},
) {
  const payloads = await pMap(
    dirs,
    async dir => getDirectoryChildrenPayloads({
      cwd,
      dirPath: dir,
      imageLimit: options.imageLimit,
      includeImages: options.includeImages,
      panelId: options.panelId,
      preferFresh: options.preferFresh,
      priority: options.priority,
      reason: options.reason,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    }, imageManagerPanel),
    { concurrency: DIRECTORY_PREFETCH_CONCURRENCY },
  )
  return payloads.flat()
}

function postWorkspaceUpdate(
  imageManagerPanel: ImageManagerPanel,
  data: {
    updateType: UpdateType
    payloads: UpdatePayload[]
    workspaceFolder: string
    absWorkspaceFolder: string
    traceId?: string
  },
) {
  if (imageManagerPanel.isDisposed) {
    return
  }

  const dirPayloads = data.payloads.filter(payload => payload.origin === UpdateOrigin.dir)
  const imagePayloadsList = data.payloads.filter(payload => payload.origin === UpdateOrigin.image)
  const targetDir = dirPayloads[0]?.origin === UpdateOrigin.dir
    ? dirPayloads[0].data.payload.absDirPath
    : undefined

  const message = {
    cmd: CmdToWebview.update_images,
    data: {
      ...data,
      id: nanoid(),
    },
  }

  // 估算 payload 字节数（仅 debug 时执行 JSON.stringify 一次以避免双重序列化开销）。
  // 大 payload 跨 webview 边界需要 V8 序列化 + 反序列化，几 MB 的 payload 单跳就要几十 ms。
  let approxBytes = -1
  const shouldMeasurePayloadBytes = !!Global.context && (Global.isDevelopment() || Config.debug_enabled)
  if (shouldMeasurePayloadBytes) {
    try {
      approxBytes = JSON.stringify(message).length
    }
    catch {}
  }

  const postStart = performance.now()
  imageManagerPanel.messageCenter.postMessage(message)
  const postMs = performance.now() - postStart

  Channel.debug(
    `postWorkspaceUpdate trace=${data.traceId || ''} `
    + `(type=${data.updateType}, workspace=${data.workspaceFolder}, payloads=${data.payloads.length}, `
    + `dirPayloads=${dirPayloads.length}, imagePayloads=${imagePayloadsList.length}, `
    + `bytes=${approxBytes >= 0 ? approxBytes : 'n/a'}, postMs=${postMs.toFixed(1)}, targetDir=${targetDir || ''})`,
  )
}

async function hydrateWorkspaceDirectoryFirst(
  cwd: string,
  workspaceFolder: string,
  revealDirs: string[],
  imageManagerPanel: ImageManagerPanel,
  signal?: AbortSignal,
) {
  if (signal?.aborted || !imageManagerPanel.visible) {
    return
  }

  const [rootDir, ...preferredDirs] = revealDirs.length ? revealDirs : [cwd]

  const rootPayloads = await getDirectoryChildrenPayloads(
    {
      cwd,
      dirPath: rootDir,
      imageLimit: DIRECTORY_IMAGE_PAGE_SIZE,
      includeImages: true,
      panelId: imageManagerPanel.id,
      preferFresh: true,
      priority: 'click',
      reason: 'unknown',
      signal,
      timeoutMs: DIRECTORY_USER_READ_TIMEOUT,
    },
    imageManagerPanel,
  )

  if (signal?.aborted || !imageManagerPanel.visible) {
    return
  }

  postWorkspaceUpdate(imageManagerPanel, {
    updateType: UpdateType.patch,
    payloads: rootPayloads,
    workspaceFolder,
    absWorkspaceFolder: cwd,
  })

  const rootDirPayloads = rootPayloads.filter(payload => payload.origin === UpdateOrigin.dir)
  const rootImagePayloads = rootPayloads.filter(payload => payload.origin === UpdateOrigin.image)
  Channel.debug(
    `Hydrated directory first: workspace=${workspaceFolder}, dir=${rootDir}, `
    + `dirs=${rootDirPayloads.length}, images=${rootImagePayloads.length}, payloads=${rootPayloads.length}`,
  )

  if (preferredDirs.length) {
    // reveal 链路：[root, parent1, parent2, ..., targetDir]
    // 中间层只拉目录骨架（不带首页图片），目标层（最后一个）拉首页 128 张。
    // 这样深路径（5+ 层）打开时不会同时对 5 个目录构造 5×128 = 640 张 ImageType，
    // 也不会对每层都跑一次 readdir 枚举完整 dirent 列表。
    // 用户后续展开中间层时，memo-collapse 会自然触发 get_directory_children 补图片。
    const targetDir = preferredDirs[preferredDirs.length - 1]
    const intermediateDirs = preferredDirs.slice(0, -1)

    const skeletonPayloads = intermediateDirs.length
      ? await prefetchVisibleDirectories(
          intermediateDirs,
          cwd,
          imageManagerPanel,
          {
            imageLimit: DIRECTORY_IMAGE_PAGE_SIZE,
            includeImages: false,
            panelId: imageManagerPanel.id,
            preferFresh: true,
            priority: 'click',
            reason: 'unknown',
            signal,
            timeoutMs: DIRECTORY_USER_READ_TIMEOUT,
          },
        )
      : []

    if (signal?.aborted || !imageManagerPanel.visible) {
      return
    }

    const targetPayloads = await getDirectoryChildrenPayloads(
      {
        cwd,
        dirPath: targetDir,
        imageLimit: DIRECTORY_IMAGE_PAGE_SIZE,
        includeImages: true,
        panelId: imageManagerPanel.id,
        preferFresh: true,
        priority: 'click',
        reason: 'unknown',
        signal,
        timeoutMs: DIRECTORY_USER_READ_TIMEOUT,
      },
      imageManagerPanel,
    )

    if (signal?.aborted || !imageManagerPanel.visible) {
      return
    }

    const preferredPayloads = uniquePayloads([...skeletonPayloads, ...targetPayloads])

    if (preferredPayloads.length && imageManagerPanel.visible) {
      postWorkspaceUpdate(imageManagerPanel, {
        updateType: UpdateType.patch,
        payloads: preferredPayloads,
        workspaceFolder,
        absWorkspaceFolder: cwd,
      })
    }
  }
}

async function warmupDirectoryTree(
  cwd: string,
  imageManagerPanel: ImageManagerPanel,
  postPayloads: (payloads: UpdatePayload[]) => void,
  options?: {
    signal?: AbortSignal
    startDirs?: string[]
    maxDepth?: number
    imageDepth?: number
  },
): Promise<DirectoryWarmupStats> {
  if (!imageManagerPanel.visible) {
    return {
      aborted: true,
      processedBatches: 0,
      processedDirs: 0,
      queuedDirs: 0,
      reason: 'hidden',
    }
  }

  const signal = options?.signal
  const maxDepth = options?.maxDepth ?? DIRECTORY_WARMUP_MAX_DEPTH
  const imageDepth = options?.imageDepth ?? DIRECTORY_WARMUP_IMAGE_DEPTH
  const queue = (options?.startDirs?.length ? options.startDirs : [cwd]).map(dirPath => ({
    depth: 0,
    dirPath: slashPath(dirPath),
  }))
  const visited = new Set<string>()
  const pendingPayloads: UpdatePayload[] = []
  let processedBatches = 0
  let lastPostTime = performance.now()

  const flushPendingPayloads = () => {
    if (!pendingPayloads.length) {
      return
    }

    const payloads = uniquePayloads(pendingPayloads.splice(0))
    if (payloads.length) {
      postPayloads(payloads)
    }
    lastPostTime = performance.now()
  }

  while (queue.length) {
    if (
      signal?.aborted
      || !imageManagerPanel.visible
      || processedBatches >= DIRECTORY_WARMUP_MAX_BATCHES
      || hasRecentForegroundDirectoryIo()
    ) {
      flushPendingPayloads()
      return {
        aborted: !!signal?.aborted || !imageManagerPanel.visible || hasRecentForegroundDirectoryIo(),
        processedBatches,
        processedDirs: visited.size,
        queuedDirs: queue.length,
        reason: signal?.aborted || !imageManagerPanel.visible
          ? 'aborted'
          : processedBatches >= DIRECTORY_WARMUP_MAX_BATCHES
            ? 'batch-limit'
            : 'foreground-active',
      }
    }

    const batch = queue.splice(0, DIRECTORY_WARMUP_CONCURRENCY)
    const results = await pMap(
      batch,
      async ({ dirPath, depth }) => {
        if (signal?.aborted || !imageManagerPanel.visible) {
          return null
        }
        if (visited.has(dirPath)) {
          return null
        }
        visited.add(dirPath)

        const payloads = await getDirectoryChildrenPayloads(
          {
            background: true,
            cwd,
            dirPath,
            includeImages: depth <= imageDepth,
            priority: 'background',
            reason: 'unknown',
            signal,
            timeoutMs: DIRECTORY_WARMUP_READ_TIMEOUT,
          },
          imageManagerPanel,
        )
        if (signal?.aborted || !imageManagerPanel.visible) {
          return null
        }
        const nextDirs = payloads
          .filter(payload => payload.origin === UpdateOrigin.dir)
          .map(payload => payload.data.payload.absDirPath)
          .filter(absDirPath => absDirPath !== dirPath)
          .map(absDirPath => ({
            depth: depth + 1,
            dirPath: absDirPath,
          }))

        return {
          nextDirs: depth < maxDepth ? nextDirs : [],
          payloads,
        }
      },
      { concurrency: DIRECTORY_WARMUP_CONCURRENCY },
    )

    for (const result of results) {
      if (!result)
        continue
      queue.push(...result.nextDirs)
    }

    pendingPayloads.push(...results.flatMap(result => result?.payloads || []))

    processedBatches++
    const shouldFlush = pendingPayloads.length >= DIRECTORY_WARMUP_FLUSH_PAYLOADS
      || processedBatches % 12 === 0
      || performance.now() - lastPostTime > 500
      || !queue.length
    if (shouldFlush) {
      flushPendingPayloads()
    }

    await yieldToEventLoop(processedBatches % 8 === 0 ? 24 : 4)
    if (signal?.aborted || !imageManagerPanel.visible) {
      flushPendingPayloads()
      return {
        aborted: true,
        processedBatches,
        processedDirs: visited.size,
        queuedDirs: queue.length,
        reason: 'aborted',
      }
    }
  }

  flushPendingPayloads()
  return {
    aborted: false,
    processedBatches,
    processedDirs: visited.size,
    queuedDirs: 0,
    reason: 'done',
  }
}

async function yieldToEventLoop(ms = 0) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

export type KeyofMessage = keyof MessageFactoryType
export type MessageType<D extends Record<string, any> | undefined = Record<string, any>, C extends string = any> = {
  cmd: C
  data: D
  msgId?: string
  postTime?: string
  callbackId?: string
  traceId?: string
}

export type ReturnOfMessage<K extends KeyofMessage> = Awaited<ReturnType<MessageMethodType<K>>>

export type ParameterOfMessage<K extends KeyofMessage>
  = FirstParameter<MessageMethodType<K>> extends Record<string, any> ? FirstParameter<MessageMethodType<K>> : never

/**
 * @name MessageFactory
 * @description It handles the message from webview and return result to webview
 */
export const VscodeMessageFactory = {
  [CmdToVscode.on_webview_ready]: async (_, imageManagerPanel: ImageManagerPanel) => {
    Channel.info(i18n.t('core.webview_ready'))
    resetNonEssentialIo(`webview-ready:${imageManagerPanel.id}`)
    const [config, workspaceState] = await Promise.all([
      VscodeMessageFactory[CmdToVscode.get_extension_config](),
      VscodeMessageFactory[CmdToVscode.get_workspace_state](),
    ])
    const {
      initialData: { imageReveal, sharpInstalled },
    } = imageManagerPanel

    return {
      config,
      workspaceState,
      windowState: {
        __reveal_image_path__: imageReveal,
        __sharp_installed__: sharpInstalled,
      },
    }
  },
  [CmdToVscode.webview_error]: async (data: {
    message?: string
    stack?: string
    source?: string
    lineno?: number
    colno?: number
  }) => {
    const location = [data.source, data.lineno, data.colno].filter(Boolean).join(':')
    Channel.error(
      [
        '[Webview Error]',
        data.message,
        location ? `at ${location}` : '',
        data.stack,
      ].filter(Boolean).join('\n'),
    )
    return true
  },
  [CmdToVscode.webview_log]: async (data: {
    level?: 'debug' | 'info' | 'warn' | 'error'
    message: string
    details?: Record<string, any>
  }) => {
    const details = data.details ? ` ${JSON.stringify(data.details)}` : ''
    const line = `[Webview ${data.level || 'debug'}] ${data.message}${details}`
    switch (data.level) {
      case 'warn':
        Channel.warn(line)
        break
      case 'error':
        Channel.error(line)
        break
      case 'info':
        Channel.info(line)
        break
      default:
        Channel.debug(line)
        break
    }
    return true
  },
  /* -------------- reload webview -------------- */
  [CmdToVscode.reload_webview]: async () => {
    const data = await commands.executeCommand('workbench.action.webview.reloadWebviewAction')
    return data
  },
  /* -------------- 获取图片信息 -------------- */
  [CmdToVscode.get_image_info]: async (
    options: {
      glob: string | string[]
      cwd: string
    },
    imageManagerPanel: ImageManagerPanel,
  ) => {
    if (imageManagerPanel.isDisposed) {
      return []
    }

    const { glob, cwd } = options

    // 指定 glob 时保留旧的递归扫描能力（搜索/刷新局部范围会用到）。
    // 初始打开面板不再走这里，避免远程深目录在首屏前全量遍历。
    const start = performance.now()

    // 优先命中模块级缓存，避免在 SSHFS / 慢盘 / 大目录上重复执行 globby。
    // 命中类型：memo=已缓存命中；inflight=同一 (cwd, glob) 正在扫描，复用 Promise；miss=真正发起了一次 IO。
    // 缓存失效由 src/core/watcher.ts 中的 create/change/delete 事件增量维护。
    const { entries: images, hit } = await withGlobbyCache(cwd, glob, () => globby(glob, {
      cwd,
      objectMode: true,
      dot: false,
      absolute: true,
      onlyFiles: true,
      stats: false,
      gitignore: Config.file_gitignore,
      suppressErrors: true,
      throwErrorOnBrokenSymbolicLink: false,
    }))

    Channel.debug(`Glob: ${glob}`)

    Channel.debug(`Globby cost: ${performance.now() - start}ms (${hit})`)

    if (imageManagerPanel.isDisposed) {
      return []
    }

    if (!images.length) {
      logger.debug(`No images found in ${glob}`)
      return []
    }

    // 注意：这里不做 fs.stat / git staged / metadata。SSHFS 上这些都是最容易卡住的远程 IO。
    // 初始列表只需要路径即可先渲染，真实尺寸、mtime、metadata、缩略图都由可见项懒加载。
    return images.map(image => imageFromPath(image.path, cwd, imageManagerPanel, image.stats))
  },

  /* ------------------ 获取图片元信息 ----------------- */
  [CmdToVscode.get_images_extra_info]: async (
    data: {
      images: (string | GlobEntry)[]
    },
    imageManagerPanel: ImageManagerPanel,
  ) => {
    if (imageManagerPanel.isDisposed) {
      return {
        gitStaged: [],
        metadataResults: [],
      }
    }

    const { images } = data
    const [gitStaged, metadataResults] = await Promise.all([
      VscodeMessageFactory[CmdToVscode.get_git_staged_images]({}, imageManagerPanel),
      VscodeMessageFactory[CmdToVscode.get_images_metadata]({
        images,
      }, imageManagerPanel),
    ])

    return {
      gitStaged,
      metadataResults,
    }
  },

  /* -------------- 获取cwds下的所有图片 -------------- */
  [CmdToVscode.get_all_images_from_cwds]: async (
    data: {
      glob?: string
      refresh?: boolean
    } = {},
    imageManagerPanel: ImageManagerPanel,
  ) => {
    const workspaces = imageManagerPanel.initialData.rootpaths || []

    const { glob } = data

    const abortKey = imageManagerPanel.id + (glob || '-')

    const disposable = imageManagerPanel.onDidChange((e) => {
      if (!e) {
        cancelablePromise.abortPromiseMap.get(abortKey)?.abort()
      }
    })

    const start = performance.now()
    try {
      await cancelablePromise.run(
        () => {
          const controller = cancelablePromise.abortPromiseMap.get(abortKey)
          return Promise.all(
            workspaces.map(async (absWorkspaceFolder) => {
              if (controller?.signal.aborted || imageManagerPanel.isDisposed) {
                return
              }

              absWorkspaceFolder = slashPath(absWorkspaceFolder)
              const workspaceFolder = path.basename(absWorkspaceFolder)

              if (!glob) {
                if (data.refresh) {
                  resetNonEssentialIo(`refresh:${absWorkspaceFolder}`)
                  clearDirectorySnapshotCachesForCwd(absWorkspaceFolder)
                  clearGlobbyCacheByCwd(absWorkspaceFolder)
                }
                const revealDirs = getRevealDirs(absWorkspaceFolder, imageManagerPanel.initialData.imageReveal)
                const payloads = await getDirectoryChildrenPayloads(
                  {
                    cwd: absWorkspaceFolder,
                    dirPath: absWorkspaceFolder,
                    imageLimit: DIRECTORY_IMAGE_PAGE_SIZE,
                    includeImages: true,
                    panelId: imageManagerPanel.id,
                    preferFresh: true,
                    priority: 'click',
                    reason: 'unknown',
                    refresh: data.refresh,
                    signal: controller?.signal,
                    timeoutMs: DIRECTORY_USER_READ_TIMEOUT,
                  },
                  imageManagerPanel,
                )

                if (controller?.signal.aborted || imageManagerPanel.isDisposed) {
                  return
                }

                const unique = uniquePayloads(payloads)
                postWorkspaceUpdate(imageManagerPanel, {
                  updateType: UpdateType.full,
                  payloads: unique,
                  workspaceFolder,
                  absWorkspaceFolder,
                })

                const [, ...preferredDirs] = revealDirs
                if (preferredDirs.length) {
                  await hydrateWorkspaceDirectoryFirst(
                    absWorkspaceFolder,
                    workspaceFolder,
                    revealDirs,
                    imageManagerPanel,
                    controller?.signal,
                  )
                }

                Channel.debug(
                  `Directory-first load cost: ${performance.now() - start}ms `
                  + `(workspace=${workspaceFolder}, dirs=${revealDirs.length}, payloads=${unique.length})`,
                )
                return
              }

              const { allImagePatterns } = imageGlob({
                cwds: [glob || absWorkspaceFolder],
                scan: getCustomFormatScanExtensions(Config.file_scan, Config.file_customFormats),
                exclude: Config.file_exclude,
              })

              const images = await VscodeMessageFactory[CmdToVscode.get_image_info](
                {
                  glob: allImagePatterns,
                  cwd: absWorkspaceFolder,
                },
                imageManagerPanel,
              )

              if (controller?.signal.aborted || imageManagerPanel.isDisposed) {
                return
              }

              if (glob) {
                postWorkspaceUpdate(imageManagerPanel, {
                  updateType: UpdateType.patch,
                  payloads: imagePayloads(images),
                  workspaceFolder,
                  absWorkspaceFolder,
                })
              }
            }),
          )
        },
        {
          key: abortKey,
        },
      )

      Channel.debug(`Get all images cost: ${performance.now() - start}ms`)
      return true
    }
    catch (e) {
      if (e instanceof AbortError) {
        Channel.debug(`Get all images aborted: panel=${imageManagerPanel.id}`)
        return false
      }
      logger.error(e)
      return false
    }
    finally {
      disposable.dispose()
    }
  },

  [CmdToVscode.get_directory_children]: async (
    data: {
      dirPath: string
      cwd: string
      imageOffset?: number
      imageLimit?: number
      includeImages?: boolean
      refresh?: boolean
      requestReason?: DirectoryRequestReason
      priority?: DirectoryIoPriority
    },
    imageManagerPanel: ImageManagerPanel,
    message?: MessageType,
  ) => {
    if (imageManagerPanel.isDisposed) {
      return {
        childrenLoaded: false,
        ok: false,
        count: 0,
        timeout: true,
      } satisfies DirectoryChildrenResult
    }

    const cwd = slashPath(data.cwd)
    const dirPath = slashPath(data.dirPath || cwd)
    const workspaceFolder = path.basename(cwd)
    const start = performance.now()
    const includeImages = data.includeImages ?? true
    const { offset: imageOffset, limit: imageLimit } = normalizeImagePage(data.imageOffset, data.imageLimit)
    const isExplicitImageRequest = data.includeImages === true
    const isImagePageRequest = isExplicitImageRequest || (includeImages && imageOffset > 0)
    const requestReason: DirectoryRequestReason = data.requestReason || 'unknown'
    const priority: DirectoryIoPriority = data.priority
      ?? (isImagePageRequest ? 'background' : (requestReason === 'click-toggle' ? 'click' : 'normal'))
    const traceId = message?.traceId || message?.msgId || nanoid()
    const requestKey = directoryChildrenRequestKey(
      imageManagerPanel.id,
      cwd,
      dirPath,
      includeImages,
      imageOffset,
      imageLimit,
    )
    const existingRequest = !data.refresh ? directoryChildrenRequestInflight.get(requestKey) : undefined
    if (existingRequest && Date.now() - existingRequest.startedAt < DIRECTORY_USER_READ_TIMEOUT) {
      Channel.debug(`directory request joined trace=${traceId} inflight=${requestKey} reason=${requestReason} priority=${priority}`)
      return await existingRequest.promise
    }
    if (existingRequest) {
      directoryChildrenRequestInflight.delete(requestKey)
    }
    const backgroundIo = isImagePageRequest
      ? startBackgroundIo('directory-page', DIRECTORY_PAGE_READ_TIMEOUT)
      : undefined
    if (priority === 'click' && !isImagePageRequest) {
      abortBackgroundIoForForegroundDirectory(dirPath)
      directoryIoPool?.cancelNonClickTasks(`foreground-click:${dirPath}`, { exceptDirPath: dirPath })
    }
    cancelablePromise.abortPromiseMap.get(`${imageManagerPanel.id}:warmup:${cwd}`)?.abort()

    // 用户主动 click 时，取消同 panel 中尚在跑的所有 worker 目录读取
    // —— 等价于"我已经不再关心之前那个目录了，把 worker 让出来"。
    // 这是主流文件管理器的"导航即取消"语义，避免新点击被旧 readdir 卡住。
    if (priority === 'click' && !isImagePageRequest && imageManagerPanel.id) {
      cancelDirectoryIoForPanel(imageManagerPanel.id, `superseded-by-click:${dirPath}`)
    }

    Channel.debug(
      `directory request received trace=${traceId} callback=${message?.callbackId || ''} `
      + `(dir=${dirPath}, offset=${imageOffset}, limit=${imageLimit}, refresh=${!!data.refresh}, `
      + `includeImages=${includeImages}, explicitImageRequest=${isExplicitImageRequest}, reason=${requestReason}, priority=${priority})`,
    )

    const runRequest = async (): Promise<DirectoryChildrenResult> => {
      let payloads: UpdatePayload[]
      // 注：之前这里有一个 250ms 后回送 "loadingChildren=true" 的兜底 patch，已删除。
      // 原因：前端在 loadDirectoryChildren 入口已 patchDirectoryLoading(true)，
      // 后端再发一遍只是冗余 round-trip；worker 池下大多数读取 < 50ms，根本不需要兜底。
      const loadingPatchPosted = false

      try {
        Channel.debug(
          `directory request payload build start trace=${traceId} `
          + `(dir=${dirPath}, offset=${imageOffset}, limit=${imageLimit}, includeImages=${includeImages}, `
          + `explicitImageRequest=${isExplicitImageRequest}, refresh=${!!data.refresh})`,
        )
        payloads = await getDirectoryChildrenPayloads(
          {
            cwd,
            dirPath,
            imageLimit,
            imageOffset,
            includeImages,
            background: isImagePageRequest,
            panelId: imageManagerPanel.id,
            preferFresh: !isImagePageRequest,
            priority,
            reason: requestReason,
            refresh: data.refresh,
            signal: backgroundIo?.signal,
            timeoutMs: isImagePageRequest ? DIRECTORY_PAGE_READ_TIMEOUT : DIRECTORY_USER_READ_TIMEOUT,
            traceId,
          },
          imageManagerPanel,
        )
        const targetDirPayload = payloads.find(payload =>
          payload.origin === UpdateOrigin.dir
          && payload.data.payload.absDirPath === dirPath,
        )
        const targetDirData = targetDirPayload?.origin === UpdateOrigin.dir ? targetDirPayload.data.payload : undefined
        if (
          !isImagePageRequest
          && imageOffset === 0
          && targetDirData?.childrenLoaded
          && (targetDirData.directFolderCount || 0) > 0
          && !imageManagerPanel.isDisposed
        ) {
          const snapshot = getCachedDirectorySnapshot(cwd, dirPath)
          if (snapshot) {
            scheduleDirectoryLookaheadPayloads(snapshot, {
              cwd,
              dirPath,
              traceId,
            }, imageManagerPanel)
          }
        }
        const dirPayloadCount = payloads.filter(payload => payload.origin === UpdateOrigin.dir).length
        const imagePayloadCount = payloads.filter(payload => payload.origin === UpdateOrigin.image).length
        Channel.debug(
          `directory request payload build finish trace=${traceId} `
          + `(dir=${dirPath}, payloads=${payloads.length}, dirPayloads=${dirPayloadCount}, imagePayloads=${imagePayloadCount})`,
        )
        if (!isImagePageRequest && !payloads.some(payload => payload.origin === UpdateOrigin.dir && payload.data.payload.absDirPath === dirPath)) {
          Channel.warn(`directory request target payload missing before fallback trace=${traceId} (dir=${dirPath})`)
          payloads.unshift(directoryPayload(dirPath, cwd, {
            canLoadChildren: true,
            childrenLoaded: false,
            imagesLoaded: false,
            loadingChildren: false,
            type: UpdateEvent.update,
          }))
        }
      }
      catch (err) {
        if (err instanceof AbortError || (err instanceof Error && err.name === 'AbortError')) {
          Channel.debug(`directory request cancelled trace=${traceId} dir=${dirPath} reason=${err.message || 'aborted'}`)
          return {
            childrenLoaded: false,
            ok: false,
            count: 0,
            pending: false,
            timeout: false,
          }
        }
        Channel.error(err)
        payloads = [
          directoryPayload(dirPath, cwd, {
            canLoadChildren: true,
            childrenLoaded: false,
            imagesLoaded: false,
            loadingChildren: false,
            type: UpdateEvent.update,
          }),
        ]
      }
      finally {
        backgroundIo?.dispose()
      }

      postWorkspaceUpdate(imageManagerPanel, {
        updateType: UpdateType.patch,
        payloads,
        workspaceFolder,
        absWorkspaceFolder: cwd,
        traceId,
      })

      const dirPayload = payloads.find(payload =>
        payload.origin === UpdateOrigin.dir
        && payload.data.payload.absDirPath === dirPath,
      )
      const dirData = dirPayload?.origin === UpdateOrigin.dir ? dirPayload.data.payload : undefined
      const childDirPayloadCount = payloads.filter(payload =>
        payload.origin === UpdateOrigin.dir
        && payload.data.payload.absDirPath !== dirPath,
      ).length
      const imagePayloadCount = payloads.filter(payload => payload.origin === UpdateOrigin.image).length
      Channel.debug(
        `get_directory_children cost: ${performance.now() - start}ms trace=${traceId} `
        + `(dir=${dirPath}, offset=${imageOffset}, limit=${imageLimit}, childrenLoaded=${!!dirData?.childrenLoaded}, `
        + `loadingChildren=${!!dirData?.loadingChildren}, directFolders=${dirData?.directFolderCount ?? 'n/a'}, `
        + `directImages=${dirData?.directImageCount ?? 'n/a'}, loadedImages=${dirData?.loadedImageCount ?? 'n/a'}, `
        + `canLoadMoreImages=${dirData?.canLoadMoreImages ?? 'n/a'}, imagesLoaded=${dirData?.imagesLoaded ?? 'n/a'}, `
        + `loadingPatchPosted=${loadingPatchPosted}, dirPayloadFound=${!!dirData}, childDirPayloads=${childDirPayloadCount}, `
        + `images=${imagePayloadCount}, payloads=${payloads.length})`,
      )
      const hasVisiblePage = (dirData?.loadedImageCount || 0) > 0
        || payloads.some(payload =>
          payload.origin === UpdateOrigin.dir
          && payload.data.payload.absDirPath !== dirPath,
        )
      const ok = payloads.some(payload =>
        payload.origin === UpdateOrigin.dir
        && payload.data.payload.absDirPath === dirPath
        && (payload.data.payload.childrenLoaded || hasVisiblePage),
      )
      Channel.debug(
        `directory request result trace=${traceId} `
        + `(dir=${dirPath}, ok=${ok}, hasVisiblePage=${hasVisiblePage}, dirPayloadFound=${!!dirData})`,
      )

      return {
        childrenLoaded: !!dirData?.childrenLoaded,
        ok,
        count: payloads.length,
        directFolderCount: dirData?.directFolderCount,
        directImageCount: dirData?.directImageCount,
        canLoadMoreImages: dirData?.canLoadMoreImages,
        imagesLoaded: dirData?.imagesLoaded,
        loadedImageCount: dirData?.loadedImageCount,
        pending: false,
        timeout: !ok,
      }
    }

    // 前台目录展开（非图片分页）= 用户导航。打点让重 IO（缩略图/metadata/base64）让路，
    // 避免它们在用户点目录的同一刻占满单条 SSH 连接。图片分页本身是 background，不打点。
    const isNavigation = !isImagePageRequest
    if (isNavigation) {
      beginDirectoryNavigation()
    }
    const requestPromise = runRequest()
    if (!data.refresh) {
      directoryChildrenRequestInflight.set(requestKey, { promise: requestPromise, startedAt: Date.now() })
    }
    try {
      return await requestPromise
    }
    finally {
      if (isNavigation) {
        endDirectoryNavigation()
      }
      if (!data.refresh) {
        const current = directoryChildrenRequestInflight.get(requestKey)
        if (current?.promise === requestPromise) {
          directoryChildrenRequestInflight.delete(requestKey)
        }
      }
    }
  },

  [CmdToVscode.warmup_directory_tree]: async (
    data: {
      cwd: string
      startDirs?: string[]
      maxDepth?: number
      imageDepth?: number
      reason?: string
      targets?: DirectoryWarmupTarget[]
    },
    imageManagerPanel: ImageManagerPanel,
  ) => {
    if (DIRECTORY_EXPAND_DISABLE_WARMUP || shouldDisableNonEssentialDirectoryWork()) {
      Channel.debug(`Warmup directory tree disabled: cwd=${slashPath(data.cwd)}`)
      return false
    }

    const cwd = slashPath(data.cwd)
    const workspaceFolder = path.basename(cwd)
    const abortKey = `${imageManagerPanel.id}:warmup:${cwd}`
    const rawTargets = data.targets?.length
      ? data.targets
      : [{
          imageDepth: data.imageDepth,
          maxDepth: data.maxDepth,
          reason: data.reason,
          startDirs: data.startDirs,
        }]
    const targets = normalizeWarmupTargets(rawTargets)

    if (!targets.length) {
      Channel.debug(`Warmup directory tree skipped: cwd=${cwd}, no safe targets`)
      return false
    }

    try {
      const targetSummary = targets.map((target) => {
        const maxDepth = target.maxDepth ?? DIRECTORY_WARMUP_MAX_DEPTH
        const startDirs = target.startDirs?.length ?? 0
        return `${target.reason || 'default'}:${startDirs}@${maxDepth}`
      }).join(',')
      Channel.debug(
        `Warmup directory tree start: cwd=${cwd}, targets=${targets.length}, ${targetSummary}`,
      )
      await cancelablePromise.run(
        async () => {
          const controller = cancelablePromise.abortPromiseMap.get(abortKey)
          for (const target of targets) {
            if (controller?.signal.aborted) {
              break
            }
            const stats = await warmupDirectoryTree(
              cwd,
              imageManagerPanel,
              (payloads) => {
                postWorkspaceUpdate(imageManagerPanel, {
                  updateType: UpdateType.patch,
                  payloads,
                  workspaceFolder,
                  absWorkspaceFolder: cwd,
                })
              },
              {
                imageDepth: target.imageDepth ?? DIRECTORY_WARMUP_IMAGE_DEPTH,
                maxDepth: target.maxDepth ?? DIRECTORY_WARMUP_MAX_DEPTH,
                signal: controller?.signal,
                startDirs: target.startDirs,
              },
            )
            Channel.debug(
              `Warmup directory tree finish: cwd=${cwd}, reason=${target.reason || data.reason || 'default'}, `
              + `status=${stats.reason}, dirs=${stats.processedDirs}, batches=${stats.processedBatches}, `
              + `queued=${stats.queuedDirs}, aborted=${stats.aborted}`,
            )
          }
        },
        {
          key: abortKey,
        },
      )
    }
    catch (err) {
      if (err instanceof AbortError) {
        Channel.debug(`Warmup directory tree aborted: cwd=${cwd}`)
        return false
      }
      throw err
    }

    return true
  },

  /* --------------- 获取指定图片 -------------- */
  [CmdToVscode.get_images]: async (
    data: {
      filePaths: string[]
      cwd: string
    },
    imageManagerPanel: ImageManagerPanel,
  ) => {
    const { filePaths, cwd } = data
    if (imageManagerPanel.isDisposed) {
      return []
    }

    // 历史实现是把 filePaths 转成 glob，再走一次 globby+stats:true，
    // 这在 SSHFS 上会跟主扫描挤同一条 SSH 连接，每张图都要等几分钟。
    // watcher 的 onDidChange/onDidCreate 会以单文件粒度调用这里，所以必须避免触发 globby。
    // 改为直接 fs.stat 每个文件，并复用 get_image_info 的格式化逻辑（用 GlobEntry 形态包一下）。
    const start = performance.now()

    const results = await pMap(
      filePaths,
      async (filePath): Promise<ImageType | undefined> => {
        if (imageManagerPanel.isDisposed) {
          return undefined
        }
        try {
          const stats = await fs.stat(filePath).catch(() => undefined)
          return imageFromPath(filePath, cwd, imageManagerPanel, stats)
        }
        catch {
          // 文件可能在 watcher 触发后被快速删除/移走
          return undefined
        }
      },
      { concurrency: 8 },
    )

    Channel.debug(`get_images cost: ${performance.now() - start}ms (n=${filePaths.length})`)

    return results.filter((x): x is ImageType => !!x)
  },

  /* ------- get extension & vscode config ------ */
  [CmdToVscode.get_extension_config]: async () => {
    const config = Config.all

    const vscodeConfig = {
      theme: Global.vscodeTheme,
      language: Global.vscodeLanguage,
      reduceMotion: Global.vscodeReduceMotion,
    }

    return {
      ext: config,
      vscode: vscodeConfig,
    }
  },

  /* ----------- get compressor ---------- */
  [CmdToVscode.get_compressor]: async (_, imageManagerPanel: ImageManagerPanel) => {
    let compressor = new UsualCompressor(Config.compression, imageManagerPanel)
    const { option, limit } = compressor
    // @ts-expect-error Garbage collection
    compressor = null
    return {
      option,
      limit,
    }
  },

  /* ----------- get format converter ----------- */
  [CmdToVscode.get_format_converter]: async (_, imageManagerPanel: ImageManagerPanel) => {
    let converter = new FormatConverter(Config.conversion, imageManagerPanel)
    const { option, limit } = converter
    // @ts-expect-error Garbage collection
    converter = null
    return {
      option,
      limit,
    }
  },

  /* ------- open path in vscode explorer ------ */
  [CmdToVscode.open_image_in_vscode_explorer]: (data: { filePath: string }) => {
    const res = commands.executeCommand('revealInExplorer', Uri.file(data.filePath))
    return res
  },

  /* --------- open path in os explorer -------- */
  [CmdToVscode.open_image_in_os_explorer]: async (data: { filePath: string }) => {
    const { filePath } = data
    let revealPath = filePath
    if (Config.file_revealFileInOsDeeply) {
      try {
        const files = fs.readdirSync(revealPath)
        revealPath = path.join(revealPath, files[0])
      }
      catch {}
    }

    const res = await commands.executeCommand('revealFileInOS', Uri.file(revealPath))
    return res
  },

  /* ------------ copy image as base64 --------- */
  [CmdToVscode.copy_image_as_base64]: async (
    data: { delivery?: 'data-url' | 'uri', filePath: string, priority?: Base64RequestPriority },
    imageManagerPanel?: ImageManagerPanel,
  ) => {
    const { delivery = 'data-url', filePath, priority = 'normal' } = data
    if (!filePath) {
      Channel.warn('copy_image_as_base64 skipped: empty filePath')
      return ''
    }

    if (priority === 'high') {
      requestBackgroundIoAbort(`preview-base64:${filePath}`)
      cancelThumbnailWork(`preview-base64:${filePath}`)
      await waitForSharpQuiet(600)
    }

    await waitForForegroundDirectoryIo()

    const start = performance.now()
    try {
      const browserNative = isBrowserSupportImageType(filePath).suppprted
        && !isLikelyCustomImageFile(filePath, Config.file_customFormats)
      if (delivery === 'data-url' && browserNative) {
        const dataUrl = await withTimeout(
          convertImageToBase64(filePath, Global.sharp),
          COPY_BASE64_TIMEOUT,
          null,
        )
        if (dataUrl === null) {
          Channel.warn(`copy_image_as_base64 timed out: ${filePath} (${COPY_BASE64_TIMEOUT}ms)`)
          return ''
        }
        return dataUrl
      }
      const preview = await withTimeout(
        previewSourceForWebview(filePath, imageManagerPanel, delivery),
        COPY_BASE64_TIMEOUT,
        null,
      )
      if (!preview) {
        Channel.warn(`copy_image_as_base64 preview cache missed: ${filePath} delivery=${delivery} cost=${performance.now() - start}ms`)
        return ''
      }
      Channel.debug(
        `copy_image_as_base64 preview ${delivery}: ${filePath} priority=${priority} cost=${performance.now() - start}ms len=${preview.length}`,
      )
      return preview
    }
    catch (e) {
      Channel.error(
        `copy_image_as_base64 fail: ${filePath} priority=${priority} cost=${performance.now() - start}ms err=${toString(e)}`,
      )
      Channel.error(`${i18n.t('core.copy_base64_error')}: ${toString(e)}`)
      return ''
    }
  },

  [CmdToVscode.focus_preview_image]: async (data: { filePath?: string }) => {
    const filePath = data?.filePath || ''
    requestBackgroundIoAbort(`preview-focus:${filePath}`)
    cancelThumbnailWork(`preview-focus:${filePath}`)
    await waitForSharpQuiet(400)
    Channel.debug(`focus_preview_image: ${filePath}`)
    return true
  },

  /* ------------ get image histogram --------- */
  [CmdToVscode.get_image_histogram]: async (data: { filePath: string }, imageManagerPanel: ImageManagerPanel) => {
    if (imageManagerPanel.isDisposed)
      return null
    const { filePath } = data
    if (!Global.sharp)
      return null
    // 同样让路给目录导航，并加硬超时，避免直方图的全图解码占满单连接。
    await waitForForegroundDirectoryIo()
    const result = await withTimeout(
      getImageHistogram(filePath, Global.sharp),
      HISTOGRAM_TIMEOUT,
      null,
    )
    if (result === null) {
      Channel.warn(`get_image_histogram timed out: ${filePath} (${HISTOGRAM_TIMEOUT}ms)`)
    }
    return result
  },

  [CmdToVscode.decode_image_for_preview]: async (data: {
    delivery?: 'data-url' | 'uri'
    filePath: string
    options?: Parameters<typeof decodeCustomImage>[1]
  }, imageManagerPanel?: ImageManagerPanel) => {
    const { delivery = 'uri', filePath, options } = data
    try {
      Channel.debug(`[custom-format] decode request: ${filePath} options=${JSON.stringify(options || {})}`)
      const result = await decodeCustomImage(filePath, options, Config.file_customFormats, Global.sharp)
      const previewSrc = await previewSourceForWebview(filePath, imageManagerPanel, delivery, options, result)
      Channel.debug(
        `[custom-format] decoded preview: ${filePath} ${result.width}x${result.height} ${result.dtype} `
        + `layout=${result.layout} axes=${result.axes.join('')} shape=${result.shape.join('x')} `
        + `page=${result.pageIndex + 1}/${result.pageCount} channelMode=${result.channelMode} `
        + `channels=${result.channels} min=${result.min} max=${result.max}`,
      )
      return {
        ...toCustomImageProbe(result),
        previewSrc,
      }
    }
    catch (err) {
      Channel.warn(`[custom-format] decode failed: ${filePath} (${err instanceof Error ? err.message : String(err)})`)
      return {
        error: err instanceof Error ? err.message : toString(err),
      }
    }
  },

  [CmdToVscode.probe_custom_image]: async (data: {
    filePath: string
    options?: Parameters<typeof decodeCustomImage>[1]
  }) => {
    const { filePath, options } = data
    try {
      Channel.debug(`[custom-format] probe request: ${filePath} options=${JSON.stringify(options || {})}`)
      const result = await decodeCustomImage(filePath, options, Config.file_customFormats, Global.sharp)
      Channel.debug(
        `[custom-format] probe ok: ${filePath} ${result.layout} ${result.width}x${result.height} `
        + `${result.dtype} axes=${result.axes.join('')} shape=${result.shape.join('x')} `
        + `page=${result.pageIndex + 1}/${result.pageCount} channelMode=${result.channelMode} `
        + `channels=${result.channels} min=${result.min} max=${result.max}`,
      )
      return toCustomImageProbe(result)
    }
    catch (err) {
      Channel.warn(`[custom-format] probe failed: ${filePath} (${err instanceof Error ? err.message : String(err)})`)
      return {
        error: err instanceof Error ? err.message : toString(err),
      }
    }
  },

  /* -------------- compress image -------------- */
  [CmdToVscode.compress_image]: async (
    data: {
      images: ImageType[]
      option: CompressionOptions
    },
    imageManagerPanel: ImageManagerPanel,
  ): Promise<
    | OperatorResult[]
    | {
      error: string
    }
  > => {
    try {
      const { images, option } = data
      const start = performance.now()
      Channel.debug(
        `[tools] compress command start count=${images.length} outputDir=${option?.outputDir || ''} `
        + `paths=${images.slice(0, 5).map(image => image.path).join('|')}`,
      )

      const svgs: ImageType[] = []
      const usuals: ImageType[] = []

      images.forEach((item) => {
        const filePath = item.path
        if (path.extname(filePath) === '.svg') {
          svgs.push(item)
        }
        else {
          usuals.push(item)
        }
      })

      const res = await pMap(
        [
          ...usuals.map(image => () => {
            let compressor = new UsualCompressor(option, imageManagerPanel)
            try {
              return compressor.run(image, option)
            }
            finally {
              // @ts-expect-error Garbage collection
              compressor = null
            }
          }),
          ...svgs.map(image => () => {
            let compressor = new SvgCompressor(option, imageManagerPanel)
            try {
              return compressor.run(image, option)
            }
            finally {
              // @ts-expect-error Garbage collection
              compressor = null
            }
          }),
        ],
        task => task(),
      )

      Channel.debug(
        `[tools] compress command done count=${images.length} results=${res.length} `
        + `cost=${(performance.now() - start).toFixed(0)}ms errors=${res.filter(item => item.error).length}`,
      )
      return res
    }
    catch (e: any) {
      logger.error(`${i18n.t('core.compress_error')}`, e)
      return {
        error: e instanceof Error ? e.message : toString(e),
      }
    }
  },

  /* ----------- convert image format ----------- */
  [CmdToVscode.convert_image_format]: async (
    data: {
      images: ImageType[]
      option: FormatConverterOptions
    },
    imageManagerPanel: ImageManagerPanel,
  ): Promise<
    | OperatorResult[]
    | {
      error: string
    }
  > => {
    try {
      const { images, option } = data
      const start = performance.now()
      Channel.debug(
        `[tools] convert command start count=${images.length} format=${option?.format || ''} outputDir=${option?.outputDir || ''} `
        + `paths=${images.slice(0, 5).map(image => image.path).join('|')}`,
      )
      const res = await pMap(
        images.map(image => () => {
          let converter = new FormatConverter(Config.conversion, imageManagerPanel)
          try {
            return converter.run(image, option)
          }
          finally {
            // @ts-expect-error Garbage collection
            converter = null
          }
        }),
        task => task(),
      )

      Channel.debug(
        `[tools] convert command done count=${images.length} results=${res.length} `
        + `cost=${(performance.now() - start).toFixed(0)}ms errors=${res.filter(item => item.error).length}`,
      )
      return res
    }
    catch (e: any) {
      logger.error('Convert Error', e)
      return {
        error: e instanceof Error ? e.message : toString(e),
      }
    }
  },

  /* -------------- undo operation -------------- */
  [CmdToVscode.undo_operation]: async (data: {
    /**
     * 操作id
     */
    id: string
  }) => {
    const { id } = data
    try {
      await commandCache.executeUndo(id)
      return true
    }
    catch (e: any) {
      return {
        error: e instanceof Error ? e.message : toString(e),
      }
    }
  },

  /* ------ delete operation command cache ------ */
  [CmdToVscode.remove_operation_cmd_cache]: async (data: { ids: string[] }) => {
    for (const id of data.ids) {
      commandCache.remove(id)
    }
  },

  /* ------- clear operation command cache ------ */
  [CmdToVscode.clear_operation_cmd_cache]: async () => {
    commandCache.clear()
    Similarity.clearCache()
  },

  /* ---------------- 获取操作缓存 ---------------- */
  [CmdToVscode.get_operation_cmd_cache]: (data: { ids: string[] }) => {
    const { ids } = data
    return ids.map(id => commandCache.get(id))
  },

  /* --------- 把缓存中的inputBuffer转为base64 --------- */
  [CmdToVscode.get_cmd_cache_inputBuffer_as_base64]: (data: { id: string }) => {
    const cache = VscodeMessageFactory[CmdToVscode.get_operation_cmd_cache]({ ids: [data.id] })[0]
    const { details } = cache || {}
    if (details?.inputBuffer) {
      return bufferTobase64(details.inputBuffer, details.inputPath, Global.sharp)
    }
    return null
  },

  /* -------- match glob with micromatch -------- */
  [CmdToVscode.micromatch_ismatch]: (data: { filePaths: string[], globs: string[], not?: boolean }) => {
    let { filePaths, globs, not } = data

    globs = convertPatternToGlob(globs)

    if (not) {
      return micromatch.not(filePaths, globs)
    }
    return micromatch(filePaths, globs)
  },

  /* --------- save cropper image to file -------- */
  [CmdToVscode.save_cropper_image]: async (data: {
    dataUrl: string
    image: ImageType
  }): Promise<{ filename: string } | null> => {
    const { dataUrl, image } = data

    const [mimeType, base64] = dataUrl.split(',')

    const imageBuffer = Buffer.from(base64, 'base64')

    const outputFileType = mime.getExtension(mimeType.match(/data:(.*);/)?.[1] || '')

    let outputPath = image.path.replace(new RegExp(`\\.${image.extname}$`), `.${outputFileType}`)

    outputPath = generateOutputPath(outputPath, '.crop')

    if (outputFileType !== image.extname) {
      // Convert to the same format as the original image
      let formatter: SharpOperator<{
        filePath: string
        ext: string
      }> = new SharpOperator({
        plugins: [
          {
            name: 'toFormat',
            hooks: {
              'before:run': async ({ sharp, runtime }) => {
                const { ext } = runtime
                sharp?.toFormat(ext as keyof SharpNS.FormatEnum)
              },
              'on:generate-output-path': () => {
                return outputPath
              },
            },
          },
        ],
      })
      try {
        await formatter.run({ filePath: image.path, ext: outputFileType || image.extname, input: imageBuffer })
      }
      catch (e) {
        Channel.error(`${i18n.t('core.save_cropper_image_error')} ${e}`)
        return null
      }
      finally {
        // @ts-expect-error Garbage collection
        formatter = null
      }
    }
    else {
      // Write image output directly
      try {
        await fs.writeFile(outputPath, imageBuffer)
      }
      catch (e) {
        Channel.error(`${i18n.t('core.save_cropper_image_error')} ${e}`)
        return null
      }
    }

    const filename = path.basename(outputPath)

    return {
      filename,
    }
  },

  [CmdToVscode.save_edited_image]: async (data: {
    dataUrl: string
    image: ImageType
    prompt?: boolean
    suffix?: string
  }): Promise<{ filename: string, path: string } | null> => {
    const { dataUrl, image, prompt = false, suffix = '.edited' } = data
    try {
      const [, base64] = dataUrl.split(',')
      const imageBuffer = Buffer.from(base64 || '', 'base64')
      const mimeType = dataUrl.match(/data:(.*);/)?.[1] || 'image/png'
      const outputFileType = mime.getExtension(mimeType) || image.extname || 'png'
      let outputPath = image.path.replace(new RegExp(`\\.${image.extname}$`), `.${outputFileType}`)
      outputPath = generateOutputPath(outputPath, suffix)
      if (prompt) {
        const selected = await window.showSaveDialog({
          defaultUri: Uri.file(outputPath),
          filters: {
            Images: [outputFileType],
          },
          saveLabel: 'Download',
          title: 'Download Edited Image',
        })
        if (!selected)
          return null
        outputPath = selected.fsPath
      }
      if (outputFileType === image.extname && !isLikelyCustomImageFile(image.path, Config.file_customFormats)) {
        await fs.writeFile(outputPath, imageBuffer)
      }
      else {
        await Global.sharp(imageBuffer).toFormat(outputFileType as keyof SharpNS.FormatEnum).toFile(outputPath)
      }
      Channel.debug(`[editor] saved edited image: ${outputPath}`)
      return {
        filename: path.basename(outputPath),
        path: outputPath,
      }
    }
    catch (err) {
      Channel.error(`[editor] save_edited_image failed: ${err instanceof Error ? err.message : String(err)}`)
      return null
    }
  },

  /* --------- find similar images -------- */
  [CmdToVscode.find_similar_images]: async (data: {
    algorithm?: SimilarityOptions['algorithm']
    image: ImageType
    maxResults?: number
    requestId?: string
    scope: ImageType[]
    sliceStrategy?: SimilarityOptions['sliceStrategy']
    threshold?: number
  }, imageManagerPanel?: ImageManagerPanel) => {
    const { algorithm, image, maxResults, scope, sliceStrategy, threshold } = data
    const requestId = data.requestId || nanoid()
    const panelKey = similarityPanelKey(imageManagerPanel)
    const controller = activeSimilarityRequests.start(panelKey, requestId)
    const publishProgress = createSimilarityProgressPublisher(imageManagerPanel)
    try {
      Channel.debug(
        `[similarity] command image=${image.path} scope=${scope.length} algorithm=${algorithm || 'hybrid'} `
        + `threshold=${threshold ?? 'default'} maxResults=${maxResults ?? 'default'} sliceStrategy=${sliceStrategy || 'first'} requestId=${requestId}`,
      )
      return await Similarity.findSimilar(image, scope, {
        algorithm,
        maxResults,
        onProgress: publishProgress,
        requestId,
        signal: controller.signal,
        sliceStrategy,
        threshold,
      })
    }
    catch (e) {
      return e instanceof Error ? e : toString(e)
    }
    finally {
      activeSimilarityRequests.finish(panelKey, controller)
    }
  },

  [CmdToVscode.cancel_find_similar_images]: (data: { requestId?: string }, imageManagerPanel?: ImageManagerPanel) => {
    return cancelSimilarityRequest(similarityPanelKey(imageManagerPanel), data.requestId)
  },

  /* ------------ get images metadata ------------ */
  // Viewport batches only need file size to choose a thumbnail. Directory expansion
  // returns deferred immediately so this does not stat or decode while SSH readdir is active.
  [CmdToVscode.get_images_metadata]: async (data: { images: (string | GlobEntry)[] }, imageManagerPanel?: ImageManagerPanel) => {
    const start = performance.now()
    const { images } = data
    const directoryBusy = DIRECTORY_EXPAND_DISABLE_METADATA
      || shouldDisableNonEssentialDirectoryWork()
      || isForegroundDirectoryIoInFlight()
      || hasRecentForegroundDirectoryIo()
    if (directoryBusy) {
      Channel.debug(`Get images metadata deferred: directory IO active (n=${images.length})`)
      return images.map(deferredImageMetadata)
    }

    try {
      const results = await pMap(
        images,
        async (image) => {
          const filePath = metadataFilePath(image)
          if (imageManagerPanel?.isDisposed) {
            return {
              compressed: Compressed.unknown,
              filePath,
              metadata: {} as Metadata,
            }
          }
          if (isForegroundDirectoryIoInFlight() || hasRecentForegroundDirectoryIo())
            return deferredImageMetadata(image)
          const known = typeof image === 'string' ? undefined : image.stats
          if (known && Number.isFinite(known.size)) {
            return {
              compressed: Compressed.unknown,
              filePath,
              metadata: {} as Metadata,
              stats: { mtimeMs: known.mtimeMs, size: known.size },
            }
          }
          const stat = await withTimeout(fs.stat(filePath), METADATA_STAT_TIMEOUT, null)
          if (!stat)
            return deferredImageMetadata(image)
          return {
            compressed: Compressed.unknown,
            filePath,
            metadata: {} as Metadata,
            stats: { mtimeMs: stat.mtimeMs, size: stat.size },
          }
        },
        { concurrency: 2 },
      )
      Channel.debug(`Get images metadata size-only cost: ${performance.now() - start}ms (n=${images.length})`)
      return results
    }
    catch (err) {
      Channel.debug(`Get images metadata failed: ${err instanceof Error ? err.message : String(err)}`)
      return images.map(deferredImageMetadata)
    }
  },

  /* ------ get one image metadata (lazy/per-image) ------ */
  // 给 webview 在图片真正进入视口时按需调用，避免一次性扫描上万张图。
  // 内部命中 metadataCache (mtimeMs 校验)，所以同一张图反复请求基本零成本。
  [CmdToVscode.get_image_metadata_one]: async (data: { filePath: string }, imageManagerPanel: ImageManagerPanel) => {
    if (imageManagerPanel.isDisposed) {
      return {
        metadata: {} as Metadata,
        compressed: Compressed.unknown,
      }
    }

    const { filePath } = data
    if (DIRECTORY_EXPAND_DISABLE_METADATA || shouldDisableNonEssentialDirectoryWork()) {
      Channel.debug(`Get image metadata one disabled: non-essential work paused (${filePath})`)
      return {
        metadata: {} as Metadata,
        compressed: Compressed.unknown,
      }
    }

    let acquired = false
    const start = performance.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), METADATA_BATCH_TIMEOUT)
    const signal = controller.signal
    try {
      acquired = await acquireSharp(signal)
      if (!acquired) {
        return {
          metadata: {} as Metadata,
          compressed: Compressed.unknown,
        }
      }
      const result = await getImageMetadata(filePath, { signal, skipStat: true, statTimeoutMs: 600 })
      return {
        metadata: {
          width: result.metadata.width,
          height: result.metadata.height,
          channels: result.metadata.channels,
          shape: result.metadata.shape,
        } as Metadata,
        compressed: result.compressed,
        stats: result.stats,
      }
    }
    catch (err) {
      Channel.debug(
        `Get image metadata one failed: ${filePath} `
        + `(${err instanceof Error ? err.message : String(err)}, cost=${(performance.now() - start).toFixed(0)}ms)`,
      )
      return {
        metadata: {} as Metadata,
        compressed: Compressed.unknown,
      }
    }
    finally {
      clearTimeout(timer)
      if (acquired) {
        releaseSharp()
      }
    }
  },

  [CmdToVscode.get_thumbnails]: async (data: { images: string[], maxWidth: number }, imageManagerPanel: ImageManagerPanel) => {
    const { images, maxWidth = 200 } = data
    if (imageManagerPanel.isDisposed)
      return []
    if (!Global.sharp)
      return []
    if (DIRECTORY_EXPAND_DISABLE_THUMBNAILS) {
      Channel.debug(`get_thumbnails disabled: non-essential work paused (n=${images.length}, maxWidth=${maxWidth})`)
      return []
    }

    const workerPool = getThumbnailWorkerPool()
    const sharpPath = workerPool ? getBundledSharpPath() : null
    const useWorker = !!(workerPool && sharpPath)
    Channel.debug(
      `get_thumbnails start build=${THUMBNAIL_DIAGNOSTIC_BUILD} n=${images.length} maxWidth=${maxWidth} `
      + `worker=${useWorker ? 'on' : 'off'} sharpPath=${sharpPath || ''} cacheVersion=${THUMBNAIL_CACHE_VERSION} `
      + `itemTimeout=${THUMBNAIL_ITEM_TIMEOUT}`,
    )
    if (!useWorker) {
      Channel.debug(`get_thumbnails using main-thread fallback (n=${images.length}, maxWidth=${maxWidth})`)
    }

    const backgroundIo = startBackgroundIo('thumbnail', THUMBNAIL_BATCH_TIMEOUT)
    const signal = backgroundIo.signal
    if (isForegroundDirectoryIoInFlight()) {
      if (useWorker) {
        Channel.debug(`get_thumbnails continuing in worker while foreground directory IO is active (n=${images.length})`)
      }
      else if (!await waitForForegroundDirectoryIo(signal, THUMBNAIL_FOREGROUND_WAIT_MS)) {
        Channel.debug(`get_thumbnails proceeding slowly: foreground directory IO active (n=${images.length})`)
      }
    }

    const start = performance.now()

    const thumbDir = path.join(FileCache.cacheDir, 'thumbnails', String(maxWidth))
    try {
      await fs.ensureDir(thumbDir)
    }
    catch {
      backgroundIo.dispose()
      return []
    }

    const hashKey = (filePath: string) => {
      let h = 5381
      for (let i = 0; i < filePath.length; i++) h = ((h << 5) + h + filePath.charCodeAt(i)) | 0
      return (h >>> 0).toString(36)
    }

    const resolveThumbnailCacheInfo = async (filePath: string) => {
      const stat = await withTimeout(fs.stat(filePath), 3_000, null)
      if (!stat)
        return null
      const isCustomImage = isLikelyCustomImageFile(filePath, Config.file_customFormats)
      const cacheIdentity = isCustomImage
        ? customImageCacheKey(filePath, stat, 'thumbnail:first-page', Config.file_customFormats, { pageIndex: 0 })
        : filePath
      const cacheHash = hashKey(cacheIdentity)
      const cacheName = `${path.basename(filePath, path.extname(filePath))}.${cacheHash}.${stat.mtimeMs}.${THUMBNAIL_CACHE_VERSION}.jpg`
      const cachePath = path.join(thumbDir, cacheName)
      return {
        cacheHash,
        cachePath,
        isCustomImage,
        stat,
      }
    }

    const toThumbnailResult = (filePath: string, cachePath: string) => {
      const webviewUri = imageManagerPanel.panel.webview
        .asWebviewUri(Uri.file(slashPath(cachePath)))
        .toString()
      return { filePath, thumbPath: webviewUri }
    }

    const createThumbnailBufferOnMainThread = async (input: string | Buffer, options: { allowDuringForeground?: boolean } = {}) => {
      if (signal.aborted || (!options.allowDuringForeground && isForegroundDirectoryIoInFlight()))
        return null
      const acquired = await acquireSharp(signal)
      if (!acquired)
        return null
      try {
        if (signal.aborted || (!options.allowDuringForeground && isForegroundDirectoryIoInFlight()))
          return null
        if (signal.aborted)
          return null
        return await buildJpegThumbnail(input, Global.sharp!, maxWidth)
      }
      finally {
        releaseSharp()
      }
    }

    const createThumbnailOnMainThread = async (
      filePath: string,
      options: { allowDuringForeground?: boolean, reason?: string } = {},
    ): Promise<{ filePath: string, thumbPath: string } | null> => {
      try {
        const itemStart = performance.now()
        const cacheInfo = await resolveThumbnailCacheInfo(filePath)
        if (imageManagerPanel.isDisposed || signal.aborted)
          return null
        if (!cacheInfo)
          return null
        const { cacheHash, cachePath, isCustomImage, stat } = cacheInfo

        const cacheStat = await fs.stat(cachePath).catch(() => null)
        if (isCustomImage) {
          Channel.debug(
            `[custom-format] thumbnail request: ${filePath} firstPage=0 cacheHit=${!!cacheStat} `
            + `cacheHash=${cacheHash} cachePath=${cachePath}`,
          )
        }
        if (!cacheStat) {
          if (imageManagerPanel.isDisposed || signal.aborted)
            return null
          let thumbBuf: Buffer | null
          if (isCustomImage) {
            Channel.debug(`[custom-format] thumbnail decode first page: ${filePath}`)
            const decoded = await decodeCustomImage(filePath, { pageIndex: 0 }, Config.file_customFormats, Global.sharp)
            Channel.debug(
              `[custom-format] thumbnail decoded: ${filePath} ${decoded.width}x${decoded.height} `
              + `layout=${decoded.layout} axes=${decoded.axes.join('')} shape=${decoded.shape.join('x')} `
              + `page=${decoded.pageIndex + 1}/${decoded.pageCount} channelMode=${decoded.channelMode}`,
            )
            thumbBuf = decoded.pixels?.length
              ? await encodeRawPixelsToJpeg(decoded, Global.sharp!, maxWidth, 'width', 70)
              : null
          }
          else {
            thumbBuf = await createThumbnailBufferOnMainThread(filePath, options)
          }
          if (imageManagerPanel.isDisposed || signal.aborted || !thumbBuf)
            return null
          await fs.writeFile(cachePath, thumbBuf)
          Channel.debug(
            `thumbnail main-thread write ok: ${filePath} reason=${options.reason || 'fallback'} `
            + `bytes=${thumbBuf.length} elapsedMs=${Math.round(performance.now() - itemStart)} cachePath=${cachePath}`,
          )
        }

        if (imageManagerPanel.isDisposed || signal.aborted)
          return null
        return toThumbnailResult(filePath, cachePath)
      }
      catch (err) {
        Channel.debug(
          `thumbnail main-thread item failed: ${filePath} `
          + `(${err instanceof Error ? err.message : String(err)})`,
        )
        return null
      }
    }

    try {
      const results = await pMap(
        images,
        async (filePath, index): Promise<{ filePath: string, thumbPath: string } | null> => {
          if (imageManagerPanel.isDisposed || signal.aborted) {
            return null
          }
          const info = await resolveThumbnailCacheInfo(filePath)
          if (info) {
            const cacheStat = await fs.stat(info.cachePath).catch(() => null)
            if (cacheStat)
              return toThumbnailResult(filePath, info.cachePath)
          }
          if (!useWorker && isForegroundDirectoryIoInFlight()) {
            const ready = await waitForForegroundDirectoryIoInBatch(signal)
            if (!ready) {
              Channel.debug(`thumbnail item deferred: foreground directory IO still active before start (${filePath})`)
              return null
            }
          }
          if (index > 0 && index % 3 === 0) {
            await yieldToEventLoop(2)
          }
          if (imageManagerPanel.isDisposed || signal.aborted) {
            return null
          }
          if (!useWorker && isForegroundDirectoryIoInFlight()) {
            const ready = await waitForForegroundDirectoryIoInBatch(signal)
            if (!ready) {
              Channel.debug(`thumbnail item deferred: foreground directory IO still active after yield (${filePath})`)
              return null
            }
          }
          if (useWorker) {
            const result = await workerPool!.read({
              cacheDir: thumbDir,
              cacheVersion: THUMBNAIL_CACHE_VERSION,
              customFormats: Config.file_customFormats,
              filePath,
              maxWidth,
              sharpPath: sharpPath!,
              sourceMtimeMs: info?.stat.mtimeMs,
              sourceSize: info?.stat.size,
              timeoutMs: Math.min(THUMBNAIL_ITEM_TIMEOUT, THUMBNAIL_BATCH_TIMEOUT),
            })
            if (imageManagerPanel.isDisposed || signal.aborted) {
              return null
            }
            if (!result.ok) {
              // 区分"worker 没能处理"(deadline 卡死 / 崩溃 / 启动超时)和"被正常取消"
              // (导航让路 cancelAll / 面板销毁 / pool disposed)。前者要回退主线程兜底——
              // 万一卡死根因是 worker 线程里 require(sharp) 而非解码本身，主线程(sharp 已加载、
              // normalize 已加硬超时)能出图并写盘缓存，worker 下次在 loadSharp 之前命中缓存即可秒回。
              const workerFailed = !result.cancelled
                || /^(?:deadline|exit|error|worker-ready-timeout)/.test(result.error || '')
              if (workerFailed) {
                Channel.debug(
                  `thumbnail worker item failed: ${filePath} `
                  + `(cancelled=${result.cancelled}, ${result.error}, readMs=${Math.round(result.readMs)})`,
                )
              }
              if (workerFailed && !imageManagerPanel.isDisposed && !signal.aborted) {
                Channel.debug(`thumbnail worker fallback to main-thread: ${filePath}`)
                return await withTimeout(
                  createThumbnailOnMainThread(filePath),
                  Math.min(THUMBNAIL_ITEM_TIMEOUT, THUMBNAIL_BATCH_TIMEOUT),
                  null,
                )
              }
              return null
            }
            const webviewUri = imageManagerPanel.panel.webview
              .asWebviewUri(Uri.file(slashPath(result.cachePath)))
              .toString()
            return { filePath, thumbPath: webviewUri }
          }
          return await withTimeout(
            createThumbnailOnMainThread(filePath),
            Math.min(THUMBNAIL_ITEM_TIMEOUT, THUMBNAIL_BATCH_TIMEOUT),
            null,
          )
        },
        { concurrency: useWorker ? THUMBNAIL_WORKER_POOL_SIZE : 1 },
      )
      const filtered = results.filter((x): x is NonNullable<typeof x> => !!x)
      Channel.debug(
        `get_thumbnails cost: ${performance.now() - start}ms `
        + `(n=${images.length}, returned=${filtered.length}, worker=${useWorker ? 'on' : 'off'}, aborted=${signal.aborted})`,
      )
      return filtered
    }
    finally {
      backgroundIo.dispose()
    }
  },

  /* --------- get git staged images --------- */
  [CmdToVscode.get_git_staged_images]: async (_, imageManagerPanel: ImageManagerPanel) => {
    if (imageManagerPanel.isDisposed) {
      return []
    }

    const start = performance.now()

    const images = await Promise.all(imageManagerPanel.initialData.rootpaths.map(root => getStagedImages(root)))

    Channel.debug(`Get git staged images cost: ${performance.now() - start}ms`)

    return flatten(images)
  },

  /* --------- update user configuration -------- */
  [CmdToVscode.update_user_configuration]: async (
    data: {
      key: Flatten<ConfigType>
      value: any
      target?: ConfigurationTarget
    },
    imageManagerPanel: ImageManagerPanel,
  ) => {
    const { key, value, target } = data

    await cancelablePromise.run(
      async () => {
        imageManagerPanel.isProgrammaticChangeConfig = true
        try {
          await Config.updateConfig(key, value, target)
        }
        finally {
          imageManagerPanel.isProgrammaticChangeConfig = false
        }
        imageManagerPanel.messageCenter.postMessage({
          cmd: CmdToWebview.update_config,
          data: { keys: [key] },
        })
      },
      {
        key: key + imageManagerPanel.id,
      },
    )

    return true
  },

  /* ------------ get workspace state ----------- */
  [CmdToVscode.get_workspace_state]: async () => {
    return WorkspaceState.get_all()
  },

  /* ---------- update workspace state ---------- */
  [CmdToVscode.update_workspace_state]: async <T extends WorkspaceStateKey, U>(
    data: {
      key: T
      value: U | undefined
    },
    imageMangerPanel: ImageManagerPanel,
  ) => {
    const { key, value } = data
    await cancelablePromise.run(() => WorkspaceState.update(key, value), { key: key + imageMangerPanel.id })
    return true
  },

  /* ----------- clear_workspace_state ---------- */
  [CmdToVscode.clear_workspace_state]: async () => {
    await WorkspaceState.clear_unused()
    await WorkspaceState.clear()
    return true
  },

  /* ------- clear useless workspace state ------ */
  [CmdToVscode.clear_useless_workspace_state]: async () => {
    await WorkspaceState.clear_unused()
    return true
  },

  /* ---------------- pretty svg ---------------- */
  [CmdToVscode.prettify_svg]: async (data: { filePath: string }) => {
    const { filePath } = data
    const svgString = await fs.readFile(filePath, 'utf-8')
    const svg = await Svgo.prettify(svgString, Config.compression.svg)
    await fs.writeFile(filePath, svg)
    return true
  },
  /* --------- open file in text editor --------- */
  [CmdToVscode.open_file_in_text_editor]: async (data: { filePath: string }) => {
    const { filePath } = data
    const document = await workspace.openTextDocument(Uri.file(filePath))
    await window.showTextDocument(document, ViewColumn.Active)
    return true
  },
  /* ---------------- delete file/dir --------------- */
  [CmdToVscode.delete_file]: async (data: { filePaths: string[], recursive?: boolean, useTrash?: boolean }) => {
    const { filePaths, recursive, useTrash = true } = data
    try {
      await Promise.all(filePaths.map((filePath) => {
        const startedAt = performance.now()
        const slashedPath = slashPath(filePath)
        Channel.debug(`delete_file start: ${slashedPath} (recursive=${!!recursive}, useTrash=${useTrash})`)
        return withRejectingTimeout(
          workspace.fs.delete(Uri.file(slashedPath), { useTrash, recursive }),
          FILE_DELETE_TIMEOUT,
          `delete_file:${slashedPath}`,
        ).then((value) => {
          Channel.debug(`delete_file success: ${slashedPath} (${(performance.now() - startedAt).toFixed(0)}ms)`)
          return value
        })
      }))
      return true
    }
    catch (err) {
      Channel.warn(`delete_file failed: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  },
  /* --------------- 获取路径下的同级文件(夹)列表 --------------- */
  [CmdToVscode.get_sibling_resource]: async (data: { source: string[] }) => {
    const { source } = data
    const res = await Promise.all(source.map((p) => {
      const parent = slashPath(path.dirname(p))
      return withRejectingTimeout(
        fs.readdir(parent),
        FILE_SIBLING_RESOURCE_TIMEOUT,
        `get_sibling_resource:${parent}`,
      )
    }))
    return res.flat()
  },
  /* ---------------- 打开svgo配置文件 ---------------- */
  [CmdToVscode.open_svgo_config]: async () => {
    await commands.executeCommand(Commands.configure_svgo)
    return true
  },
  /* ---------------- 重命名文件/目录 --------------- */
  [CmdToVscode.rename_file]: async (
    data: { files: { source: string, target: string }[], overwrite?: boolean },
    imageManagerPanel: ImageManagerPanel,
  ) => {
    const { files, overwrite = false } = data
    const renameOne = async ({ source, target }: { source: string, target: string }) => {
      const slashedSource = slashPath(source)
      const slashedTarget = slashPath(target)
      const startedAt = performance.now()
      Channel.debug(`rename_file start: ${slashedSource} -> ${slashedTarget} (overwrite=${overwrite})`)
      try {
        await withRejectingTimeout(
          workspace.fs.rename(Uri.file(slashedSource), Uri.file(slashedTarget), { overwrite }),
          FILE_RENAME_TIMEOUT,
          `rename_file.workspace.fs:${slashedSource}`,
        )
        Channel.debug(
          `rename_file workspace.fs success: ${slashedSource} -> ${slashedTarget} `
          + `(${(performance.now() - startedAt).toFixed(0)}ms)`,
        )
      }
      catch (workspaceErr) {
        if (workspaceErr instanceof OperationTimeoutError) {
          Channel.warn(
            `rename_file workspace.fs timed out, fallback skipped: ${slashedSource} -> ${slashedTarget} `
            + `(${workspaceErr.message})`,
          )
          throw workspaceErr
        }
        Channel.warn(
          `rename_file workspace.fs failed, trying fs-extra: ${slashedSource} -> ${slashedTarget} `
          + `(${workspaceErr instanceof Error ? workspaceErr.message : String(workspaceErr)})`,
        )
        try {
          await withRejectingTimeout(
            fs.move(slashedSource, slashedTarget, { overwrite }),
            FILE_RENAME_TIMEOUT,
            `rename_file.fs-extra:${slashedSource}`,
          )
          Channel.debug(
            `rename_file fs-extra success: ${slashedSource} -> ${slashedTarget} `
            + `(${(performance.now() - startedAt).toFixed(0)}ms)`,
          )
        }
        catch (fsErr: any) {
          if (!overwrite && fsErr?.code === 'EEXIST') {
            throw Object.assign(fsErr, { code: 'FileExists' })
          }
          throw fsErr
        }
      }

      const cwd = imageManagerPanel.initialData.rootpaths
        .map(slashPath)
        .find(root => isPathInside(slashedTarget, root) || isPathInside(slashedSource, root))
      const parentSource = slashPath(path.dirname(slashedSource))
      const parentTarget = slashPath(path.dirname(slashedTarget))
      if (cwd) {
        clearDirectorySnapshotCachesForPath(slashedSource, cwd)
        clearDirectorySnapshotCachesForPath(slashedTarget, cwd)
        clearDirectorySnapshotCachesForPath(parentSource, cwd)
        if (parentTarget !== parentSource) {
          clearDirectorySnapshotCachesForPath(parentTarget, cwd)
        }
        clearGlobbyCacheByCwd(cwd)
      }

      try {
        const stat = await withRejectingTimeout(
          fs.stat(slashedTarget),
          FILE_STAT_AFTER_OPERATION_TIMEOUT,
          `rename_file.stat:${slashedTarget}`,
        )
        if (cwd && stat.isDirectory()) {
          const workspaceFolder = path.basename(cwd)
          postWorkspaceUpdate(imageManagerPanel, {
            updateType: UpdateType.patch,
            workspaceFolder,
            absWorkspaceFolder: cwd,
            payloads: [
              directoryPayload(slashedSource, cwd, {
                type: UpdateEvent.delete,
              }),
              directoryPayload(slashedTarget, cwd, {
                canLoadChildren: true,
                childrenLoaded: false,
                loadingChildren: false,
                type: UpdateEvent.create,
              }),
            ],
          })
          Channel.debug(
            `rename_file directory patch posted: ${slashedSource} -> ${slashedTarget} `
            + `(cwd=${cwd}, cost=${(performance.now() - startedAt).toFixed(0)}ms)`,
          )
        }
      }
      catch (statErr) {
        Channel.warn(
          `rename_file stat after success failed: ${slashedTarget} `
          + `(${statErr instanceof Error ? statErr.message : String(statErr)})`,
        )
      }
    }

    const res = await Promise.allSettled(files.map(renameOne))
    const successCount = res.filter(item => item.status === 'fulfilled').length
    Channel.debug(
      `rename_file settled: success=${successCount}/${files.length} ${
        res.map((item, i) => item.status === 'fulfilled'
          ? `[ok ${slashPath(files[i].source)} -> ${slashPath(files[i].target)}]`
          : `[failed ${slashPath(files[i].source)} -> ${slashPath(files[i].target)}: ${toString(item.reason)}]`).join(' ')}`,
    )
    return res.map((item, i) => ({
      ...item,
      ...files[i],
    }))
  },
  /* ---------------- 复制/移动图片文件到指定目录 --------------- */
  [CmdToVscode.copy_or_move_file_to]: async (data: {
    source: string[]
    target: string
    type: 'copy' | 'move'
    overwrite?: boolean
  }) => {
    const { source, target, type, overwrite = false } = data

    const fnMap = {
      copy: workspace.fs.copy,
      move: workspace.fs.rename,
    }

    const res = await Promise.allSettled(
      source.map((filePath) => {
        const slashedSource = slashPath(filePath)
        const targetPath = slashPath(path.join(target, path.basename(filePath)))
        const startedAt = performance.now()
        Channel.debug(`copy_or_move_file_to start: ${type} ${slashedSource} -> ${targetPath}`)
        return withRejectingTimeout(
          fnMap[type](Uri.file(slashedSource), Uri.file(targetPath), {
            overwrite,
          }),
          FILE_COPY_MOVE_TIMEOUT,
          `copy_or_move_file_to.${type}:${slashedSource}`,
        ).then((value) => {
          Channel.debug(
            `copy_or_move_file_to success: ${type} ${slashedSource} -> ${targetPath} `
            + `(${(performance.now() - startedAt).toFixed(0)}ms)`,
          )
          return value
        })
      }),
    )

    return res.map((item, i) => ({
      ...item,
      source: source[i],
      target: slashPath(path.join(target, path.basename(source[i]))),
    }))
  },
}
