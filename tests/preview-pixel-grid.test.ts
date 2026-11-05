import type { PixelTransform } from '~/webview/image-manager/components/pixel-inspector/preview-pixel-grid'
import { describe, expect, it } from 'vitest'
import { getDisplayedPixelSize, imagePixelToScreen, screenToImagePixel } from '~/webview/image-manager/components/pixel-inspector/preview-pixel-grid'

const base: PixelTransform = { a: 25.125, b: 0, c: 0, d: 25.125, centerX: 353.75, centerY: 248.125, width: 8, height: 6 }

describe('preview source-pixel coordinates', () => {
  it('keeps a fractional, panned image origin and its exact cell boundaries', () => {
    expect(imagePixelToScreen(base, 0, 0)).toEqual({ x: 253.25, y: 172.75 })
    expect(imagePixelToScreen(base, 1, 1)).toEqual({ x: 278.375, y: 197.875 })
    expect(screenToImagePixel(base, 278.375, 197.875)).toEqual({ imgX: 1, imgY: 1 })
  })

  it('uses rotation and flip in the order of the actual CSS matrix', () => {
    const rotated = { ...base, a: 0, b: -25, c: -25, d: 0 }
    expect(imagePixelToScreen(rotated, 0, 0)).toEqual({ x: 428.75, y: 348.125 })
    expect(screenToImagePixel(rotated, 428.75, 348.125)).toEqual({ imgX: 0, imgY: 0 })
    expect(getDisplayedPixelSize(rotated)).toBe(25)
  })

  it.each([0.5, 14, 22, 50])('identifies every standard-pattern cell centre at scale %s', (scale) => {
    for (const matrix of [[scale, 0, 0, scale], [0, scale, -scale, 0], [-scale, 0, 0, scale], [0, -scale, -scale, 0]]) {
      const [a, b, c, d] = matrix
      const transform = { ...base, a, b, c, d }
      for (let y = 0; y < 6; y++) {
        for (let x = 0; x < 8; x++) {
          const screen = imagePixelToScreen(transform, x + 0.5, y + 0.5)
          const point = screenToImagePixel(transform, screen.x, screen.y)!
          expect([Math.floor(point.imgX), Math.floor(point.imgY)]).toEqual([x, y])
        }
      }
    }
  })

  it('rejects an image collapsed by a transition', () => {
    expect(screenToImagePixel({ ...base, a: 0, b: 0 }, 0, 0)).toBeNull()
  })
})
