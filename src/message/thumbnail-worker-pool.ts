import type { CustomFormatConfig } from '~/core/custom-format/types'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { Worker } from 'node:worker_threads'

export type ThumbnailRequest = {
  cacheDir: string
  cacheVersion: string
  customFormats?: Partial<CustomFormatConfig>
  filePath: string
  maxWidth: number
  sharpPath: string
  sourceMtimeMs?: number
  sourceSize?: number
  timeoutMs?: number
}

export type ThumbnailSuccess = {
  ok: true
  cacheHit: boolean
  cachePath: string
  filePath: string
  readMs: number
}

export type ThumbnailFailure = {
  ok: false
  cancelled?: boolean
  error: string
  filePath: string
  readMs: number
}

export type ThumbnailResult = ThumbnailSuccess | ThumbnailFailure

type WorkerSlot = {
  busyTaskId: number | null
  ready: boolean
  readyResolvers: Array<() => void>
  worker: Worker
}

type Pending = {
  enqueuedAt: number
  filePath: string
  reject: (err: unknown) => void
  request: ThumbnailRequest
  resolve: (res: ThumbnailResult) => void
  startedAt: number
  taskId: number
  timeout?: ReturnType<typeof setTimeout>
  worker?: WorkerSlot
}

export type ThumbnailWorkerPoolOptions = {
  log?: (msg: string) => void
  poolSize?: number
  workerScript: string
}

