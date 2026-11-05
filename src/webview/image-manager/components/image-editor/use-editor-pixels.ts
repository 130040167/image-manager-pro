import type { RefObject } from 'react'
import type { PanePointEvent } from './canvas-frame'
import type { ImagePlacement } from './editor-utils'
import type { Editor } from './fabric-photo/core'
import type { PixelValueMode } from './histogram-range'
import { useMemoizedFn } from 'ahooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { imagePixelToScreen, screenToImagePixel } from '../pixel-inspector/preview-pixel-grid'
import { getEditorPixelTransform, getRotatedEditorPixelWindow, shouldShowEditorPixelOverlay } from './editor-pixel-grid'
import { formatPixelComparison, hasPixelEdits, readImagePixel } from './editor-pixel-readout'
import { formatPixelValue, getContrastingPixelLabelColor, isImageDataGrayscale } from './histogram-range'

export function useEditorPixels({ editor, rawImageData, sampledImageData, displayImageData, image, placement, mountRef, pixelValueMode }: {
  editor: Editor | null
  rawImageData: ImageData | null
  sampledImageData: ImageData | null
  displayImageData: ImageData | null
  image: ImageType | undefined
  placement: ImagePlacement | null
  mountRef: RefObject<HTMLElement | null>
  pixelValueMode: PixelValueMode
}) {
  const pixelGridCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [pixelReadout, setPixelReadout] = useState<string | undefined>()
  const pointerRef = useRef<{ clientX: number, clientY: number } | null>(null)
  const frameRef = useRef<number | null>(null)
  const originalChannels = useMemo(() => rawImageData && isImageDataGrayscale(rawImageData) ? 1 : 3, [rawImageData])
  const displayChannels = useMemo(() => {
    if (!sampledImageData)
      return image?.info?.metadata?.channels === 1 ? 1 : 3
    return isImageDataGrayscale(sampledImageData) ? 1 : 3
  }, [sampledImageData, image?.info?.metadata?.channels])
  const refreshPixel = useMemoizedFn(() => {
    const event = pointerRef.current
    if (!rawImageData || !placement || !event) {
      setPixelReadout(undefined)
      return
    }
    const transform = getEditorPixelTransform({ ...placement, centerX: placement.screenLeft + placement.width / 2, centerY: placement.screenTop + placement.height / 2, sourceSize: rawImageData })
    const sourcePoint = screenToImagePixel(transform, event.clientX, event.clientY)
    const original = sourcePoint ? readImagePixel(rawImageData, Math.floor(sourcePoint.imgX), Math.floor(sourcePoint.imgY)) : null
    if (!original) {
      setPixelReadout(undefined)
      return
    }
    const composite = editor && hasPixelEdits(editor.state.doc) ? editor.getCompositePixel(original.x, original.y) : null
    setPixelReadout(formatPixelComparison(original, composite ? { ...original, ...composite } : null, originalChannels))
  })

  const schedulePixel = useMemoizedFn(() => {
    if (frameRef.current !== null)
      return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      refreshPixel()
    })
  })
  const updatePixelFromPointer = useMemoizedFn((event: PanePointEvent) => {
    pointerRef.current = { clientX: event.clientX, clientY: event.clientY }
    schedulePixel()
  })
  useEffect(() => {
    schedulePixel()
  }, [rawImageData, displayImageData, placement, schedulePixel])
  useEffect(() => {
    const unsubscribeRender = editor?.subscribeCanvasRender(schedulePixel)
    const unsubscribe = editor?.subscribe(schedulePixel)
    return () => {
      unsubscribeRender?.()
      unsubscribe?.()
      if (frameRef.current !== null)
        cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [editor, schedulePixel])

  useEffect(() => {
    const canvas = pixelGridCanvasRef.current
    const mount = mountRef.current
    if (!canvas || !mount || !sampledImageData || !placement)
      return
    const ctx = canvas.getContext('2d')
    if (!ctx)
      return
    const viewport = mount.getBoundingClientRect()
    const transform = getEditorPixelTransform({ ...placement, centerX: placement.screenLeft - viewport.left + placement.width / 2, centerY: placement.screenTop - viewport.top + placement.height / 2, sourceSize: sampledImageData })
    const visible = getRotatedEditorPixelWindow(transform, viewport.width, viewport.height)
    const cellSize = Math.min(placement.pixelWidth, placement.pixelHeight)
    const pixelCount = visible ? (visible.maxX - visible.minX + 1) * (visible.maxY - visible.minY + 1) : 0
    if (!visible || !shouldShowEditorPixelOverlay({ channels: displayChannels, pixelCount, pixelSize: cellSize })) {
      canvas.style.display = 'none'
      return
    }
    const dpr = window.devicePixelRatio || 1
    const width = Math.max(1, Math.round(viewport.width * dpr))
    const height = Math.max(1, Math.round(viewport.height * dpr))
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }
    canvas.style.display = 'block'
    canvas.style.left = '0px'
    canvas.style.top = '0px'
    canvas.style.width = `${viewport.width}px`
    canvas.style.height = `${viewport.height}px`
    ctx.setTransform(width / viewport.width, 0, 0, height / viewport.height, 0, 0)
    ctx.clearRect(0, 0, viewport.width, viewport.height)
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = visible.minX; x <= visible.maxX + 1; x++) {
      const a = imagePixelToScreen(transform, x, visible.minY)
      const b = imagePixelToScreen(transform, x, visible.maxY + 1)
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
    }
    for (let y = visible.minY; y <= visible.maxY + 1; y++) {
      const a = imagePixelToScreen(transform, visible.minX, y)
      const b = imagePixelToScreen(transform, visible.maxX + 1, y)
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
    }
    ctx.stroke()
    const fontSize = Math.max(7, Math.min(14, cellSize * (displayChannels === 1 ? 0.34 : 0.22)))
    ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, Consolas, monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (let y = visible.minY; y <= visible.maxY; y++) {
      for (let x = visible.minX; x <= visible.maxX; x++) {
        const index = (y * sampledImageData.width + x) * 4
        const r = sampledImageData.data[index]
        const g = sampledImageData.data[index + 1]
        const b = sampledImageData.data[index + 2]
        const center = imagePixelToScreen(transform, x + 0.5, y + 0.5)
        if (center.x < -cellSize || center.y < -cellSize || center.x > viewport.width + cellSize || center.y > viewport.height + cellSize)
          continue
        const cx = center.x
        const cy = center.y
        const corners = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]].map(([px, py]) => imagePixelToScreen(transform, px, py))
        ctx.save()
        ctx.beginPath()
        ctx.moveTo(corners[0].x, corners[0].y)
        for (const corner of corners.slice(1))
          ctx.lineTo(corner.x, corner.y)
        ctx.closePath()
        ctx.clip()
        ctx.fillStyle = getContrastingPixelLabelColor({ b: displayImageData?.data[index + 2] ?? b, g: displayImageData?.data[index + 1] ?? g, r: displayImageData?.data[index] ?? r })
        const text = formatPixelValue({ b, g, r }, displayChannels, undefined, pixelValueMode)
        if (displayChannels === 1 || (r === g && g === b)) {
          ctx.fillText(formatPixelValue({ b, g, r }, 1, undefined, pixelValueMode), cx, cy)
        }
        else {
          const gap = Math.min(fontSize + 1, (cellSize - 4) / 3)
          const [red, green, blue] = text.split(' ')
          ctx.fillText(red, cx, cy - gap)
          ctx.fillText(green, cx, cy)
          ctx.fillText(blue, cx, cy + gap)
        }
        ctx.restore()
      }
    }
  }, [displayChannels, displayImageData, sampledImageData, pixelValueMode, placement])

  return { pixelReadout, pixelGridCanvasRef, updatePixelFromPointer }
}
