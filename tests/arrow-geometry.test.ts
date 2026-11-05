import type { Canvas, Path, TMat2D } from 'fabric'
import type { PathObject } from '~/webview/image-manager/components/image-editor/fabric-photo/core/model/doc'
import { describe, expect, it, vi } from 'vitest'
import { Editor } from '~/webview/image-manager/components/image-editor/fabric-photo/core/editor'
import { ArrowController } from '~/webview/image-manager/components/image-editor/fabric-photo/core/render/controllers/arrow'
import { readTransformedArrowEndpoints, SelectController } from '~/webview/image-manager/components/image-editor/fabric-photo/core/render/controllers/select'
import { createFabricObject, probePathPosition } from '~/webview/image-manager/components/image-editor/fabric-photo/core/render/object-factory'
import { arrowGeometryFromObject, arrowHeadControlPoints, arrowHeadPoints, ArrowPath, buildArrowPath, transformArrowGeometry } from '~/webview/image-manager/components/image-editor/fabric-photo/core/render/shapes/arrow-path'
import { EditorState } from '~/webview/image-manager/components/image-editor/fabric-photo/core/state/editor-state'
import { AddObject, UpdateObject } from '~/webview/image-manager/components/image-editor/fabric-photo/core/steps/object-steps'

function arrow(): PathObject {
  const geometry = { start: { x: 20, y: 50 }, end: { x: 220, y: 50 }, startHead: 'open' as const, endHead: 'filled' as const, headLength: 24, headWidth: 18 }
  const path = buildArrowPath(geometry)
  return { kind: 'path', tool: 'arrow', id: 'arrow', ...probePathPosition(path, 6), path, angle: 0, scaleX: 1, scaleY: 1, fill: '#ff0000', stroke: '#ff0000', strokeWidth: 6, arrowStart: geometry.start, arrowEnd: geometry.end, startHead: geometry.startHead, endHead: geometry.endHead, headLength: geometry.headLength, headWidth: geometry.headWidth }
}

