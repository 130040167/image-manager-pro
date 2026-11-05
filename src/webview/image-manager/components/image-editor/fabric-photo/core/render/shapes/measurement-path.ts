import type { PathProps } from 'fabric'
import type { PathObject } from '../../model/doc'
import { Path, Point, util } from 'fabric'
import { endpointAxes, measurementEndpointBounds, measurementEndpointGeometries } from '../../../../measurement-endpoints'
import { measurementCanvasLabelLayouts, measurementLabelFontFamily, measurementLabelSettings } from '../../../../measurement-label'

/** Text is part of the Fabric projection, including exports; handles live in SVG. */
export class MeasurementPath extends Path {
  private measurementModel: PathObject

  constructor(path: string, options: Partial<PathProps>, model: PathObject) {
    super(path, { ...options, objectCaching: false })
    this.measurementModel = model
  }

  setMeasurementModel(model: PathObject) {
    this.measurementModel = model
    this.dirty = true
  }

  getAnnotationBounds() {
    const model = this.measurementModel
    if (!model || !measurementLabelSettings(model).visible)
      return null
    const ctx = this.canvas?.getContext()
    const points = this.transformedPoints()
    const layouts = ctx
      ? (() => {
          const global = measurementLabelSettings(model)
          ctx.save()
          ctx.font = `500 ${global.fontSize}px ${measurementLabelFontFamily(global.fontFamily)}`
          const result = measurementCanvasLabelLayouts(model, points, (text, settings) => {
            if (settings)
              ctx.font = `500 ${settings.fontSize}px ${measurementLabelFontFamily(settings.fontFamily)}`
            return ctx.measureText(text).width
          })
          ctx.restore()
          return result
        })()
      : measurementCanvasLabelLayouts(model, points)
    if (layouts.length === 0)
      return null
    const first = layouts[0]
    const left = Math.min(...layouts.map(layout => layout.left))
    const top = Math.min(...layouts.map(layout => layout.top))
    const right = Math.max(...layouts.map(layout => layout.left + layout.width))
    const bottom = Math.max(...layouts.map(layout => layout.top + layout.height))
    return { ...first, left, top, width: right - left, height: bottom - top }
  }

  private transformedPoints() {
    const matrix = this.calcTransformMatrix()
    return (this.measurementModel.measurementPoints ?? []).map(point => util.transformPoint(new Point(point.x - this.pathOffset.x, point.y - this.pathOffset.y), matrix))
  }

  override getBoundingRect() {
    const pathBounds = super.getBoundingRect()
    const endpointBounds = this.measurementModel === undefined ? null : measurementEndpointBounds(this.measurementModel, this.transformedPoints())
    if (endpointBounds === null)
      return pathBounds
    const left = Math.min(pathBounds.left, endpointBounds.left)
    const top = Math.min(pathBounds.top, endpointBounds.top)
    const right = Math.max(pathBounds.left + pathBounds.width, endpointBounds.left + endpointBounds.width)
    const bottom = Math.max(pathBounds.top + pathBounds.height, endpointBounds.top + endpointBounds.height)
    return { left, top, width: right - left, height: bottom - top }
  }

  override isOnScreen() {
    if (super.isOnScreen())
      return true
    if (!this.canvas)
      return false
    const { tl, br } = this.canvas.vptCoords
    // End decorations and labels can remain visible after the axis leaves view.
    return [this.getBoundingRect(), this.getAnnotationBounds()].some(bounds => bounds && bounds.left <= br.x && bounds.top <= br.y && bounds.left + bounds.width >= tl.x && bounds.top + bounds.height >= tl.y)
  }

