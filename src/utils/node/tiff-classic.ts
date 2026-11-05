import { Buffer } from 'node:buffer'
import { inflateRawSync, inflateSync } from 'node:zlib'

export type ClassicTiffImage = {
  channels: 1 | 2 | 3 | 4
  data: Buffer
  height: number
  width: number
}

const MAX_DECODE_BYTES = 80 * 1024 * 1024
const MAX_PIXELS = 24_000_000

type Reader = {
  big: boolean
  le: boolean
  readU16: (offset: number) => number
  readU32: (offset: number) => number
  readU64: (offset: number) => number
}

type Ifd = {
  bits: number[]
  colorMap?: Buffer
  compression: number
  height: number
  photometric: number
  planar: number
  predictor: number
  rowsPerStrip: number
  sampleFormat: number[]
  samples: number
  stripByteCounts: number[]
  stripOffsets: number[]
  width: number
}

export function looksLikeClassicTiff(input: Buffer) {
  if (input.length < 8)
    return false
  const order = input.toString('ascii', 0, 2)
  if (order !== 'II' && order !== 'MM')
    return false
  const le = order === 'II'
  const magic = le ? input.readUInt16LE(2) : input.readUInt16BE(2)
  return magic === 42 || magic === 43
}

export function decodeClassicTiff(input: Buffer): ClassicTiffImage | null {
  try {
    if (!looksLikeClassicTiff(input) || input.length > MAX_DECODE_BYTES)
      return null
    const reader = createReader(input)
    const ifdOffset = reader.big ? reader.readU64(8) : reader.readU32(4)
    const ifd = readIfd(input, reader, ifdOffset)
    if (!ifd)
      return null
    return decodeIfd(input, reader, ifd)
  }
  catch {
    return null
  }
}

