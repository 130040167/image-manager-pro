import { Buffer } from 'node:buffer'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG } from '~/core/config/common'
import { decodeCustomImageBufferForTest, rawImageToPngDataUrl } from '~/core/custom-format'
import { FileCache } from '~/core/file-cache'
import { Global } from '~/core/global'
import { UsualCompressor } from '~/core/operator/compressor/usual'
import { FormatConverter } from '~/core/operator/format-converter'
import { CmdToVscode } from '~/message/cmd'
import { VscodeMessageFactory } from '~/message/message-factory'
import { Compressed } from '~/meta'
import { convertImageToBase64, normalizeTiffToPngBuffer } from '~/utils/node/image-type'

vi.mock('vscode', () => {
  const uriFromPath = (fsPath: string) => ({
    fsPath,
    path: fsPath,
    scheme: 'file',
    toString: () => `file://${fsPath.replace(/\\/g, '/')}`,
  })

  const config = {
    get: (_key: string, fallback?: unknown) => fallback,
    update: vi.fn(),
  }

  return {
    commands: {
      executeCommand: vi.fn(),
    },
    env: {
      appRoot: '',
      language: 'zh-cn',
      openExternal: vi.fn(),
      uiKind: 1,
    },
    ExtensionMode: {
      Development: 2,
      Production: 1,
      Test: 3,
    },
    Uri: {
      file: uriFromPath,
      joinPath: (base: { fsPath?: string, path?: string }, ...parts: string[]) => {
        return uriFromPath(path.join(base.fsPath || base.path || '', ...parts))
      },
    },
    ViewColumn: {
      Active: 1,
    },
    window: {
      activeColorTheme: { kind: 1 },
      createOutputChannel: () => ({
        append: vi.fn(),
        appendLine: vi.fn(),
        clear: vi.fn(),
        dispose: vi.fn(),
        show: vi.fn(),
      }),
      createStatusBarItem: () => ({
        command: '',
        dispose: vi.fn(),
        hide: vi.fn(),
        show: vi.fn(),
        text: '',
      }),
      onDidChangeActiveColorTheme: () => ({ dispose: vi.fn() }),
      showErrorMessage: vi.fn(),
      showInformationMessage: vi.fn(),
      showTextDocument: vi.fn(),
      showWarningMessage: vi.fn(),
    },
    workspace: {
      fs: {
        copy: vi.fn(),
        delete: vi.fn(),
        rename: vi.fn(),
      },
      getConfiguration: () => config,
      openTextDocument: vi.fn(),
      workspaceFolders: [],
    },
  }
})

vi.mock('~/i18n', () => ({
  i18n: {
    t: (key: string) => key,
  },
}))

function randomRgb(width = 128, height = 128) {
  const buffer = Buffer.alloc(width * height * 3)
  let seed = 0x12345678
  for (let i = 0; i < buffer.length; i++) {
    seed = (1664525 * seed + 1013904223) >>> 0
    buffer[i] = seed & 0xFF
  }
  return buffer
}

async function createPng(filePath: string, pixels = randomRgb()) {
  await sharp(pixels, {
    raw: {
      channels: 3,
      height: 128,
      width: 128,
    },
  }).png().toFile(filePath)
}

function createLowRangeU16Tiff(width = 16, height = 16) {
  const entries = [
    [256, 4, 1, width],
    [257, 4, 1, height],
    [258, 3, 1, 16],
    [259, 3, 1, 1],
    [262, 3, 1, 1],
    [273, 4, 1, 0],
    [277, 3, 1, 1],
    [278, 4, 1, height],
    [279, 4, 1, width * height * 2],
  ] as const
  const ifdOffset = 8
  const pixelOffset = ifdOffset + 2 + entries.length * 12 + 4
  const buffer = Buffer.alloc(pixelOffset + width * height * 2)
  buffer.write('II', 0, 'ascii')
  buffer.writeUInt16LE(42, 2)
  buffer.writeUInt32LE(ifdOffset, 4)
  buffer.writeUInt16LE(entries.length, ifdOffset)

  let entryOffset = ifdOffset + 2
  for (const [tag, type, count, rawValue] of entries) {
    const value = tag === 273 ? pixelOffset : rawValue
    buffer.writeUInt16LE(tag, entryOffset)
    buffer.writeUInt16LE(type, entryOffset + 2)
    buffer.writeUInt32LE(count, entryOffset + 4)
    if (type === 3 && count === 1)
      buffer.writeUInt16LE(value, entryOffset + 8)
    else
      buffer.writeUInt32LE(value, entryOffset + 8)
    entryOffset += 12
  }
  buffer.writeUInt32LE(0, entryOffset)

  for (let i = 0; i < width * height; i++) {
    buffer.writeUInt16LE(1000 + i * 100, pixelOffset + i * 2)
  }
  return buffer
}