describe('parametric arrows', () => {
  it.each([
    { length: 1, width: 80, strokeWidth: 1 },
    { length: 2, width: 60, strokeWidth: 4 },
    { length: 3, width: 40, strokeWidth: 12 },
  ])('keeps extreme $length x $width heads rounded at stroke $strokeWidth', ({ length, width, strokeWidth }) => {
    const geometry = { start: { x: 20, y: 50 }, end: { x: 220, y: 50 }, startHead: 'filled' as const, endHead: 'open' as const, headLength: length, headWidth: width }
    const path = new ArrowPath(buildArrowPath(geometry), { stroke: '#000', fill: '#000', strokeWidth }, geometry)
    expect(path.strokeLineCap).toBe('round')
    expect(path.strokeLineJoin).toBe('round')
    expect(arrowHeadPoints(geometry.end, geometry.start, length, width)).toEqual([
      { x: 220 - length, y: 50 - width / 2 },
      { x: 220 - length, y: 50 + width / 2 },
    ])
  })
  it('places shared size controls at both decorated ends', () => {
    const start = arrowHeadControlPoints({ x: 20, y: 50 }, { x: 220, y: 50 }, 'start', 3, 80)
    const end = arrowHeadControlPoints({ x: 20, y: 50 }, { x: 220, y: 50 }, 'end', 3, 80)
    expect(start.base).toEqual({ x: 23, y: 50 })
    expect(start.wing).toEqual({ x: 23, y: 90 })
    expect(end.base).toEqual({ x: 217, y: 50 })
    expect(end.wing).toEqual({ x: 217, y: 90 })
  })
  it('keeps metadata with generic moves, flips and paste offsets and restores them on undo', () => {
    const editor = new Editor()
    const original = arrow()
    editor.dispatch(editor.newTransaction().addStep(new AddObject(original)).setSelection([original.id]))
    editor.dispatch(editor.newTransaction().addStep(new UpdateObject(original.id, { left: original.left + 50 })))
    const moved = editor.state.getObject(original.id) as PathObject
    expect(moved.arrowStart!.x).toBeCloseTo(original.arrowStart!.x + 50)
    editor.undo()
    expect((editor.state.getObject(original.id) as PathObject).arrowStart).toEqual(original.arrowStart)
    editor.flipActiveObjects('horizontal')
    const flipped = editor.state.getObject(original.id) as PathObject
    expect(flipped.scaleX).toBe(1)
    expect(flipped.arrowStart!.x).toBeGreaterThan(flipped.arrowEnd!.x)
    editor.undo()
    editor.dispatch(editor.newTransaction().addStep(new AddObject({ ...original, id: 'pasted', left: original.left + 24, top: original.top + 24 })))
    const pasted = editor.state.getObject('pasted') as PathObject
    expect(pasted.arrowStart).toEqual({ x: 44, y: 74 })
    editor.destroy()
  })
  it('keeps head proportions under nonuniform scaling, rotation and reflection', () => {
    const geometry = arrowGeometryFromObject(arrow())!
    for (const matrix of [[3, 0, 0, 2, 0, 0], [0, 3, -2, 0, 40, 60], [-3, 0, 0, 2, 0, 0]] as TMat2D[]) {
      const transformed = transformArrowGeometry(geometry, matrix, { x: 0, y: 0 })
      expect(transformed.headLength).toBeCloseTo(48)
      expect(transformed.headWidth).toBeCloseTo(36)
      expect(transformed.headLength / transformed.headWidth).toBeCloseTo(24 / 18)
      expect(Math.hypot(transformed.end.x - transformed.start.x, transformed.end.y - transformed.start.y)).toBeCloseTo(600)
    }
  })
  it('commits exactly the live transformed endpoints/head dimensions in one transaction', () => {
    const object = arrow()
    let state = new EditorState({ doc: { background: null, objects: [object] }, selection: [object.id] })
    const handlers = new Map<string, (event: any) => void>()
    const dispatch = vi.fn(tr => state = state.apply(tr))
    const fire = vi.fn()
    const canvas = { on: vi.fn((name, handler) => handlers.set(name, handler)), off: vi.fn(), getObjects: () => [], viewportTransform: [1, 0, 0, 1, 0, 0] } as unknown as Canvas
    new SelectController().activate({ canvas, getState: () => state, dispatch, fire })
    const target = createFabricObject(object) as Path
    target.set({ scaleX: 3, scaleY: 1.7, angle: 31 })
    const live = readTransformedArrowEndpoints(object, target)!
    handlers.get('object:scaling')!({ target })
    expect(fire).toHaveBeenCalledWith('arrowTransform', { id: object.id, ...live })
    handlers.get('object:modified')!({ target })
    expect(dispatch).toHaveBeenCalledTimes(1)
    const committed = state.getObject(object.id) as PathObject
    expect(committed.arrowStart).toEqual(live.start)
    expect(committed.arrowEnd).toEqual(live.end)
    expect(committed.headLength).toBeCloseTo(live.headLength)
    expect(committed.headWidth).toBeCloseTo(live.headWidth)
    expect(committed.scaleX).toBe(1)
    expect(committed.scaleY).toBe(1)
  })
  it('creates configured end decorations at the exact drawn coordinates with a thick stroke', () => {
    let state = new EditorState()
    const handlers = new Map<string, (event: any) => void>()
    const canvas = { on: vi.fn((name, handler) => handlers.set(name, handler)), off: vi.fn(), remove: vi.fn(), requestRenderAll: vi.fn() } as unknown as Canvas
    const controller = new ArrowController()
    controller.setBrush({ width: 12, color: '#8899aa', dash: [3, 2], startHead: 'filled', endHead: 'open', headLength: 30, headWidth: 45 })
    controller.activate({ canvas, getState: () => state, dispatch: tr => state = state.apply(tr), fire: vi.fn() })
    handlers.get('mouse:down')!({ scenePoint: { x: 20, y: 30 } })
    handlers.get('mouse:up')!({ scenePoint: { x: 260, y: 80 } })
    const created = state.doc.objects[0] as PathObject
    const points = readTransformedArrowEndpoints(created, createFabricObject(created))!
    expect(points.start).toEqual({ x: 20, y: 30 })
    expect(points.end).toEqual({ x: 260, y: 80 })
    expect(created.startHead).toBe('filled')
    expect(created.endHead).toBe('open')
    expect(created.headLength).toBe(30)
    expect(created.strokeDash).toEqual([3, 2])
  })
  it('supports none at both ends and merges a head gesture into one undo entry', () => {
    const editor = new Editor()
    const object = arrow()
    editor.dispatch(editor.newTransaction().addStep(new AddObject(object)).setSelection([object.id]))
    editor.changeArrowStyle({ startHead: 'none', endHead: 'none' })
    expect((editor.state.getObject(object.id) as PathObject).path).toBe('M 20 50 L 220 50')
    editor.clearUndoStack()
    editor.changeArrowGeometry({ headLength: 40 }, { mergeKey: 'gesture' })
    editor.changeArrowGeometry({ headLength: 60 }, { mergeKey: 'gesture' })
    expect(editor.history.undoSize).toBe(1)
    editor.undo()
    expect((editor.state.getObject(object.id) as PathObject).headLength).toBe(24)
    editor.redo()
    expect((editor.state.getObject(object.id) as PathObject).headLength).toBe(60)
    editor.destroy()
  })
})
