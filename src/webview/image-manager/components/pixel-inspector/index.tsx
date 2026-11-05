import type { PixelValueMode } from '../image-editor/histogram-range'
import type { PixelTransform } from './preview-pixel-grid'
import { useMemoizedFn, useRafState } from 'ahooks'
import { memo, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { DEFAULT_PIXEL_VALUE_MODE, formatPixelValue, getContrastingPixelLabelColor } from '../image-editor/histogram-range'
import { observePreviewLayout } from './preview-layout-observer'
import { getDisplayedPixelSize, imagePixelToScreen, readPreviewPixelTransform, screenToImagePixel } from './preview-pixel-grid'
import { drawPreviewPixelTile } from './preview-pixel-renderer'

type Transform = {
  x: number
  y: number
  scale: number
  rotate: number
  flipX: boolean
  flipY: boolean
}

type PixelValue = {
  r: number
  g: number
  b: number
  a: number
  x: number
  y: number
}

type Props = {
  src: string | undefined
  transform: Transform
  visible: boolean
  valueRange?: [number, number]
  pixelValueMode?: PixelValueMode
  onImageLoaded?: (info: { width: number, height: number, channels: number }) => void
}

const GRAYSCALE_VALUE_MIN_PIXEL_SIZE = 14
const RGB_VALUE_MIN_PIXEL_SIZE = 22
const MAX_VALUE_LABEL_PIXELS = 96 * 96

function sameTransform(a: PixelTransform | null, b: PixelTransform | null) {
  if (!a || !b)
    return a === b
  return (Object.keys(a) as (keyof PixelTransform)[]).every(key => Math.abs(a[key] - b[key]) < 0.0001)
}

function clampInt(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(v)))
}

