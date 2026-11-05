import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const cssPath = path.resolve(__dirname, '../src/webview/image-manager/components/image-editor/index.css')
const fabricCssPath = path.resolve(__dirname, '../src/webview/image-manager/components/image-editor/fabric-photo/react/styles.css')

describe('image editor css guards', () => {
  it('keeps the fixed pixel grid overlay transparent to pointer events', () => {
    const css = fs.readFileSync(cssPath, 'utf8')

    expect(css).toMatch(/\.vim-image-editor-page\s+\.vim-editor-pixel-grid\s*\{[^}]*pointer-events:\s*none\s*!important;/)
  })

  it('keeps the pixel grid behind measurements and above the fabric canvas', () => {
    const css = fs.readFileSync(cssPath, 'utf8')

    expect(css).toMatch(/\.vim-image-editor-page\s+\.fp-pixel-grid\s*\{[^}]*z-index:\s*1\b/)
    expect(css).toMatch(/\.vim-image-editor-page\s+\.fp-measure-overlay\s*\{[^}]*z-index:\s*3\b/)
  })

  it('gives active editor toolbar buttons an obvious selected background', () => {
    const css = fs.readFileSync(cssPath, 'utf8')

    expect(css).toMatch(/\.vim-image-editor-page\s+\.vim-editor-toolbar-inner\s+\.ant-btn-primary\s*\{[^}]*background:\s*rgba\(80,\s*120,\s*255,\s*0\.32\)\s*!important;/)
  })

  it('places pixel readout and zoom controls in the responsive title bar', () => {
    const css = fs.readFileSync(cssPath, 'utf8')
    const fabricCss = fs.readFileSync(fabricCssPath, 'utf8')

    expect(css).not.toContain('.vim-editor-file-info')
    expect(fabricCss).toMatch(/\.fp-topbar-title\s*\{[^}]*min-width:\s*0;/)
    expect(fabricCss).toMatch(/\.fp-topbar-pixel\s*\{[^}]*text-overflow:\s*ellipsis;/)
    expect(fabricCss).toMatch(/@media\s*\(max-width:\s*760px\)[\s\S]*?\.fp-topbar-name\s*\{[^}]*max-width:\s*120px;/)
    expect(fabricCss).toMatch(/@media\s*\(max-width:\s*560px\)[\s\S]*?\.fp-topbar-name\s*\{[^}]*display:\s*none;/)
    expect(fabricCss).not.toMatch(/\.fp-topbar-pixel\s*\{[^}]*display:\s*none;/)
    expect(fabricCss).toMatch(/\.fp-zoom-controls\s*\{[^}]*flex:\s*0 0 auto;/)
    expect(fabricCss).not.toMatch(/\.fp-zoom-controls\s*\{[^}]*(?:bottom|position):/)
  })
})
