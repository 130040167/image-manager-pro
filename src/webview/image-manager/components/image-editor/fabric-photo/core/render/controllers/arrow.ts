import type { Path, TPointerEventInfo } from 'fabric'
import type { PathObject } from '../../model/doc'
import type { ArrowGeometry } from '../shapes/arrow-path'
import type { BrushSetting, Controller, ControllerContext } from './controller'
import { createId } from '../../model/id'
import { AddObject } from '../../steps/object-steps'
import { Transaction } from '../../transform/transaction'
import { probePathPosition } from '../object-factory'
import {

  ArrowPath,
  buildArrowPath,
  DEFAULT_ARROW_HEAD_LENGTH,
  DEFAULT_ARROW_HEAD_WIDTH,
} from '../shapes/arrow-path'
import { ROUND_STROKE, smoothStrokeDash } from '../stroke-style'

const DEFAULT_WIDTH = 1
const DEFAULT_COLOR = 'rgba(0, 0, 0, 0.5)'
/** 旧 arrow.ts 的拖动判定阈值（曼哈顿距离），小于视为误触不落对象。 */
const DRAG_THRESHOLD = 5

export interface ArrowBrushSetting extends BrushSetting {
  startHead?: ArrowGeometry['startHead']
  endHead?: ArrowGeometry['endHead']
  headLength?: number
  headWidth?: number
}

/**
 * arrow controller（mode 'arrow'，由 Editor.startArrowDrawing 进入）：
 * - mouse:down 记尾点；mouse:move 超阈值后以单个 fabric.Path 预览（线+三角箭头合成 path）；
 *   mouse:up 移除预览 → dispatch AddObject(PathObject { tool:'arrow', path: 合成 path }）
 *   → fire objectAdded
 * - crosshair 光标；其他对象 selectable/evented 由 renderer 在非 normal 模式统一关闭
 * 移植自旧 src/modules/arrow.ts（旧为 Line+Triangle+Circle 的 Group，落盘改为单 PathObject）。
 */
export class ArrowController implements Controller {
  readonly mode = 'arrow' as const

  private ctx: ControllerContext | undefined
  private active = false
  private width = DEFAULT_WIDTH
  private color = DEFAULT_COLOR
  private dash: number[] | undefined
  private headWidth = DEFAULT_ARROW_HEAD_WIDTH
  private headLength = DEFAULT_ARROW_HEAD_LENGTH
  private startHead: ArrowGeometry['startHead'] = 'none'
  private endHead: ArrowGeometry['endHead'] = 'filled'
  private preview: Path | undefined
  private dragging = false
  private startX = 0
  private startY = 0

  /** 更新笔刷配置（影响下一次落盘的对象样式）。 */
  setBrush(setting: ArrowBrushSetting): void {
    if (setting.width !== undefined) {
      this.width = setting.width
    }
    if (setting.color !== undefined) {
      this.color = setting.color
    }
    if (setting.dash !== undefined) {
      this.dash = setting.dash
    }
    if (setting.startHead !== undefined)
      this.startHead = setting.startHead
    if (setting.endHead !== undefined)
      this.endHead = setting.endHead
    if (setting.headLength !== undefined)
      this.headLength = Math.max(1, setting.headLength)
    if (setting.headWidth !== undefined)
      this.headWidth = Math.max(1, setting.headWidth)
  }

  private makePreview(geometry: ArrowGeometry): Path {
    return new ArrowPath(buildArrowPath(geometry), {
      stroke: this.color,
      strokeWidth: this.width,
      fill: this.color,
      strokeDashArray: smoothStrokeDash(this.dash, this.width),
      ...ROUND_STROKE,
      strokeUniform: true,
      selectable: false,
      evented: false,
    }, geometry)
  }

  private replacePreview(geometry: ArrowGeometry): void {
    const ctx = this.ctx
    if (ctx === undefined) {
      return
    }
    if (this.preview !== undefined) {
      ctx.canvas.remove(this.preview)
    }
    this.preview = this.makePreview(geometry)
    ctx.canvas.add(this.preview)
    ctx.canvas.requestRenderAll()
  }

  private clearPreview(): void {
    if (this.ctx !== undefined && this.preview !== undefined) {
      this.ctx.canvas.remove(this.preview)
    }
    this.preview = undefined
  }

  private readonly onMouseDown = (event: TPointerEventInfo): void => {
    if (this.ctx === undefined) {
      return
    }
    this.dragging = true
    this.startX = event.scenePoint.x
    this.startY = event.scenePoint.y
  }

  private readonly onMouseMove = (event: TPointerEventInfo): void => {
    if (!this.dragging || this.ctx === undefined) {
      return
    }
    const { x, y } = event.scenePoint
    if (Math.abs(x - this.startX) + Math.abs(y - this.startY) <= DRAG_THRESHOLD) {
      return
    }
    this.replacePreview(this.geometryAt(x, y))
  }

  private readonly onMouseUp = (event: TPointerEventInfo): void => {
    const ctx = this.ctx
    if (!this.dragging || ctx === undefined) {
      return
    }
    this.dragging = false
    this.clearPreview()
    const x = event.scenePoint.x
    const y = event.scenePoint.y
    if (Math.abs(x - this.startX) + Math.abs(y - this.startY) <= DRAG_THRESHOLD) {
      return // 未有效拖动，不落对象
    }
    const geometry = this.geometryAt(x, y)
    const path = buildArrowPath(geometry)
    const { left, top } = probePathPosition(path, this.width)
    const object: PathObject = {
      id: createId(),
      kind: 'path',
      tool: 'arrow',
      path,
      left,
      top,
      angle: 0,
      scaleX: 1,
      scaleY: 1,
      stroke: this.color,
      strokeWidth: this.width,
      fill: this.color,
      strokeDash: this.dash,
      arrowStart: geometry.start,
      arrowEnd: geometry.end,
      startHead: geometry.startHead,
      endHead: geometry.endHead,
      headLength: geometry.headLength,
      headWidth: geometry.headWidth,
    }
    ctx.dispatch(new Transaction(ctx.getState()).addStep(new AddObject(object)).setSelection([object.id]))
    ctx.fire('objectAdded', { object })
  }

  private geometryAt(x: number, y: number): ArrowGeometry {
    return {
      start: { x: this.startX, y: this.startY },
      end: { x, y },
      startHead: this.startHead,
      endHead: this.endHead,
      headLength: this.headLength,
      headWidth: this.headWidth,
    }
  }

  activate(ctx: ControllerContext): void {
    if (this.active) {
      return
    }
    this.active = true
    this.ctx = ctx
    const { canvas } = ctx
    canvas.defaultCursor = 'crosshair'
    canvas.on('mouse:down', this.onMouseDown)
    canvas.on('mouse:move', this.onMouseMove)
    canvas.on('mouse:up', this.onMouseUp)
  }

  deactivate(): void {
    if (!this.active || this.ctx === undefined) {
      return
    }
    this.active = false
    const { canvas } = this.ctx
    canvas.off('mouse:down', this.onMouseDown)
    canvas.off('mouse:move', this.onMouseMove)
    canvas.off('mouse:up', this.onMouseUp)
    canvas.defaultCursor = 'default'
    this.dragging = false
    this.clearPreview()
    this.ctx = undefined
  }
}
