import type { GlobEntry } from 'globby'
import type { SharpNS } from '~/@types/global'
import path from 'node:path'
import { isString } from 'antd/es/button'
import readExif from 'exif-reader'
import fs from 'fs-extra'
import { imageSizeFromFile } from 'image-size/fromFile'
import git from 'simple-git'
import { Config } from '~/core/config/config'
import { decodeCustomImage, getCustomFormatScanExtensions, isLikelyCustomImageFile } from '~/core/custom-format'
import { Global } from '~/core/global'
import { COMPRESSED_META } from '~/core/operator/meta'
import { Svgo } from '~/core/operator/svgo'
import { i18n } from '~/i18n'
import { Compressed } from '~/meta'
import { Channel } from '~/utils/node/channel'

const gitStagedCache = new Map<string, { timestamp: number, data: string[] }>()
const GIT_CACHE_DURATION = 10 * 1000 // 10s
const GIT_ERROR_CACHE_DURATION = 5 * 60 * 1000 // 5min

// 已知不是 git 仓库的根目录（避免每次都付出一次 git 探测的开销）
const nonRepoRoots = new Set<string>()

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
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

/**
 * 获取 git staged 中的图片
 */
export async function getStagedImages(root: string) {
  const cacheKey = root

  const currentCache = gitStagedCache.get(cacheKey)
  if (currentCache && Date.now() - currentCache.timestamp < GIT_CACHE_DURATION) {
    // 即便结果为空也算命中，不再重复请求 git
    Channel.debug('Get git staged images from cache')
    return currentCache.data
  }

  // 非 git 仓库：直接返回空，避免 simple-git 在没有 .git 时回落到 `--no-index`
  // 触发 ~3.6s 的 "unknown option `cached`" 错误路径。
  if (nonRepoRoots.has(root)) {
    return []
  }

  const simpleGit = git({ baseDir: root, binary: 'git' })

  try {
    const isRepo = await withTimeout(simpleGit.checkIsRepo(), 1500, false)
    if (!isRepo) {
      nonRepoRoots.add(root)
      gitStagedCache.set(cacheKey, {
        timestamp: Date.now(),
        data: [],
      })
      return []
    }

    const [gitRoot, files] = await withTimeout(
      Promise.all([
        simpleGit.revparse(['--show-toplevel']),
        simpleGit.diff(['--cached', '--diff-filter=ACMR', '--name-only']),
      ]),
      2000,
      ['', ''] as [string, string],
    )
    if (!gitRoot || !files)
      return []

    const imageFiles = files
      .split('\n')
      .filter(file => getCustomFormatScanExtensions(Config.file_scan, Config.file_customFormats).includes(path.extname(file).slice(1)))
      .map(file => path.join(gitRoot, file))

    gitStagedCache.set(cacheKey, {
      timestamp: Date.now(),
      data: imageFiles,
    })

    return imageFiles
  }
  catch (e) {
    Channel.debug(`${i18n.t('core.get_git_staged_error')}: ${e}`)
    nonRepoRoots.add(root)
    // 出错也加入缓存，避免坏仓库/远程盘持续重试拖慢整个 extension host
    gitStagedCache.set(cacheKey, {
      timestamp: Date.now() + GIT_ERROR_CACHE_DURATION - GIT_CACHE_DURATION,
      data: [],
    })
    return []
  }
}

/**
 * 清除 git staged 缓存
 */
export function clearGitStagedCache() {
  gitStagedCache.clear()
  nonRepoRoots.clear()
}

const metadataCache = new Map<
  string,
  {
    mtimeMs: number
    data: {
      filePath: string
      metadata: Metadata
      compressed: Compressed
      stats?: Pick<fs.Stats, 'mtimeMs' | 'size'>
    }
  }
>()

export type MetadataReadOptions = {
  signal?: AbortSignal
  skipStat?: boolean
  statTimeoutMs?: number
}

/**
 * 检查元数据缓存是否有效
 */
function isMetadataCacheValid(filePath: string, mtimeMs: number | undefined) {
  if (!mtimeMs) {
    return false
  }
  const cache = metadataCache.get(filePath)
  if (cache && cache.mtimeMs === mtimeMs) {
    return true
  }
  return false
}

/**
 * 获取图片元信息
 */
