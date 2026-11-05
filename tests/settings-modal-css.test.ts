import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const globalCssPath = path.resolve(__dirname, '../src/webview/image-manager/styles/global.css')
const settingsCssPath = path.resolve(__dirname, '../src/webview/image-manager/hooks/use-settings/settings/index.module.css')

describe('settings modal css guards', () => {
  it('keeps the settings modal content constrained inside the viewport', () => {
    const css = fs.readFileSync(globalCssPath, 'utf8')

    expect(css).toMatch(/\.vim-settings-modal\s*\{[^}]*top:\s*0 !important;/)
    expect(css).toMatch(/\.vim-settings-modal\s+\.ant-modal-content\s*\{[^}]*max-height:\s*calc\(100vh - 32px\);/)
    expect(css).toMatch(/\.vim-settings-modal\s+\.ant-modal-body\s*\{[^}]*max-height:\s*calc\(100vh - 108px\);/)
    expect(css).toMatch(/\.vim-settings-modal\s+\.ant-modal-close\s*\{[^}]*top:\s*12px;/)
    expect(css).toMatch(/\.vim-settings-modal\s+\.ant-modal-close\s*\{[^}]*z-index:\s*2;/)
  })

  it('keeps the settings panel body scrollable instead of closing on internal interactions', () => {
    const css = fs.readFileSync(settingsCssPath, 'utf8')

    expect(css).toMatch(/\.settingsBody\s*\{[^}]*flex:\s*1 1 auto;/)
    expect(css).toMatch(/\.settingsBody\s*\{[^}]*overflow:\s*auto;/)
    expect(css).toMatch(/\.settingsRoot\s*\{[^}]*overflow:\s*hidden;/)
    expect(css).toMatch(/\.settingsRoot\s*\{[^}]*width:\s*min\(860px,\s*calc\(100vw - 48px\)\);/)
  })

  it('keeps file format suffix presets compact and readable', () => {
    const css = fs.readFileSync(settingsCssPath, 'utf8')

    expect(css).toMatch(/\.fileFormatControls\s*\{[^}]*grid-template-columns:\s*minmax\(148px,\s*1\.15fr\)\s+minmax\(124px,\s*0\.9fr\)\s+112px\s+auto;/)
    expect(css).toMatch(/\.fileFormatTagList\s*\{[^}]*gap:\s*6px;/)
    expect(css).toMatch(/\.fileFormatTag\s*\{[^}]*min-height:\s*26px;/)
    expect(css).toMatch(/\.fileFormatTag\s*\{[^}]*padding:\s*3px 9px;/)
    expect(css).toMatch(/\.fileFormatTag\s*\{[^}]*font-size:\s*13px;/)
    expect(css).toMatch(/\.fileFormatTag\s*\{[^}]*font-weight:\s*600;/)
    expect(css).toMatch(/\.fileFormatPresetGrid\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);/)
    expect(css).toMatch(/\.fileFormatPresetGrid\s*\{[^}]*gap:\s*8px 10px;/)
    expect(css).toMatch(/\.presetFieldWide\s*\{[^}]*grid-column:\s*span 2;/)
    expect(css).toMatch(/\.presetFieldFull\s*\{[^}]*grid-column:\s*1 \/ -1;/)
    expect(css).toMatch(/\.presetRangeGroup\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/)
  })
})
