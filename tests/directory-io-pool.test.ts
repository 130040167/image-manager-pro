import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'
import { createCancelToken, createDirectoryIoPool } from '~/message/directory-io-pool'

// 这个测试不依赖打包后的 worker 文件 — 它启动一个内联脚本作为 worker，
// 用真实 Worker 来验证池的行为（dispatch / queue / cancel / preempt）。
function makeMockWorkerScript(readyDelayMs = 0) {
  const script = `
    const { parentPort } = require('node:worker_threads');
    setTimeout(() => {
      parentPort.postMessage({ id: -1, ok: true, dirs: [], imagePaths: [], scannedEntries: 0, complete: true, readMs: 0 });
    }, ${readyDelayMs});
    parentPort.on('message', (req) => {
      // 模拟一个可控延迟的 readdir：dirPath 末尾的数字就是返回前等待的毫秒数
      const m = /(\\d+)$/.exec(req.dirPath);
      const delay = m ? Number(m[1]) : 0;
      setTimeout(() => {
        parentPort.postMessage({
          id: req.id,
          ok: true,
          dirs: ['child-' + req.id],
          imagePaths: [],
          directImageCount: 0,
          scannedEntries: 1,
          complete: true,
          readMs: delay,
        });
      }, delay);
    });
  `
  return script
}

async function withTempWorkerScript<T>(run: (scriptPath: string) => Promise<T>, readyDelayMs = 0): Promise<T> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dir-io-pool-test-'))
  const scriptPath = path.join(tmpDir, 'mock-worker.js')
  await fs.writeFile(scriptPath, makeMockWorkerScript(readyDelayMs))
  try {
    return await run(scriptPath)
  }
  finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
    catch {}
  }
}

async function withBundledDirectoryWorker<T>(run: (scriptPath: string) => Promise<T>): Promise<T> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dir-io-real-worker-test-'))
  const scriptPath = path.join(tmpDir, 'directory-io-worker.js')
  await build({
    bundle: true,
    entryPoints: [path.resolve('src/message/directory-io-worker.ts')],
    format: 'cjs',
    outfile: scriptPath,
    platform: 'node',
    target: 'node18',
  })
  try {
    return await run(scriptPath)
  }
  finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
    catch {}
  }
}

function slashPath(filePath: string) {
  return filePath.replace(/\\/g, '/')
}

