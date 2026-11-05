import { describe, expect, it } from 'vitest'
import {
  buildFilenameSearchMatcher,
  filterImagesByFilename,
  scoreFilenameMatch,
} from '~/webview/image-manager/hooks/use-image-search/search-utils'

function image(basename: string, dirPath = 'samples') {
  return {
    basename,
    dirPath,
    path: `c:/workspace/${dirPath}/${basename}`,
  } as ImageType
}

describe('image filename search utils', () => {
  it('scores exact filename matches ahead of partial matches', () => {
    expect(scoreFilenameMatch('image_01.png', 'image_01', false, false)).toBeGreaterThan(
      scoreFilenameMatch('image_010.png', 'image_01', false, false),
    )
  })

  it('supports whole-word style filename stem matching', () => {
    expect(scoreFilenameMatch('slice_001.png', 'slice_001', false, true)).toBeGreaterThan(0)
    expect(scoreFilenameMatch('slice_001_extra.png', 'slice_001', false, true)).toBe(0)
  })

  it('respects case sensitivity when requested', () => {
    expect(scoreFilenameMatch('Sample.PNG', 'sample', true, false)).toBe(0)
    expect(scoreFilenameMatch('Sample.PNG', 'sample', false, false)).toBeGreaterThan(0)
  })

  it('filters and sorts images by filename quality first', () => {
    const result = filterImagesByFilename(
      [
        image('image_010.png'),
        image('image_01.png'),
        image('preview-image_01.png'),
        image('mask.png'),
      ],
      buildFilenameSearchMatcher({
        caseSensitive: false,
        includeGlob: undefined,
        keyword: 'image_01',
        wholeWord: false,
      }),
    )

    expect(result.map(item => item.image.basename)).toEqual([
      'image_01.png',
      'image_010.png',
      'preview-image_01.png',
    ])
  })
})
