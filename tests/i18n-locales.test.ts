import fs from 'node:fs'
import path from 'node:path'
import JSON5 from 'json5'
import { describe, expect, it } from 'vitest'

const localeDir = path.resolve(__dirname, '../src/webview/image-manager/i18n/locales')
const localeNames = ['en', 'zh-CN', 'zh-TW', 'ja', 'de'] as const

function loadLocale(locale: string) {
  return JSON5.parse(fs.readFileSync(path.join(localeDir, `${locale}.json5`), 'utf8'))
}

describe('webview i18n locales', () => {
  it('keeps similarity empty-candidate messages available in every locale', () => {
    const keys = [
      'no_similarity_candidates_title',
      'no_similarity_candidates_desc',
      'similarity_algorithm',
      'similarity_threshold',
      'similarity_threshold_auto',
      'similarity_threshold_range',
      'similarity_threshold_help',
      'similarity_threshold_direction',
      'similarity_max_results',
      'similarity_max_results_hint',
      'similarity_scope',
      'similarity_scope_hint',
      'similarity_results_total',
      'similarity_help',
      'similarity_unit_hybrid',
      'similarity_unit_phash',
      'similarity_unit_dhash',
      'similarity_unit_ahash',
      'similarity_unit_histogram',
      'similarity_algorithm_hybrid_short',
      'similarity_algorithm_phash_short',
      'similarity_algorithm_dhash_short',
      'similarity_algorithm_ahash_short',
      'similarity_algorithm_histogram_short',
      'similarity_algorithm_hybrid_desc',
      'similarity_algorithm_phash_desc',
      'similarity_algorithm_dhash_desc',
      'similarity_algorithm_ahash_desc',
      'similarity_algorithm_histogram_desc',
      'similarity_algorithm_hybrid_use_case',
      'similarity_algorithm_phash_use_case',
      'similarity_algorithm_dhash_use_case',
      'similarity_algorithm_ahash_use_case',
      'similarity_algorithm_histogram_use_case',
    ] as const

    for (const locale of localeNames) {
      const resources = loadLocale(locale)
      for (const key of keys) {
        expect(resources.im[key], `${locale}:${key}`).toEqual(expect.any(String))
        expect(resources.im[key].trim(), `${locale}:${key}`).not.toBe('')
      }
    }
  })

  it('keeps TOAST UI editor supplement labels available in every locale', () => {
    const keys = [
      'edit_image',
      'measure',
      'line',
      'polygon',
      'angle',
      'angle_from_edges',
      'length',
      'area',
      'perimeter',
      'line_opacity',
      'node_opacity',
      'node_size',
      'delete_point',
      'show_measure_toolbar',
      'hide_measure_toolbar',
      'histogram',
      'histogram_range',
      'binarized',
      'pixel_values',
      'pixel_values_raw',
      'pixel_values_adjusted',
      'save',
      'download',
      'fit_to_window',
      'reset_center',
      'wheel_zoom_mode',
      'wheel_page_mode',
      'lock_zoom',
      'unlock_zoom',
      'first_slice',
      'all_slices',
      'grayscale',
      'none',
      'tiff_compression',
      'tiff_compression_tip',
      'output_path',
      'output_path_placeholder',
      'preset_name',
      'apply_preset_to_folder',
      'test',
      'loading',
    ] as const

    for (const locale of localeNames) {
      const resources = loadLocale(locale)
      for (const key of keys) {
        expect(resources.im[key], `${locale}:${key}`).toEqual(expect.any(String))
        expect(resources.im[key].trim(), `${locale}:${key}`).not.toBe('')
      }
    }
  })
})
