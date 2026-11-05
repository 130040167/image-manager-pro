import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ColorPalette } from '~/webview/image-manager/components/image-editor/fabric-photo/react/color-palette'
import { hexToRgb, rgbToHex } from '~/webview/image-manager/components/image-editor/fabric-photo/react/color-palette-utils'

describe('color palette selection', () => {
  it('marks the custom color input when the current color is outside the fixed palette', () => {
    const html = renderToStaticMarkup(createElement(ColorPalette, { value: '#123456', onChange: () => undefined }))

    expect(html).toContain('fp-color-custom fp-color-custom-active')
    expect(html).toContain('aria-current="true"')
  })

  it('leaves the custom input unselected when a fixed swatch is current', () => {
    const html = renderToStaticMarkup(createElement(ColorPalette, { value: '#ff0000', onChange: () => undefined }))

    expect(html).not.toContain('fp-color-custom-active')
    expect(html).toContain('aria-pressed="true"')
  })

  it('converts between HEX and RGB without losing channels', () => {
    expect(hexToRgb('#12a0ff')).toEqual([18, 160, 255])
    expect(rgbToHex(18, 160, 255)).toBe('#12a0ff')
  })

  it('shows a rainbow custom swatch until a custom color is selected', () => {
    const html = renderToStaticMarkup(createElement(ColorPalette, { value: '#ff0000', onChange: () => undefined }))

    expect(html).toContain('fp-color-custom-rainbow')
    expect(html).not.toContain('fp-color-custom-rainbow" style=')
    expect(html).toContain('fp-color-custom-separator')
  })
})
