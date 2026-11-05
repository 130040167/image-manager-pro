import type { Canvas, Path } from 'fabric'
import type { PathObject } from '~/webview/image-manager/components/image-editor/fabric-photo/core/model/doc'
import type { ControllerContext } from '~/webview/image-manager/components/image-editor/fabric-photo/core/render/controllers/controller'
import type { Transaction } from '~/webview/image-manager/components/image-editor/fabric-photo/core/transform/transaction'
import { Point } from 'fabric'
import { describe, expect, it, vi } from 'vitest'
import { Editor } from '~/webview/image-manager/components/image-editor/fabric-photo/core/editor'
import { readTransformedMeasurementPoints, SelectController } from '~/webview/image-manager/components/image-editor/fabric-photo/core/render/controllers/select'
import { createFabricObject, probePathPosition, updateFabricObject } from '~/webview/image-manager/components/image-editor/fabric-photo/core/render/object-factory'
import { EditorState } from '~/webview/image-manager/components/image-editor/fabric-photo/core/state/editor-state'
import { AddObject } from '~/webview/image-manager/components/image-editor/fabric-photo/core/steps/object-steps'
import { buildMeasurementPath, measureEllipsePoints } from '~/webview/image-manager/components/image-editor/measurement'

type Handler = (event: { target?: unknown }) => void

function createHarness(object: PathObject) {
  const state = new EditorState({ doc: { background: null, objects: [object] } })
  const handlers = new Map<string, Handler>()
  const dispatched: Transaction[] = []
  const fire = vi.fn()
  const canvas = {
    getObjects: () => [],
    off: vi.fn(),
    on: vi.fn((name: string, handler: Handler) => handlers.set(name, handler)),
    viewportTransform: [1, 0, 0, 1, 0, 0],
  }
  const context: ControllerContext = {
    canvas: canvas as unknown as Canvas,
    dispatch: transaction => dispatched.push(transaction),
    fire,
    getState: () => state,
  }
  new SelectController().activate(context)
  return { dispatched, fire, handlers }
}

function measurement(strokeWidth = 2): PathObject {
  const path = 'M 10 10 L 30 20'
  const base = probePathPosition(path, strokeWidth)
  return {
    angle: 0,
    fill: 'transparent',
    id: 'measurement-1',
    kind: 'path',
    left: base.left,
    measurementKind: 'line',
    measurementPoints: [{ x: 10, y: 10 }, { x: 30, y: 20 }],
    path,
    scaleX: 1,
    scaleY: 1,
    stroke: '#0d99ff',
    strokeWidth,
    tool: 'measurement',
    top: base.top,
  }
}

function fabricTarget(object: PathObject, attrs: Partial<Path> = {}) {
  const target = createFabricObject(object) as Path
  target.set(attrs)
  target.setCoords()
  return target
}

