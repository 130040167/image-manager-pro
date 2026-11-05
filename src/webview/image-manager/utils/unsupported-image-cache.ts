import type { CustomImageDecodeOptions } from '~/core/custom-format/types'
import { CmdToVscode } from '~/message/cmd'
import logger from '~/utils/logger'
import { vscodeApi } from '~/webview/vscode-api'
import { PreviewSourceCache } from './preview-source-cache'

// 浏览器不能直接显示的格式：向扩展宿主要一张最大 2048 的 JPEG 缓存。
// 预览和编辑器优先使用 webview URI；data URL 仅用于显式请求的回退。
export const UNSUPPORTED_EXTS = new Set(['tif', 'tiff', 'heic', 'heif', 'npy', 'raw', 'dat', 'bin'])
const CUSTOM_DECODE_EXTS = new Set(['npy', 'raw', 'dat', 'bin'])
const LOG_PREFIX = '[unsupported-base64]'

export function isUnsupportedImage(image: { extname?: string }): boolean {
  return UNSUPPORTED_EXTS.has((image.extname || '').toLowerCase())
}

// 有界进程内缓存：路径与解码选项 -> webview URI / data URL。
const base64Cache = new PreviewSourceCache()
const inflight = new Map<string, Promise<string>>()
const activeEntries = new Set<QueueEntry>()
const MAX_CONCURRENT_BASE64 = 1

type FetchOptions = {
  decodeOptions?: CustomImageDecodeOptions
  delivery?: 'data-url' | 'uri'
  forceCustomDecode?: boolean
  priority?: 'high' | 'normal' | 'idle'
}

type QueueEntry = {
  invalidated?: boolean
  decodeOptions?: CustomImageDecodeOptions
  delivery: 'data-url' | 'uri'
  filePath: string
  forceCustomDecode?: boolean
  priority: number
  reject: (reason?: unknown) => void
  resolve: (value: string) => void
  sequence: number
}

let activeCount = 0
let sequence = 0
const queue: QueueEntry[] = []

function stableStringify(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function getUnsupportedBase64CacheKey(filePath: string, decodeOptions?: CustomImageDecodeOptions) {
  const optionsKey = decodeOptions && Object.keys(decodeOptions).length ? stableStringify(decodeOptions) : ''
  return optionsKey ? `${filePath}|${optionsKey}` : filePath
}

function displayCacheKey(filePath: string, decodeOptions: CustomImageDecodeOptions | undefined, delivery: 'data-url' | 'uri') {
  const base = getUnsupportedBase64CacheKey(filePath, decodeOptions)
  return delivery === 'data-url' ? `${base}|delivery=data-url` : base
}

export function clearUnsupportedBase64Cache(filePath?: string) {
  const matches = (key: string) => !filePath || key === filePath || key.startsWith(`${filePath}|`)
  for (const key of Array.from(base64Cache.keys())) {
    if (matches(key))
      base64Cache.delete(key)
  }
  for (const key of inflight.keys()) {
    if (matches(key))
      inflight.delete(key)
  }
  for (const entry of [...queue, ...activeEntries]) {
    if (matches(entry.filePath)) {
      entry.invalidated = true
      entry.resolve('')
    }
  }
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].invalidated)
      queue.splice(i, 1)
  }
  notifyCacheUpdated()
}

export function releaseUnsupportedDataUrls() {
  base64Cache.releaseDataUrls()
  for (const entry of [...queue, ...activeEntries]) {
    if (entry.delivery === 'data-url') {
      entry.invalidated = true
      entry.resolve('')
      inflight.delete(displayCacheKey(entry.filePath, entry.decodeOptions, entry.delivery))
    }
  }
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].invalidated)
      queue.splice(i, 1)
  }
}

export function getUnsupportedCacheUsage() {
  return base64Cache.usage
}

if (typeof window !== 'undefined')
  window.addEventListener('pagehide', () => clearUnsupportedBase64Cache())

// prefetch 完一张图就广播一次，让 PreviewGroup 这种"按 src 渲染"的消费者
// 能感知到缓存被填充并刷新自己的 items。节流 100ms，避免一次扫上千张
// 时把 React 打成噪声 update。
const cacheSubscribers = new Set<() => void>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
function notifyCacheUpdated() {
  if (flushTimer)
    return
  flushTimer = setTimeout(() => {
    flushTimer = null
    cacheSubscribers.forEach((cb) => {
      try {
        cb()
      }
      catch {}
    })
  }, 100)
}

export function subscribeUnsupportedCache(cb: () => void): () => void {
  cacheSubscribers.add(cb)
  return () => {
    cacheSubscribers.delete(cb)
  }
}

export function getCachedUnsupportedBase64(filePath: string, decodeOptions?: CustomImageDecodeOptions): string | undefined {
  return base64Cache.get(getUnsupportedBase64CacheKey(filePath, decodeOptions))
}

function priorityValue(priority: FetchOptions['priority']) {
  switch (priority) {
    case 'high':
      return 0
    case 'normal':
      return 1
    case 'idle':
      return 2
    default:
      return 1
  }
}

function extnameOf(filePath: string) {
  const name = filePath.split(/[\\/]/).pop() || filePath
  const index = name.lastIndexOf('.')
  return index >= 0 ? name.slice(index + 1).toLowerCase() : ''
}

function shouldUseCustomDecode(filePath: string) {
  return CUSTOM_DECODE_EXTS.has(extnameOf(filePath))
}

