import { Buffer } from 'node:buffer'
import path from 'node:path'
import fs from 'fs-extra'
import mime from 'mime/lite'
import { decodeClassicTiff, looksLikeClassicTiff } from './tiff-classic'

/**
 * 判断是否为 base64
 */
export function isBase64(str: string) {
  return /^data:[a-z]+\/[a-z]+;base64,/.test(str)
}

/**
 * buffer 转 base64
 */
export function toBase64(mimetype: string, buffer: Buffer) {
  return `data:${mimetype};base64,${buffer.toString('base64')}`
}

/**
 * 判断浏览器是否支持某个图片格式
 * 如果不支持，则返回一个默认的 mimetype
 */
const BROWSER_UNSUPPORTED_EXTENSIONS = new Set(['heic', 'heif', 'tif', 'tiff'])

export function isBrowserSupportImageType(filepath: string) {
  const extension = path.extname(filepath).slice(1).toLowerCase()
  const mimetype = mime.getType(filepath)
  if (!mimetype) {
    return {
      suppprted: false,
      mimetype: `image/${extension}`,
    }
  }
  const unsupportedMime = mimetype === 'image/tiff'
    || mimetype === 'image/heic'
    || mimetype === 'image/heif'
    || mimetype === 'image/heic-sequence'
    || mimetype === 'image/heif-sequence'
  return {
    suppprted: !BROWSER_UNSUPPORTED_EXTENSIONS.has(extension) && !unsupportedMime,
    mimetype,
  }
}

// sharp 元信息中可能出现的 "depth"。非 8-bit TIFF 需要走归一化路径，
// 否则高动态范围或低数值范围的科研图像在浏览器里容易接近全黑。
// 参考: https://sharp.pixelplumbing.com/api-output#tiff
const FLOAT_DEPTHS = new Set(['float', 'double'])
const NORMALIZABLE_TIFF_DEPTHS = new Set(['char', 'short', 'ushort', 'int', 'uint', 'float', 'double'])
const HIST_BINS = 256

function depthBytes(depth: string) {
  if (depth === 'double')
    return 8
  if (depth === 'float' || depth === 'uint' || depth === 'int')
    return 4
  if (depth === 'ushort' || depth === 'short')
    return 2
  return 1
}

function readSample(data: Buffer, offset: number, depth: string) {
  if (depth === 'double')
    return data.readDoubleLE(offset)
  if (depth === 'float')
    return data.readFloatLE(offset)
  if (depth === 'uint')
    return data.readUInt32LE(offset)
  if (depth === 'int')
    return data.readInt32LE(offset)
  if (depth === 'ushort')
    return data.readUInt16LE(offset)
  if (depth === 'short')
    return data.readInt16LE(offset)
  if (depth === 'char')
    return data.readInt8(offset)
  return data.readUInt8(offset)
}

function inferHistogramDomain(min: number, max: number, depth: string): [number, number] {
  if (FLOAT_DEPTHS.has(depth)) {
    if (min >= 0 && max <= 1)
      return [0, 1]
    return [min, max]
  }
  if (depth === 'char')
    return [-128, 127]
  if (depth === 'short')
    return [-32768, 32767]
  if (depth === 'ushort')
    return [0, 65535]
  if (depth === 'int')
    return [-2147483648, 2147483647]
  if (depth === 'uint')
    return [0, 4294967295]
  return [0, 255]
}

