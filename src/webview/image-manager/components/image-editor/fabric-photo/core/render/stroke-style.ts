/** Round caps extend each dash by one stroke width; preserve a visible gap. */
export function smoothStrokeDash(dash: readonly number[] | undefined, width: number): number[] | undefined {
  if (!dash?.length)
    return dash ? [] : undefined
  const scale = Math.max(1, width / 2)
  return dash.map((length, index) => Math.max(0, length) * scale + (index % 2 ? width : 0))
}

export const ROUND_STROKE = { strokeLineCap: 'round', strokeLineJoin: 'round' } as const
