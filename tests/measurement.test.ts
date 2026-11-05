import { describe, expect, it } from 'vitest'
import { anglePointsFromEdges, buildMeasurementPath, deleteMeasurementPoint, getActiveNodeRadius, measureAngle, measureAngleByEdges, measureAngleByThreePoints, measureEllipsePoints, measureLine, measurePolygonArea, measurePolygonPerimeter, normalizeMeasurementPoints, nudgePoint } from '~/webview/image-manager/components/image-editor/measurement'

describe('measurement', () => {
  it('measures polyline length', () => {
    expect(measureLine([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 6, y: 8 }])).toBe(10)
  })

  it('measures open line segments without closing them', () => {
    expect(measureLine([{ x: -1, y: -1 }, { x: -1, y: 2 }, { x: 3, y: 2 }])).toBe(7)
  })

  it('measures polygon area', () => {
    expect(measurePolygonArea([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }])).toBe(12)
    expect(measurePolygonArea([{ x: 0, y: 3 }, { x: 4, y: 3 }, { x: 4, y: 0 }, { x: 0, y: 0 }])).toBe(12)
  })

  it('measures concave polygon area independent of winding direction', () => {
    const concave = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 2, y: 2 }, { x: 0, y: 4 }]
    expect(measurePolygonArea(concave)).toBe(12)
    expect(measurePolygonArea([...concave].reverse())).toBe(12)
  })

  it('measures polygon perimeter', () => {
    expect(measurePolygonPerimeter([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }])).toBe(14)
  })

  it('normalizes legacy ellipse corners and builds a cubic path', () => {
    const points = normalizeMeasurementPoints('ellipse', [{ x: 10, y: 20 }, { x: 50, y: 40 }])
    expect(points).toEqual([{ x: 30, y: 30 }, { x: 50, y: 30 }, { x: 30, y: 40 }])
    expect(buildMeasurementPath('ellipse', points)).toMatch(/^M .* C .* C .* C .* C .* Z$/)
    expect(measureEllipsePoints(points).area).toBeCloseTo(Math.PI * 20 * 10, 8)
  })

  it('measures an affine ellipse from conjugate radii', () => {
    const points = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 3 }]
    const measured = measureEllipsePoints(points)
    expect(measured.area).toBeCloseTo(Math.PI * 12, 8)
    expect(measured.perimeter).toBeGreaterThan(0)
  })

  it('measures angles from three points or two edges', () => {
    expect(measureAngleByThreePoints({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90, 8)
    expect(measureAngleByEdges([{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBeCloseTo(45, 8)
    expect(measureAngle([{ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }])).toBeCloseTo(180, 8)
  })

  it('measures angles from existing connected edges regardless of endpoint order', () => {
    const a = { x: 1, y: 0 }
    const vertex = { x: 0, y: 0 }
    const c = { x: 0, y: 1 }

    expect(measureAngleByEdges([a, vertex], [vertex, c])).toBeCloseTo(90, 8)
    expect(measureAngleByEdges([vertex, a], [c, vertex])).toBeCloseTo(90, 8)
    expect(measureAngleByEdges([a, vertex], [c, vertex])).toBeCloseTo(90, 8)
  })

  it('extracts three angle points from connected existing edges', () => {
    const a = { x: 1, y: 0 }
    const vertex = { x: 0, y: 0 }
    const c = { x: 0, y: 1 }

    expect(anglePointsFromEdges([a, vertex], [vertex, c])).toEqual([a, vertex, c])
    expect(anglePointsFromEdges([vertex, a], [c, vertex])).toEqual([a, vertex, c])
    expect(anglePointsFromEdges([a, { x: 2, y: 0 }], [{ x: 0, y: 1 }, c])).toBeNull()
  })

  it('falls back to directional edge angle when edges do not share an endpoint', () => {
    expect(measureAngleByEdges([{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 3, y: 3 }, { x: 3, y: 4 }])).toBeCloseTo(90, 8)
  })

  it('returns zero for incomplete or degenerate angles', () => {
    expect(measureAngle([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(0)
    expect(measureAngleByEdges([{ x: 0, y: 0 }, { x: 0, y: 0 }], [{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(0)
  })

  it('closes polygon perimeter back to the first point', () => {
    expect(measurePolygonPerimeter([{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }])).toBe(12)
  })

  it('nudges points with arrow keys', () => {
    expect(nudgePoint({ x: 5, y: 5 }, 'ArrowLeft')).toEqual({ x: 4, y: 5 })
    expect(nudgePoint({ x: 5, y: 5 }, 'ArrowRight')).toEqual({ x: 6, y: 5 })
    expect(nudgePoint({ x: 5, y: 5 }, 'ArrowUp')).toEqual({ x: 5, y: 4 })
    expect(nudgePoint({ x: 5, y: 5 }, 'ArrowDown', 10)).toEqual({ x: 5, y: 15 })
  })

  it('keeps unsupported nudge keys as a no-op', () => {
    const point = { x: 5, y: 5 }
    expect(nudgePoint(point, 'KeyA')).toBe(point)
  })

  it('returns zero for insufficient measurement points', () => {
    expect(measureLine([{ x: 0, y: 0 }])).toBe(0)
    expect(measureAngle([{ x: 0, y: 0 }])).toBe(0)
    expect(measurePolygonArea([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(0)
    expect(measurePolygonPerimeter([{ x: 0, y: 0 }])).toBe(0)
  })

  it('keeps active node size tied to the node size in both directions', () => {
    expect(getActiveNodeRadius(8)).toBe(9.5)
    expect(getActiveNodeRadius(2)).toBe(3.5)
  })

  it('deletes selected points from line, polygon, and angle measurements', () => {
    const points = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }, { x: 0, y: 4 }]

    expect(deleteMeasurementPoint(points, 1)).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 4 },
      { x: 0, y: 4 },
    ])
    expect(deleteMeasurementPoint(points.slice(0, 2), 0)).toEqual([{ x: 3, y: 0 }])
    expect(deleteMeasurementPoint(points.slice(0, 3), 2)).toEqual([{ x: 0, y: 0 }, { x: 3, y: 0 }])
    expect(deleteMeasurementPoint(points, -1)).toBe(points)
    expect(deleteMeasurementPoint(points, 10)).toBe(points)
  })
})
