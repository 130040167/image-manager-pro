/**
 * 目录 I/O Worker 池。
 *
 * 主流文件管理器（Windows Explorer 等）使用多个独立 I/O 线程读目录，
 * 当用户切换路径时立刻取消正在进行的读操作。Node.js 主线程的 `fs.readdir`
 * 一旦发起就无法中途取消，因此我们用 worker_threads 实现等价能力：
 *
 * - 每个 worker 是一个独立的 Node 线程，自带 libuv pool，不会被主线程的
 *   sharp / globby / 其他 IO 饿死；
 * - `cancel(taskId)` 通过 `worker.terminate()` 直接杀掉 worker，等价于强制
 *   取消正在执行的 `opendir/readdir`；
 * - 池子保持 N 个 worker（默认 4），全部忙时排队，但**点击优先级的请求
 *   永远不需要排队**——它会触发 kill 一个 worker 立即接手。
 */

import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { Worker } from 'node:worker_threads'

export type DirectoryIoMode = 'snapshot' | 'fast' | 'streaming'
export type DirectoryIoPriority = 'click' | 'normal' | 'background'

export type DirectoryIoRequest = {
  dirPath: string
  mode: DirectoryIoMode
  scanExts: string[]
  excludeBasenames?: string[]
  fastImageLimit?: number
  imageOffset?: number
  imageLimit?: number
  deadlineMs?: number
  priority?: DirectoryIoPriority
  panelId?: string
  reason?: string
}

export type DirectoryIoSuccess = {
  ok: true
  dirs: string[]
  imagePaths: string[]
  directImageCount: number
  scannedEntries: number
  complete: boolean
  readMs: number
}

export type DirectoryIoFailure = {
  ok: false
  error: string
  readMs: number
  cancelled?: boolean
}

export type DirectoryIoResult = DirectoryIoSuccess | DirectoryIoFailure

type Pending = {
  taskId: number
  request: DirectoryIoRequest
  resolve: (res: DirectoryIoResult) => void
  reject: (err: unknown) => void
  startedAt: number
  timeout?: ReturnType<typeof setTimeout>
  worker?: WorkerSlot
  cancelled: boolean
  cancelToken?: CancelToken
  cancelListener?: () => void
  enqueuedAt: number
  priority: DirectoryIoPriority
  seq: number
}

type WorkerSlot = {
  worker: Worker
  busyTaskId: number | null
  ready: boolean
  readyResolvers: Array<() => void>
}

export type CancelToken = {
  cancelled: boolean
  reason?: string
  onCancel: (cb: () => void) => () => void
}

