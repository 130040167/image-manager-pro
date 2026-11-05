import { Buffer } from 'node:buffer'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { histogram } from '~/core/analysis/histogram'
import { Global } from '~/core/global'
import { buildJpegThumbnail, isBrowserSupportImageType, normalizeTiffToThumbnailBuffer } from '~/utils/node/image-type'
import { decodeClassicTiff } from '~/utils/node/tiff-classic'

vi.mock('vscode', () => ({
  ExtensionMode: { Production: 1 },
  window: {},
  workspace: { onDidChangeConfiguration: () => ({ dispose() {} }) },
}))

function writeU16(target: Buffer, offset: number, value: number, littleEndian: boolean) {
  if (littleEndian)
    target.writeUInt16LE(value, offset)
  else
    target.writeUInt16BE(value, offset)
}

function writeU32(target: Buffer, offset: number, value: number, littleEndian: boolean) {
  if (littleEndian)
    target.writeUInt32LE(value, offset)
  else
    target.writeUInt32BE(value, offset)
}

function buildTiff(options: {
  bits?: number
  bytes: Buffer
  compression?: number
  height: number
  littleEndian?: boolean
  photometric?: number
  predictor?: number
  sampleFormat?: number
  samples?: number
  width: number
}) {
  const littleEndian = options.littleEndian !== false
  const tags: Array<[number, number, number]> = [
    [256, 4, options.width],
    [257, 4, options.height],
    [258, 3, options.bits || 8],
    [259, 3, options.compression || 1],
    [262, 3, options.photometric ?? 1],
    [273, 4, 0],
    [277, 3, options.samples || 1],
    [278, 4, options.height],
    [279, 4, options.bytes.length],
  ]
  if (options.predictor)
    tags.push([317, 3, options.predictor])
  if (options.sampleFormat)
    tags.push([339, 3, options.sampleFormat])
  tags.sort((left, right) => left[0] - right[0])

  const ifdStart = 8
  const dataOffset = ifdStart + 2 + tags.length * 12 + 4
  tags.find(tag => tag[0] === 273)![2] = dataOffset
  const output = Buffer.alloc(dataOffset + options.bytes.length)
  output.write(littleEndian ? 'II' : 'MM', 0, 'ascii')
  writeU16(output, 2, 42, littleEndian)
  writeU32(output, 4, ifdStart, littleEndian)
  writeU16(output, ifdStart, tags.length, littleEndian)
  tags.forEach((tag, index) => {
    const entry = ifdStart + 2 + index * 12
    writeU16(output, entry, tag[0], littleEndian)
    writeU16(output, entry + 2, tag[1], littleEndian)
    writeU32(output, entry + 4, 1, littleEndian)
    if (tag[1] === 3)
      writeU16(output, entry + 8, tag[2], littleEndian)
    else
      writeU32(output, entry + 8, tag[2], littleEndian)
  })
  options.bytes.copy(output, dataOffset)
  return output
}