  _render(ctx: CanvasRenderingContext2D) {
    if (this.measurementModel?.measurementKind === 'angle')
      this.renderAngle(ctx)
    else if (this.measurementModel?.measurementKind === 'line')
      this.renderLine(ctx)
    else
      super._render(ctx)
    this.renderEndpoints(ctx)
    const model = this.measurementModel
    if (!model || !measurementLabelSettings(model).visible)
      return
    const matrix = this.calcTransformMatrix()
    const inverse = util.invertTransform([matrix[0], matrix[1], matrix[2], matrix[3], 0, 0])
    if (!inverse.every(Number.isFinite))
      return
    ctx.save()
    // Counter-transform the object's scaling/rotation. The viewport remains,
    // so text follows zoom but stays upright and the font doesn't stretch.
    ctx.transform(...inverse)
    ctx.translate(-matrix[4], -matrix[5])
    const points = this.transformedPoints()
    const global = measurementLabelSettings(model)
    ctx.font = `500 ${global.fontSize}px ${measurementLabelFontFamily(global.fontFamily)}`
    const layouts = measurementCanvasLabelLayouts(model, points, (text, settings) => {
      if (settings)
        ctx.font = `500 ${settings.fontSize}px ${measurementLabelFontFamily(settings.fontFamily)}`
      return ctx.measureText(text).width
    })
    layouts.forEach((box) => {
      const settings = box.settings
      ctx.font = `500 ${settings.fontSize}px ${measurementLabelFontFamily(settings.fontFamily)}`
      if (settings.background !== 'none') {
        ctx.save()
        ctx.globalAlpha *= settings.backgroundOpacity
        ctx.fillStyle = settings.background === 'custom' ? settings.backgroundColor : '#0f172a'
        ctx.beginPath()
        ctx.roundRect(box.left, box.top, box.width, box.height, Math.min(4, box.fontSize / 3))
        ctx.fill()
        ctx.restore()
      }
      ctx.fillStyle = settings.color
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      box.lines.forEach((line, index) => ctx.fillText(line, box.left + box.width / 2, box.top + box.paddingY + box.lineHeight * (index + 0.5)))
    })
    ctx.restore()
  }

  private renderLine(ctx: CanvasRenderingContext2D) {
    const model = this.measurementModel
    const points = this.transformedPoints()
    if (!model || points.length < 2)
      return
    const endpoints = measurementEndpointGeometries(model, points)
    const trimFor = (endpoint: (typeof endpoints)[number] | undefined) => {
      if (endpoint?.style === 'filled-arrow')
        return endpoint.size
      if (endpoint?.style === 'hollow-circle' || endpoint?.style === 'filled-circle')
        return endpoint.size / 2
      return 0
    }
    const startEndpoint = endpoints.find(endpoint => endpoint.tip.x === points[0].x && endpoint.tip.y === points[0].y)
    const last = points[points.length - 1]
    const endEndpoint = endpoints.find(endpoint => endpoint.tip.x === last.x && endpoint.tip.y === last.y)
    const startAxes = startEndpoint === undefined ? null : endpointAxes(startEndpoint)
    const endAxes = endEndpoint === undefined ? null : endpointAxes(endEndpoint)
    let startTrim = trimFor(startEndpoint)
    let endTrim = trimFor(endEndpoint)
    if (points.length === 2) {
      const length = Math.hypot(last.x - points[0].x, last.y - points[0].y)
      const total = startTrim + endTrim
      if (total > length && total > 0) {
        const ratio = length / total
        startTrim *= ratio
        endTrim *= ratio
      }
    }
    const start = startAxes === null ? points[0] : { x: points[0].x + startAxes.tangent.x * startTrim, y: points[0].y + startAxes.tangent.y * startTrim }
    const end = endAxes === null ? last : { x: last.x + endAxes.tangent.x * endTrim, y: last.y + endAxes.tangent.y * endTrim }
    const matrix = this.calcTransformMatrix()
    const inverse = util.invertTransform([matrix[0], matrix[1], matrix[2], matrix[3], 0, 0])
    if (!inverse.every(Number.isFinite))
      return
    ctx.save()
    ctx.transform(...inverse)
    ctx.translate(-matrix[4], -matrix[5])
    ctx.beginPath()
    ctx.moveTo(start.x, start.y)
    points.slice(1, -1).forEach(point => ctx.lineTo(point.x, point.y))
    ctx.lineTo(end.x, end.y)
    ctx.strokeStyle = model.stroke
    ctx.lineWidth = model.strokeWidth
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.setLineDash(this.strokeDashArray ?? [])
    ctx.stroke()
    ctx.restore()
  }

