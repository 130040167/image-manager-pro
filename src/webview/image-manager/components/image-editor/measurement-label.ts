import type { PathObject } from './fabric-photo/core/model/doc'
import type { Point } from './measurement'
import { editorText } from './editor-i18n'
import { measureAngle, measureEllipsePoints, measureLine, measurePolygonArea, measurePolygonPerimeter } from './measurement'

export function measurementLabelSettings(object: PathObject) {
  const saved = object.measurementLabel
  const { showInProperties: _legacyShowInProperties, ...savedSettings } = saved ?? {}
  return {
    visible: false,
    content: 'value' as 'value' | 'name' | 'both',
    nameMode: 'default' as 'default' | 'custom',
    customName: '',
    offset: { x: 0, y: -18 },
    color: '#ffffff',
    fontFamily: 'system-ui' as 'system-ui' | 'serif' | 'monospace',
    background: 'default' as 'default' | 'none' | 'custom',
    backgroundColor: '#0f172a',
    ...savedSettings,
    // Old documents may contain showInProperties=false. It is intentionally
    // excluded because measurement results now always appear in properties.
    fontSize: Math.max(0.5, saved?.fontSize ?? 14),
    backgroundOpacity: Math.min(1, Math.max(0, saved?.backgroundOpacity ?? 0.82)),
    showPerimeter: saved?.showPerimeter ?? true,
    showArea: saved?.showArea ?? true,
  }
}

export function measurementLabelFontFamily(fontFamily: ReturnType<typeof measurementLabelSettings>['fontFamily']) {
  switch (fontFamily) {
    case 'serif': return 'Georgia, "Times New Roman", serif'
    case 'monospace': return 'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace'
    default: return 'system-ui, sans-serif'
  }
}

export function measurementDefaultName(object: PathObject) {
  const name = object.measurementName
  if (!name || name === '测量')
    return editorText('测量')
  const automatic = /^测量-(直线|多边形|椭圆|角度)(\d+)$/.exec(name)
  if (!automatic)
    return name
  const sources: Record<string, string> = {
    直线: '测量-直线{{index}}',
    多边形: '测量-多边形{{index}}',
    椭圆: '测量-椭圆{{index}}',
    角度: '测量-角度{{index}}',
  }
  const source = sources[automatic[1]]
  return source ? editorText(source, { index: automatic[2] }) : name
}

export function measurementDisplayName(object: PathObject) {
  const settings = measurementLabelSettings(object)
  return settings.nameMode === 'custom' && settings.customName.trim()
    ? settings.customName.trim()
    : measurementDefaultName(object)
}

export interface MeasurementValueDetail {
  label: string
  value: string
  unit: string
}

export function measurementValueDetails(object: PathObject, points = object.measurementPoints ?? [], options: { respectCanvasVisibility?: boolean } = {}): MeasurementValueDetail[] {
  const precision = Math.min(6, Math.max(0, Math.round(object.measurementPrecision ?? 2)))
  const format = (value: number) => value.toFixed(precision)
  const settings = measurementLabelSettings(object)
  const showPerimeter = options.respectCanvasVisibility !== true || settings.showPerimeter
  const showArea = options.respectCanvasVisibility !== true || settings.showArea
  switch (object.measurementKind) {
    case 'angle': return [{ label: editorText('角度'), value: format(measureAngle(points)), unit: '°' }]
    case 'ellipse': {
      const ellipse = measureEllipsePoints(points)
      return [
        ...(showPerimeter ? [{ label: editorText('周长'), value: format(ellipse.perimeter), unit: 'px' }] : []),
        ...(showArea ? [{ label: editorText('面积'), value: format(ellipse.area), unit: 'px²' }] : []),
      ]
    }
    case 'polygon': return [
      ...(showPerimeter ? [{ label: editorText('周长'), value: format(measurePolygonPerimeter(points)), unit: 'px' }] : []),
      ...(showArea ? [{ label: editorText('面积'), value: format(measurePolygonArea(points)), unit: 'px²' }] : []),
    ]
    default: return [{ label: editorText('长度'), value: format(measureLine(points)), unit: 'px' }]
  }
}

