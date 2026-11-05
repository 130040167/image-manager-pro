import { describe, expect, it } from 'vitest'
import { resolveImageDetailDimensionInfo } from '~/webview/image-manager/hooks/use-image-details/model'

describe('image detail dimension info', () => {
  it('prefers raw custom-format shape text while keeping rendered pixel size available', () => {
    expect(resolveImageDetailDimensionInfo({
      channels: 3,
      height: 32,
      shape: [8, 32, 64],
      width: 64,
    })).toEqual({
      imageSizeText: '64 x 32 x 3',
      shapeText: '8 x 32 x 64',
    })
  })

  it('falls back to rendered pixel dimensions for regular images', () => {
    expect(resolveImageDetailDimensionInfo({
      channels: 4,
      height: 256,
      width: 512,
    })).toEqual({
      imageSizeText: '512 x 256 x 4',
      shapeText: undefined,
    })
  })
})
