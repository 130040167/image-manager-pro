import type {
  CustomFormatConfig,
  CustomImageAxisRole,
  CustomImageDecodeOptions,
  CustomImageDtype,
  CustomImageKind,
  CustomImagePreset,
  CustomImageProbeResult,
  ResolvedCustomImagePreset,
} from './types'
import { Buffer } from 'node:buffer'
import path from 'node:path'
import fs from 'fs-extra'
import { normalizeCustomFormatConfig } from './types'

type ParsedArray = {
  dataOffset: number
  dtype: CustomImageDtype
  fortranOrder: boolean
  littleEndian: boolean
  shape: number[]
}

type DimensionPlan = {
  axes: CustomImageAxisRole[]
  batchAxis?: number
  channelAxis?: number
  heightAxis: number
  ignoredAxes: number[]
  layout: string
  pageAxis?: number
  widthAxis: number
}

type RawImage = {
  channelMode: 'rgb' | 'rgba' | 'stack' | 'single'
  channels: number
  data: Buffer
  dtype: CustomImageDtype
  height: number
  kind: CustomImageKind
  layout: string
  littleEndian: boolean
  max: number
  min: number
  pageCount: number
  pageIndex: number
  shape: number[]
  width: number
}

const DTYPE_BYTES: Record<CustomImageDtype, number> = {
  float32: 4,
  float64: 8,
  int8: 1,
  int16: 2,
  int32: 4,
  uint8: 1,
  uint16: 2,
  uint32: 4,
}

const DEFAULT_SCAN_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'tiff', 'tif', 'avif', 'heif', 'heic', 'apng', 'svg', 'bmp', 'ico']

function normalizeExt(ext: string) {
  return ext.trim().replace(/^\./, '').toLowerCase()
}

function normalizePath(filePath: string) {
  return filePath.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '')
}

function dirnameOf(filePath: string) {
  return normalizePath(path.dirname(filePath))
}

export function getCustomFormatScanExtensions(
  scan: string[],
  customFormats?: Partial<CustomFormatConfig>,
): string[] {
  const formats = normalizeCustomFormatConfig(customFormats)
  const set = new Set(scan.map(normalizeExt).filter(Boolean))
  for (const [ext, preset] of Object.entries(formats.extensionPresets)) {
    const exts = preset.extensions?.length ? preset.extensions : [ext]
    exts.forEach(item => set.add(normalizeExt(item)))
  }
  return Array.from(set)
}

export function isLikelyCustomImageFile(filePath: string, customFormats?: Partial<CustomFormatConfig>) {
  return !!resolveCustomImagePreset(filePath, customFormats)
}

export function resolveCustomImagePreset(
  filePath: string,
  customFormats?: Partial<CustomFormatConfig>,
): ResolvedCustomImagePreset | undefined {
  const formats = normalizeCustomFormatConfig(customFormats)
  const dirPath = dirnameOf(filePath)
  const ext = normalizeExt(path.extname(filePath))
  const folderEntries = Object.entries(formats.folderPresets)
    .map(([folderPath, preset]) => [normalizePath(folderPath), preset] as const)
    .filter(([folderPath, preset]) => {
      const presetExts = preset.extensions?.map(normalizeExt).filter(Boolean) || []
      return (dirPath === folderPath || dirPath.startsWith(`${folderPath}/`))
        && (!presetExts.length || presetExts.includes(ext))
    })
    .sort((a, b) => b[0].length - a[0].length)

  if (folderEntries[0]) {
    const [folderPath, preset] = folderEntries[0]
    return {
      cacheKey: `folder:${folderPath}:${JSON.stringify(preset.options || {})}`,
      preset,
      source: 'folder',
    }
  }

  const extensionPreset = formats.extensionPresets[ext]
  if (extensionPreset) {
    return {
      cacheKey: `ext:${ext}:${JSON.stringify(extensionPreset.options || {})}`,
      preset: extensionPreset,
      source: 'extension',
    }
  }

  if (ext === 'npy') {
    const preset: CustomImagePreset = {
      extensions: ['npy'],
      kind: 'npy',
      options: { channelMode: 'auto' },
    }
    return {
      cacheKey: 'implicit:npy',
      preset,
      source: 'implicit-npy',
    }
  }
}

