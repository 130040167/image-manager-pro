import fs from 'node:fs'
import path from 'node:path'
import i18next from 'i18next'
import JSON5 from 'json5'
import { describe, expect, it } from 'vitest'
import { editorText } from '~/webview/image-manager/components/image-editor/editor-i18n'

const localeDir = path.resolve(__dirname, '../src/webview/image-manager/i18n/locales')
const en = JSON5.parse(fs.readFileSync(path.join(localeDir, 'en.json5'), 'utf8'))
const zh = JSON5.parse(fs.readFileSync(path.join(localeDir, 'zh-CN.json5'), 'utf8'))

describe('editor language resources', () => {
  it('resolves every editor key using the application namespace configuration', async () => {
    await i18next.init({
      lng: 'en',
      nsSeparator: '.',
      keySeparator: '.',
      resources: { 'en': { translation: en }, 'zh-CN': { translation: zh } },
      interpolation: { escapeValue: false },
    })
    for (const [key, value] of Object.entries(en.im.editor)) {
      expect(editorText(key), key).toBe(value)
    }
    expect(editorText('色板 {{color}}', { color: '#123456' })).toBe('Palette #123456')
    await i18next.changeLanguage('zh-CN')
    expect(Object.keys(zh.im.editor).sort()).toEqual(Object.keys(en.im.editor).sort())
    for (const key of Object.keys(zh.im.editor)) {
      expect(editorText(key), key).toBe(key)
    }
    expect(editorText('色板 {{color}}', { color: '#123456' })).toBe('色板 #123456')
  })
})
