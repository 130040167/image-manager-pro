export type Point = {
  x: number
  y: number
}

export function getActiveNodeRadius(nodeRadius: number, activeOffset = 1.5) {
  return Math.max(1, nodeRadius + activeOffset)
}

export function deleteMeasurementPoint<T extends Point>(points: T[], index: number): T[] {
  if (!Number.isInteger(index) || index < 0 || index >= points.length)
    return points
  return points.filter((_, i) => i !== index)
}

export function measureLine(points: Point[]) {
  if (points.length < 2)
    return 0
  let length = 0
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  }
  return length
}

export function measurePolygonArea(points: Point[]) {
  if (points.length < 3)
    return 0
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const current = points[i]
    const next = points[(i + 1) % points.length]
    area += current.x * next.y - next.x * current.y
  }
  return Math.abs(area) / 2
}

export function measureEllipse(width: number, height: number) {
  const radiusX = Math.abs(width) / 2
  const radiusY = Math.abs(height) / 2
  const area = Math.PI * radiusX * radiusY
  const perimeter = Math.PI * (3 * (radiusX + radiusY) - Math.sqrt((3 * radiusX + radiusY) * (radiusX + 3 * radiusY)))
  return { area, perimeter }
}

export function normalizeMeasurementPoints(kind: 'angle' | 'ellipse' | 'line' | 'polygon', points: Point[]): Point[] {
  if (kind !== 'ellipse' || points.length !== 2)
    return points
  const [start, end] = points
  const center = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  }
  return [
    center,
    { x: center.x + Math.abs(end.x - start.x) / 2, y: center.y },
    { x: center.x, y: center.y + Math.abs(end.y - start.y) / 2 },
  ]
}

export function measureEllipsePoints(points: Point[]) {
  const normalized = normalizeMeasurementPoints('ellipse', points)
  if (normalized.length < 3)
    return { area: 0, perimeter: 0 }
  const [center, radiusXPoint, radiusYPoint] = normalized
  const ux = radiusXPoint.x - center.x
  const uy = radiusXPoint.y - center.y
  const vx = radiusYPoint.x - center.x
  const vy = radiusYPoint.y - center.y
  const trace = ux * ux + uy * uy + vx * vx + vy * vy
  const determinant = ux * vy - uy * vx
  const discriminant = Math.sqrt(Math.max(0, trace * trace - 4 * determinant * determinant))
  const radiusA = Math.sqrt(Math.max(0, (trace + discriminant) / 2))
  const radiusB = Math.sqrt(Math.max(0, (trace - discriminant) / 2))
  return {
    area: Math.PI * Math.abs(determinant),
    perimeter: measureEllipse(radiusA * 2, radiusB * 2).perimeter,
  }
}

function ellipsePath(points: Point[]) {
  const normalized = normalizeMeasurementPoints('ellipse', points)
  if (normalized.length < 3)
    return ''
  const [center, radiusXPoint, radiusYPoint] = normalized
  const ux = radiusXPoint.x - center.x
  const uy = radiusXPoint.y - center.y
  const vx = radiusYPoint.x - center.x
  const vy = radiusYPoint.y - center.y
  if ((!ux && !uy) || (!vx && !vy))
    return ''
  const kappa = 0.5522847498307936
  const point = (uScale: number, vScale: number) => ({
    x: center.x + ux * uScale + vx * vScale,
    y: center.y + uy * uScale + vy * vScale,
  })
  const p0 = point(1, 0)
  const segments = [
    [point(1, kappa), point(kappa, 1), point(0, 1)],
    [point(-kappa, 1), point(-1, kappa), point(-1, 0)],
    [point(-1, -kappa), point(-kappa, -1), point(0, -1)],
    [point(kappa, -1), point(1, -kappa), p0],
  ]
  return `M ${p0.x} ${p0.y} ${segments.map(([c1, c2, end]) => `C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${end.x} ${end.y}`).join(' ')} Z`
}