function parseNpyHeader(buffer: Buffer): ParsedArray {
  if (buffer.length < 10 || buffer.toString('latin1', 0, 6) !== '\x93NUMPY') {
    throw new Error('Invalid NPY magic header')
  }
  const major = buffer.readUInt8(6)
  const minor = buffer.readUInt8(7)
  const headerLen = major <= 1 ? buffer.readUInt16LE(8) : buffer.readUInt32LE(8)
  const headerStart = major <= 1 ? 10 : 12
  const dataOffset = headerStart + headerLen
  const header = buffer.toString('latin1', headerStart, dataOffset)
  const descr = /'descr'\s*:\s*'([^']+)'/.exec(header)?.[1]
    || /"descr"\s*:\s*"([^"]+)"/.exec(header)?.[1]
  const fortran = /'fortran_order'\s*:\s*(True|False)/.exec(header)?.[1]
    || /"fortran_order"\s*:\s*(true|false)/i.exec(header)?.[1]
  const shapeText = /'shape'\s*:\s*\(([^)]*)\)/.exec(header)?.[1]
    || /"shape"\s*:\s*\[([^\]]*)\]/.exec(header)?.[1]

  if (!descr || !shapeText) {
    throw new Error(`Unsupported NPY header (${major}.${minor})`)
  }

  const dtype = parseNpyDtype(descr)
  const shape = shapeText
    .split(',')
    .map(item => Number(item.trim()))
    .filter(item => Number.isFinite(item) && item > 0)

  if (!shape.length || shape.length > 4) {
    throw new Error(`Unsupported NPY shape: ${shapeText}`)
  }

  return {
    dataOffset,
    dtype,
    fortranOrder: String(fortran).toLowerCase() === 'true',
    littleEndian: descr[0] !== '>',
    shape,
  }
}

function parseNpyDtype(descr: string): CustomImageDtype {
  const kind = descr.at(-2)
  const bytes = Number(descr.at(-1))
  if (kind === 'u' && bytes === 1)
    return 'uint8'
  if (kind === 'i' && bytes === 1)
    return 'int8'
  if (kind === 'u' && bytes === 2)
    return 'uint16'
  if (kind === 'i' && bytes === 2)
    return 'int16'
  if (kind === 'u' && bytes === 4)
    return 'uint32'
  if (kind === 'i' && bytes === 4)
    return 'int32'
  if (kind === 'f' && bytes === 4)
    return 'float32'
  if (kind === 'f' && bytes === 8)
    return 'float64'
  throw new Error(`Unsupported NPY dtype: ${descr}`)
}

function rolesFromLayout(layout: string | undefined, dims: number): CustomImageAxisRole[] | undefined {
  if (!layout)
    return
  const normalized = layout.toUpperCase().replace(/[^BCHWI]/g, '')
  const roles: CustomImageAxisRole[] = []
  for (const ch of normalized) {
    if (ch === 'I')
      roles.push('Ignore')
    else
      roles.push(ch as CustomImageAxisRole)
  }
  return roles.length === dims ? roles : undefined
}

function rolesFromRawLayout(layout: string | undefined): CustomImageAxisRole[] | undefined {
  if (!layout)
    return
  const normalized = layout.toUpperCase().replace(/[^BCHWI]/g, '')
  const roles: CustomImageAxisRole[] = []
  for (const ch of normalized) {
    if (ch === 'I')
      roles.push('Ignore')
    else
      roles.push(ch as CustomImageAxisRole)
  }
  return roles.length >= 2 && roles.length <= 4 ? roles : undefined
}

function inferAxes(shape: number[], options: CustomImageDecodeOptions): CustomImageAxisRole[] {
  const fromOptions = options.axes?.slice(0, shape.length)
  if (fromOptions?.length === shape.length) {
    return fromOptions
  }
  const fromLayout = rolesFromLayout(options.layout, shape.length)
  if (fromLayout) {
    return fromLayout
  }

  if (shape.length === 2)
    return ['H', 'W']
  if (shape.length === 3) {
    const first = shape[0]
    const last = shape[2]
    if (last === 3 || last === 4)
      return ['H', 'W', 'C']
    if (first === 3 || first === 4)
      return ['C', 'H', 'W']
    return ['B', 'H', 'W']
  }
  if (shape.length === 4) {
    const last = shape[3]
    const second = shape[1]
    if (last === 3 || last === 4)
      return ['B', 'H', 'W', 'C']
    if (second === 3 || second === 4)
      return ['B', 'C', 'H', 'W']
    return ['B', 'Ignore', 'H', 'W']
  }
  throw new Error(`Unsupported shape rank: ${shape.length}`)
}

