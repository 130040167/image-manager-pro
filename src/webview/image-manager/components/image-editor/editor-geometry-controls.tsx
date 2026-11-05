import type { PointerEvent as ReactPointerEvent } from 'react'
import type { ImagePlacement, MeasurementObject } from './editor-utils'
import type { Editor, PathObject } from './fabric-photo/core'
import type { Point } from './measurement'
import { useMemoizedFn } from 'ahooks'
import { useEffect, useRef, useState } from 'react'
import { arrowHeadControlPoints } from './fabric-photo/core/render/shapes/arrow-path'
import { angleArcHandle } from './measurement'
import { measurementCanvasLabelLayouts, measurementLabelFontFamily, measurementLabelSettings, measurementMetricLabelSettings } from './measurement-label'
import { selectedMeasurementLabelKind, useMeasurementLabelSelection } from './measurement-label-selection'
import './editor-geometry-controls.css'

type ArrowHeadControlKind = 'start-length' | 'start-width' | 'end-length' | 'end-width'
type LabelControlKind = 'label' | 'perimeter' | 'area'
type ControlKind = LabelControlKind | 'arc' | 'start' | 'end' | ArrowHeadControlKind
type Drag = { object: PathObject, kind: ControlKind, start: Point, current: PathObject, mergeKey: string }

