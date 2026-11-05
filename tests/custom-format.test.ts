import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { decodeCustomImageBufferForTest, isLikelyCustomImageFile, parseNpyArray, resolveCustomImagePreset } from '~/core/custom-format'

function npyHeader(descr: string, shape: number[]) {
  const shapeText = `(${shape.join(', ')}${shape.length === 1 ? ',' : ''})`
  const dict = `{'descr': '${descr}', 'fortran_order': False, 'shape': ${shapeText}, }`
  const magic = Buffer.from([0x93, 0x4E, 0x55, 0x4D, 0x50, 0x59, 0x01, 0x00])
  const rawHeaderLen = dict.length + 1
  const padding = (16 - ((magic.length + 2 + rawHeaderLen) % 16)) % 16
  const header = `${dict}${' '.repeat(padding)}\n`
  const len = Buffer.alloc(2)
  len.writeUInt16LE(header.length, 0)
  return Buffer.concat([magic, len, Buffer.from(header, 'latin1')])
}

function npyBuffer(shape: number[], data: number[]) {
  return Buffer.concat([npyHeader('|u1', shape), Buffer.from(data)])
}

function decodeNpy(buffer: Buffer, layout: string, options: Record<string, unknown> = {}) {
  const parsed = parseNpyArray(buffer)
  return decodeCustomImageBufferForTest(buffer, {
    ...parsed,
    kind: 'npy',
    options: { layout, ...options },
  })
}

