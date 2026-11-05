import { describe, expect, it } from 'vitest'
import { resolveVisibleImageSourceState, shouldBlockOnViewportThumbnail, shouldRequestViewportThumbnail } from '~/webview/image-manager/components/lazy-image/components/visible-image/source-state'

describe('thumbnail display source resolution', () => {
  it('keeps supported small images visible while thumbnails are not needed', () => {
    const state = resolveVisibleImageSourceState({
      needsBase64: false,
      needsThumb: false,
      renderedSrc: 'vscode-resource://image.png',
      thumbSrc: undefined,
      waitForThumbnail: false,
    })

    expect(state.gridSrc).toBe('vscode-resource://image.png')
    expect(state.shouldWaitForThumbnail).toBe(false)
    expect(state.showThumbFallback).toBe(false)
  })

  it('keeps known large supported images visible while a thumbnail is loading', () => {
    const state = resolveVisibleImageSourceState({
      needsBase64: false,
      needsThumb: true,
      renderedSrc: 'vscode-resource://large-image.png',
      thumbSrc: undefined,
      waitForThumbnail: false,
    })

    expect(state.gridSrc).toBe('vscode-resource://large-image.png')
    expect(state.shouldWaitForThumbnail).toBe(false)
    expect(state.showThumbFallback).toBe(false)
  })

  it('keeps unknown-size supported images visible without entering the thumbnail queue yet', () => {
    const state = resolveVisibleImageSourceState({
      needsBase64: false,
      needsThumb: false,
      renderedSrc: 'vscode-resource://unknown-size-image.png',
      thumbSrc: undefined,
      waitForThumbnail: false,
    })

    expect(state.gridSrc).toBe('vscode-resource://unknown-size-image.png')
    expect(state.shouldWaitForThumbnail).toBe(false)
    expect(state.showThumbFallback).toBe(false)
  })

  it('uses thumbnails when they are available', () => {
    const state = resolveVisibleImageSourceState({
      needsBase64: false,
      needsThumb: true,
      renderedSrc: 'vscode-resource://image.png',
      thumbSrc: 'vscode-resource://thumb.jpg',
      waitForThumbnail: true,
    })

    expect(state.gridSrc).toBe('vscode-resource://thumb.jpg')
    expect(state.showThumbFallback).toBe(false)
  })

  it('keeps unsupported images behind the placeholder until a thumbnail or base64 source exists', () => {
    const state = resolveVisibleImageSourceState({
      needsBase64: true,
      needsThumb: true,
      renderedSrc: 'vim-unsupported://image.tif',
      thumbSrc: undefined,
      waitForThumbnail: true,
    })

    expect(state.gridSrc).toBeUndefined()
    expect(state.shouldWaitForThumbnail).toBe(true)
    expect(state.showThumbFallback).toBe(true)
  })

  it('uses cached base64 for unsupported images while a thumbnail is not available', () => {
    const state = resolveVisibleImageSourceState({
      base64Src: 'data:image/png;base64,abc',
      needsBase64: true,
      needsThumb: true,
      renderedSrc: 'data:image/png;base64,abc',
      thumbSrc: undefined,
      waitForThumbnail: true,
    })

    expect(state.gridSrc).toBe('data:image/png;base64,abc')
    expect(state.shouldWaitForThumbnail).toBe(false)
    expect(state.showThumbFallback).toBe(false)
  })

  it('does not request a thumbnail until a supported image has a known large size', () => {
    expect(shouldRequestViewportThumbnail({
      needsBase64: false,
      size: 0,
      threshold: 512 * 1024,
    })).toBe(false)
    expect(shouldRequestViewportThumbnail({
      needsBase64: false,
      size: 1024 * 1024,
      threshold: 512 * 1024,
    })).toBe(true)
  })

  it('keeps an already visible unknown-size image visible after metadata promotes it to thumbnail loading', () => {
    const state = resolveVisibleImageSourceState({
      needsBase64: false,
      needsThumb: true,
      renderedSrc: 'vscode-resource://later-known-large-image.png',
      thumbSrc: undefined,
      waitForThumbnail: false,
    })

    expect(state.gridSrc).toBe('vscode-resource://later-known-large-image.png')
    expect(state.shouldWaitForThumbnail).toBe(false)
    expect(state.showThumbFallback).toBe(false)
  })

  it('does not block supported unknown-size images on the thumbnail request', () => {
    expect(shouldBlockOnViewportThumbnail({
      needsBase64: false,
      size: 0,
      threshold: 512 * 1024,
    })).toBe(false)
  })

  it('does not block known large supported images while thumbnails load', () => {
    expect(shouldBlockOnViewportThumbnail({
      needsBase64: false,
      size: 1024 * 1024,
      threshold: 512 * 1024,
    })).toBe(false)
  })

  it('blocks unsupported images until a thumbnail or base64 source is ready', () => {
    expect(shouldBlockOnViewportThumbnail({
      needsBase64: true,
      size: 0,
      threshold: 512 * 1024,
    })).toBe(true)
  })

  it('skips supported small images once their size is known', () => {
    expect(shouldRequestViewportThumbnail({
      needsBase64: false,
      size: 128 * 1024,
      threshold: 512 * 1024,
    })).toBe(false)
  })
})