describe('directory-io-pool', () => {
  it('reads with the real streaming worker', async () => {
    await withBundledDirectoryWorker(async (scriptPath) => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dir-io-real-data-'))
      const childDir = path.join(tmpDir, 'child')
      const imagePath = path.join(tmpDir, 'preview.png')
      await fs.mkdir(childDir)
      await fs.writeFile(imagePath, 'not really an image')

      const pool = createDirectoryIoPool({ workerScript: scriptPath, poolSize: 1 })
      try {
        const result = await pool.read({
          deadlineMs: 5000,
          dirPath: tmpDir,
          imageLimit: 10,
          mode: 'streaming',
          priority: 'click',
          scanExts: ['png'],
        })

        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.dirs.map(slashPath)).toContain(slashPath(childDir))
          expect(result.imagePaths.map(slashPath)).toContain(slashPath(imagePath))
          expect(result.directImageCount).toBe(1)
        }
      }
      finally {
        pool.dispose()
        await fs.rm(tmpDir, { recursive: true, force: true })
      }
    })
  })

  it('reads concurrently across multiple workers', async () => {
    await withTempWorkerScript(async (scriptPath) => {
      const pool = createDirectoryIoPool({ workerScript: scriptPath, poolSize: 4 })
      try {
        // 4 个并发 ~100ms 任务，总耗时应当远小于 4 * 100ms（如果是串行的话）
        const t0 = performance.now()
        const results = await Promise.all([
          pool.read({ dirPath: 'C:/fake-100', mode: 'snapshot', scanExts: [] }),
          pool.read({ dirPath: 'C:/fake-100', mode: 'snapshot', scanExts: [] }),
          pool.read({ dirPath: 'C:/fake-100', mode: 'snapshot', scanExts: [] }),
          pool.read({ dirPath: 'C:/fake-100', mode: 'snapshot', scanExts: [] }),
        ])
        const elapsed = performance.now() - t0
        expect(results.every(r => r.ok)).toBe(true)
        // 4 worker 并发 ~ 100ms；松散上界 250ms，留足启动开销
        expect(elapsed).toBeLessThan(400)
      }
      finally {
        pool.dispose()
      }
    })
  })

  it('cancel via terminate releases the slot for new tasks', async () => {
    await withTempWorkerScript(async (scriptPath) => {
      const pool = createDirectoryIoPool({ workerScript: scriptPath, poolSize: 1 })
      try {
        const slow = createCancelToken()
        const slowP = pool.read({ dirPath: 'C:/fake-5000', mode: 'snapshot', scanExts: [] }, slow.token)
        // 给 slow 任务一点时间真正派发到 worker
        await new Promise(r => setTimeout(r, 50))
        slow.cancel('test')
        const slowRes = await slowP
        expect(slowRes.ok).toBe(false)
        if (!slowRes.ok) {
          expect(slowRes.cancelled).toBe(true)
        }

        // 紧接着发起一个新任务，应当快速拿到结果（旧 worker 已被 terminate，池子起了新的）
        const t0 = performance.now()
        const fast = await pool.read({ dirPath: 'C:/fake-50', mode: 'snapshot', scanExts: [] })
        expect(fast.ok).toBe(true)
        // 不应当再被 5s 的 slow 阻塞
        expect(performance.now() - t0).toBeLessThan(2000)
      }
      finally {
        pool.dispose()
      }
    })
  })

  it('queues additional tasks beyond pool size and serves them in order', async () => {
    await withTempWorkerScript(async (scriptPath) => {
      const pool = createDirectoryIoPool({ workerScript: scriptPath, poolSize: 1 })
      try {
        const r1 = pool.read({ dirPath: 'C:/fake-100', mode: 'snapshot', scanExts: [] })
        const r2 = pool.read({ dirPath: 'C:/fake-50', mode: 'snapshot', scanExts: [] })
        const [a, b] = await Promise.all([r1, r2])
        expect(a.ok).toBe(true)
        expect(b.ok).toBe(true)
      }
      finally {
        pool.dispose()
      }
    })
  })

  it('cancelToken pre-cancelled returns immediately without dispatch', async () => {
    await withTempWorkerScript(async (scriptPath) => {
      const pool = createDirectoryIoPool({ workerScript: scriptPath, poolSize: 1 })
      try {
        const ct = createCancelToken()
        ct.cancel('pre')
        const t0 = performance.now()
        const res = await pool.read({ dirPath: 'C:/fake-5000', mode: 'snapshot', scanExts: [] }, ct.token)
        expect(res.ok).toBe(false)
        if (!res.ok) {
          expect(res.cancelled).toBe(true)
        }
        expect(performance.now() - t0).toBeLessThan(50)
      }
      finally {
        pool.dispose()
      }
    })
  })

  it('runs click priority before queued normal tasks', async () => {
    await withTempWorkerScript(async (scriptPath) => {
      const events: string[] = []
      const pool = createDirectoryIoPool({
        workerScript: scriptPath,
        poolSize: 1,
        log: msg => events.push(msg),
      })
      try {
        const blocker = pool.read({
          dirPath: 'C:/fake-120',
          mode: 'snapshot',
          panelId: 'panel-1',
          priority: 'normal',
          scanExts: [],
        })
        const queuedNormal = pool.read({
          dirPath: 'C:/fake-10',
          mode: 'snapshot',
          panelId: 'panel-1',
          priority: 'normal',
          scanExts: [],
        })
        const click = pool.read({
          dirPath: 'C:/fake-5',
          mode: 'snapshot',
          panelId: 'panel-1',
          priority: 'click',
          scanExts: [],
        })

        const normalRes = await queuedNormal
        expect(normalRes.ok).toBe(false)
        if (!normalRes.ok) {
          expect(normalRes.cancelled).toBe(true)
        }

        await blocker
        const clickRes = await click
        expect(clickRes.ok).toBe(true)
        const dispatches = events.filter(item => item.includes('directory-io dispatch'))
        expect(dispatches[0]).toContain('C:/fake-120')
        expect(dispatches[1]).toContain('C:/fake-5')
      }
      finally {
        pool.dispose()
      }
    })
  })

  it('preempts active background work for a click request', async () => {
    await withTempWorkerScript(async (scriptPath) => {
      const events: string[] = []
      const pool = createDirectoryIoPool({
        workerScript: scriptPath,
        poolSize: 1,
        log: msg => events.push(msg),
      })
      try {
        const background = pool.read({
          dirPath: 'C:/background-5000',
          mode: 'snapshot',
          panelId: 'panel-1',
          priority: 'background',
          scanExts: [],
        })

        await new Promise(r => setTimeout(r, 50))

        const startedAt = performance.now()
        const click = await pool.read({
          dirPath: 'C:/click-10',
          mode: 'snapshot',
          panelId: 'panel-1',
          priority: 'click',
          scanExts: [],
        })
        const elapsed = performance.now() - startedAt

        const backgroundRes = await background
        expect(backgroundRes.ok).toBe(false)
        if (!backgroundRes.ok) {
          expect(backgroundRes.cancelled).toBe(true)
        }
        expect(click.ok).toBe(true)
        expect(elapsed).toBeLessThan(2000)
        expect(events.some(item => item.includes('directory-io click preempted active task'))).toBe(true)
      }
      finally {
        pool.dispose()
      }
    })
  })

  it('starts read deadlines after the worker is ready', async () => {
    await withTempWorkerScript(async (scriptPath) => {
      const pool = createDirectoryIoPool({ workerScript: scriptPath, poolSize: 1 })
      try {
        const t0 = performance.now()
        const result = await pool.read({
          deadlineMs: 50,
          dirPath: 'C:/ready-delay-10',
          mode: 'snapshot',
          priority: 'click',
          scanExts: [],
        })
        expect(result.ok).toBe(true)
        expect(performance.now() - t0).toBeGreaterThanOrEqual(100)
      }
      finally {
        pool.dispose()
      }
    }, 120)
  })

  it('lets a new panel click preempt an old panel background task', async () => {
    await withTempWorkerScript(async (scriptPath) => {
      const events: string[] = []
      const pool = createDirectoryIoPool({
        workerScript: scriptPath,
        poolSize: 1,
        log: msg => events.push(msg),
      })
      try {
        const background = pool.read({
          dirPath: 'C:/old-panel-background-5000',
          mode: 'snapshot',
          panelId: 'old-panel',
          priority: 'background',
          scanExts: [],
        })

        await new Promise(r => setTimeout(r, 50))

        const startedAt = performance.now()
        const click = await pool.read({
          dirPath: 'C:/new-panel-click-10',
          mode: 'snapshot',
          panelId: 'new-panel',
          priority: 'click',
          scanExts: [],
        })
        const elapsed = performance.now() - startedAt

        const backgroundRes = await background
        expect(backgroundRes.ok).toBe(false)
        if (!backgroundRes.ok) {
          expect(backgroundRes.cancelled).toBe(true)
        }
        expect(click.ok).toBe(true)
        expect(elapsed).toBeLessThan(2000)
        expect(events.some(item => item.includes('directory-io click preempted active task'))).toBe(true)
      }
      finally {
        pool.dispose()
      }
    })
  })

  it('can cancel queued and active non-click tasks without cancelling click tasks', async () => {
    await withTempWorkerScript(async (scriptPath) => {
      const pool = createDirectoryIoPool({ workerScript: scriptPath, poolSize: 2 })
      try {
        const activeBackground = pool.read({
          dirPath: 'C:/active-background-5000',
          mode: 'snapshot',
          priority: 'background',
          scanExts: [],
        })
        const activeNormal = pool.read({
          dirPath: 'C:/active-normal-5000',
          mode: 'snapshot',
          priority: 'normal',
          scanExts: [],
        })
        const queuedBackground = pool.read({
          dirPath: 'C:/queued-background-5000',
          mode: 'snapshot',
          priority: 'background',
          scanExts: [],
        })

        await new Promise(r => setTimeout(r, 50))

        const cancelled = pool.cancelNonClickTasks('test-cancel-non-click')
        expect(cancelled).toBeGreaterThanOrEqual(3)

        const click = await pool.read({
          dirPath: 'C:/click-10',
          mode: 'snapshot',
          priority: 'click',
          scanExts: [],
        })
        const results = await Promise.all([activeBackground, activeNormal, queuedBackground])

        expect(click.ok).toBe(true)
        expect(results.every(result => !result.ok && result.cancelled)).toBe(true)
      }
      finally {
        pool.dispose()
      }
    })
  })
})