export async function getImageHistogram(input: string, sharp: TSharp): Promise<ImageHistogram | null> {
  try {
    const probe = sharp(input)
    const meta = await probe.metadata()
    const requestedDepth = meta.depth && meta.depth !== 'uchar' ? meta.depth : undefined

    let raw
    let usedDepth = requestedDepth || 'uchar'
    try {
      raw = await sharp(input)
        .raw(requestedDepth ? { depth: requestedDepth as any } : undefined)
        .toBuffer({ resolveWithObject: true })
    }
    catch {
      raw = await sharp(input)
        .raw()
        .toBuffer({ resolveWithObject: true })
      usedDepth = 'uchar'
    }

    const { data, info } = raw
    const channels = info.channels || meta.channels || 1
    const colorChannels = channels >= 3 ? 3 : 1
    const bytes = depthBytes(usedDepth)
    const totalSamples = Math.floor(data.byteLength / bytes)
    if (!totalSamples || !channels)
      return null

    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (let i = 0; i < totalSamples; i++) {
      const channel = i % channels
      if (channels === 2 && channel === 1)
        continue
      if (channels >= 4 && channel === 3)
        continue
      const value = readSample(data, i * bytes, usedDepth)
      if (!Number.isFinite(value))
        continue
      if (value < min)
        min = value
      if (value > max)
        max = value
    }
    if (!Number.isFinite(min) || !Number.isFinite(max))
      return null

    const domain = inferHistogramDomain(min, max, usedDepth)
    const range = domain[1] - domain[0]
    const bins: number[][] = Array.from(
      { length: colorChannels === 1 ? 1 : 4 },
      () => Array.from<number>({ length: HIST_BINS }).fill(0),
    )
    const toBin = (value: number) => {
      if (!Number.isFinite(value) || range <= 0)
        return 0
      const ratio = (value - domain[0]) / range
      return Math.max(0, Math.min(HIST_BINS - 1, Math.round(ratio * (HIST_BINS - 1))))
    }

    for (let i = 0; i < totalSamples; i += channels) {
      if (colorChannels === 1) {
        bins[0][toBin(readSample(data, i * bytes, usedDepth))]++
        continue
      }
      const rv = readSample(data, i * bytes, usedDepth)
      const gv = readSample(data, (i + 1) * bytes, usedDepth)
      const bv = readSample(data, (i + 2) * bytes, usedDepth)
      bins[0][toBin(rv)]++
      bins[1][toBin(gv)]++
      bins[2][toBin(bv)]++
      bins[3][toBin(0.299 * rv + 0.587 * gv + 0.114 * bv)]++
    }

    return { bins, domain, channels: colorChannels }
  }
  catch {
    return null
  }
}

function isAlphaChannel(channels: number, channel: number) {
  return (channels === 2 && channel === 1) || (channels >= 4 && channel === 3)
}

function normalizeRawSamplesToUchar(data: Buffer, channels: number, depth: string) {
  const bytesPerSample = depthBytes(depth)
  const totalSamples = (data.byteLength / bytesPerSample) | 0
  if (totalSamples <= 0) {
    return null
  }

  // 每个颜色通道单独计算 min/max。alpha 也采样 min/max，但输出时按原始数值域映射，
  // 避免为了提升亮度而把半透明 alpha 也做对比度拉伸。
  const mins: number[] = Array.from({ length: channels }, () => Number.POSITIVE_INFINITY)
  const maxs: number[] = Array.from({ length: channels }, () => Number.NEGATIVE_INFINITY)
  for (let i = 0; i < totalSamples; i++) {
    const c = i % channels
    const v = readSample(data, i * bytesPerSample, depth)
    if (!Number.isFinite(v))
      continue
    if (v < mins[c])
      mins[c] = v
    if (v > maxs[c])
      maxs[c] = v
  }

  // 退化情况：所有 min/max 相等 / 全是 NaN，避免除零，按 0 输出
  const ranges = mins.map((m, idx) => {
    const r = maxs[idx] - m
    return Number.isFinite(r) && r > 0 ? r : 0
  })

  const out = Buffer.alloc(totalSamples)
  for (let i = 0; i < totalSamples; i++) {
    const c = i % channels
    const v = readSample(data, i * bytesPerSample, depth)
    if (!Number.isFinite(v)) {
      out[i] = 0
      continue
    }
    if (isAlphaChannel(channels, c)) {
      const [alphaMin, alphaMax] = inferHistogramDomain(mins[c], maxs[c], depth)
      const alphaRange = alphaMax - alphaMin
      if (!Number.isFinite(alphaRange) || alphaRange <= 0) {
        out[i] = v > 0 ? 255 : 0
        continue
      }
      const norm = (v - alphaMin) / alphaRange
      const clamped = norm < 0 ? 0 : norm > 1 ? 1 : norm
      out[i] = Math.round(clamped * 255)
      continue
    }
    const range = ranges[c]
    if (range === 0) {
      const flat = mins[c]
      if (!Number.isFinite(flat) || flat <= 0)
        out[i] = 0
      else if (flat <= 1)
        out[i] = Math.round(flat * 255)
      else
        out[i] = 255
      continue
    }
    const norm = (v - mins[c]) / range
    const clamped = norm < 0 ? 0 : norm > 1 ? 1 : norm
    out[i] = Math.round(clamped * 255)
  }

  return out
}

