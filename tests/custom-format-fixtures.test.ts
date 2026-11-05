import type { CustomFormatConfig } from '~/core/custom-format/types'
import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { decodeCustomImage } from '~/core/custom-format'

const fixtureDir = path.resolve(__dirname, 'fixture/custom-formats')

const config: CustomFormatConfig = {
  extensionPresets: {
    npy: {
      extensions: ['npy'],
      kind: 'npy',
      name: 'NPY',
      options: { channelMode: 'auto' },
    },
    raw: {
      extensions: ['raw'],
      kind: 'raw',
      name: 'RAW',
      options: {},
    },
  },
  folderPresets: {},
}

describe('custom format fixtures', () => {
  it('decodes BHW.npy pages through the real file path pipeline', async () => {
    const filePath = path.join(fixtureDir, 'BHW.npy')

    const first = await decodeCustomImage(filePath, { layout: 'BHW', pageIndex: 0 }, config, sharp)
    const second = await decodeCustomImage(filePath, { layout: 'BHW', pageIndex: 1 }, config, sharp)

    expect(first.pageCount).toBe(2)
    expect(first.pageIndex).toBe(0)
    expect(first.width).toBe(3)
    expect(first.height).toBe(2)
    expect(first.pixels.length).toBe(first.width * first.height * first.channels)
    expect(first.dataUrl).toBeUndefined()
    expect(second.pageIndex).toBe(1)
    expect(Buffer.compare(first.pixels, second.pixels)).not.toBe(0)
  })

  it('decodes uint16.raw with explicit dimensions and dtype', async () => {
    const filePath = path.join(fixtureDir, 'uint16.raw')

    const decoded = await decodeCustomImage(filePath, {
      dtype: 'uint16',
      endian: 'little',
      height: 2,
      layout: 'HW',
      width: 3,
    }, config, sharp)

    expect(decoded.width).toBe(3)
    expect(decoded.height).toBe(2)
    expect(decoded.dtype).toBe('uint16')
    expect(decoded.max).toBeGreaterThan(decoded.min)
    expect(decoded.pixels.length).toBe(decoded.width * decoded.height * decoded.channels)
    expect(decoded.dataUrl).toBeUndefined()
  })

  it('keeps fixture files present for custom-format smoke coverage', async () => {
    const names = await fs.readdir(fixtureDir)

    expect(names).toEqual(expect.arrayContaining([
      'HW.npy',
      'BHW.npy',
      'BCHW.npy',
      'uint16.raw',
      'BHW.raw',
    ]))
  })
})