function buildDimensionPlan(shape: number[], options: CustomImageDecodeOptions): DimensionPlan {
  const axes = inferAxes(shape, options)
  const heightAxis = axes.indexOf('H')
  const widthAxis = axes.indexOf('W')
  if (heightAxis < 0 || widthAxis < 0) {
    throw new Error(`Layout must include H and W axes: ${axes.join('')}`)
  }
  const channelAxis = axes.indexOf('C')
  const batchAxis = axes.indexOf('B')
  const ignoredAxes = axes
    .map((axis, index) => axis === 'Ignore' ? index : -1)
    .filter(index => index >= 0)
  const pageAxis = batchAxis >= 0 ? batchAxis : ignoredAxes[0]
  return {
    axes,
    batchAxis: batchAxis >= 0 ? batchAxis : undefined,
    channelAxis: channelAxis >= 0 ? channelAxis : undefined,
    heightAxis,
    ignoredAxes,
    layout: axes.map(axis => axis === 'Ignore' ? 'I' : axis).join(''),
    pageAxis,
    widthAxis,
  }
}

function getElementOffset(indices: number[], shape: number[], fortranOrder: boolean) {
  if (fortranOrder) {
    let stride = 1
    let offset = 0
    for (let axis = 0; axis < shape.length; axis++) {
      offset += indices[axis] * stride
      stride *= shape[axis]
    }
    return offset
  }

  let stride = 1
  let offset = 0
  for (let axis = shape.length - 1; axis >= 0; axis--) {
    offset += indices[axis] * stride
    stride *= shape[axis]
  }
  return offset
}

function readValue(buffer: Buffer, offset: number, dtype: CustomImageDtype, littleEndian: boolean) {
  switch (dtype) {
    case 'float32': return littleEndian ? buffer.readFloatLE(offset) : buffer.readFloatBE(offset)
    case 'float64': return littleEndian ? buffer.readDoubleLE(offset) : buffer.readDoubleBE(offset)
    case 'int8': return buffer.readInt8(offset)
    case 'int16': return littleEndian ? buffer.readInt16LE(offset) : buffer.readInt16BE(offset)
    case 'int32': return littleEndian ? buffer.readInt32LE(offset) : buffer.readInt32BE(offset)
    case 'uint8': return buffer.readUInt8(offset)
    case 'uint16': return littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset)
    case 'uint32': return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset)
  }
}

function dtypeDomain(dtype: CustomImageDtype): [number, number] {
  switch (dtype) {
    case 'float32':
    case 'float64':
      return [0, 1]
    case 'int8':
      return [-128, 127]
    case 'int16':
      return [-32768, 32767]
    case 'int32':
      return [-2147483648, 2147483647]
    case 'uint16':
      return [0, 65535]
    case 'uint32':
      return [0, 4294967295]
    case 'uint8':
      return [0, 255]
  }
}

function resolveChannelMode(
  options: CustomImageDecodeOptions,
  channelCount: number,
): 'rgb' | 'rgba' | 'stack' | 'single' {
  if (options.channelMode === 'rgb')
    return 'rgb'
  if (options.channelMode === 'rgba')
    return 'rgba'
  if (options.channelMode === 'stack')
    return 'stack'
  if (options.channelMode === 'single')
    return 'single'
  if (channelCount === 3)
    return 'rgb'
  if (channelCount === 4)
    return 'rgba'
  return channelCount > 1 ? 'stack' : 'single'
}

function getSourceValue(
  buffer: Buffer,
  params: {
    baseOffset: number
    bytes: number
    dtype: CustomImageDtype
    fortranOrder: boolean
    littleEndian: boolean
    shape: number[]
  },
  indices: number[],
) {
  const elementOffset = getElementOffset(indices, params.shape, params.fortranOrder)
  const byteOffset = params.baseOffset + elementOffset * params.bytes
  if (byteOffset < 0 || byteOffset + params.bytes > buffer.length)
    return 0
  return readValue(buffer, byteOffset, params.dtype, params.littleEndian)
}

function normalizeSamples(
  samples: Float64Array,
  dtype: CustomImageDtype,
  normalize: CustomImageDecodeOptions['normalize'],
) {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const value of samples) {
    if (!Number.isFinite(value))
      continue
    if (value < min)
      min = value
    if (value > max)
      max = value
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0
    max = 0
  }

  const explicitMin = normalize?.min
  const explicitMax = normalize?.max
  let domainMin = Number.isFinite(explicitMin) ? explicitMin! : undefined
  let domainMax = Number.isFinite(explicitMax) ? explicitMax! : undefined
  if (domainMin === undefined || domainMax === undefined) {
    if (normalize?.auto || dtype === 'float32' || dtype === 'float64') {
      domainMin ??= min
      domainMax ??= max
    }
    else {
      const [dmin, dmax] = dtypeDomain(dtype)
      domainMin ??= dmin
      domainMax ??= dmax
    }
  }

  if (!Number.isFinite(domainMin) || !Number.isFinite(domainMax) || domainMax <= domainMin) {
    domainMin = min
    domainMax = max
  }

  const range = domainMax - domainMin
  const out = Buffer.alloc(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const value = samples[i]
    const normalized = range > 0 && Number.isFinite(value) ? (value - domainMin) / range : 0
    out[i] = Math.max(0, Math.min(255, Math.round(normalized * 255)))
  }

  return { max, min, out }
}

