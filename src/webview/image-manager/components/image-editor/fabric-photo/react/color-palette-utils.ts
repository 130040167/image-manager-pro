const HEX_COLOR = /^#[0-9a-f]{6}$/i

export function normalizeHex(value: string): string | null {
  const candidate = value.trim().startsWith('#') ? value.trim() : `#${value.trim()}`
  return HEX_COLOR.test(candidate) ? candidate.toLowerCase() : null
}

export function hexToRgb(value: string): [number, number, number] {
  const normalized = normalizeHex(value) ?? '#000000'
  return [Number.parseInt(normalized.slice(1, 3), 16), Number.parseInt(normalized.slice(3, 5), 16), Number.parseInt(normalized.slice(5, 7), 16)]
}

export function rgbToHex(red: number, green: number, blue: number): string {
  const channel = (value: number) => Math.min(255, Math.max(0, Math.round(value))).toString(16).padStart(2, '0')
  return `#${channel(red)}${channel(green)}${channel(blue)}`
}

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value)
}
