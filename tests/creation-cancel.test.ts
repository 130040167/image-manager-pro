import type { Canvas } from 'fabric'
import type { ControllerContext } from '~/webview/image-manager/components/image-editor/fabric-photo/core/render/controllers/controller'
import { describe, expect, it, vi } from 'vitest'
import { DrawController } from '~/webview/image-manager/components/image-editor/fabric-photo/core/render/controllers/draw'
import { MosaicController } from '~/webview/image-manager/components/image-editor/fabric-photo/core/render/controllers/mosaic'
import { EditorState } from '~/webview/image-manager/components/image-editor/fabric-photo/core/state/editor-state'

function context(canvas: Partial<Canvas>): ControllerContext {
  return {
    canvas: canvas as Canvas,
    dispatch: vi.fn(),
    fire: vi.fn(),
    getState: () => new EditorState(),
  }
}

describe('creation cancellation', () => {
  it('clears an in-progress free drawing preview', () => {
    const contextTop = {} as CanvasRenderingContext2D
    const clearContext = vi.fn()
    const canvas = {
      clearContext,
      contextTop,
      freeDrawingBrush: undefined,
      isDrawingMode: false,
      off: vi.fn(),
      on: vi.fn(),
      _isCurrentlyDrawing: true,
    }
    const controller = new DrawController()
    controller.activate(context(canvas))

    controller.deactivate()

    expect(canvas.isDrawingMode).toBe(false)
    expect(canvas._isCurrentlyDrawing).toBe(false)
    expect(clearContext).toHaveBeenCalledWith(contextTop)
  })

  it('removes an in-progress mosaic overlay', () => {
    const canvas = {
      defaultCursor: 'crosshair',
      off: vi.fn(),
      on: vi.fn(),
    }
    const overlay = { remove: vi.fn() }
    const controller = new MosaicController()
    controller.activate(context(canvas))
    ;(controller as unknown as { overlay: typeof overlay }).overlay = overlay

    controller.deactivate()

    expect(overlay.remove).toHaveBeenCalledOnce()
    expect(canvas.defaultCursor).toBe('default')
  })
})