export function createThumbnailWorkerPool(options: ThumbnailWorkerPoolOptions) {
  const log = options.log
  const poolSize = Math.max(1, options.poolSize || 1)
  const workers: WorkerSlot[] = []
  const queue: Pending[] = []
  const pendingMap = new Map<number, Pending>()
  let disposed = false
  let nextTaskId = 1

  function spawnWorker(): WorkerSlot {
    const worker = new Worker(options.workerScript, { execArgv: [] })
    const slot: WorkerSlot = {
      busyTaskId: null,
      ready: false,
      readyResolvers: [],
      worker,
    }

    worker.on('online', () => {
      log?.('thumbnail worker online')
    })

    worker.on('message', (msg: any) => {
      if (msg && msg.__thumbnailDebug) {
        const task = typeof msg.id === 'number' && msg.id >= 0 ? ` task=${msg.id}` : ''
        log?.(`thumbnail worker debug${task} ${msg.message || ''}`)
        return
      }

      if (!slot.ready && msg && msg.id === -1) {
        slot.ready = true
        log?.('thumbnail worker ready')
        const resolvers = slot.readyResolvers.splice(0)
        resolvers.forEach(resolve => resolve())
        return
      }

      if (slot.busyTaskId == null) {
        return
      }
      const taskId = slot.busyTaskId
      const pending = popPending(taskId)
      slot.busyTaskId = null
      if (!pending) {
        pumpQueue()
        return
      }

      const result = msg as ThumbnailResult
      log?.(
        `thumbnail result task=${taskId} ok=${result.ok} readMs=${Math.round(result.readMs)} `
        + `${result.ok ? `cacheHit=${result.cacheHit}` : `error=${result.error}`} file=${pending.filePath}`,
      )
      pending.resolve(result)
      pumpQueue()
    })

    worker.on('error', (err) => {
      log?.(`thumbnail worker error: ${err.message}`)
      handleWorkerExit(slot, `error:${err.message}`)
    })

    worker.on('exit', (code) => {
      log?.(`thumbnail worker exit code=${code}`)
      handleWorkerExit(slot, `exit:${code}`)
    })

    return slot
  }

  function popPending(taskId: number): Pending | undefined {
    const pending = pendingMap.get(taskId)
    if (!pending) {
      return undefined
    }
    pendingMap.delete(taskId)
    if (pending.timeout) {
      clearTimeout(pending.timeout)
      pending.timeout = undefined
    }
    const index = queue.findIndex(item => item.taskId === taskId)
    if (index !== -1) {
      queue.splice(index, 1)
    }
    return pending
  }

  function handleWorkerExit(slot: WorkerSlot, reason: string) {
    const index = workers.indexOf(slot)
    if (index !== -1) {
      workers.splice(index, 1)
    }

    if (slot.busyTaskId != null) {
      const pending = popPending(slot.busyTaskId)
      slot.busyTaskId = null
      if (pending) {
        pending.resolve({
          cancelled: true,
          error: reason,
          filePath: pending.filePath,
          ok: false,
          readMs: performance.now() - pending.startedAt,
        })
      }
    }

    if (!disposed && workers.length < poolSize) {
      workers.push(spawnWorker())
    }
    pumpQueue()
  }

  function dispatchToSlot(slot: WorkerSlot, pending: Pending) {
    slot.busyTaskId = pending.taskId
    pending.worker = slot
    const queuedMs = Math.round(performance.now() - pending.enqueuedAt)
    const waitReadyStart = performance.now()
    log?.(`thumbnail dispatch task=${pending.taskId} queuedMs=${queuedMs} file=${pending.filePath}`)

    const ready = slot.ready
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
        slot.readyResolvers.push(resolve)
      })
    const readyTimeout = setTimeout(() => {
      cancelTask(pending.taskId, 'worker-ready-timeout')
    }, 8000)

    void ready.then(() => {
      clearTimeout(readyTimeout)
      if (!pendingMap.has(pending.taskId)) {
        return
      }
      pending.startedAt = performance.now()
      armDeadline(pending)
      log?.(
        `thumbnail post task=${pending.taskId} readyWaitMs=${Math.round(performance.now() - waitReadyStart)} `
        + `timeoutMs=${pending.request.timeoutMs || 0} file=${pending.filePath}`,
      )
      slot.worker.postMessage({
        cacheDir: pending.request.cacheDir,
        cacheVersion: pending.request.cacheVersion,
        customFormats: pending.request.customFormats,
        filePath: pending.request.filePath,
        id: pending.taskId,
        maxWidth: pending.request.maxWidth,
        sharpPath: pending.request.sharpPath,
        sourceMtimeMs: pending.request.sourceMtimeMs,
        sourceSize: pending.request.sourceSize,
      })
    })
  }

  function armDeadline(pending: Pending) {
    const timeoutMs = pending.request.timeoutMs || 0
    if (timeoutMs <= 0 || pending.timeout) {
      return
    }
    pending.timeout = setTimeout(() => {
      cancelTask(pending.taskId, `deadline:${timeoutMs}ms`)
    }, timeoutMs)
  }

  function pumpQueue() {
    if (disposed) {
      return
    }
    while (queue.length) {
      const idle = workers.find(worker => worker.busyTaskId == null)
      if (!idle) {
        break
      }
      const next = queue.shift()!
      if (!pendingMap.has(next.taskId)) {
        continue
      }
      dispatchToSlot(idle, next)
    }
  }

  function read(request: ThumbnailRequest): Promise<ThumbnailResult> {
    if (disposed) {
      return Promise.resolve({
        cancelled: true,
        error: 'pool disposed',
        filePath: request.filePath,
        ok: false,
        readMs: 0,
      })
    }

    const taskId = nextTaskId++
    return new Promise<ThumbnailResult>((resolve, reject) => {
      const pending: Pending = {
        enqueuedAt: performance.now(),
        filePath: request.filePath,
        reject,
        request,
        resolve,
        startedAt: performance.now(),
        taskId,
      }
      pendingMap.set(taskId, pending)
      queue.push(pending)
      log?.(`thumbnail queued task=${taskId} queued=${queue.length} stats=${JSON.stringify(stats())} file=${request.filePath}`)
      pumpQueue()
    })
  }

  function cancelTask(taskId: number, reason: string) {
    const pending = pendingMap.get(taskId)
    if (!pending) {
      return
    }
    if (pending.timeout) {
      clearTimeout(pending.timeout)
      pending.timeout = undefined
    }

    if (pending.worker && pending.worker.busyTaskId === taskId) {
      const slot = pending.worker
      log?.(`thumbnail cancel via terminate task=${taskId} reason=${reason} file=${pending.filePath}`)
      const index = workers.indexOf(slot)
      if (index !== -1) {
        workers.splice(index, 1)
      }
      slot.busyTaskId = null
      pendingMap.delete(taskId)
      pending.resolve({
        cancelled: true,
        error: reason,
        filePath: pending.filePath,
        ok: false,
        readMs: performance.now() - pending.startedAt,
      })
      slot.worker.terminate().catch(() => {})
      if (!disposed && workers.length < poolSize) {
        workers.push(spawnWorker())
      }
      pumpQueue()
      return
    }

    popPending(taskId)
    pending.resolve({
      cancelled: true,
      error: reason,
      filePath: pending.filePath,
      ok: false,
      readMs: performance.now() - pending.startedAt,
    })
  }

  function cancelAll(reason: string): number {
    const taskIds = Array.from(pendingMap.keys())
    for (const taskId of taskIds) {
      cancelTask(taskId, reason)
    }
    if (taskIds.length > 0) {
      log?.(`thumbnail cancelled all tasks n=${taskIds.length} reason=${reason}`)
    }
    return taskIds.length
  }

  function dispose() {
    disposed = true
    for (const slot of workers) {
      slot.worker.terminate().catch(() => {})
    }
    workers.length = 0
    for (const pending of pendingMap.values()) {
      if (pending.timeout) {
        clearTimeout(pending.timeout)
      }
      pending.resolve({
        cancelled: true,
        error: 'pool disposed',
        filePath: pending.filePath,
        ok: false,
        readMs: 0,
      })
    }
    pendingMap.clear()
    queue.length = 0
  }

  function stats() {
    const busy = workers.reduce((count, worker) => count + (worker.busyTaskId != null ? 1 : 0), 0)
    return {
      busy,
      pending: pendingMap.size,
      queued: queue.length,
      workers: workers.length,
    }
  }

  for (let i = 0; i < poolSize; i++) {
    workers.push(spawnWorker())
  }

  return {
    cancelAll,
    cancelTask,
    dispose,
    read,
    stats,
  }
}

export type ThumbnailWorkerPool = ReturnType<typeof createThumbnailWorkerPool>

export function resolveBundledThumbnailWorkerPath(extensionDist: string): string {
  return path.join(extensionDist, 'thumbnail-worker.js')
}
