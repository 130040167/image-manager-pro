import { describe, expect, it, vi } from 'vitest'
import {
  getSimilarityAlgorithmOptions,
  getSimilarityAlgorithmProfile,
} from '~/core/analysis/similarity-common'
import {
  getSimilarityAutoPlaceholder,
  getSimilarityCandidateImages,
  getSimilarityResultContextMenuEnable,
  getSimilaritySearchLaunch,
  resolveSimilarityOptions,
  showOrUpdateSimilarityModal,
} from '~/webview/image-manager/hooks/use-image-similarity/similarity-ui'

function image(path: string, absDirPath = 'c:/img') {
  return {
    absDirPath,
    path,
  }
}

describe('similarity ui helpers', () => {
  it('describes algorithm-specific controls and help copy', () => {
    expect(getSimilarityAlgorithmOptions().map(option => option.value)).toEqual([
      'hybrid',
      'phash',
      'dhash',
      'ahash',
      'histogram',
    ])

    expect(getSimilarityAlgorithmProfile('hybrid')).toMatchObject({
      label: 'Hybrid',
      threshold: {
        defaultValue: 14,
        max: 64,
        min: 0,
        recommended: [10, 18],
        unit: 'combined distance',
      },
    })
    expect(getSimilarityAlgorithmProfile('hybrid').description).toContain('pHash')
    expect(getSimilarityAlgorithmProfile('histogram').threshold.unit).toBe('color distance')
  })

  it('resolves default similarity options', () => {
    expect(resolveSimilarityOptions()).toEqual({
      algorithm: 'hybrid',
      maxResults: 50,
      scope: 'all',
      sliceStrategy: 'first',
      threshold: undefined,
    })
    expect(resolveSimilarityOptions({ algorithm: 'phash' }).threshold).toBeUndefined()
    expect(resolveSimilarityOptions({ algorithm: 'phash', threshold: 12 }).threshold).toBe(12)
    expect(resolveSimilarityOptions({ algorithm: 'dhash' }).threshold).toBe(8)
    expect(resolveSimilarityOptions({ algorithm: 'ahash' }).threshold).toBe(8)
    expect(resolveSimilarityOptions({ algorithm: 'histogram' }).threshold).toBeUndefined()
    expect(resolveSimilarityOptions({ algorithm: 'hybrid', threshold: 7 }).threshold).toBe(7)
  })

  it('normalizes user-entered thresholds and result limits to algorithm ranges', () => {
    expect(resolveSimilarityOptions({ algorithm: 'dhash', maxResults: 0, threshold: -5 })).toMatchObject({
      algorithm: 'dhash',
      maxResults: 1,
      threshold: 0,
    })
    expect(resolveSimilarityOptions({ algorithm: 'hybrid', maxResults: 999, threshold: 999 })).toMatchObject({
      algorithm: 'hybrid',
      maxResults: 500,
      threshold: 64,
    })
    expect(resolveSimilarityOptions({ algorithm: 'phash', threshold: 12.8 }).threshold).toBe(13)
  })

  it('exposes ui placeholders for auto thresholds by algorithm', () => {
    expect(getSimilarityAutoPlaceholder('dhash')).toBe('8')
    expect(getSimilarityAutoPlaceholder('ahash')).toBe('8')
    expect(getSimilarityAutoPlaceholder('phash')).toBe('14')
    expect(getSimilarityAutoPlaceholder('histogram')).toBe('14')
    expect(getSimilarityAutoPlaceholder('hybrid')).toBe('14')
  })

  it('returns no candidates for an empty scope', () => {
    expect(getSimilarityCandidateImages(image('c:/img/source.png'), [], { scope: 'all' })).toEqual([])
  })

  it('excludes the source image from candidates', () => {
    const source = image('c:/img/source.png')
    expect(getSimilarityCandidateImages(source, [source], { scope: 'all' })).toEqual([])
  })

  it('filters candidates to the same directory', () => {
    const source = image('c:/img/source.png', 'c:/img')
    const sameDir = image('c:/img/near.png', 'c:/img')
    const otherDir = image('c:/other/near.png', 'c:/other')

    expect(getSimilarityCandidateImages(source, [source, sameDir, otherDir], { scope: 'same-level' })).toEqual([sameDir])
  })

  it('keeps all non-source directories and removes duplicate paths', () => {
    const source = image('c:/img/source.png', 'c:/img')
    const first = image('c:/img/near.png', 'c:/img')
    const duplicate = image('c:/img/near.png', 'c:/img')
    const otherDir = image('c:/other/near.png', 'c:/other')

    expect(getSimilarityCandidateImages(source, [source, first, duplicate, otherDir], { scope: 'all' })).toEqual([first, otherDir])
  })

  it('matches the clicked mode while keeping full workspace candidates available for later scope changes', () => {
    const sameLevelOnly = [image('c:/img/source.png', 'c:/img'), image('c:/img/near.png', 'c:/img')]
    const wholeWorkspace = [...sameLevelOnly, image('c:/other/far.png', 'c:/other')]

    expect(getSimilaritySearchLaunch('same-level', {
      sameLevelImages: sameLevelOnly,
      sameWorkspaceImages: wholeWorkspace,
    })).toEqual({
      options: { scope: 'same-level' },
      scopeImages: wholeWorkspace,
    })

    expect(getSimilaritySearchLaunch('all', {
      sameLevelImages: sameLevelOnly,
      sameWorkspaceImages: wholeWorkspace,
    })).toEqual({
      options: { scope: 'all' },
      scopeImages: wholeWorkspace,
    })
  })

  it('falls back to the local image list when no workspace-wide candidates are available', () => {
    const sameLevelOnly = [image('c:/img/source.png', 'c:/img'), image('c:/img/near.png', 'c:/img')]

    expect(getSimilaritySearchLaunch('same-level', {
      sameLevelImages: sameLevelOnly,
    })).toEqual({
      options: { scope: 'same-level' },
      scopeImages: sameLevelOnly,
    })
  })

  it('enables a focused context menu for similarity result thumbnails', () => {
    expect(getSimilarityResultContextMenuEnable()).toMatchObject({
      compress: true,
      crop: true,
      delete: true,
      edit: true,
      format_conversion: true,
      rename: true,
      reveal_in_viewer: true,
    })
    expect(getSimilarityResultContextMenuEnable().find_similar_in_all).toBe(false)
    expect(getSimilarityResultContextMenuEnable().find_similar_in_same_level).toBe(false)
  })

  it('updates an open modal when update succeeds', () => {
    const showModal = vi.fn()
    const updateModal = vi.fn(() => ({ destroy: vi.fn() }))

    showOrUpdateSimilarityModal({
      isOpened: () => true,
      showModal,
      updateModal,
    }, { id: 'next' })

    expect(updateModal).toHaveBeenCalledWith({ id: 'next' })
    expect(showModal).not.toHaveBeenCalled()
  })

  it('reopens the modal when an update has no instance to update', () => {
    const showModal = vi.fn(() => ({ destroy: vi.fn() }))
    const updateModal = vi.fn(() => undefined)

    showOrUpdateSimilarityModal({
      isOpened: () => true,
      showModal,
      updateModal,
    }, { id: 'next' })

    expect(updateModal).toHaveBeenCalledWith({ id: 'next' })
    expect(showModal).toHaveBeenCalledWith({ id: 'next' })
  })
})
