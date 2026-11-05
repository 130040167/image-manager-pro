import type { Buffer } from 'node:buffer'
import type { CustomFormatConfig } from '../core/custom-format/types'
import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { parentPort } from 'node:worker_threads'
import { customImageCacheKey, decodeCustomImage, encodeRawPixelsToJpeg, isLikelyCustomImageFile } from '../core/custom-format'
import { buildJpegThumbnail } from '../utils/node/image-type'

type ThumbnailRequest = {
  id: number
  cacheDir: string
  cacheVersion: string
  customFormats?: Partial<CustomFormatConfig>
  filePath: string
  maxWidth: number
  sharpPath: string
  sourceMtimeMs?: number
  sourceSize?: number
}

type ThumbnailResponse
  = | {
    id: number
    ok: true
    cacheHit: boolean
    cachePath: string
    filePath: string
    readMs: number
  }
  | {
    id: number
    ok: false
    error: string
    filePath: string
    readMs: number
  }

if (!parentPort) {
  throw new Error('thumbnail-worker must be run as a Worker')
}

const port = parentPort

let loadedSharpPath = ''
let sharp: any

function debug(req: Pick<ThumbnailRequest, 'id' | 'filePath'>, message: string) {
  port.postMessage({
    __thumbnailDebug: true,
    filePath: req.filePath,
    id: req.id,
    message: `${message} file=${req.filePath}`,
  })
}

function slashPath(filePath: string) {
  return filePath.replace(/\\/g, '/')
}

function hashKey(filePath: string) {
  let h = 5381
  for (let i = 0; i < filePath.length; i++) h = ((h << 5) + h + filePath.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

function loadSharp(sharpPath: string) {
  if (sharp && loadedSharpPath === sharpPath) {
    return sharp
  }
  // sharp is installed/copied by the extension and loaded by absolute path.

  const sharpModule = require(sharpPath)
  sharp = sharpModule.default || sharpModule.sharp || sharpModule
  loadedSharpPath = sharpPath
  return sharp
}

async function createThumbnail(req: ThumbnailRequest): Promise<ThumbnailResponse> {
  const start = performance.now()
  try {
    debug(req, `start maxWidth=${req.maxWidth} cacheVersion=${req.cacheVersion}`)
    fs.mkdirSync(req.cacheDir, { recursive: true })

    const stat = Number.isFinite(req.sourceMtimeMs) && Number.isFinite(req.sourceSize)
      ? { mtimeMs: req.sourceMtimeMs as number, size: req.sourceSize as number }
      : fs.statSync(req.filePath)
    debug(req, `stat ok size=${stat.size} mtimeMs=${stat.mtimeMs} reused=${Number.isFinite(req.sourceMtimeMs)}`)
    const isCustomImage = isLikelyCustomImageFile(req.filePath, req.customFormats)
    const cacheIdentity = isCustomImage
      ? customImageCacheKey(req.filePath, stat, 'thumbnail:first-page', req.customFormats, { pageIndex: 0 })
      : req.filePath
    const cacheName = `${path.basename(req.filePath, path.extname(req.filePath))}.${hashKey(cacheIdentity)}.${stat.mtimeMs}.${req.cacheVersion}.jpg`
    const cachePath = slashPath(path.join(req.cacheDir, cacheName))
    debug(req, `cache path=${cachePath}`)

    try {
      fs.statSync(cachePath)
      debug(req, `cache hit elapsedMs=${Math.round(performance.now() - start)}`)
      return {
        id: req.id,
        ok: true,
        cacheHit: true,
        cachePath,
        filePath: req.filePath,
        readMs: performance.now() - start,
      }
    }
    catch {}

    const loadSharpStart = performance.now()
    const sharpImpl = loadSharp(req.sharpPath)
    debug(req, `sharp loaded path=${req.sharpPath} elapsedMs=${Math.round(performance.now() - loadSharpStart)}`)
    let thumbBuf: Buffer
    if (isCustomImage) {
      debug(req, 'custom decode start')
      const decoded = await decodeCustomImage(req.filePath, { pageIndex: 0 }, req.customFormats, sharpImpl)
      debug(req, `custom decode done ${decoded.width}x${decoded.height}`)
      if (!decoded.pixels?.length) {
        throw new Error('custom thumbnail decode returned empty pixels')
      }
      thumbBuf = await encodeRawPixelsToJpeg(decoded, sharpImpl, req.maxWidth, 'width', 70)
    }
    else {
      const normalizeStart = performance.now()
      thumbBuf = await buildJpegThumbnail(req.filePath, sharpImpl, req.maxWidth)
      debug(
        req,
        `thumbnail encoded bytes=${thumbBuf.length} elapsedMs=${Math.round(performance.now() - normalizeStart)}`,
      )
    }

    fs.writeFileSync(cachePath, thumbBuf)
    debug(req, `write ok bytes=${thumbBuf.length} elapsedMs=${Math.round(performance.now() - start)}`)

    return {
      id: req.id,
      ok: true,
      cacheHit: false,
      cachePath,
      filePath: req.filePath,
      readMs: performance.now() - start,
    }
  }
  catch (err) {
    debug(req, `failed ${err instanceof Error ? err.message : String(err)} elapsedMs=${Math.round(performance.now() - start)}`)
    return {
      id: req.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      filePath: req.filePath,
      readMs: performance.now() - start,
    }
  }
}

port.on('message', (req: ThumbnailRequest) => {
  void createThumbnail(req).then(result => port.postMessage(result))
})

port.postMessage({
  cacheHit: false,
  cachePath: '',
  filePath: '',
  id: -1,
  ok: true,
  readMs: 0,
})
