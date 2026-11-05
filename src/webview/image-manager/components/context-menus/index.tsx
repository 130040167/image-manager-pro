import { memo } from 'react'
import { createPortal } from 'react-dom'
import { vscodeApi } from '~/webview/vscode-api'
import CollapseContextMenu from './components/collapse-context-menu'
import ImageContextMenu from './components/image-context-menu'
import 'react-contexify/ReactContexify.css'
import './index.css'

function warmModalChunks() {
  if (typeof window === 'undefined') {
    return
  }

  const warm = () => {
    const imports = [
      ['editor', () => import('~/webview/image-manager/components/image-editor')],
      ['compressor', () => import('~/webview/image-manager/hooks/use-image-compressor/image-compressor')],
      ['converter', () => import('~/webview/image-manager/hooks/use-image-converter/image-converter')],
      ['similarity', () => import('~/webview/image-manager/hooks/use-image-similarity/image-similarity')],
      ['rename-images', () => import('~/webview/image-manager/hooks/use-rename-images/rename-images')],
    ] as const

    imports.forEach(([name, load]) => {
      const start = performance.now()
      vscodeApi.log('debug', '[modal] warm start', { name })
      void load()
        .then(() => {
          vscodeApi.log('debug', '[modal] warm done', {
            costMs: Math.round(performance.now() - start),
            name,
          })
        })
        .catch((err) => {
          vscodeApi.log('warn', '[modal] warm failed', {
            error: err instanceof Error ? err.message : String(err),
            name,
          })
        })
    })
  }

  if ('requestIdleCallback' in window && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(warm, { timeout: 1500 })
    return
  }
  window.setTimeout(warm, 800)
}

warmModalChunks()

function ContextMenus() {
  // Portal 到 body：图片预览（antd Image）也用 body Portal 渲染，
  // 如果 ContextMenus 在主 React 树内（带 transform/overflow 的 stacking context 里），
  // menu 节点会被预览 root 盖住而不可见。挂到 body 后两者平级，z-index 9999 才生效。
  return createPortal(
    <>
      <ImageContextMenu />
      <CollapseContextMenu />
    </>,
    document.body,
  )
}

export default memo(ContextMenus)