/** Interactive handles use document coordinates, shared with pixels and Fabric. */
export function EditorGeometryControls({ editor, placement, measurements, creating }: {
  editor: Editor
  placement: ImagePlacement
  measurements: MeasurementObject[]
  creating: boolean
}) {
  const [, render] = useState(0)
  const { selection: labelSelection, selectLabel } = useMeasurementLabelSelection(editor)
  const dragRef = useRef<Drag | null>(null)
  const textMetricsRef = useRef<CanvasRenderingContext2D | null>(null)
  const [preview, setPreview] = useState<PathObject | null>(null)
  const [arrows, setArrows] = useState<Record<string, { start: Point, end: Point, headLength: number, headWidth: number }>>({})
  useEffect(() => {
    const unsubscribe = editor.subscribe(() => render(value => value + 1))
    const moving = ({ id, ...geometry }: { id: string, start: Point, end: Point, headLength: number, headWidth: number }) => setArrows(items => ({ ...items, [id]: geometry }))
    const stopped = ({ id }: { id: string }) => setArrows((items) => {
      const next = { ...items }
      delete next[id]
      return next
    })
    editor.on('arrowTransform', moving)
    editor.on('arrowTransformEnd', stopped)
    return () => {
      unsubscribe()
      editor.off('arrowTransform', moving)
      editor.off('arrowTransformEnd', stopped)
    }
  }, [editor])

  const pointForEvent = useMemoizedFn((event: { clientX: number, clientY: number }) => ({
    x: (event.clientX - placement.screenLeft) / placement.pixelWidth,
    y: (event.clientY - placement.screenTop) / placement.pixelHeight,
  }))
  const finish = useMemoizedFn(() => {
    const drag = dragRef.current
    dragRef.current = null
    if (drag && (drag.kind === 'label' || drag.kind === 'perimeter' || drag.kind === 'area' || drag.kind === 'arc')) {
      const patch = drag.kind === 'arc' ? { measurementArc: drag.current.measurementArc } : { measurementLabel: drag.current.measurementLabel }
      editor.changeMeasurementAnnotation(drag.object.id, patch)
    }
    setPreview(null)
  })
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag)
        return
      event.preventDefault()
      const point = pointForEvent(event)
      const object = drag.object
      if (drag.kind === 'label') {
        const settings = measurementLabelSettings(object)
        const measurementLabel = { ...settings, offset: { x: settings.offset.x + point.x - drag.start.x, y: settings.offset.y + point.y - drag.start.y } }
        drag.current = { ...object, measurementLabel }
        editor.previewMeasurementAnnotation(object.id, { measurementLabel })
        setPreview(drag.current)
      }
      else if (drag.kind === 'perimeter' || drag.kind === 'area') {
        const settings = measurementMetricLabelSettings(object, drag.kind)
        const offset = { x: settings.offset.x + point.x - drag.start.x, y: settings.offset.y + point.y - drag.start.y }
        const base = measurementLabelSettings(object)
        const savedMetric = object.measurementLabel?.metricLabels?.[drag.kind] ?? {}
        const measurementLabel = {
          ...base,
          metricLabels: {
            ...base.metricLabels,
            [drag.kind]: { ...savedMetric, offset },
          },
        }
        drag.current = { ...object, measurementLabel }
        editor.previewMeasurementAnnotation(object.id, { measurementLabel })
        setPreview(drag.current)
      }
      else if (drag.kind === 'arc') {
        const vertex = object.measurementPoints?.[1]
        if (!vertex)
          return
        const measurementArc = { style: object.measurementArc?.style ?? 'single' as const, radius: Math.max(1, Math.round(Math.hypot(point.x - vertex.x, point.y - vertex.y) * 10) / 10) }
        drag.current = { ...object, measurementArc }
        editor.previewMeasurementAnnotation(object.id, { measurementArc })
        setPreview(drag.current)
      }
      else if (object.arrowStart && object.arrowEnd) {
        const { arrowStart: start, arrowEnd: end } = object
        const side = drag.kind.startsWith('start-') ? 'start' : 'end'
        const controls = arrowHeadControlPoints(start, end, side, object.headLength ?? 20, object.headWidth ?? 20)
        const dx = point.x - controls.tip.x
        const dy = point.y - controls.tip.y
        const patch = drag.kind === 'start'
          ? { start: point }
          : drag.kind === 'end'
            ? { end: point }
            : drag.kind.endsWith('length')
              ? { headLength: Math.max(1, Math.round((dx * controls.towardX + dy * controls.towardY) * 10) / 10) }
              : { headWidth: Math.max(1, Math.round(Math.abs(-dx * controls.towardY + dy * controls.towardX) * 20) / 10) }
        editor.changeArrowGeometry(patch, { mergeKey: drag.mergeKey })
      }
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape')
        finish()
    }
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', finish, true)
    window.addEventListener('pointercancel', finish, true)
    window.addEventListener('blur', finish)
    window.addEventListener('keydown', key)
    document.addEventListener('image-editor-end-measure', finish)
    return () => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', finish, true)
      window.removeEventListener('pointercancel', finish, true)
      window.removeEventListener('blur', finish)
      window.removeEventListener('keydown', key)
      document.removeEventListener('image-editor-end-measure', finish)
    }
  }, [editor, finish, pointForEvent])
  const begin = useMemoizedFn((event: ReactPointerEvent<SVGElement>, object: PathObject, kind: ControlKind) => {
    if (creating || editor.state.mode !== 'normal' || object.locked)
      return
    event.preventDefault()
    event.stopPropagation()
    if (event.button === 2) {
      finish()
      editor.endAll()
      return
    }
    if (event.button !== 0)
      return
    if (kind === 'label' || kind === 'perimeter' || kind === 'area')
      selectLabel(object.id, kind === 'label' ? 'general' : kind)
    editor.selectObjects([object.id])
    dragRef.current = { object, current: object, kind, start: pointForEvent(event), mergeKey: `geometry:${object.id}:${Date.now()}` }
  })

  if (creating || editor.state.mode !== 'normal')
    return null
  const scale = placement.pixelWidth || 1
  const radius = 4.5 / scale
  const hitRadius = 10 / scale
  const selected = editor.state.selection
  const selectedArrows = editor.state.doc.objects.filter((object): object is PathObject => object.kind === 'path' && object.tool === 'arrow' && selected.includes(object.id) && !object.hidden && !object.locked)
  return (
    <g className='fp-geometry-controls'>
      {measurements.map((measurement) => {
        const stored = editor.state.getObject(measurement.id)
        if (stored?.kind !== 'path' || stored.locked || stored.hidden)
          return null
        const object = preview?.id === stored.id ? preview : { ...stored, measurementPoints: measurement.points }
        const settings = measurementLabelSettings(object)
        textMetricsRef.current ??= document.createElement('canvas').getContext('2d')
        const textMetrics = textMetricsRef.current
        if (textMetrics)
          textMetrics.font = `500 ${settings.fontSize}px ${measurementLabelFontFamily(settings.fontFamily)}`
        const layouts = measurementCanvasLabelLayouts(
          object,
          undefined,
          textMetrics
            ? (text, labelSettings) => {
                if (labelSettings)
                  textMetrics.font = `500 ${labelSettings.fontSize}px ${measurementLabelFontFamily(labelSettings.fontFamily)}`
                return textMetrics.measureText(text).width
              }
            : undefined,
        )
        const active = selected.includes(object.id)
        const arc = object.measurementArc ?? { style: 'single', radius: 22 }
        const handle = object.measurementKind === 'angle' && arc.style !== 'none' && active ? angleArcHandle(object.measurementPoints ?? [], arc.radius) : null
        return (
          <g key={object.id}>
            {layouts.map((box) => {
              const labelKind: LabelControlKind = box.kind === 'general' ? 'label' : box.kind
              const key = box.kind === 'general' ? object.id : `${object.id}-${box.kind}`
              const labelSelected = active && selectedMeasurementLabelKind(object, labelSelection) === box.kind
              return box.lines.length > 0 && (
                <rect
                  key={key}
                  data-measurement-label={key}
                  data-label-selected={labelSelected}
                  role='button'
                  tabIndex={active ? 0 : -1}
                  aria-pressed={labelSelected}
                  aria-label={`拖动${box.kind === 'perimeter' ? '周长' : box.kind === 'area' ? '面积' : ''}标注`}
                  x={box.left}
                  y={box.top}
                  width={box.width}
                  height={box.height}
                  rx={4}
                  fill='transparent'
                  stroke={active ? '#8cbcff' : 'none'}
                  strokeWidth={labelSelected ? 1.5 : 1}
                  strokeOpacity={labelSelected ? 1 : 0.3}
                  strokeDasharray={labelSelected ? undefined : `${3 / scale} ${3 / scale}`}
                  vectorEffect='non-scaling-stroke'
                  style={{ pointerEvents: 'auto', cursor: 'move' }}
                  onPointerDown={event => begin(event, object, labelKind)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ')
                      return
                    event.preventDefault()
                    event.stopPropagation()
                    selectLabel(object.id, box.kind)
                    editor.selectObjects([object.id])
                  }}
                />
              )
            })}
            {handle && (
              <g className='fp-geometry-handle' data-measurement-arc={object.id} style={{ cursor: 'grab' }} onPointerDown={event => begin(event, object, 'arc')}>
                <circle className='fp-geometry-handle-hit' cx={handle.x} cy={handle.y} r={hitRadius} />
                <circle className='fp-geometry-handle-visible fp-geometry-handle-accent' cx={handle.x} cy={handle.y} r={radius} vectorEffect='non-scaling-stroke' />
                <title>拖动调整夹角弧线</title>
              </g>
            )}
          </g>
        )
      })}
      {selectedArrows.map((object) => {
        const start = arrows[object.id]?.start ?? object.arrowStart
        const end = arrows[object.id]?.end ?? object.arrowEnd
        if (!start || !end)
          return null
        const headLength = arrows[object.id]?.headLength ?? object.headLength ?? 20
        const headWidth = arrows[object.id]?.headWidth ?? object.headWidth ?? 20
        const heads = (['start', 'end'] as const)
          .filter(side => (side === 'start' ? object.startHead : object.endHead) !== 'none')
          .map(side => ({ side, ...arrowHeadControlPoints(start, end, side, headLength, headWidth) }))
        return (
          <g key={object.id}>
            {[{ kind: 'start' as const, point: start }, { kind: 'end' as const, point: end }].map(({ kind, point }) => (
              <g key={kind} className='fp-geometry-handle' data-arrow-handle={kind} style={{ cursor: 'move' }} onPointerDown={event => begin(event, object, kind)}>
                <circle className='fp-geometry-handle-hit' cx={point.x} cy={point.y} r={hitRadius} />
                <circle className='fp-geometry-handle-visible fp-geometry-handle-endpoint' cx={point.x} cy={point.y} r={radius} vectorEffect='non-scaling-stroke' />
                <title>{kind === 'start' ? '起点' : '终点'}</title>
              </g>
            ))}
            {heads.map(({ side, tip, base, wing }) => (
              <g key={side}>
                <path d={`M ${tip.x} ${tip.y} L ${base.x} ${base.y} L ${wing.x} ${wing.y}`} fill='none' stroke='#fbbf24' strokeDasharray='3 3' vectorEffect='non-scaling-stroke' />
                {([{ dimension: 'length', point: base }, { dimension: 'width', point: wing }] as const).map(({ dimension, point }) => {
                  const kind: ArrowHeadControlKind = `${side}-${dimension}`
                  const handleName = side === 'start' ? kind : dimension
                  return (
                    <g key={kind} className='fp-geometry-handle' data-arrow-handle={handleName} style={{ cursor: 'move' }} onPointerDown={event => begin(event, object, kind)}>
                      <circle className='fp-geometry-handle-hit' cx={point.x} cy={point.y} r={hitRadius} />
                      <rect className='fp-geometry-handle-visible fp-geometry-handle-accent' x={point.x - radius} y={point.y - radius} width={radius * 2} height={radius * 2} transform={`rotate(45 ${point.x} ${point.y})`} vectorEffect='non-scaling-stroke' />
                      <title>{dimension === 'length' ? `${side === 'start' ? '起始' : '结束'}箭头长度` : `${side === 'start' ? '起始' : '结束'}箭头宽度`}</title>
                    </g>
                  )
                })}
              </g>
            ))}
          </g>
        )
      })}
    </g>
  )
}
