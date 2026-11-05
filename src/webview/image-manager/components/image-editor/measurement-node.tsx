import type { CSSProperties, PointerEventHandler } from 'react'
import { Color } from 'fabric'

export function MeasurementNode({ x, y, radius, color, opacity, objectId, index, style, onPointerDown }: {
  x: number
  y: number
  radius: number
  color: string
  opacity: number
  objectId: string
  index: number
  style: CSSProperties
  onPointerDown: PointerEventHandler<SVGCircleElement>
}) {
  const [r, g, b] = new Color(color).getSource()
  const fill = 0.299 * r + 0.587 * g + 0.114 * b > 128 ? '#111827' : '#ffffff'
  const path = `M ${x} ${y - radius} L ${x + radius} ${y} L ${x} ${y + radius} L ${x - radius} ${y} Z`
  return (
    <g className='fp-measure-marker' data-measurement-marker={objectId} opacity={opacity}>
      <circle className='fp-measure-node-halo' cx={x} cy={y} r={radius * 1.8} fill='#60a5fa' fillOpacity={0.2} stroke='#93c5fd' vectorEffect='non-scaling-stroke' pointerEvents='none' />
      <path d={path} fill={fill} stroke='#ffffff' strokeWidth={3.5} vectorEffect='non-scaling-stroke' pointerEvents='none' />
      <path d={path} fill={fill} stroke='#111827' strokeWidth={1.5} vectorEffect='non-scaling-stroke' pointerEvents='none' />
      <circle className='fp-measure-node' data-measurement-id={objectId} data-measurement-node={index} cx={x} cy={y} r={radius * 1.8} fill='transparent' style={style} onPointerDown={onPointerDown} />
    </g>
  )
}
