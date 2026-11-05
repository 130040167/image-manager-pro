/**
 * 滤镜与图像调整参数。数值域：brightness/contrast/saturation ∈ [-1,1]，blur ∈ [0,1]。
 * 挂在 BackgroundImage / ImageObject 的可选 filters 字段上；缺省 = 无滤镜。
 */
export interface FilterSettings {
  brightness: number
  contrast: number
  saturation: number
  blur: number
  grayscale: boolean
  sepia: boolean
  invert: boolean
}

/** 滤镜默认值（全部中性：不产生任何 fabric filter 实例）。 */
export const DEFAULT_FILTERS: FilterSettings = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  blur: 0,
  grayscale: false,
  sepia: false,
  invert: false,
}

export interface BaseObject {
  id: string
  left: number // 背景图片像素坐标系
  top: number
  angle: number // 度
  scaleX: number
  scaleY: number
  opacity?: number // 0..1，缺省 1
  locked?: boolean // 缺省 false；锁定后画布不可交互选中/变换（面板仍可选中）
  hidden?: boolean // 缺省 false；隐藏后不渲染、画布不可选、不计入框选
}

export interface ShapeObject extends BaseObject {
  kind: 'shape'
  shapeType: 'rect' | 'circle' | 'triangle'
  width: number
  height: number
  fill: string
  stroke: string
  strokeWidth: number
  strokeDash?: number[]
}

export interface Point {
  x: number
  y: number
}

export type ArrowHeadStyle = 'none' | 'filled' | 'open'

export interface MeasurementArc {
  style: 'none' | 'single' | 'double'
  radius: number
}

/** 独立的周长/面积画布标注；缺省样式回退到全局样式，名称默认使用指标名称。 */
export interface MeasurementMetricLabel {
  visible?: boolean
  /** Metric names are independent; omitted names default to 周长 / 面积. */
  nameMode?: 'default' | 'custom'
  customName?: string
  offset?: Point
  fontSize?: number
  color?: string
  fontFamily?: 'system-ui' | 'serif' | 'monospace'
  background?: 'default' | 'none' | 'custom'
  backgroundColor?: string
  backgroundOpacity?: number
}

export interface MeasurementLabel {
  visible: boolean
  /** @deprecated Measurement results are always shown in the properties panel. */
  showInProperties?: boolean
  content: 'value' | 'name' | 'both'
  nameMode: 'default' | 'custom'
  customName: string
  offset: Point
  fontSize: number
  color: string
  fontFamily?: 'system-ui' | 'serif' | 'monospace'
  background?: 'default' | 'none' | 'custom'
  backgroundColor?: string
  backgroundOpacity?: number
  /** Canvas-only metric visibility. Property panels always show all results. */
  showPerimeter?: boolean
  showArea?: boolean
  /** Polygon/ellipse metrics use independent canvas text boxes when present. */
  metricLabels?: {
    perimeter?: MeasurementMetricLabel
    area?: MeasurementMetricLabel
  }
}

export type MeasurementEndpointStyle = 'none' | 'filled-arrow' | 'simple-arrow' | 'hollow-circle' | 'filled-circle' | 'bar'

export interface MeasurementEndpoints {
  start: MeasurementEndpointStyle
  end: MeasurementEndpointStyle
  /** Diameter/length in document pixels. Missing values follow the line width. */
  size?: number
}

export interface TextObject extends BaseObject {
  kind: 'text'
  text: string
  fontSize: number
  fontFamily: string
  fill: string
  fontWeight: string
  fontStyle: string // '' | 'italic'
  textDecoration: string // '' | 'underline' | 'line-through'
  textAlign: string
}

export interface PathObject extends BaseObject {
  kind: 'path'
  tool: 'freedraw' | 'line' | 'arrow' | 'measurement'
  path: string // SVG path data
  stroke: string
  strokeWidth: number
  fill: string
  measurementKind?: 'line' | 'polygon' | 'ellipse' | 'angle'
  measurementName?: string
  measurementPoints?: Point[]
  measurementArc?: MeasurementArc
  measurementLabel?: MeasurementLabel
  measurementEndpoints?: MeasurementEndpoints
  measurementPrecision?: number
  strokeDash?: number[]
  arrowStart?: Point
  arrowEnd?: Point
  startHead?: ArrowHeadStyle
  endHead?: ArrowHeadStyle
  headLength?: number
  headWidth?: number
}

