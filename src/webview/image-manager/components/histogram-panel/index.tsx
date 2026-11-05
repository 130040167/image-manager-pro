import type { PixelValueMode } from '../image-editor/histogram-range'
import { useMemoizedFn } from 'ahooks'
import { Button, InputNumber } from 'antd'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IoMdClose } from 'react-icons/io'
import { CmdToVscode } from '~/message/cmd'
import { vscodeApi } from '~/webview/vscode-api'
import { histogramFromPixels } from './histogram-pixels'

type Props = {
  src: string | undefined
  imagePath?: string
  imageData?: ImageData | null
  visible: boolean
  range: [number, number]
  onChange: (range: [number, number], options?: { record?: boolean, mergeKey?: string }) => void
  onClose: () => void
  pixelValueMode?: PixelValueMode
  onPixelValueModeChange?: (mode: PixelValueMode) => void
}

const PANEL_WIDTH = 280
const PANEL_HEIGHT = 160
const HIST_BINS = 256

type HistogramState = { r: number[], g: number[], b: number[], lum: number[], channels: number, domain: [number, number] }

function toHistogramState(data: ImageHistogram): HistogramState {
  if (data.channels === 1) {
    return { r: [], g: [], b: [], lum: data.bins[0] || [], channels: 1, domain: data.domain }
  }
  return {
    r: data.bins[0] || [],
    g: data.bins[1] || [],
    b: data.bins[2] || [],
    lum: data.bins[3] || [],
    channels: 3,
    domain: data.domain,
  }
}

function formatDomainValue(value: number) {
  if (!Number.isFinite(value))
    return '0'
  const abs = Math.abs(value)
  if (abs > 0 && abs < 0.01)
    return value.toExponential(2)
  if (abs <= 1)
    return Number(value.toFixed(4)).toString()
  if (abs < 100)
    return Number(value.toFixed(2)).toString()
  return Math.round(value).toString()
}

function positionToDomain(position: number, domain: [number, number]) {
  return domain[0] + (position / 255) * (domain[1] - domain[0])
}

function domainToPosition(value: number, domain: [number, number]) {
  const width = domain[1] - domain[0]
  if (!Number.isFinite(value) || !Number.isFinite(width) || width === 0)
    return 0
  return Math.max(0, Math.min(255, Math.round(((value - domain[0]) / width) * 255)))
}

function emptyBins() {
  return Array.from<number>({ length: HIST_BINS }).fill(0)
}