/** Compatibility rows for property consumers that still expect a formatted value string. */
export function measurementValueRows(object: PathObject, points = object.measurementPoints ?? [], options: { respectCanvasVisibility?: boolean } = {}): [string, string][] {
  return measurementValueDetails(object, points, options).map(row => [row.label, row.unit ? `${row.value} ${row.unit}` : row.value])
}

export function measurementLabelLines(object: PathObject, points = object.measurementPoints ?? []): string[] {
  const settings = measurementLabelSettings(object)
  const values = measurementValueDetails(object, points, { respectCanvasVisibility: true }).map(row => row.value).join(' · ')
  if (settings.content === 'name')
    return [measurementDisplayName(object)]
  if (settings.content === 'both')
    return values ? [measurementDisplayName(object), values] : [measurementDisplayName(object)]
  return values ? [values] : []
}

export type MeasurementMetricKind = 'perimeter' | 'area'

export type MeasurementMetricLabelSettings = {
  visible: boolean
  nameMode: 'default' | 'custom'
  customName: string
  offset: Point
  fontSize: number
  color: string
  fontFamily: ReturnType<typeof measurementLabelSettings>['fontFamily']
  background: ReturnType<typeof measurementLabelSettings>['background']
  backgroundColor: string
  backgroundOpacity: number
}

/** Returns one metric's effective style, preserving compatibility with old labels. */
export function measurementMetricLabelSettings(object: PathObject, kind: MeasurementMetricKind): MeasurementMetricLabelSettings {
  const global = measurementLabelSettings(object)
  const saved = object.measurementLabel?.metricLabels?.[kind]
  const legacyOffset = object.measurementLabel?.offset
  // Old labels were centered at the single default offset (-18). Keep a custom
  // legacy offset as the base while separating the two metric boxes vertically.
  const legacyDelta = legacyOffset === undefined
    ? { x: 0, y: 0 }
    : { x: legacyOffset.x, y: legacyOffset.y + 18 }
  const defaultOffset = kind === 'perimeter'
    ? { x: legacyDelta.x, y: legacyDelta.y - 18 }
    : { x: legacyDelta.x, y: legacyDelta.y + 18 }
  const fallbackVisible = kind === 'perimeter' ? global.showPerimeter : global.showArea
  const metric = saved ?? {}
  return {
    visible: metric.visible ?? fallbackVisible,
    nameMode: metric.nameMode ?? 'default',
    customName: metric.customName ?? '',
    offset: metric.offset ?? defaultOffset,
    fontSize: Math.max(0.5, metric.fontSize ?? global.fontSize),
    color: metric.color ?? global.color,
    fontFamily: metric.fontFamily ?? global.fontFamily,
    background: metric.background ?? global.background,
    backgroundColor: metric.backgroundColor ?? global.backgroundColor,
    backgroundOpacity: Math.min(1, Math.max(0, metric.backgroundOpacity ?? global.backgroundOpacity)),
  }
}

export function measurementMetricDisplayName(object: PathObject, kind: MeasurementMetricKind) {
  const settings = measurementMetricLabelSettings(object, kind)
  return settings.nameMode === 'custom' && settings.customName.trim()
    ? settings.customName.trim()
    : editorText(kind === 'perimeter' ? '周长' : '面积')
}

export interface MeasurementCanvasLabelLayout {
  kind: 'general' | MeasurementMetricKind
  lines: string[]
  settings: ReturnType<typeof measurementLabelSettings> | MeasurementMetricLabelSettings
  left: number
  top: number
  width: number
  height: number
  fontSize: number
  lineHeight: number
  paddingX: number
  paddingY: number
}

