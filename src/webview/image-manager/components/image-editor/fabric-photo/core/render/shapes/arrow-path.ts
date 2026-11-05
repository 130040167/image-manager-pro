import type { PathProps, TMat2D, TOptions } from 'fabric'
import type { ArrowHeadStyle, PathObject, Point } from '../../model/doc'
import { Point as FabricPoint, Path, util } from 'fabric'
import { ROUND_STROKE } from '../stroke-style'

export const DEFAULT_ARROW_HEAD_LENGTH = 20
export const DEFAULT_ARROW_HEAD_WIDTH = 20

export interface ArrowGeometry {
  start: Point
  end: Point
  startHead: ArrowHeadStyle
  endHead: ArrowHeadStyle
  headLength: number
  headWidth: number
}

function finitePositive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback
}

export function arrowGeometryFromObject(obj: PathObject): ArrowGeometry | null {
  if (obj.tool !== 'arrow' || obj.arrowStart === undefined || obj.arrowEnd === undefined) {
    return null
  }
  return {
    start: obj.arrowStart,
    end: obj.arrowEnd,
    startHead: obj.startHead ?? 'none',
    endHead: obj.endHead ?? 'filled',
    headLength: finitePositive(obj.headLength, DEFAULT_ARROW_HEAD_LENGTH),
    headWidth: finitePositive(obj.headWidth, DEFAULT_ARROW_HEAD_WIDTH),
  }
}

export function arrowHeadPoints(tip: Point, towardShaft: Point, length: number, width: number): [Point, Point] {
  const dx = towardShaft.x - tip.x
  const dy = towardShaft.y - tip.y
  const magnitude = Math.hypot(dx, dy)
  if (magnitude === 0) {
    return [tip, tip]
  }
  const ux = dx / magnitude
  const uy = dy / magnitude
  const baseX = tip.x + ux * length
  const baseY = tip.y + uy * length
  const halfWidth = width / 2
  return [
    { x: baseX - uy * halfWidth, y: baseY + ux * halfWidth },
    { x: baseX + uy * halfWidth, y: baseY - ux * halfWidth },
  ]
}

export function arrowHeadControlPoints(start: Point, end: Point, side: 'start' | 'end', headLength: number, headWidth: number) {
  const shaftLength = Math.hypot(end.x - start.x, end.y - start.y) || 1
  const shaftX = (end.x - start.x) / shaftLength
  const shaftY = (end.y - start.y) / shaftLength
  const tip = side === 'start' ? start : end
  const towardX = side === 'start' ? shaftX : -shaftX
  const towardY = side === 'start' ? shaftY : -shaftY
  const base = { x: tip.x + towardX * headLength, y: tip.y + towardY * headLength }
  const wing = { x: base.x - shaftY * headWidth / 2, y: base.y + shaftX * headWidth / 2 }
  return { tip, base, wing, towardX, towardY }
}

function appendHead(parts: string[], tip: Point, towardShaft: Point, style: ArrowHeadStyle, length: number, width: number): void {
  if (style === 'none') {
    return
  }
  const [wing1, wing2] = arrowHeadPoints(tip, towardShaft, length, width)
  if (style === 'filled') {
    parts.push(`M ${tip.x} ${tip.y} L ${wing1.x} ${wing1.y} L ${wing2.x} ${wing2.y} Z`)
  }
  else {
    parts.push(`M ${wing1.x} ${wing1.y} L ${tip.x} ${tip.y} L ${wing2.x} ${wing2.y}`)
  }
}

export function buildArrowPath(geometry: ArrowGeometry): string {
  const { start, end, startHead, endHead, headLength, headWidth } = geometry
  const parts = [`M ${start.x} ${start.y} L ${end.x} ${end.y}`]
  appendHead(parts, start, end, startHead, headLength, headWidth)
  appendHead(parts, end, start, endHead, headLength, headWidth)
  return parts.join(' ')
}

/** Scale both head dimensions by the perpendicular scale, preserving their ratio. */
export function transformArrowGeometry(geometry: ArrowGeometry, matrix: TMat2D, offset: Point): ArrowGeometry {
  const transform = (point: Point) => new FabricPoint(point.x - offset.x, point.y - offset.y).transform(matrix)
  const start = transform(geometry.start)
  const end = transform(geometry.end)
  const oldLength = Math.hypot(geometry.end.x - geometry.start.x, geometry.end.y - geometry.start.y)
  const tangentScale = oldLength > 0 ? Math.hypot(end.x - start.x, end.y - start.y) / oldLength : 1
  const normalScale = tangentScale > 1e-8 ? Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]) / tangentScale : 1
  return { ...geometry, start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y }, headLength: geometry.headLength * normalScale, headWidth: geometry.headWidth * normalScale }
}

/** Keep head dimensions stable during live non-uniform scaling without mutating Fabric's transform baseline. */
export class ArrowPath extends Path {
  private geometry: ArrowGeometry

  constructor(path: string, options: TOptions<PathProps>, geometry: ArrowGeometry) {
    // Acute wing angles exceed the canvas miter limit and are rendered as
    // bevels. Round joins/caps preserve both wings at every head aspect ratio.
    super(path, { ...options, objectCaching: false, ...ROUND_STROKE })
    this.geometry = geometry
  }

  setArrowModel(obj: PathObject): void {
    const geometry = arrowGeometryFromObject(obj)
    if (geometry !== null) {
      this.geometry = geometry
    }
  }

  override _render(ctx: CanvasRenderingContext2D): void {
    const matrix = this.calcTransformMatrix()
    const inverse = util.invertTransform(matrix)
    const transformedGeometry = transformArrowGeometry(this.geometry, matrix, this.pathOffset)
    const toLocal = (point: Point): Point => {
      const transformed = new FabricPoint(point.x, point.y).transform(inverse)
      return { x: transformed.x, y: transformed.y }
    }
    const { start, end } = transformedGeometry
    const localStart = toLocal(start)
    const localEnd = toLocal(end)

    ctx.beginPath()
    ctx.moveTo(localStart.x, localStart.y)
    ctx.lineTo(localEnd.x, localEnd.y)
    this._renderStroke(ctx)
    this.renderHead(ctx, start, end, this.geometry.startHead, toLocal, transformedGeometry)
    this.renderHead(ctx, end, start, this.geometry.endHead, toLocal, transformedGeometry)
  }

  private renderHead(
    ctx: CanvasRenderingContext2D,
    tip: Point,
    towardShaft: Point,
    style: ArrowHeadStyle,
    toLocal: (point: Point) => Point,
    dimensions: Pick<ArrowGeometry, 'headLength' | 'headWidth'>,
  ): void {
    if (style === 'none') {
      return
    }
    const [worldWing1, worldWing2] = arrowHeadPoints(tip, towardShaft, dimensions.headLength, dimensions.headWidth)
    const localTip = toLocal(tip)
    const localWing1 = toLocal(worldWing1)
    const localWing2 = toLocal(worldWing2)
    ctx.beginPath()
    ctx.moveTo(localWing1.x, localWing1.y)
    ctx.lineTo(localTip.x, localTip.y)
    ctx.lineTo(localWing2.x, localWing2.y)
    if (style === 'filled') {
      ctx.closePath()
      this._renderFill(ctx)
    }
    // Dashes belong to the shaft; an open head must remain open and legible.
    const dash = this.strokeDashArray
    this.strokeDashArray = null
    this._renderStroke(ctx)
    this.strokeDashArray = dash
  }
}
