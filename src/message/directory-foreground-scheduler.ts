import { performance } from 'node:perf_hooks'
import { AbortError } from '~/utils/abort-promise'

export type DirectoryRequestReason = 'click-toggle' | 'active-effect' | 'collapse-change' | 'unknown'
export type DirectoryIoPriority = 'click' | 'normal' | 'background'

export type ForegroundDirectoryIoTask = {
  dirPath: string
  panelId?: string
  queuedAt: number
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
  run: () => Promise<unknown>
  seq: number
  priority: DirectoryIoPriority
  reason: DirectoryRequestReason
}

type Logger = (message: string) => void
type SharpQuietWaiter = (maxMs: number) => Promise<void>

export type DirectoryForegroundSchedulerOptions = {
  /** 最大并发，默认 1 */
  concurrency?: number
  /** 每个任务执行前等待 sharp 空闲的时间 */
  waitForSharpQuiet?: SharpQuietWaiter
  /** 调试日志输出 */
  log?: Logger
  /** Date.now() 的来源（测试覆盖） */
  now?: () => number
}

export type EnqueueOptions = {
  panelId?: string
  priority?: DirectoryIoPriority
  reason?: DirectoryRequestReason
}

/**
 * 前台目录 IO 调度器。
 *
 * 设计：
 * - click 优先级：从队尾向前找最新的 click 任务执行（LIFO for click）
 * - normal/background 优先级：FIFO，background 排在 normal 后面
 * - 新 click 入队时抢占同 panel 中尚未启动的 normal/background 任务（reject(AbortError)）
 *
 * 这个模块被生产代码（message-factory.ts）和测试（directory-foreground-scheduler.test.ts）共用，
 * 避免之前"测试用 unshift / 生产用 push"的反向覆盖盲点。
 */
export function createDirectoryForegroundScheduler(options: DirectoryForegroundSchedulerOptions = {}) {
  const concurrency = options.concurrency ?? 1
  const waitForSharpQuiet = options.waitForSharpQuiet
  const log = options.log
  const now = options.now ?? Date.now

  const queue: Array<ForegroundDirectoryIoTask> = []
  let active = 0
  let lastFinishedAt = 0
  let seq = 0

  const pickNext = (): ForegroundDirectoryIoTask | undefined => {
    if (!queue.length) {
      return undefined
    }

    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].priority === 'click') {
        return queue.splice(i, 1)[0]
      }
    }

    let bestIndex = 0
    let best = queue[0]
    const rank = (priority: DirectoryIoPriority) => {
      if (priority === 'normal')
        return 0
      if (priority === 'background')
        return 1
      return -1
    }
    for (let i = 1; i < queue.length; i++) {
      const task = queue[i]
      if (rank(task.priority) < rank(best.priority) || (rank(task.priority) === rank(best.priority) && task.seq < best.seq)) {
        best = task
        bestIndex = i
      }
    }
    queue.splice(bestIndex, 1)
    return best
  }

  const preemptStaleNormalTasks = (panelId: string | undefined, byDirPath: string): number => {
    if (!queue.length) {
      return 0
    }
    let preempted = 0
    for (let i = queue.length - 1; i >= 0; i--) {
      const task = queue[i]
      if (task.priority === 'click') {
        continue
      }
      if (panelId && task.panelId && task.panelId !== panelId) {
        continue
      }
      if (task.dirPath === byDirPath) {
        // 同目录的 normal 旧请求不取消，等它们去重合并即可
        continue
      }
      queue.splice(i, 1)
      log?.(
        `Foreground directory IO preempted: ${task.dirPath} `
        + `by click=${byDirPath} (reason=${task.reason}, seq=${task.seq})`,
      )
      task.reject(new AbortError())
      preempted++
    }
    return preempted
  }

  const pump = () => {
    while (active < concurrency && queue.length) {
      const task = pickNext()
      if (!task) {
        break
      }
      const queuedMs = Math.round(performance.now() - task.queuedAt)
      active++
      log?.(
        `Foreground directory IO start: ${task.dirPath} `
        + `(active=${active}, queued=${queue.length}, queuedMs=${queuedMs}, `
        + `priority=${task.priority}, reason=${task.reason}, seq=${task.seq})`,
      )
      void (async () => {
        try {
          if (waitForSharpQuiet) {
            await waitForSharpQuiet(120)
          }
          task.resolve(await task.run())
        }
        catch (err) {
          task.reject(err)
        }
        finally {
          active = Math.max(0, active - 1)
          lastFinishedAt = now()
          log?.(
            `Foreground directory IO finish: ${task.dirPath} `
            + `(active=${active}, queued=${queue.length}, `
            + `priority=${task.priority}, reason=${task.reason}, seq=${task.seq})`,
          )
          pump()
        }
      })()
    }
  }

  function enqueue<T>(dirPath: string, run: () => Promise<T>, opts: EnqueueOptions = {}): Promise<T> {
    const priority: DirectoryIoPriority = opts.priority || 'normal'
    const reason: DirectoryRequestReason = opts.reason || 'unknown'
    let preempted = 0
    if (priority === 'click') {
      preempted = preemptStaleNormalTasks(opts.panelId, dirPath)
    }
    return new Promise<T>((resolve, reject) => {
      queue.push({
        dirPath,
        panelId: opts.panelId,
        queuedAt: performance.now(),
        reject,
        resolve: value => resolve(value as T),
        run,
        seq: seq++,
        priority,
        reason,
      })
      log?.(
        `Foreground directory IO queued: ${dirPath} `
        + `(active=${active}, queued=${queue.length}, `
        + `priority=${priority}, reason=${reason}, preempted=${preempted})`,
      )
      pump()
    })
  }

  function clearForPanel(panelId: string): number {
    let removed = 0
    if (!queue.length) {
      return removed
    }
    for (let i = queue.length - 1; i >= 0; i--) {
      const task = queue[i]
      if (task.panelId !== panelId) {
        continue
      }
      queue.splice(i, 1)
      task.reject(new AbortError())
      removed++
    }
    return removed
  }

  function clearAll(): number {
    let removed = 0
    for (let i = queue.length - 1; i >= 0; i--) {
      const task = queue[i]
      queue.splice(i, 1)
      task.reject(new AbortError())
      removed++
    }
    return removed
  }

  return {
    enqueue,
    clearAll,
    clearForPanel,
    get activeCount() {
      return active
    },
    get queueLength() {
      return queue.length
    },
    get lastFinishedAt() {
      return lastFinishedAt
    },
  }
}

export type DirectoryForegroundScheduler = ReturnType<typeof createDirectoryForegroundScheduler>