function createReader(input: Buffer): Reader {
  const le = input.toString('ascii', 0, 2) === 'II'
  const magic = le ? input.readUInt16LE(2) : input.readUInt16BE(2)
  const big = magic === 43
  const readU16 = (offset: number) => le ? input.readUInt16LE(offset) : input.readUInt16BE(offset)
  const readU32 = (offset: number) => le ? input.readUInt32LE(offset) : input.readUInt32BE(offset)
  const readU64 = (offset: number) => {
    const value = le ? input.readBigUInt64LE(offset) : input.readBigUInt64BE(offset)
    if (value > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error('tiff offset exceeds safe integer')
    return Number(value)
  }
  return { big, le, readU16, readU32, readU64 }
}

function readIfd(input: Buffer, reader: Reader, offset: number): Ifd | null {
  if (offset <= 0 || offset >= input.length)
    return null
  const entrySize = reader.big ? 20 : 12
  const count = reader.big ? reader.readU64(offset) : reader.readU16(offset)
  if (count <= 0 || count > 4096)
    return null
  const values = new Map<number, number[]>()
  for (let index = 0; index < count; index++) {
    const entry = offset + (reader.big ? 8 : 2) + index * entrySize
    if (entry + entrySize > input.length)
      return null
    const tag = reader.readU16(entry)
    const type = reader.readU16(entry + 2)
    const valueCount = reader.big ? reader.readU64(entry + 4) : reader.readU32(entry + 4)
    const valueOffset = reader.big ? entry + 12 : entry + 8
    values.set(tag, readTagValues(input, reader, type, valueCount, valueOffset))
  }

  const width = first(values.get(256))
  const height = first(values.get(257))
  const bits = values.get(258) || [1]
  const compression = first(values.get(259)) || 1
  const photometric = first(values.get(262)) ?? 1
  const stripOffsets = values.get(273) || []
  const samples = first(values.get(277)) || bits.length || 1
  const rowsPerStrip = first(values.get(278)) || height || 1
  const stripByteCounts = values.get(279) || []
  const planar = first(values.get(284)) || 1
  const predictor = first(values.get(317)) || 1
  const sampleFormat = values.get(339) || [1]
  const colorMapValues = values.get(320)
  if (!width || !height || !stripOffsets.length)
    return null
  if (width <= 0 || height <= 0 || width * height > MAX_PIXELS)
    return null
  if (values.has(322) || values.has(323))
    return null
  const colorMap = colorMapValues?.length
    ? encodeColorMap(colorMapValues)
    : undefined
  return {
    bits,
    colorMap,
    compression,
    height,
    photometric,
    planar,
    predictor,
    rowsPerStrip,
    sampleFormat,
    samples,
    stripByteCounts,
    stripOffsets,
    width,
  }
}

function readTagValues(input: Buffer, reader: Reader, type: number, count: number, valueOffset: number) {
  const size = typeSize(type)
  if (!size || count <= 0 || count > 1_000_000)
    return []
  const byteLength = size * count
  const inlineLimit = reader.big ? 8 : 4
  const dataOffset = byteLength <= inlineLimit ? valueOffset : (reader.big ? reader.readU64(valueOffset) : reader.readU32(valueOffset))
  if (dataOffset < 0 || dataOffset + byteLength > input.length)
    return []
  const values: number[] = []
  for (let index = 0; index < count; index++) {
    const offset = dataOffset + index * size
    values.push(readNumber(input, reader, type, offset))
  }
  return values
}

function readNumber(input: Buffer, reader: Reader, type: number, offset: number) {
  if (type === 1 || type === 7)
    return input[offset] || 0
  if (type === 6)
    return input.readInt8(offset)
  if (type === 3)
    return reader.readU16(offset)
  if (type === 8)
    return reader.le ? input.readInt16LE(offset) : input.readInt16BE(offset)
  if (type === 4)
    return reader.readU32(offset)
  if (type === 9)
    return reader.le ? input.readInt32LE(offset) : input.readInt32BE(offset)
  if (type === 11)
    return reader.le ? input.readFloatLE(offset) : input.readFloatBE(offset)
  if (type === 12)
    return reader.le ? input.readDoubleLE(offset) : input.readDoubleBE(offset)
  if (type === 5 || type === 10) {
    const denominator = reader.readU32(offset + 4)
    return denominator ? reader.readU32(offset) / denominator : 0
  }
  return 0
}

function typeSize(type: number) {
  if (type === 1 || type === 2 || type === 6 || type === 7)
    return 1
  if (type === 3 || type === 8)
    return 2
  if (type === 4 || type === 9 || type === 11)
    return 4
  if (type === 5 || type === 10 || type === 12)
    return 8
  return 0
}

function decodeIfd(input: Buffer, reader: Reader, ifd: Ifd): ClassicTiffImage | null {
  const bits = ifd.bits[0] || 1
  if (ifd.bits.some(value => value !== bits))
    return null
  if (![1, 8, 16, 32].includes(bits))
    return null
  if (ifd.samples < 1 || ifd.samples > 4)
    return null
  const supportedCompression = new Set([1, 5, 8, 32773, 32946])
  if (!supportedCompression.has(ifd.compression))
    return null
  if (ifd.predictor !== 1 && ifd.predictor !== 2)
    return null

  const planes = ifd.planar === 2 ? ifd.samples : 1
  const samplesPerPlane = ifd.planar === 2 ? 1 : ifd.samples
  const rowsPerStrip = Math.max(1, ifd.rowsPerStrip || ifd.height)
  const stripsPerPlane = Math.ceil(ifd.height / rowsPerStrip)
  if (ifd.stripOffsets.length < stripsPerPlane * planes)
    return null

  const planeBuffers: Buffer[] = []
  for (let plane = 0; plane < planes; plane++) {
    const decoded = decodePlane(input, reader, ifd, plane, samplesPerPlane, bits, rowsPerStrip, stripsPerPlane)
    if (!decoded)
      return null
    planeBuffers.push(decoded)
  }

  const interleaved = ifd.planar === 2
    ? interleavePlanes(planeBuffers, ifd.width, ifd.height, bytesPerSample(bits))
    : planeBuffers[0]
  return toDisplayImage(interleaved, reader, ifd, bits)
}

function decodePlane(
  input: Buffer,
  reader: Reader,
  ifd: Ifd,
  plane: number,
  samples: number,
  bits: number,
  rowsPerStrip: number,
  stripsPerPlane: number,
) {
  const bytes = bytesPerSample(bits)
  const rowBytes = Math.ceil(ifd.width * samples * bits / 8)
  const output = Buffer.alloc(ifd.height * rowBytes)
  for (let strip = 0; strip < stripsPerPlane; strip++) {
    const stripIndex = plane * stripsPerPlane + strip
    const rowStart = strip * rowsPerStrip
    const rows = Math.min(rowsPerStrip, ifd.height - rowStart)
    const expected = rows * rowBytes
    const compressed = readStrip(input, ifd, stripIndex, expected)
    if (!compressed)
      return null
    const raw = decompressStrip(compressed, ifd.compression, expected)
    if (!raw || raw.length < expected)
      return null
    raw.copy(output, rowStart * rowBytes, 0, expected)
  }
  if (ifd.predictor === 2)
    applyHorizontalPredictor(output, ifd.width, ifd.height, samples, bytes, reader.le)
  return output
}

function readStrip(input: Buffer, ifd: Ifd, stripIndex: number, expected: number) {
  const offset = ifd.stripOffsets[stripIndex]
  const declared = ifd.stripByteCounts[stripIndex] || (ifd.compression === 1 ? expected : 0)
  if (!offset || !declared || offset < 0 || offset + declared > input.length)
    return null
  return input.subarray(offset, offset + declared)
}

function decompressStrip(input: Buffer, compression: number, expected: number) {
  if (compression === 1)
    return input
  if (compression === 32773)
    return decodePackBits(input, expected)
  if (compression === 5)
    return decodeLzw(input)
  if (compression === 8 || compression === 32946)
    return decodeDeflate(input)
  return null
}

function decodePackBits(input: Buffer, expected: number) {
  const output = Buffer.alloc(expected)
  let source = 0
  let target = 0
  while (source < input.length && target < expected) {
    const control = input.readInt8(source++)
    if (control >= 0) {
      const length = control + 1
      if (source + length > input.length || target + length > expected)
        return null
      input.copy(output, target, source, source + length)
      source += length
      target += length
      continue
    }
    if (control === -128)
      continue
    const length = 1 - control
    if (source >= input.length || target + length > expected)
      return null
    output.fill(input[source++] || 0, target, target + length)
    target += length
  }
  return target === expected ? output : null
}

function decodeDeflate(input: Buffer) {
  try {
    return inflateSync(input)
  }
  catch {
    try {
      return inflateRawSync(input)
    }
    catch {
      return null
    }
  }
}

function decodeLzw(input: Buffer) {
  const clearCode = 256
  const eoiCode = 257
  let bitPos = 0
  let codeWidth = 9
  let nextCode = 258
  const table: Array<Uint8Array | undefined> = Array.from({ length: 4096 })
  for (let index = 0; index < 256; index++)
    table[index] = Uint8Array.of(index)

  const readCode = () => {
    let code = 0
    for (let bit = 0; bit < codeWidth; bit++) {
      const byteIndex = bitPos >> 3
      if (byteIndex >= input.length)
        return eoiCode
      const shift = 7 - (bitPos & 7)
      code = (code << 1) | ((input[byteIndex] >> shift) & 1)
      bitPos++
    }
    return code
  }

  const chunks: Uint8Array[] = []
  let code = readCode()
  if (code === clearCode)
    code = readCode()
  if (code === eoiCode || !table[code])
    return Buffer.alloc(0)
  let previous = table[code]!
  chunks.push(previous)

  while (true) {
    code = readCode()
    if (code === eoiCode)
      break
    if (code === clearCode) {
      codeWidth = 9
      nextCode = 258
      table.fill(undefined, 256)
      code = readCode()
      if (code === eoiCode || !table[code])
        break
      previous = table[code]!
      chunks.push(previous)
      continue
    }

    let entry: Uint8Array | undefined
    if (code < nextCode && table[code])
      entry = table[code]
    else if (code === nextCode)
      entry = concatBytes(previous, previous[0] || 0)
    else
      return null

    if (!entry)
      return null
    chunks.push(entry)
    if (nextCode < 4096) {
      table[nextCode++] = concatBytes(previous, entry[0] || 0)
      if (nextCode === (1 << codeWidth) && codeWidth < 12)
        codeWidth++
    }
    previous = entry
  }

  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const output = Buffer.alloc(length)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

function concatBytes(source: Uint8Array, extra: number) {
  const output = new Uint8Array(source.length + 1)
  output.set(source, 0)
  output[source.length] = extra
  return output
}

function applyHorizontalPredictor(data: Buffer, width: number, height: number, samples: number, bytes: number, le: boolean) {
  const rowBytes = width * samples * bytes
  for (let y = 0; y < height; y++) {
    const row = y * rowBytes
    for (let sample = samples; sample < width * samples; sample++) {
      const offset = row + sample * bytes
      const previous = offset - samples * bytes
      if (bytes === 1) {
        data[offset] = ((data[offset] || 0) + (data[previous] || 0)) & 0xFF
      }
      else if (bytes === 2) {
        const value = (readU16(data, offset, le) + readU16(data, previous, le)) & 0xFFFF
        writeU16(data, offset, value, le)
      }
      else if (bytes === 4) {
        const value = (readU32(data, offset, le) + readU32(data, previous, le)) >>> 0
        writeU32(data, offset, value, le)
      }
    }
  }
}

function toDisplayImage(data: Buffer, reader: Reader, ifd: Ifd, bits: number): ClassicTiffImage | null {
  const expanded = bits === 1 ? expandOneBit(data, ifd) : data
  const displayBits = bits === 1 ? 8 : bits
  const channels = displayChannels(ifd)
  if (!channels)
    return null
  const pixelCount = ifd.width * ifd.height
  const output = Buffer.alloc(pixelCount * channels)
  const sampleBytes = bytesPerSample(displayBits)
  const sourceSamples = ifd.samples
  if (expanded.length < pixelCount * sourceSamples * sampleBytes)
    return null

  if (displayBits === 8 && ifd.photometric !== 3) {
    for (let pixel = 0; pixel < pixelCount; pixel++) {
      writeEightBitPixel(output, expanded, pixel, sourceSamples, channels, ifd.photometric)
    }
    return { channels, data: output, height: ifd.height, width: ifd.width }
  }

  if (ifd.photometric === 3) {
    if (!ifd.colorMap || displayBits !== 8)
      return null
    writePalette(output, expanded, ifd, channels)
    return { channels, data: output, height: ifd.height, width: ifd.width }
  }

  const sampleFormat = ifd.sampleFormat[0] || 1
  const ranges = measureRanges(expanded, reader, pixelCount, sourceSamples, displayBits, sampleFormat)
  for (let pixel = 0; pixel < pixelCount; pixel++) {
    for (let channel = 0; channel < channels; channel++) {
      const sourceChannel = Math.min(channel, sourceSamples - 1)
      const sample = readDeepSample(expanded, reader, pixel * sourceSamples + sourceChannel, displayBits, sampleFormat)
      output[pixel * channels + channel] = scaleSample(sample, ranges[sourceChannel]!, channel, channels, ifd.photometric)
    }
  }
  return { channels, data: output, height: ifd.height, width: ifd.width }
}

function writeEightBitPixel(output: Buffer, input: Buffer, pixel: number, sourceSamples: number, channels: number, photometric: number) {
  for (let channel = 0; channel < channels; channel++) {
    const sourceChannel = channel < sourceSamples ? channel : 0
    let value = input[pixel * sourceSamples + sourceChannel] || 0
    const alpha = channels === 2 ? channel === 1 : channels === 4 && channel === 3
    if (!alpha && photometric === 0)
      value = 255 - value
    output[pixel * channels + channel] = value
  }
}

function writePalette(output: Buffer, input: Buffer, ifd: Ifd, channels: number) {
  const map = ifd.colorMap!
  const colors = map.length / 6
  for (let pixel = 0; pixel < ifd.width * ifd.height; pixel++) {
    const index = Math.min(colors - 1, input[pixel] || 0)
    for (let channel = 0; channel < channels; channel++) {
      const offset = (channel * colors + index) * 2
      const value = ifd.colorMap ? map.readUInt16LE(offset) : 0
      output[pixel * channels + channel] = value >> 8
    }
  }
}

function expandOneBit(data: Buffer, ifd: Ifd) {
  const rowBytes = Math.ceil(ifd.width / 8)
  const output = Buffer.alloc(ifd.width * ifd.height)
  for (let y = 0; y < ifd.height; y++) {
    for (let x = 0; x < ifd.width; x++) {
      const byte = data[y * rowBytes + (x >> 3)] || 0
      const bit = (byte >> (7 - (x & 7))) & 1
      output[y * ifd.width + x] = bit ? 255 : 0
    }
  }
  return output
}

function measureRanges(data: Buffer, reader: Reader, pixels: number, samples: number, bits: number, sampleFormat: number) {
  return Array.from({ length: samples }, (_, channel) => {
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (let pixel = 0; pixel < pixels; pixel++) {
      const value = readDeepSample(data, reader, pixel * samples + channel, bits, sampleFormat)
      if (!Number.isFinite(value))
        continue
      if (value < min)
        min = value
      if (value > max)
        max = value
    }
    return { max, min }
  })
}

function readDeepSample(data: Buffer, reader: Reader, index: number, bits: number, sampleFormat: number) {
  const offset = index * bytesPerSample(bits)
  if (bits === 16)
    return sampleFormat === 2 ? readI16(data, offset, reader.le) : readU16(data, offset, reader.le)
  if (bits === 32 && sampleFormat === 3)
    return reader.le ? data.readFloatLE(offset) : data.readFloatBE(offset)
  if (bits === 32)
    return readU32(data, offset, reader.le)
  return data[offset] || 0
}

function scaleSample(value: number, range: { max: number, min: number }, channel: number, channels: number, photometric: number) {
  if (!Number.isFinite(value))
    return 0
  const alpha = channels === 2 ? channel === 1 : channels === 4 && channel === 3
  const span = range.max - range.min
  let scaled = span > 0 ? Math.round(((value - range.min) / span) * 255) : (value > 0 ? 255 : 0)
  scaled = Math.max(0, Math.min(255, scaled))
  if (!alpha && photometric === 0)
    scaled = 255 - scaled
  return scaled
}

function displayChannels(ifd: Ifd): 1 | 2 | 3 | 4 | null {
  if (ifd.photometric === 2)
    return ifd.samples >= 4 ? 4 : 3
  if (ifd.photometric === 3)
    return 3
  if (ifd.samples === 2)
    return 2
  if (ifd.samples === 4)
    return 4
  if (ifd.samples === 1)
    return 1
  if (ifd.samples === 3)
    return 3
  return null
}

function interleavePlanes(planes: Buffer[], width: number, height: number, bytes: number) {
  const pixels = width * height
  const output = Buffer.alloc(pixels * planes.length * bytes)
  for (let pixel = 0; pixel < pixels; pixel++) {
    for (let plane = 0; plane < planes.length; plane++) {
      const source = (pixel * bytes)
      const target = (pixel * planes.length + plane) * bytes
      planes[plane]!.copy(output, target, source, source + bytes)
    }
  }
  return output
}

function bytesPerSample(bits: number) {
  return bits <= 8 ? 1 : bits / 8
}

function encodeColorMap(values: number[]) {
  const output = Buffer.alloc(values.length * 2)
  for (let index = 0; index < values.length; index++)
    output.writeUInt16LE(values[index] || 0, index * 2)
  return output
}

function first(values: number[] | undefined) {
  return values && values.length ? values[0] : undefined
}

function readU16(data: Buffer, offset: number, le: boolean) {
  return le ? data.readUInt16LE(offset) : data.readUInt16BE(offset)
}

function readI16(data: Buffer, offset: number, le: boolean) {
  return le ? data.readInt16LE(offset) : data.readInt16BE(offset)
}

function readU32(data: Buffer, offset: number, le: boolean) {
  return le ? data.readUInt32LE(offset) : data.readUInt32BE(offset)
}

function writeU16(data: Buffer, offset: number, value: number, le: boolean) {
  if (le)
    data.writeUInt16LE(value, offset)
  else
    data.writeUInt16BE(value, offset)
}

function writeU32(data: Buffer, offset: number, value: number, le: boolean) {
  if (le)
    data.writeUInt32LE(value, offset)
  else
    data.writeUInt32BE(value, offset)
}
