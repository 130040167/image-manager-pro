import type { EditorObject, PathObject } from '../model/doc'
import { Path, Point, util } from 'fabric'
import { buildMeasurementPath } from '../../../measurement'
import { probePathPosition, scaleToFabric } from './object-factory'
import { arrowGeometryFromObject, buildArrowPath, transformArrowGeometry } from './shapes/arrow-path'

type NormalizedPathGeometry = Partial<Pick<PathObject, 'left' | 'top' | 'angle' | 'scaleX' | 'scaleY' | 'path' | 'measurementPoints' | 'arrowStart' | 'arrowEnd' | 'headLength' | 'headWidth'>>

/** Keep metadata in document coordinates for paste, align, flip and programmatic moves. */
export function normalizedPathGeometry(object: EditorObject): NormalizedPathGeometry {
  if (object.kind !== 'path' || (object.tool !== 'measurement' && object.tool !== 'arrow'))
    return {}
  const position = probePathPosition(object.path, object.strokeWidth)
  if (object.angle === 0 && object.scaleX === 1 && object.scaleY === 1 && Math.abs(position.left - object.left) < 1e-8 && Math.abs(position.top - object.top) < 1e-8)
    return {}
  const target = new Path(object.path, { left: object.left, top: object.top, angle: object.angle, ...scaleToFabric(object.scaleX, object.scaleY), strokeWidth: object.strokeWidth, strokeUniform: true })
  const matrix = target.calcTransformMatrix()
  const arrow = arrowGeometryFromObject(object)
  let attrs: NormalizedPathGeometry
  let path: string
  if (arrow) {
    const geometry = transformArrowGeometry(arrow, matrix, target.pathOffset)
    path = buildArrowPath(geometry)
    attrs = { arrowStart: geometry.start, arrowEnd: geometry.end, headLength: geometry.headLength, headWidth: geometry.headWidth }
  }
  else if (object.measurementPoints) {
    const points = object.measurementPoints.map(point => util.transformPoint(new Point(point.x - target.pathOffset.x, point.y - target.pathOffset.y), matrix)).map(point => ({ x: point.x, y: point.y }))
    path = buildMeasurementPath(object.measurementKind ?? 'line', points, object.measurementArc?.radius, object.measurementArc?.style)
    attrs = { measurementPoints: points }
  }
  else {
    return {}
  }
  return { ...attrs, ...probePathPosition(path, object.strokeWidth), path, angle: 0, scaleX: 1, scaleY: 1 }
}