describe('measurement Fabric transforms', () => {
  it('maps wide-stroke path points without half-stroke drift', () => {
    const object = measurement(8)
    const target = fabricTarget(object)

    expect(readTransformedMeasurementPoints(object, target)).toEqual(object.measurementPoints)
  })

  it('uses the real Fabric matrix for rotation, scale, and flip', () => {
    const path = 'M 0 0 L 20 0'
    const base = probePathPosition(path, 6)
    const object: PathObject = {
      ...measurement(6),
      left: base.left,
      measurementPoints: [{ x: 0, y: 0 }, { x: 20, y: 0 }],
      path,
      top: base.top,
    }
    const target = fabricTarget(object, { angle: 90, flipX: true, scaleX: 2 })
    target.setPositionByOrigin(new Point(100, 100), 'center', 'center')

    const points = readTransformedMeasurementPoints(object, target)
    expect(points[0].x).toBeCloseTo(100, 8)
    expect(points[0].y).toBeCloseTo(120, 8)
    expect(points[1].x).toBeCloseTo(100, 8)
    expect(points[1].y).toBeCloseTo(80, 8)
  })

  it('keeps ellipse center and conjugate radii through scaled rotation', () => {
    const controls = [{ x: 50, y: 50 }, { x: 70, y: 50 }, { x: 50, y: 60 }]
    const path = buildMeasurementPath('ellipse', controls)
    const base = probePathPosition(path, 4)
    const object: PathObject = {
      ...measurement(4),
      left: base.left,
      measurementKind: 'ellipse',
      measurementPoints: controls,
      path,
      top: base.top,
    }
    const target = fabricTarget(object, { angle: 30, flipY: true, scaleX: 2, scaleY: 3 })
    target.setPositionByOrigin(new Point(200, 150), 'center', 'center')

    const points = readTransformedMeasurementPoints(object, target)
    expect(points[0].x).toBeCloseTo(200, 8)
    expect(points[0].y).toBeCloseTo(150, 8)
    expect(Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)).toBeCloseTo(40, 8)
    expect(Math.hypot(points[2].x - points[0].x, points[2].y - points[0].y)).toBeCloseTo(30, 8)
    expect(measureEllipsePoints(points).area).toBeCloseTo(Math.PI * 40 * 30, 6)
    expect(buildMeasurementPath('ellipse', points)).toContain(' C ')
  })

  it('updates measurement path in place without replacing the Fabric object', () => {
    const object = measurement(4)
    const target = fabricTarget(object)
    const controls = target.controls
    const nextPath = 'M 5 5 L 45 25'
    const nextBase = probePathPosition(nextPath, object.strokeWidth)
    const next = {
      ...object,
      left: nextBase.left,
      measurementPoints: [{ x: 5, y: 5 }, { x: 45, y: 25 }],
      path: nextPath,
      top: nextBase.top,
    }

    updateFabricObject(target, next)

    expect(target.controls).toBe(controls)
    expect(readTransformedMeasurementPoints(next, target)).toEqual(next.measurementPoints)
  })

  it('keeps document points fixed when the properties panel changes measurement width', () => {
    const editor = new Editor()
    const object = measurement(2)
    editor.dispatch(editor.newTransaction().addStep(new AddObject(object)).setSelection([object.id]))

    editor.changeFreeDrawingPathStyle({ width: 10 })

    const updated = editor.state.getObject(object.id) as PathObject
    expect({ left: updated.left, top: updated.top }).toEqual(probePathPosition(object.path, 10))
    expect(readTransformedMeasurementPoints(updated, createFabricObject(updated))).toEqual(object.measurementPoints)
  })

  it('keeps document points fixed when upsert changes measurement width', () => {
    const editor = new Editor()
    const object = measurement(2)
    editor.upsertMeasurementLayer(object.id, object.path, undefined, {
      kind: object.measurementKind,
      points: object.measurementPoints,
      width: object.strokeWidth,
    })

    editor.upsertMeasurementLayer(object.id, object.path, undefined, { width: 10 })

    const updated = editor.state.getObject(object.id) as PathObject
    expect({ left: updated.left, top: updated.top }).toEqual(probePathPosition(object.path, 10))
    expect(readTransformedMeasurementPoints(updated, createFabricObject(updated))).toEqual(object.measurementPoints)
  })

  it('emits live points without dispatching state during scaling', () => {
    const object = measurement()
    const harness = createHarness(object)

    harness.handlers.get('object:scaling')?.({ target: fabricTarget(object, { scaleX: 2 }) })

    expect(harness.dispatched).toHaveLength(0)
    expect(harness.fire).toHaveBeenCalledWith('measurementTransform', {
      id: object.id,
      points: expect.arrayContaining([expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) })]),
    })
  })

  it('commits once and ends the live transform on mouse release', () => {
    const object = measurement()
    const harness = createHarness(object)
    const target = fabricTarget(object, { left: object.left + 10, top: object.top + 20 })

    harness.handlers.get('object:modified')?.({ target })

    expect(harness.dispatched).toHaveLength(1)
    expect(harness.fire).toHaveBeenCalledWith('measurementTransformEnd', {
      id: object.id,
      points: [{ x: 20, y: 30 }, { x: 40, y: 40 }],
    })
  })
})
