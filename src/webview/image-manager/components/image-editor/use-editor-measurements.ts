import type { PanePointEvent } from './canvas-frame'
import type { ImagePlacement, MeasurementObject, MeasurementStyle, MeasureTool } from './editor-utils'
import type { Editor } from './fabric-photo/core'
import type { Point } from './measurement'
import { useMemoizedFn } from 'ahooks'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createMeasurement, DEFAULT_MEASUREMENT_STYLE } from './editor-utils'
import { buildMeasurementPath, deleteMeasurementPoint, measureAngle, measureEllipsePoints, measureLine, measurePolygonArea, measurePolygonPerimeter, normalizeMeasurementPoints, nudgePoint } from './measurement'

export function useEditorMeasurements({ editor, sourceKey, placement, collectPoint }: {
  editor: Editor | null
  sourceKey: string
  placement: ImagePlacement | null
  collectPoint: (event: PanePointEvent, clamp?: boolean) => Point | null
}) {
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const activeMeasurementRef = useRef<MeasurementObject | undefined>(undefined)
  const writingMeasurementsRef = useRef(false)
  const persistedMeasurementIdsRef = useRef(new Set<string>())
  const completedSelectionRef = useRef<string | null>(null)
  const lastMeasurementObjectsRef = useRef<unknown>(null)
  const nodeDragRef = useRef<{ measurementId: string, index: number } | null>(null)
  const ellipseDragRef = useRef<{ measurementId: string, start: Point, moved: boolean } | null>(null)
  const fabricTransformingMeasurementsRef = useRef(new Set<string>())
  const [editorDocVersion, setEditorDocVersion] = useState(0)
  const [hoverPoint, setHoverPoint] = useState<Point | null>(null)
  const [measurements, setMeasurements] = useState<MeasurementObject[]>([])
  const [activeMeasurementId, setActiveMeasurementId] = useState<string>()
  const [measureKind, setMeasureKind] = useState<MeasureTool | null>(null)
  const [nodeEditMode, setNodeEditMode] = useState(false)
  const [activeNodeIndex, setActiveNodeIndex] = useState(-1)
  const [measurementStyle, setMeasurementStyle] = useState<MeasurementStyle>(DEFAULT_MEASUREMENT_STYLE)
  useEffect(() => {
    setMeasurements([])
    persistedMeasurementIdsRef.current.clear()
    completedSelectionRef.current = null
    fabricTransformingMeasurementsRef.current.clear()
    lastMeasurementObjectsRef.current = null
    activeMeasurementRef.current = undefined
    nodeDragRef.current = null
    ellipseDragRef.current = null
    setActiveMeasurementId(undefined)
    setActiveNodeIndex(-1)
    setMeasureKind(null)
    setNodeEditMode(false)
  }, [sourceKey])
  const activeMeasurement = useMemo(
    () => measurements.find(item => item.id === activeMeasurementId),
    [activeMeasurementId, measurements],
  )
  activeMeasurementRef.current = activeMeasurement
  const measurementStats = useMemo(() => measurements.map(item => ({
    ...item,
    angle: item.kind === 'angle' ? measureAngle(item.points) : 0,
    area: item.kind === 'polygon' ? measurePolygonArea(item.points) : item.kind === 'ellipse' ? measureEllipsePoints(item.points).area : 0,
    length: item.kind === 'line' ? measureLine(item.points) : 0,
    perimeter: item.kind === 'polygon' ? measurePolygonPerimeter(item.points) : item.kind === 'ellipse' ? measureEllipsePoints(item.points).perimeter : 0,
  })), [measurements])

  const finishNodeDrag = useMemoizedFn(() => {
    const item = activeMeasurementRef.current
    const drag = nodeDragRef.current
    nodeDragRef.current = null
    if (!item || drag?.measurementId !== item.id)
      return
    writingMeasurementsRef.current = true
    try {
      editor?.upsertMeasurementLayer(item.id, buildMeasurementPath(item.kind, item.points, item.arc?.radius, item.arc?.style), undefined, { points: item.points })
    }
    finally {
      writingMeasurementsRef.current = false
    }
  })

  const finishMeasurement = useMemoizedFn(({ keepCreating = false }: { keepCreating?: boolean } = {}) => {
    if (!measureKind)
      return
    const active = activeMeasurementRef.current
    ellipseDragRef.current = null
    nodeDragRef.current = null
    if (!keepCreating)
      setMeasureKind(null)
    setHoverPoint(null)
    setActiveNodeIndex(-1)
    const required = active?.kind === 'polygon' || active?.kind === 'angle' ? 3 : 2
    if (!active || active.points.length < required) {
      if (active)
        setMeasurements(items => items.filter(item => item.id !== active.id))
      activeMeasurementRef.current = undefined
      setActiveMeasurementId(undefined)
      setNodeEditMode(false)
      return
    }
    const completed = { ...active, points: normalizeMeasurementPoints(active.kind, active.points) }
    completedSelectionRef.current = completed.id
    activeMeasurementRef.current = keepCreating ? undefined : completed
    if (keepCreating)
      setActiveMeasurementId(undefined)
    setMeasurements(items => items.map(item => item.id === completed.id ? completed : item))
    setNodeEditMode(!keepCreating)
  })

  const addMeasurement = useMemoizedFn((kind: MeasureTool) => {
    finishMeasurement()
    editor?.endAll()
    editor?.deactivateAll()
    activeMeasurementRef.current = undefined
    setActiveMeasurementId(undefined)
    setMeasureKind(kind)
    setHoverPoint(null)
    setNodeEditMode(false)
    setActiveNodeIndex(-1)
  })

  useEffect(() => {
    const onStartMeasure = (event: Event) => {
      const preset = (event as CustomEvent<{ kind?: MeasureTool }>).detail
      addMeasurement(preset?.kind ?? 'line')
    }
    const onEndMeasure = () => {
      finishNodeDrag()
      finishMeasurement()
      setNodeEditMode(false)
      setActiveNodeIndex(-1)
    }
    document.addEventListener('image-editor-start-measure', onStartMeasure)
    document.addEventListener('image-editor-end-measure', onEndMeasure)
    return () => {
      document.removeEventListener('image-editor-start-measure', onStartMeasure)
      document.removeEventListener('image-editor-end-measure', onEndMeasure)
    }
  }, [])

  const measurementPath = useMemoizedFn((item: MeasurementObject) => {
    return buildMeasurementPath(item.kind, item.points, item.arc?.radius, item.arc?.style)
  })

  const handleOverlayPointerDown = useMemoizedFn((event: PointerEvent) => {
    if (event.button === 2) {
      event.preventDefault()
      event.stopImmediatePropagation()
      ellipseDragRef.current = null
      finishNodeDrag()
      if (measureKind)
        finishMeasurement()
      editor?.endAll()
      return
    }
    if (!measureKind || event.button !== 0)
      return
    const point = collectPoint(event, true)
    if (!point)
      return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.detail > 1 && measureKind === 'polygon')
      return
    if (!activeMeasurementRef.current || activeMeasurementRef.current.kind !== measureKind || activeMeasurementRef.current.points.length === 0) {
      const kind = measureKind
      const created = { ...createMeasurement(measurements.length, kind, measurementStyle), points: [point] }
      activeMeasurementRef.current = created
      if (kind === 'ellipse')
        ellipseDragRef.current = { measurementId: created.id, moved: false, start: point }
      setActiveMeasurementId(created.id)
      setMeasurements(items => [...items, created])
      return
    }
    const active = activeMeasurementRef.current
    // PointerEvent.detail can stay zero for both presses of a double-click.
    // The second press must not append the closing vertex a second time.
    const lastPoint = active.points[active.points.length - 1]
    if (active.kind === 'polygon' && lastPoint && lastPoint.x === point.x && lastPoint.y === point.y)
      return
    const points = [...active.points, point]
    let nextPoints = points
    if (active.kind === 'line' || active.kind === 'ellipse')
      nextPoints = points.slice(0, 2)
    else if (active.kind === 'angle')
      nextPoints = points.slice(0, 3)
    const next = {
      ...active,
      points: nextPoints,
    }
    activeMeasurementRef.current = next
    setMeasurements(items => items.map(item => item.id === active.id ? next : item))
    if (((active.kind === 'line' || active.kind === 'ellipse') && active.points.length >= 1) || (active.kind === 'angle' && active.points.length >= 2))
      finishMeasurement({ keepCreating: true })
  })

  useEffect(() => {
    const dragEndpoint = (start: Point, point: Point, shiftKey: boolean) => {
      if (!shiftKey)
        return point
      const size = Math.max(Math.abs(point.x - start.x), Math.abs(point.y - start.y))
      return { x: start.x + Math.sign(point.x - start.x || 1) * size, y: start.y + Math.sign(point.y - start.y || 1) * size }
    }
    const onMove = (event: PointerEvent) => {
      const drag = ellipseDragRef.current
      const point = drag ? collectPoint(event, true) : null
      if (!drag || !point)
        return
      const moved = drag.moved || Math.hypot(point.x - drag.start.x, point.y - drag.start.y) * (placement?.pixelWidth ?? 1) >= 3
      ellipseDragRef.current = { ...drag, moved }
      if (!moved)
        return
      const endpoint = dragEndpoint(drag.start, point, event.shiftKey)
      setHoverPoint(endpoint)
      const active = activeMeasurementRef.current
      if (active?.id !== drag.measurementId)
        return
      const next = { ...active, points: [drag.start, endpoint] }
      activeMeasurementRef.current = next
      setMeasurements(items => items.map(item => item.id === next.id ? next : item))
    }
    const onUp = (event: PointerEvent) => {
      const drag = ellipseDragRef.current
      if (!drag)
        return
      ellipseDragRef.current = null
      if (!drag.moved)
        return
      event.preventDefault()
      event.stopImmediatePropagation()
      const point = collectPoint(event, true)
      const active = activeMeasurementRef.current
      if (point && active?.id === drag.measurementId)
        activeMeasurementRef.current = { ...active, points: [drag.start, dragEndpoint(drag.start, point, event.shiftKey)] }
      finishMeasurement({ keepCreating: true })
    }
    const onCancel = () => {
      ellipseDragRef.current = null
    }
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onCancel, true)
    return () => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onCancel, true)
    }
  }, [collectPoint, finishMeasurement, placement?.pixelWidth])

  const handleOverlayDoubleClick = useMemoizedFn((event: MouseEvent) => {
    if (measureKind !== 'polygon' || (activeMeasurementRef.current?.points.length ?? 0) < 3)
      return
    event.preventDefault()
    finishMeasurement({ keepCreating: true })
  })

  const handleNodePointerDown = useMemoizedFn((event: React.PointerEvent<SVGCircleElement>, measurementId: string, index: number) => {
    event.preventDefault()
    event.stopPropagation()
    if (event.button === 2) {
      finishNodeDrag()
      finishMeasurement()
      editor?.endAll()
      return
    }
    activeMeasurementRef.current = measurements.find(item => item.id === measurementId)
    setActiveMeasurementId(measurementId)
    setActiveNodeIndex(index)
    if (event.button !== 0 || measureKind || editor?.state.getObject(measurementId)?.locked === true)
      return
    setNodeEditMode(true)
    nodeDragRef.current = { measurementId, index }
  })

  useEffect(() => {
    if (!nodeEditMode)
      return
    const onMove = (event: PointerEvent) => {
      const drag = nodeDragRef.current
      const point = drag ? collectPoint(event, true) : null
      if (!drag || !point)
        return
      const item = activeMeasurementRef.current
      if (!item || item.id !== drag.measurementId)
        return
      let points = item.points.slice()
      if (item.kind === 'ellipse' && drag.index === 0) {
        const delta = { x: point.x - item.points[0].x, y: point.y - item.points[0].y }
        points = item.points.map(p => ({ x: p.x + delta.x, y: p.y + delta.y }))
      }
      else {
        points[drag.index] = point
      }
      const next = { ...item, points }
      activeMeasurementRef.current = next
      editor?.previewMeasurementPoints(item.id, points)
      setMeasurements(items => items.map(candidate => candidate.id === item.id ? next : candidate))
    }
    const onUp = finishNodeDrag
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
    window.addEventListener('blur', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
      window.removeEventListener('blur', onUp)
    }
  }, [collectPoint, finishNodeDrag, nodeEditMode])

  useEffect(() => {
    const canvas = overlayRef.current?.parentElement?.querySelector('.upper-canvas')
    if (!(canvas instanceof HTMLElement))
      return
    const exitCreationMode = (event: Event) => {
      event.preventDefault()
      ellipseDragRef.current = null
      finishNodeDrag()
      if (activeMeasurementRef.current && measureKind)
        finishMeasurement()
      else
        setMeasureKind(null)
      editor?.endAll()
    }
    canvas.addEventListener('pointerdown', handleOverlayPointerDown, true)
    canvas.addEventListener('dblclick', handleOverlayDoubleClick, true)
    canvas.addEventListener('contextmenu', exitCreationMode)
    return () => {
      canvas.removeEventListener('pointerdown', handleOverlayPointerDown, true)
      canvas.removeEventListener('dblclick', handleOverlayDoubleClick, true)
      canvas.removeEventListener('contextmenu', exitCreationMode)
    }
  }, [editor, handleOverlayDoubleClick, handleOverlayPointerDown])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLElement && (target.closest('input, textarea, select') || target.isContentEditable))
        return
      if (event.key === 'Escape') {
        finishNodeDrag()
        finishMeasurement()
        nodeDragRef.current = null
        setActiveNodeIndex(-1)
        return
      }
      const active = activeMeasurementRef.current
      if (!active || !nodeEditMode || activeNodeIndex < 0)
        return
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (active.kind !== 'polygon' || active.points.length <= 3) {
          setMeasurements(items => items.filter(item => item.id !== active.id))
          setActiveMeasurementId(undefined)
          setActiveNodeIndex(-1)
        }
        else {
          setMeasurements(items => items.map(item => item.id === active.id ? { ...item, points: deleteMeasurementPoint(item.points, activeNodeIndex) } : item))
          setActiveNodeIndex(-1)
        }
        return
      }
      const point = active.points[activeNodeIndex]
      if (!point)
        return
      const next = nudgePoint(point, event.key)
      if (next === point)
        return
      event.preventDefault()
      event.stopImmediatePropagation()
      setMeasurements(items => items.map((item) => {
        if (item.id !== active.id)
          return item
        const points = item.points.slice()
        points[activeNodeIndex] = next
        return { ...item, points }
      }))
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [activeNodeIndex, nodeEditMode])

  const renderedMeasurements = measurementStats.filter((item) => {
    const layer = editorDocVersion >= 0 ? editor?.state.getObject(item.id) : undefined
    return item.visible && layer?.hidden !== true
  })

  const syncedMeasurementOpacityRef = useRef<number | null>(null)
  useEffect(() => {
    if (!editor)
      return
    const opacityChanged = syncedMeasurementOpacityRef.current !== measurementStyle.lineOpacity
    syncedMeasurementOpacityRef.current = measurementStyle.lineOpacity
    writingMeasurementsRef.current = true
    try {
      for (const item of measurementStats) {
        if (fabricTransformingMeasurementsRef.current.has(item.id) || nodeDragRef.current?.measurementId === item.id)
          continue
        const path = measurementPath(item)
        if (item.points.length >= 2 && path) {
          const layer = editor.state.getObject(item.id)
          const layerStyle = layer?.kind === 'path' ? layer : undefined
          persistedMeasurementIdsRef.current.add(item.id)
          editor.upsertMeasurementLayer(item.id, path, opacityChanged ? measurementStyle.lineOpacity : undefined, { color: layerStyle?.stroke ?? item.color, dash: layerStyle?.strokeDash ?? item.dash, kind: item.kind, name: item.name, points: item.points, width: layerStyle?.strokeWidth ?? item.width })
        }
      }
      const ids = new Set(measurementStats.filter(item => item.points.length >= 2).map(item => item.id))
      for (const object of editor.state.doc.objects) {
        if (object.kind === 'path' && object.tool === 'measurement' && !ids.has(object.id)) {
          editor.removeMeasurementLayer(object.id)
          persistedMeasurementIdsRef.current.delete(object.id)
        }
      }
      const completedId = completedSelectionRef.current
      if (completedId && editor.state.getObject(completedId)) {
        completedSelectionRef.current = null
        editor.selectObjects([completedId])
      }
    }
    finally {
      writingMeasurementsRef.current = false
    }
  }, [editorDocVersion, measurementPath, measurementStats, measurementStyle.lineOpacity])
  const handleEditorChange = useMemoizedFn(() => {
    if (!editor || lastMeasurementObjectsRef.current === editor.state.doc.objects)
      return
    lastMeasurementObjectsRef.current = editor.state.doc.objects
    setEditorDocVersion(version => version + 1)
    if (writingMeasurementsRef.current)
      return
    setMeasurements((items) => {
      const layers = editor.state.doc.objects.filter(object => object.kind === 'path' && object.tool === 'measurement')
      const next: MeasurementObject[] = []
      for (const layer of layers) {
        if (layer.kind !== 'path' || !layer.measurementKind || !layer.measurementPoints)
          continue
        const current = items.find(item => item.id === layer.id)
        next.push((fabricTransformingMeasurementsRef.current.has(layer.id) || nodeDragRef.current?.measurementId === layer.id) && current
          ? current
          : {
              id: layer.id,
              arc: layer.measurementArc,
              kind: layer.measurementKind,
              points: layer.measurementPoints,
              name: layer.measurementName ?? '测量',
              color: layer.stroke,
              width: layer.strokeWidth,
              dash: layer.strokeDash ?? [],
              visible: true,
            })
      }
      // Only a draft that has never been a Fabric layer survives a document deletion/undo.
      next.push(...items.filter(item => !persistedMeasurementIdsRef.current.has(item.id) && !next.some(candidate => candidate.id === item.id)))
      persistedMeasurementIdsRef.current = new Set(layers.map(layer => layer.id))
      return JSON.stringify(items) === JSON.stringify(next) ? items : next
    })
  })

  const previewPoints = activeMeasurement && measureKind && hoverPoint
    ? activeMeasurement.kind === 'ellipse' ? [activeMeasurement.points[0], hoverPoint] : [...activeMeasurement.points, hoverPoint]
    : []
  const previewPath = measureKind ? buildMeasurementPath(measureKind, previewPoints) : ''

  useEffect(() => {
    if (!editor)
      return
    const onTransform = ({ id, points }: { id: string, points: Point[] }) => {
      fabricTransformingMeasurementsRef.current.add(id)
      setMeasurements(items => items.map((item) => {
        if (item.id !== id)
          return item
        const next = { ...item, points }
        if (activeMeasurementRef.current?.id === id)
          activeMeasurementRef.current = next
        return next
      }))
    }

    const onTransformEnd = ({ id, points }: { id: string, points: Point[] }) => {
      fabricTransformingMeasurementsRef.current.delete(id)
      setMeasurements(items => items.map(item => item.id === id ? { ...item, points } : item))
    }

    const onSelection = () => {
      setActiveNodeIndex(-1)
      setEditorDocVersion(version => version + 1)
    }

    editor.on('measurementTransform', onTransform)
    editor.on('measurementTransformEnd', onTransformEnd)
    editor.on('change:selection', onSelection)
    editor.on('change:mode', onSelection)
    const unsubscribe = editor.subscribe(handleEditorChange)
    handleEditorChange()
    return () => {
      unsubscribe()
      editor.off('measurementTransform', onTransform)
      editor.off('measurementTransformEnd', onTransformEnd)
      editor.off('change:selection', onSelection)
      editor.off('change:mode', onSelection)
    }
  }, [editor, handleEditorChange])
  return { overlayRef, activeMeasurementId, activeNodeIndex, measureKind, measurementStyle, setMeasurementStyle, setHoverPoint, finishMeasurement, addMeasurement, handleNodePointerDown, renderedMeasurements, previewPath }
}