export interface MosaicRect { x: number, y: number, size: number, color: string }

export interface MosaicObject extends BaseObject {
  kind: 'mosaic'
  width: number
  height: number
  rects: MosaicRect[]
}

export interface ImageObject extends BaseObject {
  kind: 'image'
  src: string // dataURL 或跨域 URL
  width: number
  height: number
  filters?: FilterSettings // 缺省 = 无滤镜（保持旧数据兼容）
}

export type EditorObject = ShapeObject | TextObject | PathObject | MosaicObject | ImageObject

export interface BackgroundImage {
  src: string // dataURL 或跨域 URL
  sourceWidth?: number // 未旋转的源尺寸，防止反复旋转外接框导致膨胀
  sourceHeight?: number
  valueRange?: [number, number] // 显示映射（默认 0..255），与滤镜共享事务历史
  width: number // 当前外接框像素（旋转后可能互换/扩大）
  height: number
  name: string
  angle: number // 度，0 为原始方向
  filters?: FilterSettings // 缺省 = 无滤镜（保持旧数据兼容）
}

export interface Doc {
  background: BackgroundImage | null
  objects: EditorObject[] // 数组序即 z 序
}

export function createDoc(background: BackgroundImage | null = null): Doc {
  return { background, objects: [] }
}

export function docToJSON(doc: Doc): string {
  return JSON.stringify(doc)
}

const OBJECT_KINDS = new Set(['shape', 'text', 'path', 'mosaic', 'image'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidBackground(value: unknown): value is BackgroundImage {
  if (value === null) {
    return true
  }
  if (!isRecord(value)) {
    return false
  }
  return (
    typeof value.src === 'string'
    && typeof value.width === 'number'
    && typeof value.height === 'number'
    && typeof value.name === 'string'
    && typeof value.angle === 'number'
  )
}

function isValidObject(value: unknown): value is EditorObject {
  if (!isRecord(value)) {
    return false
  }
  return typeof value.id === 'string' && typeof value.kind === 'string' && OBJECT_KINDS.has(value.kind)
}

function inRange(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && value >= min && value <= max
}

/** filters 缺省合法（旧数据兼容）；有则必须是完整 FilterSettings 且数值在域内。 */
function isValidFilters(value: unknown): value is FilterSettings | undefined {
  if (value === undefined) {
    return true
  }
  if (!isRecord(value)) {
    return false
  }
  return (
    inRange(value.brightness, -1, 1)
    && inRange(value.contrast, -1, 1)
    && inRange(value.saturation, -1, 1)
    && inRange(value.blur, 0, 1)
    && typeof value.grayscale === 'boolean'
    && typeof value.sepia === 'boolean'
    && typeof value.invert === 'boolean'
  )
}

/**
 * B3 新增可选字段（opacity/locked/hidden）校验：缺省合法（旧数据兼容）；
 * 有则 opacity 必须 ∈ [0,1]，locked/hidden 必须 boolean。
 */
function isValidObjectFlags(obj: EditorObject): boolean {
  const record = obj as unknown as Record<string, unknown>
  if (record.opacity !== undefined && !inRange(record.opacity, 0, 1)) {
    return false
  }
  if (record.locked !== undefined && typeof record.locked !== 'boolean') {
    return false
  }
  if (record.hidden !== undefined && typeof record.hidden !== 'boolean') {
    return false
  }
  return true
}

export function docFromJSON(json: string): Doc {
  let data: unknown
  try {
    data = JSON.parse(json)
  }
  catch {
    throw new Error('invalid doc JSON')
  }
  if (!isRecord(data) || !isValidBackground(data.background)) {
    throw new Error('invalid doc JSON')
  }
  if (!Array.isArray(data.objects) || !data.objects.every(isValidObject)) {
    throw new Error('invalid doc JSON')
  }
  const background = data.background as BackgroundImage | null
  if (background !== null && !isValidFilters(background.filters)) {
    throw new Error('invalid doc JSON')
  }
  if (!(data.objects as EditorObject[]).every(obj => isValidFilters((obj as { filters?: unknown }).filters))) {
    throw new Error('invalid doc JSON')
  }
  if (!(data.objects as EditorObject[]).every(isValidObjectFlags)) {
    throw new Error('invalid doc JSON')
  }
  return data as unknown as Doc
}

export function cloneDoc(doc: Doc): Doc {
  return structuredClone(doc)
}