describe('custom-format', () => {
  it('parses npy header and dtype without numpy', () => {
    const header = npyHeader('<u2', [2, 3])
    const parsed = parseNpyArray(header)
    expect(parsed.dtype).toBe('uint16')
    expect(parsed.shape).toEqual([2, 3])
    expect(parsed.littleEndian).toBe(true)
  })

  it('decodes HW npy data and normalizes uint8', () => {
    const header = npyHeader('|u1', [2, 2])
    const buffer = Buffer.concat([header, Buffer.from([0, 127, 255, 64])])
    const parsed = parseNpyArray(buffer)
    const raw = decodeCustomImageBufferForTest(buffer, {
      ...parsed,
      kind: 'npy',
      options: { layout: 'HW' },
    })
    expect(raw.width).toBe(2)
    expect(raw.height).toBe(2)
    expect([...raw.data]).toEqual([0, 127, 255, 64])
  })

  it('decodes HWC rgb arrays', () => {
    const header = npyHeader('|u1', [1, 2, 3])
    const buffer = Buffer.concat([header, Buffer.from([255, 0, 0, 0, 255, 0])])
    const parsed = parseNpyArray(buffer)
    const raw = decodeCustomImageBufferForTest(buffer, {
      ...parsed,
      kind: 'npy',
      options: { channelMode: 'rgb', layout: 'HWC' },
    })
    expect(raw.channels).toBe(3)
    expect([...raw.data]).toEqual([255, 0, 0, 0, 255, 0])
  })

  it('selects pages from BHW stacks', () => {
    const buffer = npyBuffer([2, 1, 2], [1, 2, 9, 10])
    const raw = decodeNpy(buffer, 'BHW', { pageIndex: 1 })
    expect(raw.pageCount).toBe(2)
    expect([...raw.data]).toEqual([9, 10])
  })

  it('uses the first B slice by default for NPY thumbnails and previews', () => {
    const buffer = npyBuffer([2, 1, 2], [1, 2, 9, 10])
    const raw = decodeNpy(buffer, 'BHW')
    expect(raw.pageIndex).toBe(0)
    expect(raw.pageCount).toBe(2)
    expect([...raw.data]).toEqual([1, 2])
  })

  it('decodes BCHW pages and treats B as the slice dimension', () => {
    const buffer = npyBuffer([
      2,
      3,
      1,
      2,
    ], [
      // B0: RGB pixels -> [10, 20, 30], [40, 50, 60]
      10,
      40,
      20,
      50,
      30,
      60,
      // B1: RGB pixels -> [110, 120, 130], [140, 150, 160]
      110,
      140,
      120,
      150,
      130,
      160,
    ])

    const first = decodeNpy(buffer, 'BCHW', { channelMode: 'rgb' })
    const second = decodeNpy(buffer, 'BCHW', { channelMode: 'rgb', pageIndex: 1 })

    expect(first.pageCount).toBe(2)
    expect(first.channels).toBe(3)
    expect([...first.data]).toEqual([10, 20, 30, 40, 50, 60])
    expect(second.pageIndex).toBe(1)
    expect([...second.data]).toEqual([110, 120, 130, 140, 150, 160])
  })

  it('decodes BHWC pages and treats B as the slice dimension', () => {
    const buffer = npyBuffer([
      2,
      1,
      2,
      3,
    ], [
      // B0 HWC
      1,
      2,
      3,
      4,
      5,
      6,
      // B1 HWC
      101,
      102,
      103,
      104,
      105,
      106,
    ])

    const first = decodeNpy(buffer, 'BHWC', { channelMode: 'rgb' })
    const second = decodeNpy(buffer, 'BHWC', { channelMode: 'rgb', pageIndex: 1 })

    expect(first.pageCount).toBe(2)
    expect(first.channels).toBe(3)
    expect([...first.data]).toEqual([1, 2, 3, 4, 5, 6])
    expect([...second.data]).toEqual([101, 102, 103, 104, 105, 106])
  })

  it('decodes HBW when B is not the leading axis', () => {
    const buffer = npyBuffer([
      1,
      2,
      2,
    ], [
      // H0 B0 W0,W1
      7,
      8,
      // H0 B1 W0,W1
      70,
      80,
    ])

    const first = decodeNpy(buffer, 'HBW')
    const second = decodeNpy(buffer, 'HBW', { pageIndex: 1 })

    expect(first.pageCount).toBe(2)
    expect([...first.data]).toEqual([7, 8])
    expect([...second.data]).toEqual([70, 80])
  })

  it('decodes CHW as RGB when there is no B axis', () => {
    const buffer = npyBuffer([
      3,
      1,
      2,
    ], [
      9,
      19,
      29,
      39,
      49,
      59,
    ])
    const raw = decodeNpy(buffer, 'CHW', { channelMode: 'rgb' })

    expect(raw.pageCount).toBe(1)
    expect(raw.channels).toBe(3)
    expect([...raw.data]).toEqual([9, 29, 49, 19, 39, 59])
  })

  it('decodes raw little-endian uint16 with explicit dimensions', () => {
    const pixels = Buffer.alloc(8)
    pixels.writeUInt16LE(0, 0)
    pixels.writeUInt16LE(32768, 2)
    pixels.writeUInt16LE(65535, 4)
    pixels.writeUInt16LE(16384, 6)
    const raw = decodeCustomImageBufferForTest(pixels, {
      dataOffset: 0,
      dtype: 'uint16',
      fortranOrder: false,
      kind: 'raw',
      littleEndian: true,
      options: { height: 2, layout: 'HW', width: 2 },
      shape: [2, 2],
    })
    expect([...raw.data]).toEqual([0, 128, 255, 64])
  })

  it('decodes raw BHW stacks and selects pages', () => {
    const buffer = Buffer.from([
      1,
      2,
      3,
      4,
      11,
      12,
      13,
      14,
    ])
    const first = decodeCustomImageBufferForTest(buffer, {
      dataOffset: 0,
      dtype: 'uint8',
      fortranOrder: false,
      kind: 'raw',
      littleEndian: true,
      options: { height: 2, layout: 'BHW', pages: 2, width: 2 },
      shape: [2, 2, 2],
    })
    const second = decodeCustomImageBufferForTest(buffer, {
      dataOffset: 0,
      dtype: 'uint8',
      fortranOrder: false,
      kind: 'raw',
      littleEndian: true,
      options: { height: 2, layout: 'BHW', pages: 2, pageIndex: 1, width: 2 },
      shape: [2, 2, 2],
    })
    expect(first.pageCount).toBe(2)
    expect([...first.data]).toEqual([1, 2, 3, 4])
    expect(second.pageIndex).toBe(1)
    expect([...second.data]).toEqual([11, 12, 13, 14])
  })

  it('prefers folder presets over extension presets', () => {
    const config = {
      extensionPresets: {
        raw: {
          kind: 'raw' as const,
          options: { height: 10, layout: 'HW', width: 10 },
        },
      },
      folderPresets: {
        'c:/data/special': {
          kind: 'raw' as const,
          options: { height: 20, layout: 'HW', width: 20 },
        },
      },
    }
    const preset = resolveCustomImagePreset('c:/data/special/a.raw', config)
    expect(preset?.source).toBe('folder')
    expect(preset?.preset.options?.width).toBe(20)
    expect(isLikelyCustomImageFile('c:/data/special/a.raw', config)).toBe(true)
  })

  it('uses folder presets only for matching extensions', () => {
    const config = {
      extensionPresets: {
        raw: {
          extensions: ['raw'],
          kind: 'raw' as const,
          options: { height: 10, layout: 'HW', width: 10 },
        },
      },
      folderPresets: {
        'c:/data/special': {
          extensions: ['dat'],
          kind: 'raw' as const,
          options: { height: 20, layout: 'HW', width: 20 },
        },
      },
    }

    expect(resolveCustomImagePreset('c:/data/special/a.raw', config)?.source).toBe('extension')
    expect(resolveCustomImagePreset('c:/data/special/a.dat', config)?.source).toBe('folder')
  })

  it('clamps page and channel indexes for stacks', () => {
    const header = npyHeader('|u1', [2, 3, 1, 1])
    const buffer = Buffer.concat([header, Buffer.from([1, 2, 3, 4, 5, 6])])
    const parsed = parseNpyArray(buffer)
    const raw = decodeCustomImageBufferForTest(buffer, {
      ...parsed,
      kind: 'npy',
      options: { channelIndex: 99, channelMode: 'single', layout: 'BCHW', pageIndex: 99 },
    })
    expect(raw.pageIndex).toBe(1)
    expect(raw.pageCount).toBe(2)
    expect([...raw.data]).toEqual([6])
  })

  it('supports explicit normalization ranges', () => {
    const pixels = Buffer.from([10, 20, 30, 40])
    const raw = decodeCustomImageBufferForTest(pixels, {
      dataOffset: 0,
      dtype: 'uint8',
      fortranOrder: false,
      kind: 'raw',
      littleEndian: true,
      options: { height: 2, layout: 'HW', normalize: { min: 10, max: 40 }, width: 2 },
      shape: [2, 2],
    })
    expect([...raw.data]).toEqual([0, 85, 170, 255])
  })
})