  private renderEndpoints(ctx: CanvasRenderingContext2D) {
    const model = this.measurementModel
    if (!model || model.measurementKind !== 'line')
      return
    const endpoints = measurementEndpointGeometries(model, this.transformedPoints())
    if (endpoints.length === 0)
      return
    const matrix = this.calcTransformMatrix()
    const inverse = util.invertTransform([matrix[0], matrix[1], matrix[2], matrix[3], 0, 0])
    if (!inverse.every(Number.isFinite))
      return
    ctx.save()
    // Draw in document coordinates: live non-uniform transforms move endpoints
    // without stretching their symbols or moving their tips off the measured points.
    ctx.transform(...inverse)
    ctx.translate(-matrix[4], -matrix[5])
    ctx.strokeStyle = model.stroke
    ctx.fillStyle = model.stroke
    ctx.lineWidth = model.strokeWidth
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.setLineDash([])
    endpoints.forEach((endpoint) => {
      const { tangent, normal } = endpointAxes(endpoint)
      const half = endpoint.size / 2
      if (endpoint.style === 'hollow-circle' || endpoint.style === 'filled-circle') {
        ctx.beginPath()
        ctx.arc(endpoint.tip.x, endpoint.tip.y, half, 0, Math.PI * 2)
        if (endpoint.style === 'filled-circle')
          ctx.fill()
        else
          ctx.stroke()
        return
      }
      if (endpoint.style === 'bar') {
        ctx.beginPath()
        ctx.moveTo(endpoint.tip.x + normal.x * half, endpoint.tip.y + normal.y * half)
        ctx.lineTo(endpoint.tip.x - normal.x * half, endpoint.tip.y - normal.y * half)
        ctx.stroke()
        return
      }
      const wing1 = { x: endpoint.tip.x + tangent.x * endpoint.size + normal.x * half, y: endpoint.tip.y + tangent.y * endpoint.size + normal.y * half }
      const wing2 = { x: endpoint.tip.x + tangent.x * endpoint.size - normal.x * half, y: endpoint.tip.y + tangent.y * endpoint.size - normal.y * half }
      ctx.beginPath()
      ctx.moveTo(wing1.x, wing1.y)
      ctx.lineTo(endpoint.tip.x, endpoint.tip.y)
      ctx.lineTo(wing2.x, wing2.y)
      if (endpoint.style === 'filled-arrow') {
        ctx.closePath()
        ctx.fill()
      }
      ctx.stroke()
    })
    ctx.restore()
  }

  private renderAngle(ctx: CanvasRenderingContext2D) {
    const points = this.transformedPoints()
    if (points.length < 2)
      return
    const matrix = this.calcTransformMatrix()
    const inverse = util.invertTransform([matrix[0], matrix[1], matrix[2], matrix[3], 0, 0])
    if (!inverse.every(Number.isFinite))
      return
    ctx.save()
    ctx.transform(...inverse)
    ctx.translate(-matrix[4], -matrix[5])
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)
    points.slice(1).forEach(point => ctx.lineTo(point.x, point.y))
    const arc = this.measurementModel.measurementArc ?? { style: 'single', radius: 22 }
    if (points.length >= 3 && arc.style !== 'none') {
      const [a, vertex, b] = points
      const start = Math.atan2(a.y - vertex.y, a.x - vertex.x)
      const end = Math.atan2(b.y - vertex.y, b.x - vertex.x)
      const delta = Math.atan2(Math.sin(end - start), Math.cos(end - start))
      const radius = Math.max(1, arc.radius)
      const radii = arc.style === 'double' ? [radius, Math.max(1, radius - Math.min(5, radius / 3))] : [radius]
      radii.forEach((r) => {
        ctx.moveTo(vertex.x + Math.cos(start) * r, vertex.y + Math.sin(start) * r)
        ctx.arc(vertex.x, vertex.y, r, start, start + delta, delta < 0)
      })
    }
    ctx.strokeStyle = this.measurementModel.stroke
    ctx.lineWidth = this.strokeWidth
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.setLineDash(this.strokeDashArray ?? [])
    ctx.stroke()
    ctx.restore()
  }
}