function decodeBufferToRawImage(
  buffer: Buffer,
  params: ParsedArray & {
    kind: CustomImageKind
    options: CustomImageDecodeOptions
  },
): RawImage {
  const { dataOffset, dtype, fortranOrder, kind, littleEndian, options, shape } = params
  const plan = buildDimensionPlan(shape, options)
  const width = shape[plan.widthAxis]
  const height = shape[plan.heightAxis]
  const channelCount = plan.channelAxis === undefined ? (options.channels || 1) : shape[plan.channelAxis]
  const channelMode = resolveChannelMode(options, channelCount)
  const outputChannels = channelMode === 'rgb' ? 3 : channelMode === 'rgba' ? 4 : 1
  const pageCount = plan.pageAxis === undefined ? 1 : shape[plan.pageAxis]
  const pageIndex = Math.max(0, Math.min(pageCount - 1, Math.floor(options.pageIndex || 0)))
  const singleChannel = Math.max(0, Math.min(Math.max(0, channelCount - 1), Math.floor(options.channelIndex || 0)))
  const bytes = DTYPE_BYTES[dtype]
  const samples = new Float64Array(width * height * outputChannels)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let channel = 0; channel < outputChannels; channel++) {
        const sourceChannel = channelMode === 'stack' || channelMode === 'single' ? singleChannel : channel
        const indices = shape.map(() => 0)
        indices[plan.heightAxis] = y
        indices[plan.widthAxis] = x
        if (plan.channelAxis !== undefined) {
          indices[plan.channelAxis] = Math.min(sourceChannel, channelCount - 1)
        }
        if (plan.pageAxis !== undefined) {
          indices[plan.pageAxis] = pageIndex
        }
        for (const ignoredAxis of plan.ignoredAxes) {
          if (ignoredAxis !== plan.pageAxis) {
            indices[ignoredAxis] = 0
          }
        }
        const outIndex = (y * width + x) * outputChannels + channel
        samples[outIndex] = getSourceValue(buffer, {
          baseOffset: dataOffset,
          bytes,
          dtype,
          fortranOrder,
          littleEndian,
          shape,
        }, indices)
      }
    }
  }

  const { max, min, out } = normalizeSamples(samples, dtype, options.normalize)

  return {
    channelMode,
    channels: outputChannels,
    data: out,
    dtype,
    height,
    kind,
    layout: plan.layout,
    littleEndian,
    max,
    min,
    pageCount,
    pageIndex,
    shape,
    width,
  }
}

function rawArrayParams(buffer: Buffer, options: CustomImageDecodeOptions): ParsedArray {
  const width = options.width
  const height = options.height
  if (!width || !height) {
    throw new Error('Raw image width and height are required')
  }
  const dtype = options.dtype || 'uint8'
  const channels = options.channels || 1
  const pages = options.pages || 1
  const layout = options.axes || rolesFromRawLayout(options.layout)
  let shape: number[]
  let axes: CustomImageAxisRole[]
  if (layout?.length) {
    axes = layout
    shape = axes.map((axis) => {
      if (axis === 'H')
        return height
      if (axis === 'W')
        return width
      if (axis === 'C')
        return channels
      if (axis === 'B')
        return pages
      return 1
    })
  }
  else if (pages > 1 && channels > 1) {
    axes = ['B', 'H', 'W', 'C']
    shape = [pages, height, width, channels]
  }
  else if (pages > 1) {
    axes = ['B', 'H', 'W']
    shape = [pages, height, width]
  }
  else if (channels > 1) {
    axes = ['H', 'W', 'C']
    shape = [height, width, channels]
  }
  else {
    axes = ['H', 'W']
    shape = [height, width]
  }

  return {
    dataOffset: Math.max(0, options.offset || 0),
    dtype,
    fortranOrder: false,
    littleEndian: options.endian !== 'big',
    shape,
  }
}

