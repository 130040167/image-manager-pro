import type { CSSProperties, ReactElement } from 'react'
import { App, Image } from 'antd'
import i18n from 'i18next'
import { cloneElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { initReactI18next } from 'react-i18next'
import ImageEditorView from '../../src/webview/image-manager/components/image-editor'
import PixelInspector from '../../src/webview/image-manager/components/pixel-inspector'
import { ManagerHarness } from './manager-harness'
import '../../src/webview/image-manager/styles/index.css'

void i18n.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: {} } }, interpolation: { escapeValue: false } })
const pattern = document.createElement('canvas')
pattern.width = 8
pattern.height = 6
const context = pattern.getContext('2d')!
const pixels = context.createImageData(8, 6)
for (let y = 0; y < 6; y++) {
  for (let x = 0; x < 8; x++) {
    const i = (y * 8 + x) * 4
    pixels.data.set([x * 32, y * 40, (x + y) * 16, 255], i)
  }
}
context.putImageData(pixels, 0, 0)
const src = pattern.toDataURL()
const large = location.search.includes('large')
const largePattern = document.createElement('canvas')
largePattern.width = 3073
largePattern.height = 2049
if (large) {
  const largeContext = largePattern.getContext('2d')!
  const data = largeContext.createImageData(largePattern.width, largePattern.height)
  for (let y = 0; y < largePattern.height; y++) {
    for (let x = 0; x < largePattern.width; x++)
      data.data.set([(x % 8) * 32, (y % 6) * 40, ((x + y) % 16) * 16, 255], (y * largePattern.width + x) * 4)
  }
  largeContext.putImageData(data, 0, 0)
}
const previewSrc = large ? largePattern.toDataURL() : src
const editorPattern = document.createElement('canvas')
const rotation = location.search.includes('rotation')
editorPattern.width = rotation ? 799 : 800
editorPattern.height = rotation ? 426 : 600
const editorContext = editorPattern.getContext('2d')!
editorContext.imageSmoothingEnabled = false
if (rotation) {
  const data = editorContext.createImageData(editorPattern.width, editorPattern.height)
  for (let y = 0; y < editorPattern.height; y++) {
    for (let x = 0; x < editorPattern.width; x++)
      data.data.set([(x % 8) * 32, (y % 6) * 40, ((x + y) % 16) * 16, 255], (y * editorPattern.width + x) * 4)
  }
  editorContext.putImageData(data, 0, 0)
}
else {
  editorContext.drawImage(pattern, 0, 0, editorPattern.width, editorPattern.height)
}
const image = { path: 'C:/quality/standard.png', basename: 'standard.png', vscodePath: new URLSearchParams(location.search).get('source') || editorPattern.toDataURL(), info: { metadata: { width: editorPattern.width, height: editorPattern.height, channels: 3 } } } as ImageType
export function PreviewHarness() {
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1, rotate: 0, flipX: false, flipY: false })
  return (
    <>
      <Image
        src={previewSrc}
        preview={{
          visible: true,
          onTransform: ({ transform }) => setTransform(transform),
          toolbarRender: (_, info) => {
            (window as any).__previewActions = info.actions
            return null
          },
          imageRender: node => large
            ? cloneElement(node as ReactElement<{ style: CSSProperties }>, { style: { ...(node as ReactElement<{ style: CSSProperties }>).props.style, imageRendering: 'pixelated', transition: 'none' } })
            : <img className='ant-image-preview-img' src={src} style={{ width: '257.375px', height: '193.03125px', maxWidth: 'none', maxHeight: 'none', imageRendering: 'pixelated', transform: `translate3d(${transform.x}px,${transform.y}px,0) scale3d(${transform.flipX ? -transform.scale : transform.scale},${transform.flipY ? -transform.scale : transform.scale},1) rotate(${transform.rotate}deg)`, transition: 'none' }} />,
        }}
      />
      <PixelInspector src={previewSrc} transform={transform} visible />
    </>
  )
}
if (location.search.includes('manager')) {
  Object.assign(document.getElementById('root')!.style, { width: '1100px', height: '800px', overflow: 'auto' })
}
createRoot(document.getElementById('root')!).render(<App>{location.search.includes('manager') ? <ManagerHarness src={src} similarity={location.search.includes('similarity')} /> : location.search.includes('preview') ? <PreviewHarness /> : <ImageEditorView image={image} closeEditor={() => { }} />}</App>)