function angleArcPath(points: Point[], radius: number) {
  if (points.length < 3)
    return ''
  const [startPoint, vertex, endPoint] = points
  const startAngle = Math.atan2(startPoint.y - vertex.y, startPoint.x - vertex.x)
  const endAngle = Math.atan2(endPoint.y - vertex.y, endPoint.x - vertex.x)
  let delta = endAngle - startAngle
  while (delta <= -Math.PI)
    delta += Math.PI * 2
  while (delta > Math.PI)
    delta -= Math.PI * 2
  const start = {
    x: vertex.x + Math.cos(startAngle) * radius,
    y: vertex.y + Math.sin(startAngle) * radius,
  }
  const end = {
    x: vertex.x + Math.cos(endAngle) * radius,
    y: vertex.y + Math.sin(endAngle) * radius,
  }
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 0 ${delta >= 0 ? 1 : 0} ${end.x} ${end.y}`
}

export function buildMeasurementPath(kind: 'angle' | 'ellipse' | 'line' | 'polygon', points: Point[], angleArcRadius = 22, arcStyle: 'none' | 'single' | 'double' = 'single') {
  if (points.length < 2)
    return ''
  if (kind === 'ellipse')
    return ellipsePath(points)
  const line = `M ${points.map(point => `${point.x} ${point.y}`).join(' L ')}`
  if (kind === 'polygon' && points.length >= 3)
    return `${line} Z`
  if (kind === 'angle' && points.length >= 3 && arcStyle !== 'none') {
    const radius = Math.max(1, angleArcRadius)
    const inner = arcStyle === 'double' ? ` ${angleArcPath(points, Math.max(1, radius - Math.min(5, radius / 3)))}` : ''
    return `${line} ${angleArcPath(points, radius)}${inner}`
  }
  return line
}

/** Handle lies on the minor-angle bisector, so dragging changes the arc radius. */
export function angleArcHandle(points: Point[], radius = 22): Point | null {
  if (points.length < 3)
    return null
  const [a, vertex, b] = points
  const start = Math.atan2(a.y - vertex.y, a.x - vertex.x)
  const end = Math.atan2(b.y - vertex.y, b.x - vertex.x)
  const delta = Math.atan2(Math.sin(end - start), Math.cos(end - start))
  return { x: vertex.x + Math.cos(start + delta / 2) * radius, y: vertex.y + Math.sin(start + delta / 2) * radius }
}

export function measurePolygonPerimeter(points: Point[]) {
  if (points.length < 3)
    return 0
  return measureLine([...points, points[0]])
}

function samePoint(a: Point, b: Point, epsilon = 1e-6) {
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon
}

export function anglePointsFromEdges(edgeA: [Point, Point], edgeB: [Point, Point]): [Point, Point, Point] | null {
  const [a0, a1] = edgeA
  const [b0, b1] = edgeB
  if (samePoint(a0, b0))
    return [a1, a0, b1]
  if (samePoint(a0, b1))
    return [a1, a0, b0]
  if (samePoint(a1, b0))
    return [a0, a1, b1]
  if (samePoint(a1, b1))
    return [a0, a1, b0]
  return null
}

function measureAngleFromVectors(ax: number, ay: number, bx: number, by: number) {
  const lenA = Math.hypot(ax, ay)
  const lenB = Math.hypot(bx, by)
  if (!lenA || !lenB)
    return 0
  const cosine = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (lenA * lenB)))
  return Math.acos(cosine) * 180 / Math.PI
}

export function measureAngleByThreePoints(a: Point, vertex: Point, c: Point) {
  return measureAngleFromVectors(a.x - vertex.x, a.y - vertex.y, c.x - vertex.x, c.y - vertex.y)
}

export function measureAngleByEdges(edgeA: [Point, Point], edgeB: [Point, Point]) {
  const connected = anglePointsFromEdges(edgeA, edgeB)
  if (connected)
    return measureAngleByThreePoints(connected[0], connected[1], connected[2])
  const [a0, a1] = edgeA
  const [b0, b1] = edgeB
  return measureAngleFromVectors(a1.x - a0.x, a1.y - a0.y, b1.x - b0.x, b1.y - b0.y)
}

export function measureAngle(points: Point[]) {
  if (points.length < 3)
    return 0
  return measureAngleByThreePoints(points[0], points[1], points[2])
}

export function nudgePoint(point: Point, key: string, step = 1): Point {
  switch (key) {
    case 'ArrowDown':
      return { ...point, y: point.y + step }
    case 'ArrowLeft':
      return { ...point, x: point.x - step }
    case 'ArrowRight':
      return { ...point, x: point.x + step }
    case 'ArrowUp':
      return { ...point, y: point.y - step }
    default:
      return point
  }
}
