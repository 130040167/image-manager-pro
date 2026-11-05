import type { CanvasSize, PanePointEvent } from './canvas-frame'
import type { Editor, PathObject } from './fabric-photo/core'
import type { PixelValueMode } from './histogram-range'
import type { Point } from './measurement'
import { CmdToVscode } from '~/message/cmd'
import { vscodeApi } from '~/webview/vscode-api'
import { DEFAULT_PIXEL_VALUE_MODE, formatPixelValue } from './histogram-range'

export type Tool = 'crop' | 'measure' | 'select'
export type MeasureTool = 'angle' | 'ellipse' | 'line' | 'polygon'

export type MeasurementObject = {
  arc?: PathObject['measurementArc']
  color: string
  dash: number[]
  id: string
  kind: MeasureTool
  name: string
  points: Point[]
  visible: boolean
  width: number
}

export type MeasurementStyle = {
  activeNodeRadius: number
  color: string
  dash: number[]
  lineOpacity: number
  nodeOpacity: number
  nodeRadius: number
  width: number
}

export type PixelValue = Point & {
  a: number
  b: number
  g: number
  r: number
}

export type ImagePlacement = {
  angle: number
  documentWidth: number
  documentHeight: number
  height: number
  left: number
  pixelHeight: number
  pixelWidth: number
  screenLeft: number
  screenTop: number
  top: number
  width: number
}

export const EDITOR_SOURCE_TIMEOUT_MS = 12_000
export const EDITOR_IMAGE_LOAD_TIMEOUT_MS = 12_000
export const EDITOR_LOG_PREFIX = '[image-editor]'
export const DEFAULT_MEASUREMENT_STYLE: MeasurementStyle = {
  activeNodeRadius: 5.5,
  color: '#0d99ff',
  dash: [],
  lineOpacity: 0.92,
  nodeOpacity: 1,
  nodeRadius: 4,
  width: 1,
}

export type Props = {
  defaultTool?: Extract<Tool, 'crop' | 'select'>
  image: ImageType | undefined
  closeEditor: () => void
}

function timeoutError(label: string, timeoutMs: number) {
  return new Error(`${label} timed out after ${timeoutMs}ms`)
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: number | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = window.setTimeout(() => reject(timeoutError(label, timeoutMs)), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer))
}

export function createMeasurement(index: number, kind: MeasureTool, style: MeasurementStyle): MeasurementObject {
  return {
    id: `${kind}-${Date.now()}-${index}`,
    kind,
    color: style.color,
    dash: style.dash,
    name: `测量-${kind === 'line' ? '直线' : kind === 'polygon' ? '多边形' : kind === 'ellipse' ? '椭圆' : '角度'}${index + 1}`,
    width: style.width,
    points: [],
    visible: true,
  }
}

export function formatPixel(pixel: PixelValue | null, channels = 3, range?: [number, number], mode: PixelValueMode = DEFAULT_PIXEL_VALUE_MODE) {
  if (!pixel)
    return '(-, -)'
  const pixelValueStr = formatPixelValue(pixel, channels, range, mode)
  return `(${pixel.x}, ${pixel.y}) ${pixelValueStr}${pixel.a < 255 ? ` A:${pixel.a}` : ''}`
}

export function normalizeImageName(image: ImageType | undefined) {
  return image?.basename || image?.name || image?.path.split(/[\\/]/).pop() || 'image'
}

export function copyImageAsBase64(filePath: string): Promise<string> {
  return new Promise((resolve) => {
    const start = performance.now()
    let settled = false
    let timer: number | undefined
    const finish = (value: string, timedOut = false) => {
      if (settled)
        return
      settled = true
      window.clearTimeout(timer)
      vscodeApi.log(value ? 'debug' : 'warn', `${EDITOR_LOG_PREFIX} fallback base64 ${timedOut ? 'timeout' : 'response'}`, {
        costMs: Math.round(performance.now() - start),
        filePath,
        len: value.length,
        prefix: value.slice(0, 32),
        timeoutMs: timedOut ? EDITOR_SOURCE_TIMEOUT_MS : undefined,
      })
      resolve(value)
    }
    timer = window.setTimeout(() => finish('', true), EDITOR_SOURCE_TIMEOUT_MS)
    vscodeApi.postMessage({
      cmd: CmdToVscode.copy_image_as_base64,
      data: { filePath, priority: 'high' },
    }, (data) => {
      finish(typeof data === 'string' ? data : '')
    })
  })
}

export function loadImageData(src: string) {
  const promise = new Promise<ImageData>((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) {
          reject(new Error('Unable to create 2d canvas context'))
          return
        }
        ctx.drawImage(img, 0, 0)
        resolve(ctx.getImageData(0, 0, canvas.width, canvas.height))
      }
      catch (err) {
        reject(err)
      }
    }
    img.onerror = () => reject(new Error('Unable to load image data'))
    img.src = src
  })
  return withTimeout(promise, EDITOR_IMAGE_LOAD_TIMEOUT_MS, 'Pixel buffer load')
}

export function getImagePlacement(editor: Editor, mount: HTMLElement): ImagePlacement | null {
  const background = editor.state.doc.background
  const canvas = mount.querySelector('.upper-canvas') || mount.querySelector('.lower-canvas')
  if (!background || !canvas)
    return null
  const viewport = editor.getViewPortInfo()
  const rect = canvas.getBoundingClientRect()
  if (viewport.width <= 0 || viewport.height <= 0 || rect.width <= 0 || rect.height <= 0)
    return null
  const pixelWidth = rect.width / viewport.width
  const pixelHeight = rect.height / viewport.height
  // 视口矩形和 Fabric 的 vpt 是同一组变量：源像素 (0,0) 的左上角就是 -left * pixelSize。
  const left = -viewport.left * pixelWidth
  const top = -viewport.top * pixelHeight
  return {
    angle: background.angle,
    documentWidth: background.width,
    documentHeight: background.height,
    height: background.height * pixelHeight,
    left,
    pixelHeight,
    pixelWidth,
    screenLeft: rect.left + left,
    screenTop: rect.top + top,
    top,
    width: background.width * pixelWidth,
  }
}

export function pointerToImagePoint(event: PanePointEvent, placement: ImagePlacement, imageSize: CanvasSize, clamp = false): Point | null {
  const x = (event.clientX - placement.screenLeft) / placement.pixelWidth
  const y = (event.clientY - placement.screenTop) / placement.pixelHeight
  if (!clamp && (x < 0 || y < 0 || x > imageSize.width || y > imageSize.height))
    return null
  return {
    x: clamp ? Math.max(0, Math.min(imageSize.width, x)) : x,
    y: clamp ? Math.max(0, Math.min(imageSize.height, y)) : y,
  }
}