// 占位 src：缓存命中前给一个唯一可区分的 data URL，避免 rc-image PreviewGroup
// 在 fromItems 模式下用 src 做 findIndex 时把多张未就绪 TIF 全部命中到第一个空 src，
// 导致"点击缩略图后放大显示的不是同一张"。fragment 不会改变浏览器加载结果，
// 但能让字符串唯一。visible-image 和 image-group 必须共用此函数，两侧 src 完全一致
// rc-image 才能正确匹配。
const PLACEHOLDER_PREFIX = 'data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E#'

export function getStableSrcForUnsupported(filePath: string, decodeOptions?: CustomImageDecodeOptions): string {
  const cached = base64Cache.get(getUnsupportedBase64CacheKey(filePath, decodeOptions))
  if (cached)
    return cached
  return `${PLACEHOLDER_PREFIX}${encodeURIComponent(getUnsupportedBase64CacheKey(filePath, decodeOptions))}`
}

export function isUnsupportedPlaceholder(src: string | undefined): boolean {
  return typeof src === 'string' && src.startsWith(PLACEHOLDER_PREFIX)
}

function pumpQueue() {
  if (activeCount >= MAX_CONCURRENT_BASE64)
    return
  if (!queue.length)
    return

  queue.sort((a, b) => a.priority - b.priority || a.sequence - b.sequence)
  const entry = queue.shift()!
  activeEntries.add(entry)
  activeCount++

  const start = performance.now()
  const useCustomDecode = entry.forceCustomDecode || shouldUseCustomDecode(entry.filePath)
  const cmd = useCustomDecode ? CmdToVscode.decode_image_for_preview : CmdToVscode.copy_image_as_base64
  const cacheKey = displayCacheKey(entry.filePath, entry.decodeOptions, entry.delivery)
  logger.debug(LOG_PREFIX, 'fetch start', entry.filePath, `cmd=${cmd}`)
  vscodeApi.log('debug', `${LOG_PREFIX} fetch start`, {
    cmd,
    decodeOptions: entry.decodeOptions,
    filePath: entry.filePath,
    priority: entry.priority,
  })
  let settled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const finish = (data: unknown) => {
    if (settled)
      return
    settled = true
    if (timer) {
      clearTimeout(timer)
    }
    const len = typeof data === 'string' ? data.length : 0
    const prefix = typeof data === 'string' ? data.slice(0, 32) : ''
    const cost = (performance.now() - start).toFixed(1)
    logger.debug(LOG_PREFIX, 'fetch done', entry.filePath, `cmd=${cmd}`, `cost=${cost}ms`, `len=${len}`, `prefix=${prefix}`)
    vscodeApi.log(len ? 'debug' : 'warn', `${LOG_PREFIX} fetch done`, {
      cmd,
      costMs: Number(cost),
      filePath: entry.filePath,
      len,
      prefix,
    })
    if (!entry.invalidated && typeof data === 'string' && data) {
      base64Cache.set(cacheKey, data)
      notifyCacheUpdated()
      entry.resolve(data)
    }
    else {
      entry.resolve('')
    }

    activeCount--
    activeEntries.delete(entry)
    pumpQueue()
  }

  timer = setTimeout(() => {
    logger.debug(LOG_PREFIX, 'fetch timeout', entry.filePath, `cmd=${cmd}`)
    vscodeApi.log('warn', `${LOG_PREFIX} fetch timeout`, {
      cmd,
      filePath: entry.filePath,
      timeoutMs: 30_000,
    })
    finish('')
  }, 30_000)

  vscodeApi.postMessage(
    {
      cmd,
      data: useCustomDecode
        ? { delivery: entry.delivery, filePath: entry.filePath, options: entry.decodeOptions }
        : { delivery: entry.delivery, filePath: entry.filePath, priority: entry.priority === 0 ? 'high' : 'normal' },
    },
    (data) => {
      const previewSrc = typeof data === 'string'
        ? data
        : ((data as { previewSrc?: string, dataUrl?: string } | null)?.previewSrc
          || (data as { dataUrl?: string } | null)?.dataUrl
          || '')
      finish(previewSrc)
    },
  )
}

export function fetchUnsupportedAsBase64(filePath: string, options: FetchOptions = {}): Promise<string> {
  if (!filePath) {
    return Promise.resolve('')
  }
  const delivery = options.delivery || 'uri'
  const cacheKey = displayCacheKey(filePath, options.decodeOptions, delivery)
  const cached = base64Cache.get(cacheKey)
  if (cached) {
    return Promise.resolve(cached)
  }
  const priority = priorityValue(options.priority)
  const existing = inflight.get(cacheKey)
  if (existing) {
    const queued = queue.find(entry => displayCacheKey(entry.filePath, entry.decodeOptions, entry.delivery) === cacheKey)
    if (queued && priority < queued.priority) {
      queued.priority = priority
    }
    return existing
  }

  const promise = new Promise<string>((resolve, reject) => {
    queue.push({
      decodeOptions: options.decodeOptions,
      delivery,
      filePath,
      forceCustomDecode: options.forceCustomDecode,
      priority,
      reject,
      resolve,
      sequence: sequence++,
    })
    pumpQueue()
  }).finally(() => {
    if (inflight.get(cacheKey) === promise)
      inflight.delete(cacheKey)
  })
  inflight.set(cacheKey, promise)
  return promise
}