describe('classic tiff compatibility', () => {
  it('decodes little-endian and big-endian uncompressed images', () => {
    const rgb = decodeClassicTiff(buildTiff({
      bytes: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
      height: 2,
      photometric: 2,
      samples: 3,
      width: 2,
    }))
    expect(Array.from(rgb?.data || [])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])

    const gray = decodeClassicTiff(buildTiff({
      bytes: Buffer.from([0, 255, 64, 128]),
      height: 2,
      littleEndian: false,
      width: 2,
    }))
    expect(Array.from(gray?.data || [])).toEqual([0, 255, 64, 128])
  })

  it('decodes packbits, horizontal predictor, min-is-white, and 16-bit ranges', () => {
    const packed = decodeClassicTiff(buildTiff({
      bytes: Buffer.from([0xFE, 10, 0x00, 20]),
      compression: 32773,
      height: 1,
      width: 4,
    }))
    expect(Array.from(packed?.data || [])).toEqual([10, 10, 10, 20])

    const predicted = decodeClassicTiff(buildTiff({
      bytes: Buffer.from([10, 20, 10]),
      height: 1,
      predictor: 2,
      width: 3,
    }))
    expect(Array.from(predicted?.data || [])).toEqual([10, 30, 40])

    const inverted = decodeClassicTiff(buildTiff({
      bytes: Buffer.from([0, 255]),
      height: 1,
      photometric: 0,
      width: 2,
    }))
    expect(Array.from(inverted?.data || [])).toEqual([255, 0])

    const deep = Buffer.alloc(4)
    deep.writeUInt16LE(1000, 0)
    deep.writeUInt16LE(5000, 2)
    const stretched = decodeClassicTiff(buildTiff({
      bits: 16,
      bytes: deep,
      height: 1,
      width: 2,
    }))
    expect(Array.from(stretched?.data || [])).toEqual([0, 255])
  })

  it('matches sharp for lzw and deflate tiff', async () => {
    const pixels = Buffer.from([0, 20, 40, 60, 80, 100, 140, 180, 220, 255, 10, 30])
    for (const compression of ['lzw', 'deflate'] as const) {
      const encoded = await sharp(pixels, { raw: { width: 4, height: 3, channels: 1 } })
        .tiff({ compression })
        .toBuffer()
      const decoded = decodeClassicTiff(encoded)
      const reference = await sharp(encoded).raw().toBuffer({ resolveWithObject: true })
      expect(decoded?.width).toBe(reference.info.width)
      expect(decoded?.height).toBe(reference.info.height)
      expect(decoded?.channels).toBe(reference.info.channels)
      expect(Array.from(decoded?.data || [])).toEqual(Array.from(reference.data))
    }
  })

  it('stretches high-range float tiff instead of clipping it white', async () => {
    const samples = Buffer.alloc(4 * 4)
    ;[100, 200, 300, 400].forEach((value, index) => samples.writeFloatLE(value, index * 4))
    const encoded = buildTiff({
      bits: 32,
      bytes: samples,
      height: 1,
      sampleFormat: 3,
      width: 4,
    })
    const jpeg = await normalizeTiffToThumbnailBuffer(encoded, sharp, 32)
    expect(jpeg).toBeTruthy()
    const viewed = await sharp(jpeg!).raw().toBuffer()
    expect(new Set(viewed).size).toBeGreaterThan(1)
  })

  it('falls back to the classic decoder when sharp rejects the tiff', async () => {
    const encoded = buildTiff({
      bytes: Buffer.from([0, 255, 0, 255]),
      height: 2,
      width: 2,
    })
    const wrapped = ((input: unknown, options?: object) => {
      const bytes = Buffer.isBuffer(input) ? input : Buffer.alloc(0)
      if (typeof input === 'string' || bytes[0] === 0x49 || bytes[0] === 0x4D)
        throw new Error('old tiff rejected')
      return sharp(input as Buffer, options)
    }) as typeof sharp
    const jpeg = await buildJpegThumbnail(encoded, wrapped, 16)
    expect(jpeg.subarray(0, 2).toString('hex')).toBe('ffd8')
  })

  it('treats heif and tiff as browser-unsupported', () => {
    expect(isBrowserSupportImageType('scan.heic').suppprted).toBe(false)
    expect(isBrowserSupportImageType('scan.heif').suppprted).toBe(false)
    expect(isBrowserSupportImageType('scan.tif').suppprted).toBe(false)
    expect(isBrowserSupportImageType('scan.png').suppprted).toBe(true)
  })
})

describe('grayscale histogram', () => {
  it('keeps single-channel samples on the same color bins', async () => {
    const pixels = Buffer.from([0, 255, 0, 255])
    Global.sharp = ((input: Buffer) => {
      const api = {
        raw: () => api,
        removeAlpha: () => api,
        resize: () => api,
        rotate: () => api,
        toBuffer: async () => ({
          data: input,
          info: { channels: 1, height: 1, width: input.length },
        }),
      }
      return api
    }) as unknown as typeof Global.sharp

    const bins = await histogram(pixels)
    expect(bins[0]).toBeCloseTo(0.5)
    expect(bins[7]).toBeCloseTo(0.5)
    expect(bins[8]).toBeCloseTo(0.5)
    expect(bins[15]).toBeCloseTo(0.5)
  })
})