/**
 * 把非 8-bit TIF 转成可显示的 8-bit PNG buffer。
 *
 * 主流浏览器无法原生显示 TIF。即使经过 sharp 转 PNG，16-bit/32-bit 科研图像也常因为
 * 像素值只占完整数值域的一小段而接近全黑。这里读取 raw 像素后按通道 min/max 线性拉伸。
 *
 * 失败或 8-bit TIFF 时返回 null，由调用方走 sharp().png() 兜底。
 */
export async function normalizeTiffToPngBuffer(input: string | Buffer, sharp: TSharp): Promise<Buffer | null> {
  return withHardTimeout(async () => {
    const probe = sharp(input, { sequentialRead: true, failOn: 'none' }).timeout({ seconds: 6 })
    const meta = await probe.metadata()
    if (meta.format !== 'tiff' && meta.format !== 'tif') {
      return null
    }
    if (!meta.depth || !NORMALIZABLE_TIFF_DEPTHS.has(meta.depth)) {
      // 8-bit TIF 走默认 png() 转换即可
      return null
    }
    const width = meta.width
    const height = meta.height
    if (!width || !height) {
      return null
    }

    // float/double TIFF 的值通常已经在 0..1。normalise() 对这些样本会产出几乎
    // 全黑图；旧稳定版的 linear(255, 0) 能快速得到可见预览，也避免 raw float
    // 抽样在 worker/主线程里卡死。
    if (FLOAT_DEPTHS.has(meta.depth)) {
      const stretched = await renderStretchedFloat(input, sharp, meta.depth, 6, width > 2048 ? 2048 : undefined, 'png')
      if (stretched)
        return stretched
      return await sharp(input, { sequentialRead: true, failOn: 'none' })
        .timeout({ seconds: 6 })
        .linear(255, 0)
        .png()
        .toBuffer()
    }

    const { data, info } = await sharp(input, { sequentialRead: true, failOn: 'none' })
      .timeout({ seconds: 6 })
      .raw({ depth: meta.depth as any })
      .toBuffer({ resolveWithObject: true })

    const ch = info.channels || meta.channels || 1
    if (![1, 2, 3, 4].includes(ch)) {
      return null
    }
    const out = normalizeRawSamplesToUchar(data, ch, meta.depth)
    if (!out) {
      return null
    }

    return await sharp(out, {
      raw: {
        width,
        height,
        channels: ch as 1 | 2 | 3 | 4,
      },
    })
      .png()
      .toBuffer()
  }, 8_000)
}

// 给一个可能永不返回的异步操作加一道 JS 级硬墙：超时就 resolve(null)。
// 注意：这并不会取消底层仍在运行的 native（libvips）操作——sharp 的 .timeout()
// 对某些 TIFF 的 .raw({depth}) 解码不生效，会把 worker 卡死整整一个 deadline。
// 这里只保证调用方能及时拿到 null 并走兜底；真正卡住的 native 线程由更上层的
// worker pool deadline（terminate）回收。
function withHardTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (value: T | null) => {
      if (settled)
        return
      settled = true
      if (timer)
        clearTimeout(timer)
      resolve(value)
    }
    timer = setTimeout(() => finish(null), ms)
    Promise.resolve()
      .then(fn)
      .then(value => finish(value), () => finish(null))
  })
}

/**
 * 网格缩略图专用的 TIFF 归一化路径。
 *
 * normalizeTiffToPngBuffer 会先把整张 TIFF 归一化成全尺寸 PNG，再由调用方二次缩放。
 * 对 SSHFS 上的大目录缩略图来说这太重。这里先在 sharp pipeline 里缩到网格尺寸，
 * 再对缩小后的 raw 像素做 min/max 拉伸，并直接输出 JPEG 缓存。
 */
type TiffNormalizeOptions = {
  fitInside?: boolean
  hardTimeoutMs?: number
  timeoutSeconds?: number
}

function edgeResize(maxEdge: number, fitInside: boolean) {
  return fitInside
    ? { fastShrinkOnLoad: true, fit: 'inside' as const, height: maxEdge, width: maxEdge, withoutEnlargement: true }
    : { fastShrinkOnLoad: true, width: maxEdge, withoutEnlargement: true }
}

