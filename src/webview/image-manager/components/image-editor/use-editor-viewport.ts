import type { PanePointEvent } from './canvas-frame'
import type { ImagePlacement } from './editor-utils'
import type { Editor } from './fabric-photo/core'
import { useMemoizedFn } from 'ahooks'
import { useEffect, useRef, useState } from 'react'
import { getImagePlacement, pointerToImagePoint } from './editor-utils'

export function useEditorViewport(editor: Editor | null) {
  const mountRef = useRef<HTMLElement | null>(null)
  const [placement, setPlacement] = useState<ImagePlacement | null>(null)
  const [canvasMax, setCanvasMax] = useState({ height: 900, width: 1200 })
  const syncPlacement = useMemoizedFn(() => {
    const mount = mountRef.current
    if (!editor || !mount) {
      setPlacement(null)
      return
    }
    const next = getImagePlacement(editor, mount)
    if (!next) {
      setPlacement(null)
      return
    }
    setPlacement(current => current && (Object.keys(next) as (keyof ImagePlacement)[]).every(key => current[key] === next[key]) ? current : next)
  })

  useEffect(() => {
    const root = document.querySelector('.fp-editor')
    const mount = root?.querySelector<HTMLElement>('.fp-canvas-mount') ?? null
    mountRef.current = mount
    if (!mount)
      return
    const syncCanvasSize = () => {
      const rect = mount.getBoundingClientRect()
      const width = Math.max(1, Math.floor(rect.width))
      const height = Math.max(1, Math.floor(rect.height))
      setCanvasMax(current => current.width === width && current.height === height ? current : { height, width })
      syncPlacement()
    }
    const observer = new ResizeObserver(syncCanvasSize)
    observer.observe(mount)
    window.addEventListener('resize', syncCanvasSize)
    syncCanvasSize()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', syncCanvasSize)
    }
  }, [editor, syncPlacement])

  const collectPoint = useMemoizedFn((event: PanePointEvent, clamp = false) => {
    if (!placement)
      return null
    return pointerToImagePoint(event, placement, { width: placement.documentWidth, height: placement.documentHeight }, clamp)
  })

  useEffect(() => editor?.subscribe(syncPlacement), [editor, syncPlacement])
  return { mountRef, placement, canvasMax, collectPoint, syncPlacement }
}
