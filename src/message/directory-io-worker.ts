/**
 * Directory I/O Worker — runs directory reads in an isolated worker thread.
 *
 * Two modes:
 * - snapshot/fast: readdir() in one call — one network round-trip on SSHFS.
 *   Fast for small dirs, but blocks until all entries arrive (e.g. 44s for 1602 files).
 * - streaming: opendir() + handle.read() per entry. Returns partial results when
 *   deadlineMs is hit (complete=false). Caller shows what arrived and fetches the rest.
 *   Slower per-entry on SSHFS (~28ms/entry) but gives the user something to see quickly.
 *
 * Synchronous fs is intentional here. Async fs inside a worker still uses libuv
 * worker threads, and timed-out SSHFS reads can keep those threads occupied after
 * worker.terminate(). Sync fs blocks only this worker thread, so a stuck remote read
 * cannot poison the extension host's shared libuv pool or make later local reads hang.
 */

import type { Dir, Dirent } from 'node:fs'
import { opendirSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { parentPort, workerData } from 'node:worker_threads'

type ReadMode = 'snapshot' | 'fast' | 'streaming'

type ReadRequest = {
  id: number
  dirPath: string
  mode: ReadMode
  scanExts: string[]
  excludeBasenames?: string[]
  fastImageLimit?: number
  imageOffset?: number
  imageLimit?: number
  /** streaming mode: return partial results after this many ms (complete=false) */
  deadlineMs?: number
}

type ReadResponse
  = | {
    id: number
    ok: true
    dirs: string[]
    imagePaths: string[]
    directImageCount: number
    scannedEntries: number
    complete: boolean
    readMs: number
  }
  | {
    id: number
    ok: false
    error: string
    readMs: number
  }

if (!parentPort) {
  throw new Error('directory-io-worker must be run as a Worker')
}

const port = parentPort

function slashPath(p: string) {
  return p.replace(/\\/g, '/')
}

function isImageFile(name: string, scanExts: Set<string>): boolean {
  const dot = name.lastIndexOf('.')
  if (dot < 0)
    return false
  return scanExts.has(name.slice(dot + 1).toLowerCase())
}

function isExcludedBasename(name: string, excludeSet: Set<string> | undefined): boolean {
  return !!excludeSet?.has(name)
}

function handleRequest(req: ReadRequest): ReadResponse {
  const start = performance.now()
  const scanExts = new Set(req.scanExts.map(s => s.toLowerCase()))
  const excludeSet = req.excludeBasenames ? new Set(req.excludeBasenames) : undefined
  const dirs: string[] = []
  const imagePaths: string[] = []
  const imageOffset = Math.max(0, Math.floor(req.imageOffset || 0))
  const imageLimit = req.imageLimit === undefined
    ? Number.POSITIVE_INFINITY
    : Math.max(0, Math.floor(req.imageLimit))
  const imageEnd = imageLimit === Number.POSITIVE_INFINITY
    ? Number.POSITIVE_INFINITY
    : imageOffset + imageLimit
  let complete = true
  let directImageCount = 0

  function addImagePath(name: string) {
    if (directImageCount >= imageOffset && directImageCount < imageEnd) {
      imagePaths.push(slashPath(path.join(req.dirPath, name)))
    }
    directImageCount++
  }

  if (req.mode === 'streaming' || req.mode === 'fast') {
    // Streaming/fast: opendir + per-entry read. Fast mode returns as soon as
    // the requested image window is filled, so image pages do not wait for a
    // full readdir of thousand-file folders.
    const deadlineAt = req.deadlineMs && req.deadlineMs > 0 ? start + req.deadlineMs : Infinity
    const shouldStopOnImagePage = req.mode === 'fast' || (req.mode === 'streaming' && imageOffset === 0 && imageLimit > 0)
    let handle: Dir | undefined
    try {
      const openOptions = req.mode === 'fast'
        ? { bufferSize: 64 }
        : undefined
      handle = opendirSync(req.dirPath, openOptions)
      while (true) {
        if (performance.now() >= deadlineAt) {
          complete = false
          break
        }
        const entry = handle.readSync()
        if (!entry)
          break
        if (entry.isSymbolicLink?.())
          continue
        const name = entry.name
        if (isExcludedBasename(name, excludeSet))
          continue
        if (entry.isDirectory()) {
          const fullPath = slashPath(path.join(req.dirPath, name))
          dirs.push(fullPath)
          continue
        }
        if (entry.isFile() && isImageFile(name, scanExts)) {
          addImagePath(name)
          if (req.fastImageLimit && imagePaths.length >= req.fastImageLimit) {
            complete = false
            break
          }
          if (shouldStopOnImagePage && imagePaths.length >= (req.fastImageLimit || imageLimit)) {
            complete = false
            break
          }
        }
      }
    }
    catch (err) {
      return { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err), readMs: performance.now() - start }
    }
    finally {
      try {
        handle?.closeSync()
      }
      catch {}
    }
  }
  else {
    // snapshot: complete readdir() for directory skeletons.
    try {
      const entries = readdirSync(req.dirPath, { withFileTypes: true }) as Dirent[]
      for (const entry of entries) {
        if (entry.isSymbolicLink?.())
          continue
        const name = entry.name
        if (isExcludedBasename(name, excludeSet))
          continue
        if (entry.isDirectory()) {
          const fullPath = slashPath(path.join(req.dirPath, name))
          dirs.push(fullPath)
          continue
        }
        if (entry.isFile() && isImageFile(name, scanExts)) {
          addImagePath(name)
        }
      }
    }
    catch (err) {
      return { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err), readMs: performance.now() - start }
    }
  }

  return {
    id: req.id,
    ok: true,
    dirs,
    imagePaths,
    directImageCount,
    scannedEntries: dirs.length + directImageCount,
    complete,
    readMs: performance.now() - start,
  }
}

port.on('message', (req: ReadRequest) => {
  port.postMessage(handleRequest(req))
})

// Send ready ack so the pool knows this worker is initialized
port.postMessage({ id: -1, ok: true, dirs: [], imagePaths: [], directImageCount: 0, scannedEntries: 0, complete: true, readMs: 0 })
void workerData