function createLowRangeFloat32Tiff(width = 16, height = 16) {
  const entries = [
    [256, 4, 1, width],
    [257, 4, 1, height],
    [258, 3, 1, 32],
    [259, 3, 1, 1],
    [262, 3, 1, 1],
    [273, 4, 1, 0],
    [277, 3, 1, 1],
    [278, 4, 1, height],
    [279, 4, 1, width * height * 4],
    [339, 3, 1, 3],
  ] as const
  const ifdOffset = 8
  const pixelOffset = ifdOffset + 2 + entries.length * 12 + 4
  const buffer = Buffer.alloc(pixelOffset + width * height * 4)
  buffer.write('II', 0, 'ascii')
  buffer.writeUInt16LE(42, 2)
  buffer.writeUInt32LE(ifdOffset, 4)
  buffer.writeUInt16LE(entries.length, ifdOffset)

  let entryOffset = ifdOffset + 2
  for (const [tag, type, count, rawValue] of entries) {
    const value = tag === 273 ? pixelOffset : rawValue
    buffer.writeUInt16LE(tag, entryOffset)
    buffer.writeUInt16LE(type, entryOffset + 2)
    buffer.writeUInt32LE(count, entryOffset + 4)
    if (type === 3 && count === 1)
      buffer.writeUInt16LE(value, entryOffset + 8)
    else
      buffer.writeUInt32LE(value, entryOffset + 8)
    entryOffset += 12
  }
  buffer.writeUInt32LE(0, entryOffset)

  for (let i = 0; i < width * height; i++) {
    buffer.writeFloatLE(i / (width * height - 1), pixelOffset + i * 4)
  }
  return buffer
}

function createPanel(root: string) {
  return {
    id: 'image-workflows-test',
    initialData: {
      rootpaths: [root],
    },
    isDisposed: false,
    panel: {
      webview: {
        asWebviewUri: (uri: { fsPath?: string, path?: string }) => ({
          toString: () => `vscode-resource://${String(uri.fsPath || uri.path || '').replace(/\\/g, '/')}`,
        }),
      },
    },
  } as any
}

async function imageOf(filePath: string, root: string): Promise<ImageType> {
  const stat = await fs.stat(filePath)
  return {
    absDirPath: path.dirname(filePath).replace(/\\/g, '/'),
    absWorkspaceFolder: root.replace(/\\/g, '/'),
    basename: path.basename(filePath),
    dirPath: '.',
    extname: path.extname(filePath).slice(1),
    info: {
      compressed: Compressed.unknown,
      gitStaged: false,
      metadata: {
        height: 128,
        width: 128,
      },
    },
    key: filePath,
    name: path.parse(filePath).name,
    path: filePath.replace(/\\/g, '/'),
    relativePath: `./${path.basename(filePath)}`,
    stats: {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    },
    vscodePath: filePath,
    workspaceFolder: path.basename(root),
  }
}

