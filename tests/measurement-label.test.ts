import type { PathObject } from '~/webview/image-manager/components/image-editor/fabric-photo/core/model/doc'
import { describe, expect, it } from 'vitest'
import { docFromJSON, docToJSON } from '~/webview/image-manager/components/image-editor/fabric-photo/core/model/doc'
import { createFabricObject, probePathPosition, updateFabricObject } from '~/webview/image-manager/components/image-editor/fabric-photo/core/render/object-factory'
import { MeasurementPath } from '~/webview/image-manager/components/image-editor/fabric-photo/core/render/shapes/measurement-path'
import { angleArcHandle, buildMeasurementPath } from '~/webview/image-manager/components/image-editor/measurement'
import { defaultMeasurementEndpointSize, measurementEndpointBounds, measurementEndpointGeometries, measurementEndpointSettings } from '~/webview/image-manager/components/image-editor/measurement-endpoints'
import { measurementCanvasLabelLayouts, measurementDisplayName, measurementLabelLayout, measurementLabelLines, measurementLabelPosition, measurementLabelSettings, measurementMetricLabelSettings, measurementValueDetails, measurementValueRows } from '~/webview/image-manager/components/image-editor/measurement-label'

function measurement(): PathObject {
  const points = [{ x: 100, y: 100 }, { x: 200, y: 100 }]
  const path = buildMeasurementPath('line', points)
  return { id: 'label-test', kind: 'path', tool: 'measurement', path, ...probePathPosition(path, 2), angle: 0, scaleX: 1, scaleY: 1, stroke: '#0d99ff', strokeWidth: 2, fill: '', measurementKind: 'line', measurementName: '测量-直线1', measurementPoints: points }
}

