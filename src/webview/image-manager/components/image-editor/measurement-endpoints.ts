import type { MeasurementEndpoints, MeasurementEndpointStyle, PathObject, Point } from './fabric-photo/core/model/doc'

export const DEFAULT_MEASUREMENT_ENDPOINT_STYLE: MeasurementEndpointStyle = 'none'

export function defaultMeasurementEndpointSize(strokeWidth: number): number {
  return Math.max(8, strokeWidth * 4)
}

export function measurementEndpointSettings(object: Pick<PathObject, 'measurementEndpoints' | 'strokeWidth'>): Required<MeasurementEndpoints> {
  const saved = object.measurementEndpoints
  return {
    start: saved?.start ?? DEFAULT_MEASUREMENT_ENDPOINT_STYLE,
    end: saved?.end ?? DEFAULT_MEASUREMENT_ENDPOINT_STYLE,
    size: saved?.size !== undefined && Number.isFinite(saved.size) && saved.size > 0
      ? saved.size
      : defaultMeasurementEndpointSize(object.strokeWidth),
  }
}

export interface MeasurementEndpointGeometry {
  style: MeasurementEndpointStyle
  tip: Point
  towardLine: Point
  size: number
}

export function measurementEndpointGeometries(object: PathObject, points = object.measurementPoints ?? []): MeasurementEndpointGeometry[] {
  if (object.measurementKind !== 'line' || points.length < 2)
    return []
  const settings = measurementEndpointSettings(object)
  const firstDirection = points.find(point => point.x !== points[0].x || point.y !== points[0].y) ?? points[1]
  const last = points[points.length - 1]
  const lastDirection = [...points].reverse().find(point => point.x !== last.x || point.y !== last.y) ?? points[points.length - 2]
  return [
    { style: settings.start, tip: points[0], towardLine: firstDirection, size: settings.size },
    { style: settings.end, tip: last, towardLine: lastDirection, size: settings.size },
  ].filter(endpoint => endpoint.style !== 'none')
}

export function endpointAxes(endpoint: MeasurementEndpointGeometry) {
  const dx = endpoint.towardLine.x - endpoint.tip.x
  const dy = endpoint.towardLine.y - endpoint.tip.y
  const length = Math.hypot(dx, dy)
  const tangent = length > 0 ? { x: dx / length, y: dy / length } : { x: 1, y: 0 }
  return { tangent, normal: { x: -tangent.y, y: tangent.x } }
}

export function measurementEndpointBounds(object: PathObject, points = object.measurementPoints ?? []) {
  const geometries = measurementEndpointGeometries(object, points)
  if (geometries.length === 0)
    return null
  const padding = object.strokeWidth / 2
  const bounds = geometries.map((endpoint) => {
    const { tangent, normal } = endpointAxes(endpoint)
    const half = endpoint.size / 2
    const samples = endpoint.style === 'filled-arrow' || endpoint.style === 'simple-arrow'
      ? [
          endpoint.tip,
          { x: endpoint.tip.x + tangent.x * endpoint.size + normal.x * half, y: endpoint.tip.y + tangent.y * endpoint.size + normal.y * half },
          { x: endpoint.tip.x + tangent.x * endpoint.size - normal.x * half, y: endpoint.tip.y + tangent.y * endpoint.size - normal.y * half },
        ]
      : endpoint.style === 'bar'
        ? [
            { x: endpoint.tip.x + normal.x * half, y: endpoint.tip.y + normal.y * half },
            { x: endpoint.tip.x - normal.x * half, y: endpoint.tip.y - normal.y * half },
          ]
        : [
            { x: endpoint.tip.x - half, y: endpoint.tip.y - half },
            { x: endpoint.tip.x + half, y: endpoint.tip.y + half },
          ]
    const xs = samples.map(point => point.x)
    const ys = samples.map(point => point.y)
    return {
      left: Math.min(...xs) - padding,
      top: Math.min(...ys) - padding,
      right: Math.max(...xs) + padding,
      bottom: Math.max(...ys) + padding,
    }
  })
  const left = Math.min(...bounds.map(bound => bound.left))
  const top = Math.min(...bounds.map(bound => bound.top))
  const right = Math.max(...bounds.map(bound => bound.right))
  const bottom = Math.max(...bounds.map(bound => bound.bottom))
  return { left, top, width: right - left, height: bottom - top }
}
