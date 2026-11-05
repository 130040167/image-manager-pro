import type { CustomFormatConfig } from '~/core/custom-format/types'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { decodeCustomImage, encodeRawPixelsToJpeg } from '~/core/custom-format'
import { buildPreviewJpeg } from '~/utils/node/image-type'

const sampleDir = 'F:/workspace/my-de-flow/results/compare/datastes/gt-full/synth_ldct_A'
const imageExts = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.bmp'])

describe('preview jpeg cache', () => {
  it('keeps the long edge at 2048 pixels', async () => {
    const source = await sharp({
      create: {
        background: { b: 200, g: 80, r: 20 },
        channels: 3,
        height: 1200,
        width: 3200,
      },
    }).png().toBuffer()

    const jpeg = await buildPreviewJpeg(source, sharp)
    expect(jpeg?.subarray(0, 2).toString('hex')).toBe('ffd8')
    const metadata = await sharp(jpeg!).metadata()
    expect(metadata.format).toBe('jpeg')
    expect(metadata.width).toBeLessThanOrEqual(2048)
    expect(metadata.height).toBeLessThanOrEqual(2048)
    expect(Math.max(metadata.width || 0, metadata.height || 0)).toBe(2048)
  })

  it('encodes custom raw pixels to jpeg without a png data url', async () => {
    const config: CustomFormatConfig = {
      extensionPresets: {
        npy: {
          extensions: ['npy'],
          kind: 'npy',
          name: 'NPY',
          options: { channelMode: 'auto' },
        },
      },
      folderPresets: {},
    }
    const decoded = await decodeCustomImage(
      path.resolve(__dirname, 'fixture/custom-formats/HW.npy'),
      { layout: 'HW' },
      config,
      sharp,
    )
    expect(decoded.dataUrl).toBeUndefined()
    expect(decoded.pixels.length).toBe(decoded.width * decoded.height * decoded.channels)
    const jpeg = await encodeRawPixelsToJpeg(decoded, sharp, 64, 'inside', 70)
    expect(jpeg.subarray(0, 2).toString('hex')).toBe('ffd8')
    expect(jpeg.subarray(0, 8).toString('hex')).not.toBe('89504e470d0a1a0a')
  })

  it('builds a bounded preview for a sample from the local dataset when that folder exists', async () => {
    if (!fs.existsSync(sampleDir))
      return
    const names = fs.readdirSync(sampleDir).filter(name => imageExts.has(path.extname(name).toLowerCase()))
    expect(names.length).toBeGreaterThan(0)
    const filePath = path.join(sampleDir, names[0])
    const stat = fs.statSync(filePath)
    expect(stat.size).toBeGreaterThan(0)
    const jpeg = await buildPreviewJpeg(filePath, sharp)
    expect(jpeg?.subarray(0, 2).toString('hex')).toBe('ffd8')
    const metadata = await sharp(jpeg!).metadata()
    expect(Math.max(metadata.width || 0, metadata.height || 0)).toBeLessThanOrEqual(2048)
    const pixels = await sharp(jpeg!).greyscale().raw().toBuffer()
    let min = 255
    let max = 0
    for (const value of pixels) {
      if (value < min)
        min = value
      if (value > max)
        max = value
    }
    expect(max - min).toBeGreaterThan(0)
  })
})