export async function getImageMetadata(image: string | GlobEntry, options: MetadataReadOptions = {}): Promise<{
  filePath: string
  metadata: Metadata
  compressed: Compressed
  stats?: Pick<fs.Stats, 'mtimeMs' | 'size'>
}> {
  let filePath = ''
  let stats: fs.Stats | undefined
  if (isString(image)) {
    filePath = image
    if (options.skipStat && options.statTimeoutMs) {
      stats = await withTimeout(fs.stat(filePath), options.statTimeoutMs, undefined)
    }
    else if (!options.skipStat) {
      try {
        stats = await fs.stat(filePath)
      }
      catch {}
    }
  }
  else {
    filePath = image.path
    stats = image.stats
  }

  if (options.signal?.aborted) {
    return {
      compressed: Compressed.unknown,
      filePath,
      metadata: {} as Metadata,
    }
  }

  if (options.skipStat) {
    const cache = metadataCache.get(filePath)
    if (cache) {
      return cache.data
    }
  }

  if (isMetadataCacheValid(filePath, stats?.mtimeMs)) {
    const cache = metadataCache.get(filePath)
    if (cache) {
      return cache.data
    }
  }

  let compressed = Compressed.no
  let metadata: SharpNS.Metadata = {} as SharpNS.Metadata
  let sharpFormatSupported = true

  if (Global.sharp && isLikelyCustomImageFile(filePath, Config.file_customFormats)) {
    try {
      const custom = await decodeCustomImage(filePath, {}, Config.file_customFormats, Global.sharp)
      const result = {
        compressed: Compressed.not_supported,
        filePath,
        metadata: {
          channels: custom.channels as Metadata['channels'],
          height: custom.height,
          shape: custom.shape,
          width: custom.width,
        } as Metadata,
        stats: stats ? { mtimeMs: stats.mtimeMs, size: stats.size } : undefined,
      }
      metadataCache.set(filePath, {
        mtimeMs: stats?.mtimeMs || 0,
        data: result,
      })
      return result
    }
    catch (err) {
      Channel.debug(`[custom-format] metadata decode failed: ${filePath} (${err instanceof Error ? err.message : String(err)})`)
    }
  }

  try {
    if (!Global.sharp) {
      throw new Error('sharp is not installed')
    }

    metadata = await Global.sharp?.(filePath, { failOn: 'none', sequentialRead: true })
      .timeout({ seconds: 2 })
      .metadata()
  }
  catch {
    if (options.signal?.aborted) {
      return {
        compressed: Compressed.unknown,
        filePath,
        metadata: {} as Metadata,
      }
    }

    // sharp 不支持该类型
    sharpFormatSupported = false

    try {
      metadata = ((await imageSizeFromFile(filePath).catch(() => {})) || {}) as SharpNS.Metadata
    }
    catch (e) {
      Channel.error(e)
    }
  }
  if (options.signal?.aborted) {
    return {
      compressed: Compressed.unknown,
      filePath,
      metadata: {} as Metadata,
    }
  }

  if (metadata.exif) {
    if (readExif(metadata.exif).Image?.ImageDescription?.includes(COMPRESSED_META)) {
      compressed = Compressed.yes
    }
  }
  else {
    if (sharpFormatSupported) {
      // 已知支持 exif 的格式
      const exifSupported = ['png', 'webp', 'jpg', 'jpeg', 'avif']

      // 已知不支持 exif 的格式

      // https://github.com/lovell/sharp/issues/3074#issuecomment-1030257856
      // EXIF metadata is unsupported for TIFF output.
      const exifNotSupported = ['svg', 'gif', 'tif', 'tiff']

      if (exifSupported.includes(metadata.format!)) {
        compressed = Compressed.no
      }
      else if (exifNotSupported.includes(metadata.format!)) {
        // 不支持 exif，无法判断是否压缩
        compressed = Compressed.unknown
      }
      else {
        // 不知道是否支持 exif 的格式
        // 旧版本会用 sharp().withExifMerge().toBuffer() 探测一次，等价于把整张图重新编码一次，
        // 在大量图像场景下是隐藏的高成本（每张图额外几十~几百毫秒）。
        // 这里直接判定为 unknown，让 UI 不再展示压缩标记即可。
        compressed = Compressed.unknown
      }
    }
    else {
      // sharp 不支持的格式
      compressed = Compressed.not_supported
    }
  }

  if (metadata.format === 'svg') {
    try {
      const svgString = await fs.readFile(filePath, 'utf-8')
      compressed = Svgo.isCompressed(svgString, Config.compression.svg) ? Compressed.yes : Compressed.no
    }
    catch (e) {
      Channel.error(e)
    }
  }

  const trimmedStats = stats ? { mtimeMs: stats.mtimeMs, size: stats.size } : undefined

  metadataCache.set(filePath, {
    mtimeMs: stats?.mtimeMs || 0,
    data: {
      filePath,
      metadata: {
        width: metadata.width,
        height: metadata.height,
        channels: metadata.channels,
      },
      compressed,
      stats: trimmedStats,
    },
  })

  return {
    filePath,
    metadata,
    compressed,
    stats: trimmedStats,
  }
}
