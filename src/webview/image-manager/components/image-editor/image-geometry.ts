/** Snap quadrant rotations so integer image dimensions and pixel edges stay exact. */
export function rotationComponents(angle: number) {
  const normalized = ((angle % 360) + 360) % 360
  if (normalized % 90 === 0) {
    const quadrant = normalized / 90
    return { cos: [1, 0, -1, 0][quadrant], sin: [0, 1, 0, -1][quadrant] }
  }
  const radians = normalized * Math.PI / 180
  return { cos: Math.cos(radians), sin: Math.sin(radians) }
}

export function rotatedImageSize(width: number, height: number, angle: number) {
  const { cos, sin } = rotationComponents(angle)
  return { width: Math.abs(width * cos) + Math.abs(height * sin), height: Math.abs(width * sin) + Math.abs(height * cos) }
}