function HistogramPanel({ src, imagePath, imageData, visible, range, onChange, onClose, pixelValueMode = 'raw', onPixelValueModeChange }: Props) {
  const rangeGestureRef = useRef<string>()
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ startLeft: number, startTop: number, startX: number, startY: number } | null>(null)
  const [hist, setHist] = useState<HistogramState | null>(null)
  const [dragging, setDragging] = useState<'min' | 'max' | null>(null)
  const [position, setPosition] = useState<{ left: number, top: number } | null>(null)
  const rangeRef = useRef(range)
  rangeRef.current = range
  const adjustedRangeKey = !imageData && pixelValueMode === 'adjusted' ? range.join(',') : ''

  useEffect(() => {
    if (!visible)
      return
    if (imageData) {
      setHist(histogramFromPixels(imageData.data))
      return
    }
    let cancelled = false
    let fallbackTimer: number | undefined
    setHist(null)

    const loadCanvasHistogram = () => {
      if (!src) {
        setHist({ r: [], g: [], b: [], lum: emptyBins(), channels: 1, domain: [0, 255] })
        return
      }
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        if (cancelled)
          return
        const W = Math.min(img.naturalWidth, 512)
        const H = Math.min(img.naturalHeight, 512)
        const sx = W / img.naturalWidth
        const sy = H / img.naturalHeight
        const scale = Math.min(sx, sy)
        const cw = Math.max(1, Math.floor(img.naturalWidth * scale))
        const ch = Math.max(1, Math.floor(img.naturalHeight * scale))

        const c = document.createElement('canvas')
        c.width = cw
        c.height = ch
        const ctx = c.getContext('2d', { willReadFrequently: true })
        if (!ctx)
          return
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(img, 0, 0, cw, ch)
        const data = ctx.getImageData(0, 0, cw, ch).data

        setHist(histogramFromPixels(data, pixelValueMode === 'adjusted' ? rangeRef.current : undefined))
      }
      img.onerror = () => {
        if (!cancelled)
          setHist({ r: [], g: [], b: [], lum: emptyBins(), channels: 1, domain: [0, 255] })
      }
      img.src = src
    }

    if (!imagePath || pixelValueMode === 'adjusted') {
      loadCanvasHistogram()
    }
    else {
      vscodeApi.postMessage({ cmd: CmdToVscode.get_image_histogram, data: { filePath: imagePath } }, (data) => {
        if (cancelled)
          return
        if (fallbackTimer) {
          window.clearTimeout(fallbackTimer)
          fallbackTimer = undefined
        }
        if (data?.bins?.length && Array.isArray(data.domain)) {
          setHist(toHistogramState(data))
          return
        }
        loadCanvasHistogram()
      })
      fallbackTimer = window.setTimeout(() => {
        if (!cancelled)
          loadCanvasHistogram()
      }, 1500)
    }

    return () => {
      cancelled = true
      if (fallbackTimer)
        window.clearTimeout(fallbackTimer)
    }
  }, [src, imagePath, imageData, visible, pixelValueMode, adjustedRangeKey])

  const displayMaxBin = useMemo(() => {
    if (!hist)
      return 1
    const arr = hist.channels === 1 ? hist.lum : [...hist.r, ...hist.g, ...hist.b]
    const positive = arr.filter(v => v > 0).sort((a, b) => a - b)
    if (!positive.length)
      return 1
    const max = positive[positive.length - 1]
    const p98 = positive[Math.floor((positive.length - 1) * 0.98)]
    const p995 = positive[Math.floor((positive.length - 1) * 0.995)]
    const capped = Math.max(p98 * 1.2, p995, max * 0.08)
    return Math.max(1, Math.min(max, capped))
  }, [hist])

  const drawCanvas = useMemoizedFn(() => {
    const canvas = canvasRef.current
    if (!canvas || !hist)
      return
    const ctx = canvas.getContext('2d')
    if (!ctx)
      return
    const W = canvas.width
    const H = canvas.height
    ctx.clearRect(0, 0, W, H)

    const drawHist = (data: number[], color: string, blend: GlobalCompositeOperation) => {
      ctx.globalCompositeOperation = blend
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.moveTo(0, H)
      for (let i = 0; i < HIST_BINS; i++) {
        const x = (i / (HIST_BINS - 1)) * W
        const h = Math.min(1, (data[i] || 0) / displayMaxBin) * H
        ctx.lineTo(x, H - h)
      }
      ctx.lineTo(W, H)
      ctx.closePath()
      ctx.fill()
    }

    if (hist.channels === 1) {
      drawHist(hist.lum, 'rgba(180,180,180,0.85)', 'source-over')
    }
    else {
      drawHist(hist.r, 'rgba(255,80,80,0.65)', 'source-over')
      drawHist(hist.g, 'rgba(80,200,80,0.65)', 'lighten')
      drawHist(hist.b, 'rgba(80,140,255,0.65)', 'lighten')
    }
    ctx.globalCompositeOperation = 'source-over'

    const minX = (range[0] / 255) * W
    const maxX = (range[1] / 255) * W
    ctx.fillStyle = 'rgba(0,0,0,0.4)'
    ctx.fillRect(0, 0, minX, H)
    ctx.fillRect(maxX, 0, W - maxX, H)

    ctx.strokeStyle = '#1677ff'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(minX, 0)
    ctx.lineTo(minX, H)
    ctx.moveTo(maxX, 0)
    ctx.lineTo(maxX, H)
    ctx.stroke()
  })

  useEffect(() => {
    drawCanvas()
  }, [hist, range, drawCanvas])

  const onMouseDown = useMemoizedFn((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas)
      return
    e.preventDefault()
    e.stopPropagation()
    const rect = canvas.getBoundingClientRect()
    const x = Math.max(0, Math.min(255, Math.round(((e.clientX - rect.left) / rect.width) * 255)))
    const currentRange = rangeRef.current
    const dMin = Math.abs(x - currentRange[0])
    const dMax = Math.abs(x - currentRange[1])
    setDragging(dMin < dMax ? 'min' : 'max')
    rangeGestureRef.current = `range-${crypto.randomUUID()}`
    if (dMin < dMax) {
      onChange([Math.min(x, currentRange[1]), currentRange[1]], { mergeKey: rangeGestureRef.current })
    }
    else {
      onChange([currentRange[0], Math.max(x, currentRange[0])], { mergeKey: rangeGestureRef.current })
    }
  })

  useEffect(() => {
    if (!dragging)
      return
    const onMove = (e: MouseEvent) => {
      const canvas = canvasRef.current
      if (!canvas)
        return
      const rect = canvas.getBoundingClientRect()
      const x = Math.max(0, Math.min(255, Math.round(((e.clientX - rect.left) / rect.width) * 255)))
      const currentRange = rangeRef.current
      if (dragging === 'min') {
        onChange([Math.min(x, currentRange[1]), currentRange[1]], { record: false, mergeKey: rangeGestureRef.current })
      }
      else {
        onChange([currentRange[0], Math.max(x, currentRange[0])], { record: false, mergeKey: rangeGestureRef.current })
      }
    }
    const onUp = () => setDragging(null)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging, range, onChange])

  const isBinarized = range[0] === range[1]
  const domainValue = useMemoizedFn((position: number) => {
    const domain = hist?.domain || [0, 255]
    return positionToDomain(position, domain)
  })
  const applyDomainMin = useMemoizedFn((value: number | null) => {
    if (value === null)
      return
    const domain = hist?.domain || [0, 255]
    const next = domainToPosition(value, domain)
    onChange([Math.min(next, rangeRef.current[1]), rangeRef.current[1]])
  })
  const applyDomainMax = useMemoizedFn((value: number | null) => {
    if (value === null)
      return
    const domain = hist?.domain || [0, 255]
    const next = domainToPosition(value, domain)
    onChange([rangeRef.current[0], Math.max(next, rangeRef.current[0])])
  })

  const totalWidth = PANEL_WIDTH + 24

  const beginPanelDrag = useMemoizedFn((e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target
    if (target instanceof HTMLElement && target.closest('button, input, canvas, [role="button"]'))
      return
    e.preventDefault()
    e.stopPropagation()
    const rect = panelRef.current?.getBoundingClientRect()
    const startLeft = position?.left ?? rect?.left ?? (window.innerWidth - totalWidth - 16)
    const startTop = position?.top ?? rect?.top ?? (window.innerHeight - PANEL_HEIGHT - 160)
    dragRef.current = { startLeft, startTop, startX: e.clientX, startY: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
  })

  const movePanelDrag = useMemoizedFn((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag)
      return
    e.preventDefault()
    const panelHeight = panelRef.current?.offsetHeight ?? (PANEL_HEIGHT + 120)
    const nextLeft = Math.max(8, Math.min(window.innerWidth - totalWidth - 8, drag.startLeft + e.clientX - drag.startX))
    const nextTop = Math.max(8, Math.min(window.innerHeight - panelHeight - 8, drag.startTop + e.clientY - drag.startY))
    setPosition({ left: nextLeft, top: nextTop })
  })

  const endPanelDrag = useMemoizedFn((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current)
      return
    dragRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    catch {}
  })

  if (!visible)
    return null

  return (
    <div
      ref={panelRef}
      data-editor-histogram-panel
      className='fixed z-[10040] cursor-grab touch-none rounded-lg border border-white/10 bg-black/85 p-3 shadow-xl backdrop-blur-md active:cursor-grabbing'
      style={position
        ? { width: totalWidth, left: position.left, top: position.top }
        : { width: totalWidth, right: 16, bottom: 80 }}
      onPointerDown={beginPanelDrag}
      onPointerMove={movePanelDrag}
      onPointerUp={endPanelDrag}
      onPointerCancel={endPanelDrag}
      onMouseDown={(e) => {
        e.stopPropagation()
      }}
      onWheel={(e) => {
        e.stopPropagation()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <div className='mb-2 flex items-center justify-between text-white'>
        <span className='text-xs font-medium'>
          {t('im.histogram_range')}
          {isBinarized && <span className='ml-2 text-[#1677ff]'>{t('im.binarized')}</span>}
        </span>
        <Button
          type='text'
          size='small'
          icon={<IoMdClose className='text-white' />}
          onClick={onClose}
        />
      </div>
      <canvas
        ref={canvasRef}
        width={PANEL_WIDTH}
        height={PANEL_HEIGHT}
        className='cursor-ew-resize select-none'
        style={{ display: 'block', background: 'rgba(255,255,255,0.05)', borderRadius: 4 }}
        onMouseDown={onMouseDown}
      />
      <div className='mt-1 flex items-center justify-between text-[10px] text-white/45'>
        <span>{formatDomainValue(hist?.domain[0] ?? 0)}</span>
        <span>{formatDomainValue(hist?.domain[1] ?? 255)}</span>
      </div>
      <div className='mt-2 flex items-center justify-between gap-2 text-xs text-white/80'>
        <label className='flex min-w-0 items-center gap-1'>
          <span>
            {t('im.min')}
            :
          </span>
          <InputNumber
            size='small'
            value={Number(formatDomainValue(domainValue(range[0])))}
            min={hist?.domain[0] ?? 0}
            max={domainValue(range[1])}
            controls={false}
            className='w-20'
            onChange={applyDomainMin}
          />
        </label>
        <Button
          size='small'
          type='text'
          className='!h-6 !text-xs !text-white/70'
          onClick={() => onChange([0, 255])}
        >
          {t('im.reset')}
        </Button>
        <label className='flex min-w-0 items-center gap-1'>
          <span>
            {t('im.max')}
            :
          </span>
          <InputNumber
            size='small'
            value={Number(formatDomainValue(domainValue(range[1])))}
            min={domainValue(range[0])}
            max={hist?.domain[1] ?? 255}
            controls={false}
            className='w-20'
            onChange={applyDomainMax}
          />
        </label>
      </div>
      <div className='mt-2 flex items-center justify-between gap-2 text-xs text-white/70'>
        <span>{t('im.pixel_values')}</span>
        <Button.Group size='small'>
          <Button
            type={pixelValueMode === 'raw' ? 'primary' : 'default'}
            className='!h-6 !px-2 !text-xs'
            onClick={() => onPixelValueModeChange?.('raw')}
          >
            {t('im.pixel_values_raw')}
          </Button>
          <Button
            type={pixelValueMode === 'adjusted' ? 'primary' : 'default'}
            className='!h-6 !px-2 !text-xs'
            onClick={() => onPixelValueModeChange?.('adjusted')}
          >
            {t('im.pixel_values_adjusted')}
          </Button>
        </Button.Group>
      </div>
    </div>
  )
}

export default memo(HistogramPanel)
