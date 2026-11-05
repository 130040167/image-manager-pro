// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import {
  CANVAS_FRAME_FALLBACK,
  collectCanvasPoint,
  getCanvasFrame,
  getEditorCanvasElement,
  getElementSize,
  mapCanvasPointToImagePixel,
  mapPointerToImagePixel,
  scaleCanvasPoints,
} from '~/webview/image-manager/components/image-editor/canvas-frame'

function rect(left: number, top: number, width: number, height: number) {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

function setRect(element: Element, value: DOMRect) {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => value,
  })
}

function setClientSize(element: Element, width: number, height: number) {
  Object.defineProperties(element, {
    clientHeight: {
      configurable: true,
      value: height,
    },
    clientWidth: {
      configurable: true,
      value: width,
    },
  })
}

describe('image editor canvas frame helpers', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('reads element size from client dimensions', () => {
    const element = document.createElement('div')
    setClientSize(element, 320.9, 240.5)

    expect(getElementSize(element)).toEqual({ height: 240, width: 320 })
  })

  it('prefers the fabric upper canvas as the measurement target', () => {
    const mount = document.createElement('div')
    const editor = document.createElement('div')
    const container = document.createElement('div')
    const lower = document.createElement('canvas')
    const upper = document.createElement('canvas')
    editor.className = 'fp-editor'
    container.className = 'fp-canvas-mount'
    lower.className = 'lower-canvas'
    upper.className = 'upper-canvas'

    container.append(lower, upper)
    editor.append(container)
    mount.append(editor)

    expect(getEditorCanvasElement(mount)).toBe(upper)
  })

  it('limits the overlay frame to the actual TOAST UI canvas, excluding bottom menus', () => {
    const pane = document.createElement('div')
    const mount = document.createElement('div')
    const canvas = document.createElement('canvas')
    canvas.className = 'upper-canvas'
    mount.innerHTML = '<div class="fp-editor"><div class="fp-canvas-mount"></div></div>'
    mount.querySelector('.fp-canvas-mount')!.append(canvas)
    pane.append(mount)
    document.body.append(pane)

    setRect(pane, rect(100, 50, 900, 700))
    setRect(canvas, rect(250, 130, 640, 480))

    expect(getCanvasFrame(pane, mount)).toEqual({
      height: 480,
      left: 150,
      top: 80,
      width: 640,
    })
  })

  it('returns null for pointers in TOAST UI controls outside the canvas frame', () => {
    const pane = document.createElement('div')
    const mount = document.createElement('div')
    const container = document.createElement('div')
    const canvas = document.createElement('canvas')
    container.className = 'fp-canvas-mount'
    canvas.className = 'upper-canvas'
    container.append(canvas)
    mount.append(container)
    pane.append(mount)

    setRect(pane, rect(100, 50, 900, 700))
    setRect(canvas, rect(250, 130, 640, 480))

    expect(collectCanvasPoint({ clientX: 300, clientY: 170 }, pane, mount, CANVAS_FRAME_FALLBACK)).toEqual({
      x: 50,
      y: 40,
    })
    expect(collectCanvasPoint({ clientX: 300, clientY: 660 }, pane, mount, CANVAS_FRAME_FALLBACK)).toBeNull()
  })

  it('falls back to the host pane before TOAST UI creates canvas nodes', () => {
    const pane = document.createElement('div')
    setRect(pane, rect(10, 20, 300, 200))

    expect(getCanvasFrame(pane, null)).toEqual({
      height: 200,
      left: 0,
      top: 0,
      width: 300,
    })
  })

  it('maps displayed canvas coordinates to source image pixels', () => {
    expect(mapCanvasPointToImagePixel(
      { x: 320, y: 240 },
      { height: 480, width: 640 },
      { height: 1080, width: 1920 },
    )).toEqual({ x: 960, y: 540 })

    expect(mapCanvasPointToImagePixel(
      { x: 640, y: 480 },
      { height: 480, width: 640 },
      { height: 1080, width: 1920 },
    )).toEqual({ x: 1919, y: 1079 })
  })

  it('maps pointer coordinates through the rendered canvas rect after layout zoom', () => {
    const mount = document.createElement('div')
    const container = document.createElement('div')
    const canvas = document.createElement('canvas')
    container.className = 'fp-canvas-mount'
    canvas.className = 'lower-canvas'
    container.append(canvas)
    mount.append(container)
    document.body.append(mount)

    setRect(canvas, rect(200, 100, 1024, 1024))

    const point = mapPointerToImagePixel(
      { clientX: 200 + 1024 * 0.72, clientY: 100 + 1024 * 0.38 },
      mount,
      { height: 128, width: 128 },
    )
    expect(point?.x).toBeCloseTo(128 * 0.72, 8)
    expect(point?.y).toBeCloseTo(128 * 0.38, 8)
  })

  it('rescales existing measurements when the canvas frame changes size', () => {
    expect(scaleCanvasPoints(
      [{ x: 10, y: 20 }, { x: 30, y: 40 }],
      { height: 100, width: 100 },
      { height: 200, width: 50 },
    )).toEqual([
      { x: 5, y: 40 },
      { x: 15, y: 80 },
    ])
  })
})