describe('image-workflows', () => {
  let tmpDir: string
  let contextBefore: any
  let osCachableBefore: string | undefined

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'im-workflows-'))
    contextBefore = (Global as any).context
    osCachableBefore = FileCache.osCachable
    FileCache.osCachable = tmpDir
    ;(Global as any).context = { extensionMode: 1, extensionUri: { fsPath: tmpDir } }
    ;(Global as any).sharp = sharp
  })

  afterEach(async () => {
    ;(Global as any).context = contextBefore
    FileCache.osCachable = osCachableBefore
    sharp.cache(false)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await fs.rm(tmpDir, { force: true, recursive: true })
        return
      }
      catch (error) {
        if (attempt === 2)
          throw error
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }
  })

  it('decodes a simulated 128x128 raw matrix into a PNG dataURL', async () => {
    const pixels = Buffer.alloc(128 * 128)
    for (let i = 0; i < pixels.length; i++) {
      pixels[i] = i % 256
    }

    const raw = decodeCustomImageBufferForTest(pixels, {
      dataOffset: 0,
      dtype: 'uint8',
      fortranOrder: false,
      kind: 'raw',
      littleEndian: true,
      options: {
        height: 128,
        layout: 'HW',
        width: 128,
      },
      shape: [128, 128],
    })
    const dataUrl = await rawImageToPngDataUrl(raw, sharp)

    expect(raw.width).toBe(128)
    expect(raw.height).toBe(128)
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true)
    const metadata = await sharp(Buffer.from(dataUrl.split(',')[1], 'base64')).metadata()
    expect(metadata.width).toBe(128)
    expect(metadata.height).toBe(128)
  })

  it('converts a random 128x128 PNG to browser-ready base64', async () => {
    const sourcePath = path.join(tmpDir, 'random.png')
    await createPng(sourcePath)

    const dataUrl = await convertImageToBase64(sourcePath, sharp)

    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true)
    const metadata = await sharp(Buffer.from(dataUrl.split(',')[1], 'base64')).metadata()
    expect(metadata.width).toBe(128)
    expect(metadata.height).toBe(128)
  })

  it('generates thumbnails through the main-thread fallback when no worker is available', async () => {
    const sourcePath = path.join(tmpDir, 'thumb-source.png')
    await createPng(sourcePath)

    const result = await VscodeMessageFactory[CmdToVscode.get_thumbnails](
      { images: [sourcePath], maxWidth: 64 },
      createPanel(tmpDir),
    )

    expect(result).toHaveLength(1)
    expect(result[0].filePath).toBe(sourcePath)
    expect(result[0].thumbPath).toContain('vscode-resource://')
    expect(result[0].thumbPath).toContain('thumb-source')
  })

  it('normalizes low-range 16-bit TIFFs before producing preview PNG data', async () => {
    const sourcePath = path.join(tmpDir, 'low-range-u16.tif')
    await fs.writeFile(sourcePath, createLowRangeU16Tiff())

    const normalized = await normalizeTiffToPngBuffer(sourcePath, sharp)
    expect(normalized).toBeTruthy()
    const dataUrl = await convertImageToBase64(sourcePath, sharp)

    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true)
    const png = Buffer.from(dataUrl.split(',')[1], 'base64')
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
    expect(info.width).toBe(16)
    expect(info.height).toBe(16)
    let min = 255
    let max = 0
    for (const value of data) {
      min = Math.min(min, value)
      max = Math.max(max, value)
    }
    expect(min).toBeLessThan(24)
    expect(max).toBeGreaterThan(220)
  })

  it('scales low-range float TIFF previews into visible 8-bit PNG data', async () => {
    const sourcePath = path.join(tmpDir, 'low-range-float.tif')
    await fs.writeFile(sourcePath, createLowRangeFloat32Tiff())

    const normalized = await normalizeTiffToPngBuffer(sourcePath, sharp)
    expect(normalized).toBeTruthy()
    const dataUrl = await convertImageToBase64(sourcePath, sharp)

    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true)
    const png = Buffer.from(dataUrl.split(',')[1], 'base64')
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
    expect(info.width).toBe(16)
    expect(info.height).toBe(16)
    let min = 255
    let max = 0
    for (const value of data) {
      min = Math.min(min, value)
      max = Math.max(max, value)
    }
    expect(min).toBeLessThan(24)
    expect(max).toBeGreaterThan(220)
    expect(png.byteLength).toBeGreaterThan(512)
  })

  it('generates a normalized low-range 16-bit TIFF thumbnail without full-size output', async () => {
    const sourcePath = path.join(tmpDir, 'low-range-u16-thumb.tif')
    await fs.writeFile(sourcePath, createLowRangeU16Tiff(32, 16))

    const result = await VscodeMessageFactory[CmdToVscode.get_thumbnails](
      { images: [sourcePath], maxWidth: 16 },
      createPanel(tmpDir),
    )

    expect(result).toHaveLength(1)
    const thumbPath = result[0].thumbPath.replace('vscode-resource://', '')
    const { data, info } = await sharp(thumbPath).raw().toBuffer({ resolveWithObject: true })
    expect(info.width).toBe(16)
    expect(info.height).toBe(8)
    let min = 255
    let max = 0
    for (const value of data) {
      min = Math.min(min, value)
      max = Math.max(max, value)
    }
    expect(min).toBeLessThan(24)
    expect(max).toBeGreaterThan(220)
  })

  it('generates a visible thumbnail for low-range float TIFFs', async () => {
    const sourcePath = path.join(tmpDir, 'low-range-float-thumb.tif')
    await fs.writeFile(sourcePath, createLowRangeFloat32Tiff(32, 16))

    const result = await VscodeMessageFactory[CmdToVscode.get_thumbnails](
      { images: [sourcePath], maxWidth: 16 },
      createPanel(tmpDir),
    )

    expect(result).toHaveLength(1)
    const thumbPath = result[0].thumbPath.replace('vscode-resource://', '')
    const { data, info } = await sharp(thumbPath).raw().toBuffer({ resolveWithObject: true })
    expect(info.width).toBe(16)
    expect(info.height).toBe(8)
    let min = 255
    let max = 0
    for (const value of data) {
      min = Math.min(min, value)
      max = Math.max(max, value)
    }
    expect(min).toBeLessThan(24)
    expect(max).toBeGreaterThan(220)
  })

  it('compresses a random 128x128 image into the selected output folder', async () => {
    const sourcePath = path.join(tmpDir, 'compress-source.png')
    const outputDir = path.join(tmpDir, '压缩')
    await createPng(sourcePath)

    const image = await imageOf(sourcePath, tmpDir)
    const compressor = new UsualCompressor({
      ...DEFAULT_CONFIG.compression,
      keepOriginal: true,
      outputDir,
      skipCompressed: false,
    }, createPanel(tmpDir))
    const result = await compressor.run(image, compressor.option)

    expect(result.error).toBe('')
    expect(result.outputPath?.replace(/\\/g, '/')).toContain('/压缩/')
    expect(await fs.stat(result.outputPath!)).toBeTruthy()
  })

  it('converts a random 128x128 image into the selected output folder', async () => {
    const sourcePath = path.join(tmpDir, 'convert-source.png')
    const outputDir = path.join(tmpDir, '格式转换')
    await createPng(sourcePath)

    const image = await imageOf(sourcePath, tmpDir)
    const converter = new FormatConverter(DEFAULT_CONFIG.conversion, createPanel(tmpDir))
    const result = await converter.run(image, {
      ...DEFAULT_CONFIG.conversion,
      format: 'webp',
      keepOriginal: true,
      outputDir,
    })

    expect(result.error).toBe('')
    expect(result.outputPath?.replace(/\\/g, '/')).toMatch(/\/格式转换\/convert-source\.webp$/)
    const metadata = await sharp(await fs.readFile(result.outputPath!)).metadata()
    expect(metadata.width).toBe(128)
    expect(metadata.height).toBe(128)
  })

  it('converts an image to grayscale even when the output format stays the same', async () => {
    const sourcePath = path.join(tmpDir, 'grayscale-source.png')
    await createPng(sourcePath)

    const image = await imageOf(sourcePath, tmpDir)
    const converter = new FormatConverter(DEFAULT_CONFIG.conversion, createPanel(tmpDir))
    const result = await converter.run(image, {
      ...DEFAULT_CONFIG.conversion,
      format: 'png',
      grayscale: true,
      keepOriginal: true,
    })

    expect(result.error).toBe('')
    expect(result.outputPath?.replace(/\\/g, '/')).toMatch(/grayscale-source\.gray\.png$/)
    const { data, info } = await sharp(await fs.readFile(result.outputPath!)).raw().toBuffer({ resolveWithObject: true })
    expect(info.width).toBe(128)
    expect(info.height).toBe(128)
    for (let index = 0; index < data.length; index += info.channels) {
      const r = data[index]
      const g = data[index + 1] ?? r
      const b = data[index + 2] ?? r
      expect(r).toBe(g)
      expect(g).toBe(b)
      if (index > 96)
        break
    }
  })
})
