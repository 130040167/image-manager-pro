import { describe, expect, it } from 'vitest'
import { getEditorPixelTransform, getRotatedEditorPixelWindow } from '~/webview/image-manager/components/image-editor/editor-pixel-grid'
import { Editor } from '~/webview/image-manager/components/image-editor/fabric-photo/core/editor'
import { readTransformedMeasurementPoints } from '~/webview/image-manager/components/image-editor/fabric-photo/core/render/controllers/select'
import { createFabricObject } from '~/webview/image-manager/components/image-editor/fabric-photo/core/render/object-factory'
import { SetBackground, TransformDoc } from '~/webview/image-manager/components/image-editor/fabric-photo/core/steps/doc-steps'
import { buildMeasurementPath } from '~/webview/image-manager/components/image-editor/measurement'
import { imagePixelToScreen, screenToImagePixel } from '~/webview/image-manager/components/pixel-inspector/preview-pixel-grid'

const background = { src: 'data:,pattern', name: 'pattern', width: 799, height: 426, angle: 0 }

describe('image rotation geometry', () => {
  it('keeps exact integer dimensions over repeated quarter turns', () => {
    let doc = { background, objects: [] }
    for (let i = 1; i <= 20; i++) {
      doc = new TransformDoc((i * 90) % 360).apply(doc).doc! as typeof doc
      expect(doc.background.width).toBe(i % 2 ? 426 : 799)
      expect(doc.background.height).toBe(i % 2 ? 799 : 426)
    }
  })

  it('derives each bounding box from source dimensions, including undo/redo', () => {
    const editor = new Editor()
    editor.dispatch(editor.newTransaction().addStep(new SetBackground(background)))
    for (const angle of [45, 30, 90, 135, 180, 270, 0]) {
      editor.setAngle(angle)
      const current = editor.state.doc.background!
      const direct = angle ? new TransformDoc(angle).apply({ background, objects: [] }).doc!.background! : background
      expect(current.width).toBe(direct.width)
      expect(current.height).toBe(direct.height)
    }
    editor.undo()
    expect(editor.state.doc.background!.width).toBe(426)
    editor.redo()
    expect(editor.state.doc.background!.height).toBe(426)
  })

  it('rotates measurement geometry and its Fabric path together', () => {
    const editor = new Editor()
    editor.dispatch(editor.newTransaction().addStep(new SetBackground(background)))
    const points = [{ x: 40, y: 70 }, { x: 140, y: 120 }]
    editor.upsertMeasurementLayer('m', buildMeasurementPath('line', points), 1, { kind: 'line', points, width: 4 })
    editor.rotate(90)
    const object = editor.state.getObject('m')!
    expect(object.kind).toBe('path')
    if (object.kind !== 'path')
      return
    const expected = points.map(p => ({ x: 426 - p.y, y: p.x }))
    expect(object.measurementPoints).toEqual(expected)
    expect(readTransformedMeasurementPoints(object, createFabricObject(object))).toEqual(expected)
    editor.undo()
    expect(editor.state.getObject('m')).toMatchObject({ measurementPoints: points })
  })

  it.each([0, 90, 180, 270, 33])('maps source pixels and pointer reads through the same %s° transform', (angle) => {
    const transform = getEditorPixelTransform({ angle, centerX: 400.25, centerY: 320.75, pixelWidth: 29.3, pixelHeight: 29.3, sourceSize: background })
    for (const [x, y] of [[0, 0], [798, 0], [0, 425], [798, 425], [399, 213]]) {
      const screen = imagePixelToScreen(transform, x + 0.5, y + 0.5)
      const point = screenToImagePixel(transform, screen.x, screen.y)!
      expect(point.imgX).toBeCloseTo(x + 0.5, 9)
      expect(point.imgY).toBeCloseTo(y + 0.5, 9)
    }
    const visible = getRotatedEditorPixelWindow(transform, 800, 640)!
    expect(visible.minX).toBeLessThan(400)
    expect(visible.maxX).toBeGreaterThan(398)
    expect(visible.minY).toBeLessThan(214)
    expect(visible.maxY).toBeGreaterThan(212)
  })
})