export async function rawImageToPngDataUrl(
  raw: Pick<RawImage, 'channels' | 'data' | 'height' | 'width'>,
  sharp: TSharp,
): Promise<string> {
  const png = await sharp(raw.data, {
    raw: {
      channels: raw.channels as 1 | 2 | 3 | 4,
      height: raw.height,
      width: raw.width,
    },
  }).png().toBuffer()
  return `data:image/png;base64,${png.toString('base64')}`
}

export function parseNpyArray(buffer: Buffer) {
  return parseNpyHeader(buffer)
}

export function decodeCustomImageBufferForTest(
  buffer: Buffer,
  params: ParsedArray & {
    kind: CustomImageKind
    options: CustomImageDecodeOptions
  },
) {
  return decodeBufferToRawImage(buffer, params)
}

export type DecodedCustomImage = CustomImageProbeResult & {
  pixels: Buffer
}

export function toCustomImageProbe(decoded: DecodedCustomImage): CustomImageProbeResult {
  return {
    axes: decoded.axes,
    channelMode: decoded.channelMode,
    channels: decoded.channels,
    dtype: decoded.dtype,
    height: decoded.height,
    kind: decoded.kind,
    layout: decoded.layout,
    littleEndian: decoded.littleEndian,
    max: decoded.max,
    min: decoded.min,
    pageCount: decoded.pageCount,
    pageIndex: decoded.pageIndex,
    shape: decoded.shape,
    width: decoded.width,
  }
}

export async function encodeRawPixelsToJpeg(
  decoded: Pick<DecodedCustomImage, 'channels' | 'height' | 'pixels' | 'width'>,
  sharp: TSharp,
  maxEdge: number,
  fit: 'inside' | 'width' = 'width',
  quality = 70,
): Promise<Buffer> {
  const channels = ([1, 2, 3, 4].includes(decoded.channels) ? decoded.channels : 1) as 1 | 2 | 3 | 4
  let pipeline = sharp(decoded.pixels, {
    failOn: 'none',
    raw: {
      channels,
      height: decoded.height,
      width: decoded.width,
    },
  })
  if (channels === 2 || channels === 4)
    pipeline = pipeline.removeAlpha()
  pipeline = pipeline.resize(fit === 'inside'
    ? { fit: 'inside', height: maxEdge, width: maxEdge, withoutEnlargement: true }
    : { fastShrinkOnLoad: true, width: maxEdge, withoutEnlargement: true })
  return pipeline.jpeg({ mozjpeg: false, progressive: false, quality }).toBuffer()
}

export async function decodeCustomImage(
  filePath: string,
  options: CustomImageDecodeOptions = {},
  customFormats: Partial<CustomFormatConfig> | undefined,
  sharp: TSharp,
): Promise<DecodedCustomImage> {
  const resolved = resolveCustomImagePreset(filePath, customFormats)
  if (!resolved) {
    throw new Error('No custom image preset found')
  }
  const presetOptions = resolved.preset.options || {}
  const mergedOptions = {
    ...presetOptions,
    ...options,
    normalize: {
      ...presetOptions.normalize,
      ...options.normalize,
    },
  }
  const buffer = await fs.readFile(filePath)
  const params = resolved.preset.kind === 'npy'
    ? parseNpyHeader(buffer)
    : rawArrayParams(buffer, mergedOptions)
  const raw = decodeBufferToRawImage(buffer, {
    ...params,
    kind: resolved.preset.kind,
    options: mergedOptions,
  })
  if (!sharp)
    throw new Error('sharp is required')
  return {
    axes: buildDimensionPlan(raw.shape, mergedOptions).axes,
    channelMode: raw.channelMode,
    channels: raw.channels,
    dtype: raw.dtype,
    height: raw.height,
    kind: raw.kind,
    layout: raw.layout,
    littleEndian: raw.littleEndian,
    max: raw.max,
    min: raw.min,
    pageCount: raw.pageCount,
    pageIndex: raw.pageIndex,
    pixels: raw.data,
    shape: raw.shape,
    width: raw.width,
  }
}

export function customImageCacheKey(
  filePath: string,
  stat: { mtimeMs: number, size: number },
  algorithmOrUse: string,
  customFormats?: Partial<CustomFormatConfig>,
  options?: CustomImageDecodeOptions,
) {
  const preset = resolveCustomImagePreset(filePath, customFormats)
  return [
    normalizePath(filePath),
    stat.mtimeMs,
    stat.size,
    algorithmOrUse,
    preset?.cacheKey || 'none',
    JSON.stringify(options || {}),
  ].join('|')
}

export function isBuiltinScanExt(ext: string) {
  return DEFAULT_SCAN_EXTS.includes(normalizeExt(ext))
}