function PixelInspector({ src, transform, visible, valueRange, pixelValueMode = DEFAULT_PIXEL_VALUE_MODE, onImageLoaded }: Props) {
  const imgDataRef = useRef<{ width: number, height: number, data: Uint8ClampedArray, channels: number } | null>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const pixelCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const pixelTileRef = useRef<HTMLCanvasElement | null>(null)
  const previewImageRef = useRef<HTMLImageElement | null>(null)
  const [pixelInfo, setPixelInfo] = useRafState<PixelValue | null>(null)
  const [imgChannels, setImgChannels] = useState(3)
  const [imgDataVersion, setImgDataVersion] = useState(0)
  const [imageLayout, setImageLayout] = useState<PixelTransform | null>(null)
  const imageLayoutRef = useRef<PixelTransform | null>(null)
  const requestLayoutRef = useRef<(() => void) | null>(null)
  imageLayoutRef.current = imageLayout

  useEffect(() => {
    if (!src || !visible) {
      imgDataRef.current = null
      setImgDataVersion(v => v + 1)
      return
    }
    let cancelled = false
    imgDataRef.current = null
    setImgDataVersion(v => v + 1)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (cancelled)
        return
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx)
        return
      ctx.drawImage(img, 0, 0)
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)

      let isGrayscale = true
      const sampleStep = Math.max(1, Math.floor(imageData.data.length / 4 / 4096))
      for (let i = 0; i < imageData.data.length; i += sampleStep * 4) {
        if (
          imageData.data[i] !== imageData.data[i + 1]
          || imageData.data[i + 1] !== imageData.data[i + 2]
        ) {
          isGrayscale = false
          break
        }
      }
      const channels = isGrayscale ? 1 : 3
      imgDataRef.current = {
        width: canvas.width,
        height: canvas.height,
        data: imageData.data,
        channels,
      }
      setImgChannels(channels)
      setImgDataVersion(v => v + 1)
      onImageLoaded?.({ width: canvas.width, height: canvas.height, channels })
    }
    img.src = src
    return () => {
      cancelled = true
    }
  }, [src, visible, onImageLoaded])

  useEffect(() => {
    if (!visible) {
      setImageLayout(null)
      return
    }
    const observer = observePreviewLayout((previewImg) => {
      previewImageRef.current = previewImg
      const data = imgDataRef.current
      const next = previewImg && data ? readPreviewPixelTransform(previewImg, data.width, data.height) : null
      if (!sameTransform(imageLayoutRef.current, next)) {
        imageLayoutRef.current = next
        setImageLayout(next)
      }
    })
    requestLayoutRef.current = observer.request
    return () => {
      requestLayoutRef.current = null
      observer.dispose()
    }
  }, [visible])

  useEffect(() => {
    requestLayoutRef.current?.()
  }, [transform, imgDataVersion])

  const getPixelAt = useMemoizedFn((imgX: number, imgY: number): PixelValue | null => {
    const imgData = imgDataRef.current
    if (!imgData)
      return null
    const x = Math.floor(imgX)
    const y = Math.floor(imgY)
    if (x < 0 || x >= imgData.width || y < 0 || y >= imgData.height)
      return null
    const idx = (y * imgData.width + x) * 4
    return {
      r: imgData.data[idx],
      g: imgData.data[idx + 1],
      b: imgData.data[idx + 2],
      a: imgData.data[idx + 3],
      x,
      y,
    }
  })

  const screenToImageCoords = useMemoizedFn((clientX: number, clientY: number): { imgX: number, imgY: number } | null => {
    const layout = imageLayoutRef.current
    if (!layout || !imgDataRef.current)
      return null

    return screenToImagePixel(layout, clientX, clientY)
  })

  const handleMouseMove = useMemoizedFn((e: MouseEvent) => {
    const coords = screenToImageCoords(e.clientX, e.clientY)
    if (!coords) {
      setPixelInfo(null)
      return
    }
    setPixelInfo(getPixelAt(coords.imgX, coords.imgY))
  })

  const handleMouseLeave = useMemoizedFn(() => {
    setPixelInfo(null)
  })

  useEffect(() => {
    if (!visible)
      return
    const dialogRoot = document.querySelector('.ant-image-preview-root, .rc-image-preview-root')
    const target = (dialogRoot || document.body) as HTMLElement
    target.addEventListener('mousemove', handleMouseMove)
    target.addEventListener('mouseleave', handleMouseLeave)
    return () => {
      target.removeEventListener('mousemove', handleMouseMove)
      target.removeEventListener('mouseleave', handleMouseLeave)
    }
  }, [handleMouseLeave, handleMouseMove, visible])

  useEffect(() => {
    const canvas = overlayCanvasRef.current
    const pixelCanvas = pixelCanvasRef.current
    const imgData = imgDataRef.current
    const layout = imageLayout
    pixelCanvas?.getContext('2d')?.clearRect(0, 0, pixelCanvas.width, pixelCanvas.height)
    if (!canvas || !pixelCanvas || !visible || !imgData || !layout) {
      if (canvas) {
        const ctx = canvas.getContext('2d')
        ctx?.clearRect(0, 0, canvas.width, canvas.height)
      }
      return
    }

    const pixelSizeOnScreen = getDisplayedPixelSize(layout)
    const minValuePixelSize = imgData.channels === 1 ? GRAYSCALE_VALUE_MIN_PIXEL_SIZE : RGB_VALUE_MIN_PIXEL_SIZE
    if (pixelSizeOnScreen < minValuePixelSize) {
      const ctx = canvas.getContext('2d')
      ctx?.clearRect(0, 0, canvas.width, canvas.height)
      return
    }

    const dpr = window.devicePixelRatio || 1
    const viewportW = Math.max(1, window.innerWidth)
    const viewportH = Math.max(1, window.innerHeight)
    const canvasWidth = Math.max(1, Math.round(viewportW * dpr))
    const canvasHeight = Math.max(1, Math.round(viewportH * dpr))
    if (canvas.width !== canvasWidth || canvas.height !== canvasHeight) {
      canvas.width = canvasWidth
      canvas.height = canvasHeight
    }
    const ctx = canvas.getContext('2d')
    if (!ctx)
      return
    ctx.setTransform(canvas.width / viewportW, 0, 0, canvas.height / viewportH, 0, 0)
    ctx.clearRect(0, 0, viewportW, viewportH)

    const visibleScreenLeft = 0
    const visibleScreenTop = 0
    const visibleScreenRight = viewportW
    const visibleScreenBottom = viewportH
    if (visibleScreenLeft >= visibleScreenRight || visibleScreenTop >= visibleScreenBottom)
      return

    const corners = [
      screenToImageCoords(visibleScreenLeft, visibleScreenTop),
      screenToImageCoords(visibleScreenRight, visibleScreenTop),
      screenToImageCoords(visibleScreenLeft, visibleScreenBottom),
      screenToImageCoords(visibleScreenRight, visibleScreenBottom),
    ].filter(Boolean) as { imgX: number, imgY: number }[]
    if (!corners.length)
      return

    const minImgX = Math.max(0, Math.floor(Math.min(...corners.map(c => c.imgX))))
    const minImgY = Math.max(0, Math.floor(Math.min(...corners.map(c => c.imgY))))
    const maxImgX = Math.min(imgData.width - 1, Math.ceil(Math.max(...corners.map(c => c.imgX))) - 1)
    const maxImgY = Math.min(imgData.height - 1, Math.ceil(Math.max(...corners.map(c => c.imgY))) - 1)
    const pixelCount = (maxImgX - minImgX + 1) * (maxImgY - minImgY + 1)
    if (pixelCount > MAX_VALUE_LABEL_PIXELS || pixelCount <= 0)
      return

    if (pixelCanvas.width !== canvasWidth || pixelCanvas.height !== canvasHeight) {
      pixelCanvas.width = canvasWidth
      pixelCanvas.height = canvasHeight
    }
    const pixelContext = pixelCanvas.getContext('2d')!
    pixelContext.setTransform(canvasWidth / viewportW, 0, 0, canvasHeight / viewportH, 0, 0)
    pixelTileRef.current ??= document.createElement('canvas')
    drawPreviewPixelTile(pixelContext, pixelTileRef.current, imgData, layout, {
      left: minImgX,
      top: minImgY,
      right: maxImgX + 1,
      bottom: maxImgY + 1,
    }, valueRange)
    // Keep the native image in place for rc-image dragging/zooming, but avoid compositing
    // its independently rounded raster below transparent pixels in the exact viewport tile.
    const previewImage = previewImageRef.current
    const previousOpacity = previewImage?.style.opacity ?? ''
    if (previewImage)
      previewImage.style.opacity = '0'

    const cellPoint = (px: number, py: number) => imagePixelToScreen(layout, px, py)
    const cellScreenSize = pixelSizeOnScreen
    const showValues = cellScreenSize >= minValuePixelSize && pixelCount <= MAX_VALUE_LABEL_PIXELS
    ctx.strokeStyle = 'rgba(255,255,255,0.32)'
    ctx.lineWidth = 1
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `${Math.max(9, Math.min(14, cellScreenSize * 0.34))}px monospace`

    ctx.beginPath()
    for (let px = minImgX; px <= maxImgX + 1; px++) {
      const from = cellPoint(px, minImgY)
      const to = cellPoint(px, maxImgY + 1)
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(to.x, to.y)
    }
    for (let py = minImgY; py <= maxImgY + 1; py++) {
      const from = cellPoint(minImgX, py)
      const to = cellPoint(maxImgX + 1, py)
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(to.x, to.y)
    }
    ctx.stroke()

    for (let py = minImgY; py <= maxImgY; py++) {
      for (let px = minImgX; px <= maxImgX; px++) {
        const idx = (py * imgData.width + px) * 4
        const r = imgData.data[idx]
        const g = imgData.data[idx + 1]
        const b = imgData.data[idx + 2]

        if (!showValues)
          continue

        const center = cellPoint(px + 0.5, py + 0.5)
        if (!center)
          continue
        ctx.fillStyle = getContrastingPixelLabelColor({ b, g, r }, valueRange)
        const fontSize = clampInt(cellScreenSize * (imgData.channels === 1 ? 0.34 : 0.22), 9, 14)
        ctx.font = `${fontSize}px monospace`

        if (imgData.channels === 1 || (r === g && g === b)) {
          ctx.fillText(formatPixelValue({ b, g, r }, 1, valueRange, pixelValueMode), center.x, center.y)
        }
        else {
          const lineGap = Math.min(fontSize + 1, cellScreenSize / 3)
          const [displayR, displayG, displayB] = formatPixelValue({ b, g, r }, imgData.channels, valueRange, pixelValueMode).split(' ')
          ctx.fillText(displayR, center.x, center.y - lineGap)
          ctx.fillText(displayG, center.x, center.y)
          ctx.fillText(displayB, center.x, center.y + lineGap)
        }
      }
    }
    return () => {
      if (previewImage)
        previewImage.style.opacity = previousOpacity
      pixelContext.clearRect(0, 0, viewportW, viewportH)
    }
  }, [imageLayout, imgDataVersion, pixelValueMode, screenToImageCoords, transform, valueRange, visible])

  const displayedValue = (() => {
    if (!pixelInfo)
      return null
    return formatPixelValue(pixelInfo, imgChannels, valueRange, pixelValueMode)
  })()

  if (!visible)
    return null

  const content = (
    <>
      <canvas
        ref={pixelCanvasRef}
        data-preview-pixel-image
        className='pointer-events-none fixed inset-0 z-20'
        style={{ width: '100vw', height: '100vh' }}
      />
      <canvas
        ref={overlayCanvasRef}
        data-preview-pixel-grid
        className='pointer-events-none fixed inset-0 z-20'
        style={{
          width: '100vw',
          height: '100vh',
          willChange: 'contents',
        }}
      />
      {pixelInfo && (
        <div className='fixed bottom-2 left-4 z-[21] rounded bg-[rgba(98,98,98,0.72)] px-3 py-1.5 font-mono text-sm text-white shadow-lg backdrop-blur-sm'>
          <div className='flex items-center gap-3'>
            <span>
              (
              {pixelInfo.x}
              ,
              {' '}
              {pixelInfo.y}
              )
            </span>
            <span>
              {displayedValue}
              {pixelInfo.a < 255 && ` A:${pixelInfo.a}`}
            </span>
          </div>
        </div>
      )}
    </>
  )

  const portalTarget = document.querySelector('.ant-image-preview-wrap, .rc-image-preview-wrap')
  return portalTarget ? createPortal(content, portalTarget) : content
}

export default memo(PixelInspector)