export async function normalizeTiffToThumbnailBuffer(
  input: string | Buffer,
  sharp: TSharp,
  maxWidth: number,
  options: TiffNormalizeOptions = {},
): Promise<Buffer | null> {
  return withHardTimeout(async () => {
    // probe 也要带 timeout——虽然 metadata() 不一定吃 libvips timeout，
    // 但聊胜于无，且与下方解码管线保持一致。
    const timeoutSeconds = options.timeoutSeconds ?? 3
    const probe = sharp(input, { sequentialRead: true, failOn: 'none' }).timeout({ seconds: timeoutSeconds })
    const meta = await probe.metadata()
    if (meta.format !== 'tiff' && meta.format !== 'tif') {
      return null
    }
    if (!meta.depth || !NORMALIZABLE_TIFF_DEPTHS.has(meta.depth)) {
      return null
    }

    // float/double TIFF 的值通常已经在 0..1。normalise() 对这些样本会产出几乎
    // 全 1 的黑图；旧稳定版的 linear(255, 0) 能快速得到可见缩略图，也避免 raw
    // float 抽样在 worker 里卡死。
    if (FLOAT_DEPTHS.has(meta.depth)) {
      const stretched = await renderStretchedFloat(input, sharp, meta.depth, timeoutSeconds, maxWidth, 'jpeg', !!options.fitInside)
      if (stretched)
        return stretched
      return await sharp(input, { sequentialRead: true, failOn: 'none' })
        .timeout({ seconds: timeoutSeconds })
        .resize(edgeResize(maxWidth, !!options.fitInside))
        .linear(255, 0)
        .jpeg({ quality: 70, mozjpeg: false, progressive: false })
        .toBuffer()
    }

    const raw = await sharp(input, { sequentialRead: true, failOn: 'none' })
      .timeout({ seconds: timeoutSeconds })
      .resize(edgeResize(maxWidth, !!options.fitInside))
      .raw({ depth: meta.depth as any })
      .toBuffer({ resolveWithObject: true })

    const ch = raw.info.channels || meta.channels || 1
    if (![1, 2, 3, 4].includes(ch)) {
      return null
    }
    if (!raw.info.width || !raw.info.height) {
      return null
    }

    const out = normalizeRawSamplesToUchar(raw.data, ch, meta.depth)
    if (!out) {
      return null
    }

    return await sharp(out, {
      raw: {
        width: raw.info.width,
        height: raw.info.height,
        channels: ch as 1 | 2 | 3 | 4,
      },
    })
      .jpeg({ quality: 70, mozjpeg: false, progressive: false })
      .toBuffer()
  }, options.hardTimeoutMs ?? 4_000)
}

/**
 * buffer 转 base64
 * 浏览器原生不支持的格式（如 TIF）会先尝试 sharp 转 PNG。
 *
 * 注意：转码后的 mimetype 必须改成 image/png，否则浏览器会按原始 mimetype
 * (例如 image/tiff) 解析 PNG 字节流，结果是预览空白。
 */
export async function bufferTobase64(buffer: Buffer, filepath: string, sharp: TSharp) {
  const { mimetype, suppprted } = isBrowserSupportImageType(filepath)

  if (suppprted) {
    return toBase64(mimetype, buffer)
  }

  // 非 8-bit TIF 优先走归一化路径
  const normalizedTiff = await normalizeTiffToPngBuffer(buffer, sharp)
  if (normalizedTiff) {
    return toBase64('image/png', normalizedTiff)
  }

  try {
    buffer = await sharp(buffer, { sequentialRead: true, failOn: 'none' }).timeout({ seconds: 8 }).png().toBuffer()
  }
  catch (error) {
    const classic = await classicTiffToPng(buffer, sharp)
    if (!classic)
      throw error
    buffer = classic
  }
  return toBase64('image/png', buffer)
}

/**
 * 根据图片path 转 base64
 */
export async function convertImageToBase64(input: string, sharp: TSharp) {
  const { mimetype, suppprted } = isBrowserSupportImageType(input)

  if (suppprted) {
    return toBase64(mimetype, await fs.readFile(input))
  }

  // 非 8-bit TIF 优先走归一化路径。注意结果是 PNG 字节流，必须用 image/png 标注，
  // 不然浏览器会拿原始的 image/tiff 去解，导致预览出不来。
  const normalizedTiff = await normalizeTiffToPngBuffer(input, sharp)
  if (normalizedTiff) {
    return toBase64('image/png', normalizedTiff)
  }

  try {
    const buffer = await sharp(input, { sequentialRead: true, failOn: 'none' }).timeout({ seconds: 8 }).png().toBuffer()
    return toBase64('image/png', buffer)
  }
  catch (error) {
    const classic = await classicTiffToPng(input, sharp)
    if (classic)
      return toBase64('image/png', classic)
    throw error
  }
}

