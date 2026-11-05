// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import {
  buildPreviewContextMenuEnable,
  buildThumbnailContextMenuEnable,
  isInPreviewRoot,
  resolvePreviewRootTarget,
} from '~/webview/image-manager/components/image-group/preview-context-menu'

describe('preview context menu guards', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('only treats AntD/rc image preview portal DOM as preview context', () => {
    const previewRoot = document.createElement('div')
    previewRoot.className = 'ant-image-preview-root'
    const image = document.createElement('img')
    previewRoot.append(image)
    document.body.append(previewRoot)

    const toolbar = document.createElement('button')
    document.body.append(toolbar)

    expect(isInPreviewRoot(image)).toBe(true)
    expect(isInPreviewRoot(toolbar)).toBe(false)
    expect(isInPreviewRoot(null)).toBe(false)
  })

  it('supports rc-image preview root class names', () => {
    const previewRoot = document.createElement('div')
    previewRoot.className = 'rc-image-preview-root'
    const image = document.createElement('img')
    previewRoot.append(image)
    document.body.append(previewRoot)

    expect(isInPreviewRoot(image)).toBe(true)
  })

  it('falls back to elementFromPoint when the wheel event target is body', () => {
    const previewRoot = document.createElement('div')
    previewRoot.className = 'ant-image-preview-root'
    const image = document.createElement('img')
    previewRoot.append(image)
    document.body.append(previewRoot)

    document.elementFromPoint = () => image

    expect(resolvePreviewRootTarget(document.body, { x: 240, y: 180 })).toBe(previewRoot)
  })

  it('returns null when neither the event target nor the point is inside preview', () => {
    const unrelated = document.createElement('div')
    document.body.append(unrelated)

    document.elementFromPoint = () => unrelated

    expect(resolvePreviewRootTarget(unrelated, { x: 12, y: 16 })).toBeNull()
  })

  it('keeps thumbnail context menu from adding a redundant Preview layer', () => {
    expect(buildThumbnailContextMenuEnable({ preview: true, rename: true })).toEqual({
      preview: false,
      rename: true,
    })
  })

  it('keeps preview context menu operations inside the requested groups', () => {
    const enable = buildPreviewContextMenuEnable({
      cut: true,
      delete: true,
      preview: true,
      rename: true,
      transform: false,
    })!

    expect(enable).toMatchObject({
      compress: true,
      crop: true,
      edit: true,
      find_similar_in_all: true,
      find_similar_in_same_level: true,
      format_conversion: true,
      preview: false,
      rename: false,
      transform: true,
    })
    expect(enable.cut).toBe(false)
    expect(enable.delete).toBe(false)
  })
})
