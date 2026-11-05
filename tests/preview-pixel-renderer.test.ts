// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { drawPreviewPixelTile } from '~/webview/image-manager/components/pixel-inspector/preview-pixel-renderer'

describe('preview pixel tiles', () => {
  it('copies only the visible region of a large source and preserves exact boundaries', () => {
    const source = { width: 3073, height: 2049, data: new Uint8ClampedArray(3073 * 2049 * 4) }
    source.data.set([255, 0, 0, 255, 0, 255, 0, 255], (2047 * 3073 + 3070) * 4)
    const canvas = document.createElement('canvas')
    canvas.width = 80
    canvas.height = 40
    const context = canvas.getContext('2d')!
    const tile = document.createElement('canvas')
    drawPreviewPixelTile(context, tile, source, {
      a: 30,
      b: 0,
      c: 0,
      d: 30,
      width: 3073,
      height: 2049,
      centerX: 30 * (3073 / 2 - 3070),
      centerY: 30 * (2049 / 2 - 2047),
    }, { left: 3070, right: 3072, top: 2047, bottom: 2048 })
    expect([tile.width, tile.height]).toEqual([2, 1])
    expect([...context.getImageData(29, 15, 1, 1).data]).toEqual([255, 0, 0, 255])
    expect([...context.getImageData(30, 15, 1, 1).data]).toEqual([0, 255, 0, 255])
    expect(context.getImageData(60, 15, 1, 1).data[3]).toBe(0)
  })

  it('applies display range without modifying raw pixels or transparent alpha', () => {
    const source = { width: 2, height: 1, data: new Uint8ClampedArray([50, 100, 150, 255, 200, 250, 255, 0]) }
    const original = source.data.slice()
    const canvas = document.createElement('canvas')
    canvas.width = 40
    canvas.height = 20
    const context = canvas.getContext('2d')!
    drawPreviewPixelTile(context, document.createElement('canvas'), source, {
      a: 20,
      b: 0,
      c: 0,
      d: 20,
      width: 2,
      height: 1,
      centerX: 20,
      centerY: 10,
    }, { left: 0, top: 0, right: 2, bottom: 1 }, [50, 150])
    expect([...context.getImageData(10, 10, 1, 1).data]).toEqual([0, 128, 255, 255])
    expect(context.getImageData(30, 10, 1, 1).data[3]).toBe(0)
    expect(source.data).toEqual(original)
  })
})