/**
 * 如果浏览器不支持展示某个格式，则转为 base64
 * 支持，则返回空
 */
export async function convertToBase64IfBrowserNotSupport(input: string, sharp: TSharp) {
  const { suppprted } = isBrowserSupportImageType(input)

  if (suppprted) {
    return null
  }

  return convertImageToBase64(input, sharp)
}

async function renderStretchedFloat(
  input: string | Buffer,
  sharp: TSharp,
  depth: string,
  timeoutSeconds: number,
  maxWidth: number | undefined,
  format: 'jpeg' | 'png',
  fitInside = false,
) {
  try {
    let pipeline = sharp(input, { sequentialRead: true, failOn: 'none' }).timeout({ seconds: timeoutSeconds })
    if (maxWidth) {
      pipeline = pipeline.resize(edgeResize(maxWidth, fitInside))
    }
    const raw = await pipeline.raw({ depth: depth as any }).toBuffer({ resolveWithObject: true })
    const channels = raw.info.channels || 1
    if (![1, 2, 3, 4].includes(channels) || !raw.info.width || !raw.info.height)
      return null
    const out = normalizeRawSamplesToUchar(raw.data, channels, depth)
    if (!out)
      return null
    const encoded = sharp(out, {
      raw: {
        width: raw.info.width,
        height: raw.info.height,
        channels: channels as 1 | 2 | 3 | 4,
      },
    })
    if (format === 'jpeg') {
      return await encoded.jpeg({ quality: 70, mozjpeg: false, progressive: false }).toBuffer()
    }
    return await encoded.png().toBuffer()
  }
  catch {
    return null
  }
}

async function readClassicTiff(input: string | Buffer) {
  const bytes = Buffer.isBuffer(input) ? input : await fs.readFile(input)
  if (!looksLikeClassicTiff(bytes))
    return null
  return decodeClassicTiff(bytes)
}

async function classicTiffToPng(input: string | Buffer, sharp: TSharp) {
  const decoded = await readClassicTiff(input)
  if (!decoded)
    return null
  return sharp(decoded.data, {
    raw: {
      width: decoded.width,
      height: decoded.height,
      channels: decoded.channels,
    },
  }).png().toBuffer()
}

async function classicTiffToJpeg(input: string | Buffer, sharp: TSharp, maxWidth: number, fitInside = false) {
  const decoded = await readClassicTiff(input)
  if (!decoded)
    return null
  return sharp(decoded.data, {
    raw: {
      width: decoded.width,
      height: decoded.height,
      channels: decoded.channels,
    },
  })
    .resize(edgeResize(maxWidth, fitInside))
    .jpeg({ quality: 70, mozjpeg: false, progressive: false })
    .toBuffer()
}

export async function buildJpegThumbnail(input: string | Buffer, sharp: TSharp, maxWidth: number) {
  const normalizedTiff = await normalizeTiffToThumbnailBuffer(input, sharp, maxWidth).catch(() => null)
  if (normalizedTiff)
    return normalizedTiff
  try {
    return await sharp(input, { sequentialRead: true, failOn: 'none' })
      .timeout({ seconds: 3 })
      .resize({ width: maxWidth, withoutEnlargement: true, fastShrinkOnLoad: true })
      .jpeg({ quality: 70, mozjpeg: false, progressive: false })
      .toBuffer()
  }
  catch (error) {
    const classic = await classicTiffToJpeg(input, sharp, maxWidth)
    if (classic)
      return classic
    throw error
  }
}

export const PREVIEW_MAX_EDGE = 2048

export async function buildPreviewJpeg(input: string | Buffer, sharp: TSharp, maxEdge = PREVIEW_MAX_EDGE): Promise<Buffer | null> {
  return withHardTimeout(async () => {
    const normalizedTiff = await normalizeTiffToThumbnailBuffer(input, sharp, maxEdge, {
      fitInside: true,
      hardTimeoutMs: 10_000,
      timeoutSeconds: 6,
    })
    if (normalizedTiff)
      return normalizedTiff
    try {
      return await sharp(input, { sequentialRead: true, failOn: 'none' })
        .timeout({ seconds: 6 })
        .resize(edgeResize(maxEdge, true))
        .jpeg({ mozjpeg: false, progressive: false, quality: 75 })
        .toBuffer()
    }
    catch (error) {
      const classic = await classicTiffToJpeg(input, sharp, maxEdge, true)
      if (classic)
        return classic
      throw error
    }
  }, 12_000)
}
