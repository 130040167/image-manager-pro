import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createThumbnailWorkerPool } from '~/message/thumbnail-worker-pool'

function makeMockWorkerScript() {
  return `
    const { parentPort } = require('node:worker_threads');
    parentPort.postMessage({ id: -1, ok: true, filePath: '', cachePath: '', cacheHit: false, readMs: 0 });
    parentPort.on('message', (req) => {
      const m = /(\\d+)$/.exec(req.filePath);
      const delay = m ? Number(m[1]) : 0;
      setTimeout(() => {
        parentPort.postMessage({
          id: req.id,
          ok: true,
          filePath: req.filePath,
          cachePath: req.cacheDir + '/thumb-' + req.id + '.jpg',
          cacheHit: false,
          readMs: delay,
        });
      }, delay);
    });
  `
}

async function withTempWorkerScript<T>(run: (scriptPath: string) => Promise<T>): Promise<T> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'thumb-pool-test-'))
  const scriptPath = path.join(tmpDir, 'mock-thumbnail-worker.js')
  await fs.writeFile(scriptPath, makeMockWorkerScript())
  try {
    return await run(scriptPath)
  }
  finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

describe('thumbnail-worker-pool', () => {
  it('runs thumbnail tasks concurrently across workers', async () => {
    await withTempWorkerScript(async (scriptPath) => {
      const pool = createThumbnailWorkerPool({ workerScript: scriptPath, poolSize: 2 })
      try {
        const startedAt = performance.now()
        const results = await Promise.all([
          pool.read({ cacheDir: 'C:/cache', cacheVersion: 'v-test', filePath: 'C:/image-100', maxWidth: 200, sharpPath: 'sharp' }),
          pool.read({ cacheDir: 'C:/cache', cacheVersion: 'v-test', filePath: 'C:/image-100', maxWidth: 200, sharpPath: 'sharp' }),
        ])
        expect(results.every(result => result.ok)).toBe(true)
        expect(performance.now() - startedAt).toBeLessThan(350)
      }
      finally {
        pool.dispose()
      }
    })
  })

  it('terminates a timed out worker and serves the next task', async () => {
    await withTempWorkerScript(async (scriptPath) => {
      const pool = createThumbnailWorkerPool({ workerScript: scriptPath, poolSize: 1 })
      try {
        const slow = await pool.read({
          cacheDir: 'C:/cache',
          cacheVersion: 'v-test',
          filePath: 'C:/image-5000',
          maxWidth: 200,
          sharpPath: 'sharp',
          timeoutMs: 50,
        })
        expect(slow.ok).toBe(false)
        if (!slow.ok) {
          expect(slow.cancelled).toBe(true)
        }

        const startedAt = performance.now()
        const fast = await pool.read({
          cacheDir: 'C:/cache',
          cacheVersion: 'v-test',
          filePath: 'C:/image-20',
          maxWidth: 200,
          sharpPath: 'sharp',
          timeoutMs: 1000,
        })
        expect(fast.ok).toBe(true)
        expect(performance.now() - startedAt).toBeLessThan(1500)
      }
      finally {
        pool.dispose()
      }
    })
  })
})