export function createCancelToken(): { token: CancelToken, cancel: (reason?: string) => void } {
  const listeners = new Set<() => void>()
  const token: CancelToken = {
    cancelled: false,
    onCancel(cb) {
      if (token.cancelled) {
        cb()
        return () => {}
      }
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
  }
  return {
    token,
    cancel(reason?: string) {
      if (token.cancelled)
        return
      token.cancelled = true
      token.reason = reason
      const snap = Array.from(listeners)
      listeners.clear()
      for (const cb of snap) {
        try {
          cb()
        }
        catch {}
      }
    },
  }
}

export type DirectoryIoPoolOptions = {
  workerScript: string
  poolSize?: number
  log?: (msg: string) => void
}

export function createDirectoryIoPool(options: DirectoryIoPoolOptions) {
  const log = options.log
  const poolSize = Math.max(1, options.poolSize || 4)
  const workers: WorkerSlot[] = []
  const queue: Pending[] = []
  let nextTaskId = 1
  let seq = 0
  let disposed = false

  function spawnWorker(): WorkerSlot {
    const worker = new Worker(options.workerScript, {
      // VS Code launches the extension host under the Node inspector during F5
      // debugging. Worker threads inherit process.execArgv by default, which can
      // leave every directory worker waiting on the same debug port before it
      // ever sends the ready ack. Directory expansion then sits on "loading"
      // until our 9s deadline kills the worker. These workers are pure fs I/O;
      // they must start without the extension host inspector flags.
      execArgv: [],
    })
    const slot: WorkerSlot = {
      worker,
      busyTaskId: null,
      ready: false,
      readyResolvers: [],
    }

    worker.on('online', () => {
      log?.('directory-io worker online')
    })

    worker.on('message', (msg: any) => {
      // 第一条 ready ack
      if (!slot.ready && msg && msg.id === -1) {
        slot.ready = true
        log?.('directory-io worker ready')
        const resolvers = slot.readyResolvers.splice(0)
        resolvers.forEach(r => r())
        return
      }

      if (slot.busyTaskId == null)
        return
      const taskId = slot.busyTaskId
      const pending = popPending(taskId)
      slot.busyTaskId = null
      if (!pending) {
        // 任务已经被取消并 reject 过；忽略迟到结果，立即拉下一个
        pumpQueue()
        return
      }

      // 触发 reject 用的解绑
      pending.cancelListener?.()
      const result = msg as DirectoryIoResult
      log?.(
        `directory-io result task=${taskId} ok=${result.ok} `
        + `readMs=${Math.round(result.readMs)}${result.ok ? '' : ` error=${result.error}`}`,
      )
      pending.resolve(result)
      pumpQueue()
    })

    worker.on('error', (err) => {
      log?.(`directory-io worker error: ${err.message}`)
      handleWorkerExit(slot, `error: ${err.message}`)
    })

    worker.on('exit', (code) => {
      log?.(`directory-io worker exit code=${code}`)
      handleWorkerExit(slot, `exit:${code}`)
    })

    return slot
  }

  function handleWorkerExit(slot: WorkerSlot, reason: string) {
    // 把这个 slot 从池子里移除，正在跑的任务 reject（如果还没被 cancel）
    const idx = workers.indexOf(slot)
    if (idx !== -1)
      workers.splice(idx, 1)

    if (slot.busyTaskId != null) {
      const pending = popPending(slot.busyTaskId)
      slot.busyTaskId = null
      if (pending) {
        pending.cancelListener?.()
        pending.resolve({
          ok: false,
          error: reason,
          readMs: performance.now() - pending.startedAt,
          cancelled: pending.cancelled,
        })
      }
    }

    if (!disposed && workers.length < poolSize) {
      workers.push(spawnWorker())
    }
    pumpQueue()
  }

  // 用一个 Map 保存全部 pending（已发出和排队中），便于按 taskId 取消
  const pendingMap = new Map<number, Pending>()
  function popPending(taskId: number): Pending | undefined {
    const p = pendingMap.get(taskId)
    if (!p)
      return undefined
    pendingMap.delete(taskId)
    if (p.timeout) {
      clearTimeout(p.timeout)
      p.timeout = undefined
    }
    // 也从队列移除（若还在队列里）
    const idx = queue.findIndex(q => q.taskId === taskId)
    if (idx !== -1)
      queue.splice(idx, 1)
    return p
  }

  function dispatchToSlot(slot: WorkerSlot, pending: Pending) {
    slot.busyTaskId = pending.taskId
    pending.worker = slot
    const queuedMs = Math.round(performance.now() - pending.enqueuedAt)
    const waitReadyStart = performance.now()
    log?.(
      `directory-io dispatch task=${pending.taskId} priority=${pending.priority} `
      + `queuedMs=${queuedMs} dir=${pending.request.dirPath}`,
    )
    const ready = slot.ready
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
        slot.readyResolvers.push(resolve)
      })
    const readyDeadlineMs = Math.max(5000, Math.min(15000, (pending.request.deadlineMs || 0) + 3000))
    let readyTimer: ReturnType<typeof setTimeout> | undefined
    if (!slot.ready) {
      readyTimer = setTimeout(() => {
        cancelTask(pending.taskId, `worker-ready-deadline:${readyDeadlineMs}ms`)
      }, readyDeadlineMs)
    }
    void ready.then(() => {
      if (readyTimer) {
        clearTimeout(readyTimer)
        readyTimer = undefined
      }
      if (pending.cancelled) {
        // 已经被取消（terminate 应已在 cancel 路径执行）
        return
      }
      const readyWaitMs = Math.round(performance.now() - waitReadyStart)
      pending.startedAt = performance.now()
      armDeadline(pending)
      log?.(
        `directory-io post task=${pending.taskId} priority=${pending.priority} `
        + `readyWaitMs=${readyWaitMs} deadlineMs=${pending.request.deadlineMs || 0} dir=${pending.request.dirPath}`,
      )
      slot.worker.postMessage({
        id: pending.taskId,
        dirPath: pending.request.dirPath,
        mode: pending.request.mode,
        scanExts: pending.request.scanExts,
        excludeBasenames: pending.request.excludeBasenames,
        fastImageLimit: pending.request.fastImageLimit,
        imageOffset: pending.request.imageOffset,
        imageLimit: pending.request.imageLimit,
        deadlineMs: pending.request.deadlineMs,
      })
    })
  }

  function armDeadline(pending: Pending) {
    if (!pending.request.deadlineMs || pending.request.deadlineMs <= 0 || pending.timeout) {
      return
    }
    pending.timeout = setTimeout(() => {
      cancelTask(pending.taskId, `deadline:${Math.round(pending.request.deadlineMs || 0)}ms`)
    }, pending.request.deadlineMs)
  }

  function pumpQueue() {
    if (disposed)
      return
    while (queue.length) {
      const idle = workers.find(w => w.busyTaskId == null)
      if (!idle)
        break
      const next = pickNextQueuedTask()
      // 当 next 已经不在 pendingMap 时（例如调用者已 cancel），跳过
      if (!pendingMap.has(next.taskId))
        continue
      dispatchToSlot(idle, next)
    }
  }

  function priorityRank(priority: DirectoryIoPriority) {
    switch (priority) {
      case 'click':
        return 0
      case 'normal':
        return 1
      case 'background':
        return 2
      default:
        return 1
    }
  }

  function pickNextQueuedTask(): Pending {
    let bestIndex = 0
    let best = queue[0]

    for (let i = 1; i < queue.length; i++) {
      const task = queue[i]
      const taskRank = priorityRank(task.priority)
      const bestRank = priorityRank(best.priority)
      if (
        taskRank < bestRank
        || (taskRank === bestRank && task.priority === 'click' && task.seq > best.seq)
        || (taskRank === bestRank && task.priority !== 'click' && task.seq < best.seq)
      ) {
        best = task
        bestIndex = i
      }
    }

    queue.splice(bestIndex, 1)
    return best
  }

  function cancelQueuedNonClickTasks(exceptDirPath: string): number {
    if (!queue.length) {
      return 0
    }
    let cancelled = 0
    for (let i = queue.length - 1; i >= 0; i--) {
      const pending = queue[i]
      if (pending.request.dirPath === exceptDirPath) {
        continue
      }
      if (pending.priority === 'click') {
        continue
      }
      cancelTask(pending.taskId, 'superseded-by-click-queued')
      cancelled++
    }
    return cancelled
  }

  function cancelNonClickTasks(reason: string, opts: { exceptDirPath?: string } = {}): number {
    const taskIds: number[] = []

    for (let i = queue.length - 1; i >= 0; i--) {
      const pending = queue[i]
      if (pending.priority === 'click') {
        continue
      }
      if (opts.exceptDirPath && pending.request.dirPath === opts.exceptDirPath) {
        continue
      }
      taskIds.push(pending.taskId)
    }

    for (const slot of workers) {
      if (slot.busyTaskId == null) {
        continue
      }
      const pending = pendingMap.get(slot.busyTaskId)
      if (!pending || pending.priority === 'click') {
        continue
      }
      if (opts.exceptDirPath && pending.request.dirPath === opts.exceptDirPath) {
        continue
      }
      taskIds.push(pending.taskId)
    }

    for (const taskId of taskIds) {
      cancelTask(taskId, reason)
    }

    if (taskIds.length > 0) {
      log?.(`directory-io cancelled non-click tasks n=${taskIds.length} reason=${reason}`)
    }
    return taskIds.length
  }

  // 初始化 worker 池
  for (let i = 0; i < poolSize; i++) {
    workers.push(spawnWorker())
  }

  function read(request: DirectoryIoRequest, cancelToken?: CancelToken): Promise<DirectoryIoResult> {
    if (disposed) {
      return Promise.resolve({ ok: false, error: 'pool disposed', readMs: 0 })
    }
    const taskId = nextTaskId++
    const startedAt = performance.now()
    const priority = request.priority || 'normal'

    return new Promise<DirectoryIoResult>((resolve, reject) => {
      const pending: Pending = {
        taskId,
        request,
        resolve,
        reject,
        startedAt,
        enqueuedAt: performance.now(),
        cancelled: false,
        cancelToken,
        priority,
        seq: seq++,
      }

      if (cancelToken) {
        pending.cancelListener = cancelToken.onCancel(() => cancelTask(taskId, cancelToken.reason || 'cancelled'))
        if (cancelToken.cancelled) {
          // 已取消
          resolve({ ok: false, error: cancelToken.reason || 'cancelled', readMs: 0, cancelled: true })
          return
        }
      }

      pendingMap.set(taskId, pending)
      if (priority === 'click') {
        const cancelled = cancelQueuedNonClickTasks(request.dirPath)
        if (cancelled > 0) {
          log?.(`directory-io click cancelled queued tasks n=${cancelled} dir=${request.dirPath}`)
        }
        const preempted = preemptOldestNormal(req =>
          req.dirPath !== request.dirPath
          && (req.priority || 'normal') !== 'click',
        )
        if (preempted) {
          log?.(`directory-io click preempted active task dir=${request.dirPath}`)
        }
      }
      queue.push(pending)
      log?.(
        `directory-io queued task=${taskId} priority=${priority} `
        + `queued=${queue.length} stats=${JSON.stringify(stats())} dir=${request.dirPath}`,
      )
      pumpQueue()
    })
  }

  function cancelTask(taskId: number, reason: string) {
    const pending = pendingMap.get(taskId)
    if (!pending)
      return
    pending.cancelled = true
    if (pending.timeout) {
      clearTimeout(pending.timeout)
      pending.timeout = undefined
    }

    if (pending.worker && pending.worker.busyTaskId === taskId) {
      // 已派发给 worker 并正在执行 — 杀掉 worker 强制取消
      log?.(`directory-io cancel via terminate task=${taskId} reason=${reason} dir=${pending.request.dirPath}`)
      const slot = pending.worker
      const workerIndex = workers.indexOf(slot)
      if (workerIndex !== -1) {
        workers.splice(workerIndex, 1)
      }
      slot.busyTaskId = null
      // 立即返回结果给调用者（避免它继续等）
      pendingMap.delete(taskId)
      pending.resolve({
        ok: false,
        error: reason,
        readMs: performance.now() - pending.startedAt,
        cancelled: true,
      })
      pending.cancelListener?.()
      // 强杀；同步 fs 卡住时 exit 可能很晚才到，所以这里立即补一个新 worker。
      slot.worker.terminate().catch(() => {})
      if (!disposed && workers.length < poolSize) {
        workers.push(spawnWorker())
      }
      pumpQueue()
    }
    else {
      // 还在队列 — 直接出队
      pendingMap.delete(taskId)
      const idx = queue.findIndex(q => q.taskId === taskId)
      if (idx !== -1)
        queue.splice(idx, 1)
      pending.resolve({
        ok: false,
        error: reason,
        readMs: performance.now() - pending.startedAt,
        cancelled: true,
      })
      pending.cancelListener?.()
    }
  }

  /**
   * 抢占式分配：找一个最旧的、低优先级的任务并取消它，腾出 worker 给新任务。
   * 由调用方决定何时调用（例如 click 优先级到来且所有 worker 都 busy）。
   */
  function preemptOldestNormal(filter: (req: DirectoryIoRequest, busyTaskId: number) => boolean): boolean {
    let candidate: { slot: WorkerSlot, taskId: number, startedAt: number } | null = null
    for (const slot of workers) {
      if (slot.busyTaskId == null)
        continue
      const p = pendingMap.get(slot.busyTaskId)
      if (!p)
        continue
      if (!filter(p.request, p.taskId))
        continue
      if (!candidate || p.startedAt < candidate.startedAt) {
        candidate = { slot, taskId: p.taskId, startedAt: p.startedAt }
      }
    }
    if (!candidate)
      return false
    cancelTask(candidate.taskId, 'preempted-by-priority')
    return true
  }

  function dispose() {
    disposed = true
    for (const slot of workers) {
      slot.worker.terminate().catch(() => {})
    }
    workers.length = 0
    for (const p of pendingMap.values()) {
      p.resolve({ ok: false, error: 'pool disposed', readMs: 0, cancelled: true })
    }
    pendingMap.clear()
    queue.length = 0
  }

  function stats() {
    const busy = workers.reduce((acc, w) => acc + (w.busyTaskId != null ? 1 : 0), 0)
    return {
      workers: workers.length,
      busy,
      queued: queue.length,
      pending: pendingMap.size,
    }
  }

  return {
    read,
    cancelNonClickTasks,
    cancelTask,
    preemptOldestNormal,
    dispose,
    stats,
  }
}

export type DirectoryIoPool = ReturnType<typeof createDirectoryIoPool>

export function resolveBundledWorkerPath(extensionDist: string): string {
  // 由 tsup build 输出到 dist/directory-io-worker.js
  return path.join(extensionDist, 'directory-io-worker.js')
}