describe('measurement annotation geometry', () => {
  it('keeps a dragged label offset while moving the measurement', () => {
    const object = measurement()
    object.measurementLabel = { ...measurementLabelSettings(object), offset: { x: 15, y: 22 } }
    expect(measurementLabelPosition(object)).toEqual({ x: 165, y: 122 })
    const moved = object.measurementPoints!.map(p => ({ x: p.x + 81, y: p.y - 29 }))
    expect(measurementLabelPosition(object, moved)).toEqual({ x: 246, y: 93 })
    expect(measurementLabelLines(object, moved)).toEqual(['100.00'])
  })
  it('shares custom names and content across labels and properties', () => {
    const object = measurement()
    object.measurementLabel = { ...measurementLabelSettings(object), content: 'both', nameMode: 'custom', customName: '边缘长度' }
    expect(measurementDisplayName(object)).toBe('边缘长度')
    expect(measurementLabelLines(object)).toEqual(['边缘长度', '100.00'])
    object.measurementLabel.content = 'name'
    expect(measurementLabelLines(object)).toEqual(['边缘长度'])
    object.measurementLabel.customName = ' '
    expect(measurementDisplayName(object)).toBe('测量-直线1')
  })
  it('renders single/double/hidden arcs and exposes the minor-angle handle', () => {
    const points = [{ x: 100, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 100 }]
    expect(buildMeasurementPath('angle', points, 40, 'none')).not.toContain(' A ')
    expect(buildMeasurementPath('angle', points, 40, 'single').match(/ A /g)).toHaveLength(1)
    expect(buildMeasurementPath('angle', points, 40, 'double').match(/ A /g)).toHaveLength(2)
    const handle = angleArcHandle(points, 40)!
    expect(handle.x).toBeCloseTo(40 / Math.sqrt(2))
    expect(handle.y).toBeCloseTo(40 / Math.sqrt(2))
  })
  it('uses the actual transformed anchor and stable font size in Fabric projection', () => {
    const object = measurement()
    object.measurementLabel = { ...measurementLabelSettings(object), visible: true }
    const target = createFabricObject(object) as MeasurementPath
    expect(target).toBeInstanceOf(MeasurementPath)
    const initial = target.getAnnotationBounds()!
    target.set({ left: target.left + 50, top: target.top + 35, scaleX: 3, scaleY: 2 })
    const box = target.getAnnotationBounds()!
    expect(box.fontSize).toBe(initial.fontSize)
    expect(box.lines).toEqual(['300.00'])
    const updated = { ...object, measurementLabel: { ...measurementLabelSettings(object), visible: false } }
    updateFabricObject(target, updated)
    expect(target.getAnnotationBounds()).toBeNull()
  })
  it('uses measured text metrics for export bounds', () => {
    const box = measurementLabelLayout(measurement(), undefined, () => 120)
    expect(box.width).toBeCloseTo(132.04)
    expect(box.left + box.width / 2).toBe(150)
  })
  it('ignores legacy property visibility and supports compact custom label styles', () => {
    const object = measurement()
    object.measurementLabel = {
      ...measurementLabelSettings(object),
      showInProperties: false,
      fontSize: 0.5,
      fontFamily: 'monospace',
      background: 'custom',
      backgroundColor: '#123456',
      backgroundOpacity: 0.4,
    }
    const settings = measurementLabelSettings(object)
    expect(settings).not.toHaveProperty('showInProperties')
    expect(settings).toMatchObject({ fontSize: 0.5, fontFamily: 'monospace', background: 'custom', backgroundColor: '#123456', backgroundOpacity: 0.4 })
    const box = measurementLabelLayout(object, undefined, () => 4)
    expect(box.width).toBe(6)
    expect(box.height).toBe(1.675)
  })

  it('hides labels by default and formats values with the selected precision', () => {
    const object = measurement()
    expect(measurementLabelSettings(object).visible).toBe(false)
    object.measurementPrecision = 0
    expect(measurementLabelLines(object)).toEqual(['100'])
    object.measurementPrecision = 4
    expect(measurementLabelLines(object)).toEqual(['100.0000'])
  })

  it('filters perimeter and area on canvas while keeping property values complete', () => {
    const object = { ...measurement(), measurementKind: 'polygon' as const, measurementPoints: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }] }
    expect(measurementValueRows(object)).toHaveLength(2)
    expect(measurementLabelLines(object)).toEqual(['120.00 · 600.00'])
    object.measurementLabel = { ...measurementLabelSettings(object), showPerimeter: false }
    expect(measurementValueRows(object)).toHaveLength(2)
    expect(measurementLabelLines(object)).toEqual(['600.00'])
    object.measurementLabel = { ...measurementLabelSettings(object), showPerimeter: true, showArea: false }
    expect(measurementLabelLines(object)).toEqual(['120.00'])
    object.measurementLabel = { ...measurementLabelSettings(object), showPerimeter: false, showArea: false }
    expect(measurementValueRows(object)).toHaveLength(2)
    expect(measurementLabelLines(object)).toEqual([])
    expect(measurementValueDetails(object)).toEqual([
      { label: '周长', value: '120.00', unit: 'px' },
      { label: '面积', value: '600.00', unit: 'px²' },
    ])
  })

  it('keeps perimeter and area in independent canvas boxes with independent styles and bounds', () => {
    const polygonPoints = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }]
    const polygonPath = buildMeasurementPath('polygon', polygonPoints)
    const object = {
      ...measurement(),
      path: polygonPath,
      ...probePathPosition(polygonPath, 2),
      measurementKind: 'polygon' as const,
      measurementPoints: polygonPoints,
      measurementLabel: { ...measurementLabelSettings(measurement()), visible: true },
    }
    const layouts = measurementCanvasLabelLayouts(object, undefined, () => 30)
    expect(layouts.map(layout => layout.kind)).toEqual(['perimeter', 'area'])
    expect(layouts[0].top).toBeLessThan(layouts[1].top)
    expect(layouts[0].left + layouts[0].width / 2).toBeCloseTo(80 / 3)
    expect(layouts[1].left + layouts[1].width / 2).toBeCloseTo(80 / 3)

    object.measurementLabel = {
      ...object.measurementLabel,
      metricLabels: {
        perimeter: { visible: true, offset: { x: -25, y: -40 }, fontSize: 8, color: '#ff0' },
        area: { visible: false, offset: { x: 35, y: 60 } },
      },
    }
    expect(measurementCanvasLabelLayouts(object, undefined, () => 30)).toHaveLength(1)
    expect(measurementMetricLabelSettings(object, 'perimeter')).toMatchObject({ offset: { x: -25, y: -40 }, fontSize: 8, color: '#ff0' })
    const target = createFabricObject(object) as MeasurementPath
    const bounds = target.getAnnotationBounds()!
    const perimeter = measurementCanvasLabelLayouts(object, undefined, () => 30)[0]
    expect(bounds.left).toBeLessThanOrEqual(perimeter.left + 1)
    expect(bounds.left + bounds.width).toBeGreaterThanOrEqual(perimeter.left + perimeter.width - 1)
  })

  it('keeps independent line endpoint styles and includes their size in visual bounds', () => {
    const object = measurement()
    expect(defaultMeasurementEndpointSize(2)).toBe(8)
    expect(measurementEndpointSettings(object)).toEqual({ start: 'none', end: 'none', size: 8 })
    object.measurementEndpoints = { start: 'filled-arrow', end: 'hollow-circle', size: 20 }
    const endpoints = measurementEndpointGeometries(object)
    expect(endpoints.map(endpoint => endpoint.style)).toEqual(['filled-arrow', 'hollow-circle'])
    expect(endpoints[0].tip).toEqual({ x: 100, y: 100 })
    expect(endpoints[1].tip).toEqual({ x: 200, y: 100 })
    expect(measurementEndpointBounds(object)).toEqual({ left: 99, top: 89, width: 112, height: 22 })

    const target = createFabricObject(object) as MeasurementPath
    const bounds = target.getBoundingRect()
    expect(bounds.left).toBeLessThanOrEqual(99)
    expect(bounds.top).toBeLessThanOrEqual(89)
    expect(bounds.left + bounds.width).toBeGreaterThanOrEqual(211)
    expect(bounds.top + bounds.height).toBeGreaterThanOrEqual(111)
  })

  it.each(['polygon', 'ellipse'] as const)('keeps %s metric names independent from each other and the object name', (kind) => {
    const object: PathObject = {
      ...measurement(),
      measurementKind: kind,
      measurementPoints: kind === 'polygon'
        ? [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }]
        : [{ x: 50, y: 50 }, { x: 90, y: 50 }, { x: 50, y: 80 }],
      measurementLabel: { ...measurementLabelSettings(measurement()), visible: true, content: 'both', nameMode: 'custom', customName: '对象名称' },
    }
    const values = measurementValueDetails(object).map(row => row.value)
    expect(measurementCanvasLabelLayouts(object).map(box => box.lines)).toEqual([['周长', values[0]], ['面积', values[1]]])
    object.measurementLabel!.metricLabels = { perimeter: { nameMode: 'custom', customName: '边界长度' } }
    expect(measurementCanvasLabelLayouts(object).map(box => box.lines)).toEqual([['边界长度', values[0]], ['面积', values[1]]])
    object.measurementLabel!.metricLabels.area = { nameMode: 'custom', customName: '晶粒面积' }
    const saved = docFromJSON(docToJSON({ background: null, objects: [object] })).objects[0] as PathObject
    expect(measurementCanvasLabelLayouts(saved).map(box => box.lines)).toEqual([['边界长度', values[0]], ['晶粒面积', values[1]]])
    expect(measurementDisplayName(saved)).toBe('对象名称')
    object.measurementLabel!.metricLabels.perimeter = { nameMode: 'default', customName: '边界长度' }
    object.measurementLabel!.metricLabels.area.customName = ' '
    expect(measurementCanvasLabelLayouts(object).map(box => box.lines)).toEqual([['周长', values[0]], ['面积', values[1]]])
    object.measurementLabel!.content = 'value'
    expect(measurementCanvasLabelLayouts(object).map(box => box.lines)).toEqual([[values[0]], [values[1]]])
    object.measurementLabel!.content = 'name'
    expect(measurementCanvasLabelLayouts(object).map(box => box.lines)).toEqual([['对象名称']])
    expect(measurementValueDetails(object).map(row => row.label)).toEqual(['周长', '面积'])
  })
})
