import { describe, expect, it } from 'vitest'
import {
  hasInitialImagePagePending,
  needsDirectoryOpenRequest,
  shouldSkipDuplicateDirectoryOpen,
} from '../src/webview/image-manager/components/collapse-tree/components/image-collapse/directory-open-state'

describe('directory open state', () => {
  it('requests the first image page after a skeleton-only directory load', () => {
    const pending = hasInitialImagePagePending({
      childrenLoaded: true,
      loadedImageCount: 0,
      totalImageCount: 1602,
    })

    expect(pending).toBe(true)
    expect(needsDirectoryOpenRequest({
      childrenLoaded: true,
      loadedImageCount: 0,
      totalImageCount: 1602,
    })).toBe(true)
    expect(shouldSkipDuplicateDirectoryOpen({
      hasInitialImagePagePending: pending,
      hasOpenRequestSession: true,
      reason: 'active-effect',
    })).toBe(false)
  })

  it('does not request an image page after images are already loaded', () => {
    expect(hasInitialImagePagePending({
      childrenLoaded: true,
      loadedImageCount: 128,
      totalImageCount: 1602,
    })).toBe(false)
    expect(needsDirectoryOpenRequest({
      childrenLoaded: true,
      loadedImageCount: 128,
      totalImageCount: 1602,
    })).toBe(false)
  })

  it('keeps duplicate automatic opens collapsed for settled directories', () => {
    expect(shouldSkipDuplicateDirectoryOpen({
      hasInitialImagePagePending: false,
      hasOpenRequestSession: true,
      reason: 'collapse-change',
    })).toBe(true)
  })

  it('still requests children for unopened directories', () => {
    expect(needsDirectoryOpenRequest({
      childrenLoaded: false,
      loadedImageCount: 0,
      totalImageCount: 0,
    })).toBe(true)
  })
})
