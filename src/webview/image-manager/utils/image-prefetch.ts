import logger from '~/utils/logger'
import { fetchUnsupportedAsBase64, getCachedUnsupportedBase64, isUnsupportedImage } from './unsupported-image-cache'

// 包装 requestIdleCallback，老浏览器/无 RIC 的环境用 setTimeout 兜底。
// 这里使用宽松类型，避免 lib.dom 缺类型定义时报错。
type IdleDeadlineLike = { didTimeout: boolean, timeRemaining: () => number }
type IdleHandle = number

const _ric: ((cb: (d: IdleDeadlineLike) => void, opts?: { timeout?: number }) => IdleHandle) | undefined
  = typeof window !== 'undefined' && typeof (window as any).requestIdleCallback === 'function'
    ? (cb, opts) => (window as any).requestIdleCallback(cb, opts)
    : undefined

const _cic: ((id: IdleHandle) => void) | undefined
  = typeof window !== 'undefined' && typeof (window as any).cancelIdleCallback === 'function'
    ? id => (window as any).cancelIdleCallback(id)
    : undefined

function requestIdle(cb: (d: IdleDeadlineLike) => void, opts?: { timeout?: number }): IdleHandle {
  if (_ric) {
    return _ric(cb, opts)
  }
  // 兜底：在下一次空闲（约 200ms 后）调用
  return window.setTimeout(
    () => cb({ didTimeout: false, timeRemaining: () => 16 }),
    200,
  ) as unknown as IdleHandle
}

function cancelIdle(id: IdleHandle): void {
  if (_cic) {
    _cic(id)
    return
  }
  window.clearTimeout(id)
}

// 已经发起过 src 加载的非 TIF 图，避免重复创建 Image 对象（也便于浏览器命中 HTTP 缓存）
const browserPrefetched = new Set<string>()
const unsupportedPrefetched = new Set<string>()

function prefetchOneBrowser(vscodePath: string | undefined): void {
  if (!vscodePath || browserPrefetched.has(vscodePath))
    return
  browserPrefetched.add(vscodePath)
  // new Image() 会让浏览器走和 <img> 一样的获取/缓存路径，但不挂在 DOM 上
  const img = new Image()
  // decoding=async 让解码不阻塞渲染线程
  ;(img as any).decoding = 'async'
  img.src = vscodePath
}

/**
 * 预取单张图片：
 * - 浏览器不支持的格式（TIF）走 vscode -> base64 通道（已有 in-flight 去重和缓存）
 * - 普通格式直接 new Image() 让浏览器把 src 放进缓存
 */
export async function prefetchImage(image: ImageType): Promise<void> {
  try {
    if (isUnsupportedImage(image)) {
      if (getCachedUnsupportedBase64(image.path))
        return
      if (unsupportedPrefetched.has(image.path))
        return
      unsupportedPrefetched.add(image.path)
      await fetchUnsupportedAsBase64(image.path, { priority: 'idle' })
      return
    }
    prefetchOneBrowser(image.vscodePath)
  }
  catch (e) {
    // 预取失败不应影响主流程
    logger.debug('[prefetch] image failed', image?.path, e)
  }
}

type IdlePrefetchOptions = {
  /** 并发上限，默认 4。SSHFS 下并发太高反而会让连接互相抢锁 */
  concurrency?: number
  /** 单次 idle 回调留多少 ms 给浏览器，默认 4 */
  perTickMs?: number
}

/**
 * 利用浏览器空闲时间，对一批图片做后台预取。
 * 返回取消函数，调用后未发起的请求会被丢弃（已发起的不能撤销）。
 */
export function prefetchImagesIdle(images: ImageType[], opts?: IdlePrefetchOptions): () => void {
  const concurrency = Math.max(1, opts?.concurrency ?? 4)
  const perTickMs = opts?.perTickMs ?? 4

  if (!images.length) {
    return () => {}
  }

  let queue: ImageType[] = images.slice()
  let inFlight = 0
  // 用对象包一层，避免 lint 把这个变量当成"循环里没改的常量"误报
  const state = { cancelled: false }
  let idleHandle: IdleHandle | null = null

  const scheduleIdle = (): void => {
    if (state.cancelled)
      return
    if (idleHandle !== null)
      return
    if (!queue.length && inFlight === 0)
      return
    if (!queue.length)
      return // 等正在飞的 finally 来 reschedule

    idleHandle = requestIdle((deadline) => {
      idleHandle = null
      // 在当前 idle 时间片里尽可能多地起新请求
      while (
        !state.cancelled
        && queue.length
        && inFlight < concurrency
        && deadline.timeRemaining() > perTickMs
      ) {
        const next = queue.shift()!
        inFlight++
        prefetchImage(next).finally(() => {
          inFlight--
          scheduleIdle()
        })
      }
      // 时间片用完但还有剩余，下个 idle 接着来
      if (!state.cancelled && queue.length) {
        scheduleIdle()
      }
    }, { timeout: 2000 })
  }

  scheduleIdle()

  return () => {
    state.cancelled = true
    queue = []
    if (idleHandle !== null) {
      cancelIdle(idleHandle)
      idleHandle = null
    }
  }
}

/**
 * 预取相邻 N 张（通常用于预览大图时，提前 fetch 下/上几张）。
 * 这里不走 idle —— 用户已经在看图了，应当尽快开始网络/磁盘读取。
 */
export function prefetchNeighbors(
  images: ImageType[],
  current: number,
  radius: number = 2,
): Promise<unknown> {
  const currentImage = images[current]
  if (currentImage && isUnsupportedImage(currentImage)) {
    return Promise.resolve()
  }
  if (current < 0 || current >= images.length || radius <= 0) {
    return Promise.resolve()
  }
  const seen = new Set<number>()
  const targets: ImageType[] = []
  for (let r = 1; r <= radius; r++) {
    const next = current + r
    const prev = current - r
    if (next < images.length && !seen.has(next)) {
      seen.add(next)
      targets.push(images[next])
    }
    if (prev >= 0 && !seen.has(prev)) {
      seen.add(prev)
      targets.push(images[prev])
    }
  }
  return Promise.all(targets.map(t => prefetchImage(t).catch(() => undefined)))
}