function measurementLabelBox(object: PathObject, points: Point[], lines: string[], settings: ReturnType<typeof measurementLabelSettings> | MeasurementMetricLabelSettings, measure?: (text: string, settings?: ReturnType<typeof measurementLabelSettings> | MeasurementMetricLabelSettings) => number): MeasurementCanvasLabelLayout {
  const anchor = measurementAnchor(object, points)
  const position = { x: anchor.x + settings.offset.x, y: anchor.y + settings.offset.y }
  const fontSize = settings.fontSize
  const lineHeight = fontSize * 1.35
  const paddingX = Math.max(1, fontSize * 0.43)
  const paddingY = Math.max(0.5, fontSize * 0.29)
  const textWidth = lines.length === 0 ? 0 : Math.max(...lines.map(line => measure ? measure(line, settings) : [...line].reduce((sum, char) => sum + (char.codePointAt(0)! > 255 ? 1 : 0.6) * fontSize, 0)))
  const width = textWidth + paddingX * 2
  const height = lines.length * lineHeight + paddingY * 2
  return { kind: 'general', lines, settings, left: position.x - width / 2, top: position.y - height / 2, width, height, fontSize, lineHeight, paddingX, paddingY }
}

/** Independent canvas boxes for polygon/ellipse perimeter and area values. */
export function measurementCanvasLabelLayouts(object: PathObject, points = object.measurementPoints ?? [], measure?: (text: string, settings?: ReturnType<typeof measurementLabelSettings> | MeasurementMetricLabelSettings) => number): MeasurementCanvasLabelLayout[] {
  const global = measurementLabelSettings(object)
  if (!global.visible)
    return []
  if (object.measurementKind !== 'polygon' && object.measurementKind !== 'ellipse') {
    const lines = measurementLabelLines(object, points)
    return lines.length === 0 ? [] : [measurementLabelBox(object, points, lines, global, measure)]
  }
  // Name-only remains one general label: there are no metric values to split.
  if (global.content === 'name') {
    const lines = [measurementDisplayName(object)]
    return [measurementLabelBox(object, points, lines, global, measure)]
  }
  const rows = measurementValueDetails(object, points)
  const layouts: MeasurementCanvasLabelLayout[] = []
  for (const [index, { value }] of rows.entries()) {
    // Metric order is stable; translated labels must never identify geometry.
    const kind: MeasurementMetricKind = index === 0 ? 'perimeter' : 'area'
    const settings = measurementMetricLabelSettings(object, kind)
    if (!settings.visible)
      continue
    const lines = global.content === 'both'
      ? [measurementMetricDisplayName(object, kind), value]
      : [value]
    const box = measurementLabelBox(object, points, lines, settings, measure)
    layouts.push({ ...box, kind })
  }
  return layouts
}

export function measurementAnchor(object: PathObject, points = object.measurementPoints ?? []): Point {
  if (!points.length)
    return { x: 0, y: 0 }
  if (object.measurementKind === 'ellipse')
    return points[0]
  if (object.measurementKind === 'angle')
    return points[1] ?? points[0]
  return { x: points.reduce((sum, point) => sum + point.x, 0) / points.length, y: points.reduce((sum, point) => sum + point.y, 0) / points.length }
}

export function measurementLabelPosition(object: PathObject, points = object.measurementPoints ?? []) {
  const anchor = measurementAnchor(object, points)
  const { offset } = measurementLabelSettings(object)
  return { x: anchor.x + offset.x, y: anchor.y + offset.y }
}

/** Shared font/box metrics keep the draggable SVG hit target and export aligned. */
export function measurementLabelLayout(object: PathObject, points = object.measurementPoints ?? [], measure?: (text: string) => number) {
  const settings = measurementLabelSettings(object)
  const lines = measurementLabelLines(object, points)
  const box = measurementLabelBox(object, points, lines, settings, measure)
  return { left: box.left, top: box.top, width: box.width, height: box.height, lines: box.lines, fontSize: box.fontSize, lineHeight: box.lineHeight, paddingX: box.paddingX, paddingY: box.paddingY }
}
