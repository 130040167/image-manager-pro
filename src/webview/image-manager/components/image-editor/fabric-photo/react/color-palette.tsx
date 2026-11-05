import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useEditorTranslation } from '../../editor-i18n'
import { hexToRgb, isHexColor, normalizeHex, rgbToHex } from './color-palette-utils'
import './color-palette.css'

export const PALETTE_COLORS = ['#ff0000', '#ffff00', '#00ff00', '#0000ff', '#808080', '#000000', '#ffffff'] as const
const RECOMMENDED_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#0ea5e9', '#6366f1', '#a855f7'] as const

const RECENT_COLORS_KEY = 'image-manager:recent-colors'
const RECENT_COLORS_EVENT = 'image-manager:recent-colors-change'
const MAX_RECENT_COLORS = 8
function readRecentColors(): string[] {
  if (typeof window === 'undefined')
    return []
  try {
    const stored = JSON.parse(window.localStorage.getItem(RECENT_COLORS_KEY) ?? '[]')
    return Array.isArray(stored) ? stored.filter(isHexColor).map(color => color.toLowerCase()).slice(0, MAX_RECENT_COLORS) : []
  }
  catch {
    return []
  }
}

function rememberColor(color: string): void {
  if (typeof window === 'undefined')
    return
  const normalized = normalizeHex(color)
  if (!normalized)
    return
  const next = [normalized, ...readRecentColors().filter(item => item !== normalized)].slice(0, MAX_RECENT_COLORS)
  try {
    window.localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(next))
  }
  catch {
    // Storage may be disabled in a webview; the selected color still applies.
  }
  window.dispatchEvent(new CustomEvent(RECENT_COLORS_EVENT, { detail: next }))
}

export interface ColorPaletteProps {
  value: string
  onChange: (color: string) => void
  className?: string
  inputLabel?: string
}

function ColorButton(props: { color: string, active: boolean, label: string, onSelect: (color: string) => void }): JSX.Element {
  return (
    <button type='button' className={props.active ? 'fp-swatch fp-swatch-active' : 'fp-swatch'} style={{ backgroundColor: props.color }} aria-label={props.label} aria-pressed={props.active} onClick={() => props.onSelect(props.color)} />
  )
}

export function ColorPalette(props: ColorPaletteProps): JSX.Element {
  const et = useEditorTranslation()
  const rootClassName = props.className === undefined ? 'fp-color-palette' : `fp-color-palette ${props.className}`
  const normalizedValue = normalizeHex(props.value) ?? props.value.toLowerCase()
  const customActive = !(PALETTE_COLORS as readonly string[]).includes(normalizedValue)
  const [customOpen, setCustomOpen] = useState(false)
  const [hexDraft, setHexDraft] = useState(() => normalizeHex(props.value) ?? '#000000')
  const [rgbDraft, setRgbDraft] = useState<[string, string, string]>(() => hexToRgb(props.value).map(String) as [string, string, string])
  const [recentColors, setRecentColors] = useState<string[]>(readRecentColors)
  const [panelPlacement, setPanelPlacement] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const hexInput = useRef<HTMLInputElement>(null)
  const customButton = useRef<HTMLButtonElement>(null)
  const currentColor = useRef(props.value)
  currentColor.current = props.value
  const customLabel = props.inputLabel ?? et('自定义颜色')

  useEffect(() => {
    const normalized = normalizeHex(props.value)
    if (!normalized)
      return
    setHexDraft(normalized)
    setRgbDraft(hexToRgb(normalized).map(String) as [string, string, string])
  }, [props.value])

  useEffect(() => {
    const sync = (event: Event) => setRecentColors((event as CustomEvent<string[]>).detail ?? readRecentColors())
    window.addEventListener(RECENT_COLORS_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(RECENT_COLORS_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  useEffect(() => {
    if (!customOpen)
      return
    hexInput.current?.focus()
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        rememberColor(currentColor.current)
        setCustomOpen(false)
      }
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        rememberColor(currentColor.current)
        setCustomOpen(false)
        customButton.current?.focus()
      }
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', key, true)
    }
  }, [customOpen])

  const select = (color: string, remember = true) => {
    const normalized = normalizeHex(color)
    if (!normalized)
      return
    props.onChange(normalized)
    if (remember)
      rememberColor(normalized)
  }

  const updateHex = (value: string) => {
    setHexDraft(value)
    const normalized = normalizeHex(value)
    if (!normalized)
      return
    setRgbDraft(hexToRgb(normalized).map(String) as [string, string, string])
    props.onChange(normalized)
  }

  const updateRgb = (index: number, value: string) => {
    const next = [...rgbDraft] as [string, string, string]
    next[index] = value
    setRgbDraft(next)
    const channels = next.map(Number)
    if (channels.some((channel, channelIndex) => next[channelIndex].trim() === '' || !Number.isInteger(channel) || channel < 0 || channel > 255))
      return
    const hex = rgbToHex(channels[0], channels[1], channels[2])
    setHexDraft(hex)
    props.onChange(hex)
  }

  const toggleCustom = () => {
    if (customOpen) {
      rememberColor(props.value)
      setCustomOpen(false)
      return
    }
    const selected = normalizeHex(props.value) ?? '#000000'
    setHexDraft(selected)
    setRgbDraft(hexToRgb(selected).map(String) as [string, string, string])
    const rect = root.current?.getBoundingClientRect()
    if (rect) {
      const vertical = rect.bottom + 190 > window.innerHeight ? ' fp-custom-color-panel-up' : ''
      const horizontal = rect.right - 234 < 8 ? ' fp-custom-color-panel-left' : ''
      setPanelPlacement(`${vertical}${horizontal}`)
    }
    setCustomOpen(true)
  }

  return (
    <div ref={root} className={rootClassName} role='group' aria-label={et('色板')}>
      {PALETTE_COLORS.map(color => <ColorButton key={color} color={color} active={normalizedValue === color} label={et('色板 {{color}}', { color })} onSelect={select} />)}
      <span className='fp-color-custom-separator' aria-hidden='true' />
      <button ref={customButton} type='button' className={customActive ? 'fp-color-custom fp-color-custom-active' : 'fp-color-custom'} aria-label={customLabel} aria-pressed={customActive} aria-current={customActive ? 'true' : undefined} aria-expanded={customOpen} onClick={toggleCustom}>
        <span className='fp-color-custom-rainbow' style={customActive ? { background: normalizedValue } : undefined} />
      </button>
      {customOpen && (
        <div className={`fp-custom-color-panel${panelPlacement}`} role='dialog' aria-label={et('{{label}}面板', { label: customLabel })}>
          <div className='fp-custom-color-row'>
            <label className='fp-custom-color-hex'>
              <span>HEX</span>
              <input ref={hexInput} aria-label='HEX' value={hexDraft} maxLength={7} spellCheck={false} onChange={event => updateHex(event.target.value)} onBlur={() => rememberColor(hexDraft)} onKeyDown={event => event.key === 'Enter' && rememberColor(hexDraft)} />
            </label>
            <input className='fp-native-color-input' type='color' aria-label={et('{{label}}系统取色', { label: customLabel })} value={normalizeHex(hexDraft) ?? '#000000'} onChange={event => select(event.target.value)} />
          </div>
          <div className='fp-custom-color-rgb' aria-label={et('RGB 颜色')}>
            {(['R', 'G', 'B'] as const).map((channel, index) => (
              <label key={channel}>
                <span>{channel}</span>
                <input type='number' aria-label={channel} min={0} max={255} value={rgbDraft[index]} onChange={event => updateRgb(index, event.target.value)} onBlur={() => rememberColor(hexDraft)} />
              </label>
            ))}
          </div>
          <div className='fp-custom-color-section'>
            <span>{et('推荐')}</span>
            <div className='fp-custom-color-grid'>{RECOMMENDED_COLORS.map(color => <ColorButton key={color} color={color} active={normalizedValue === color} label={et('推荐色 {{color}}', { color })} onSelect={select} />)}</div>
          </div>
          <div className='fp-custom-color-section'>
            <span>{et('最近')}</span>
            {recentColors.length > 0
              ? <div className='fp-custom-color-grid'>{recentColors.map(color => <ColorButton key={color} color={color} active={normalizedValue === color} label={et('最近使用 {{color}}', { color })} onSelect={select} />)}</div>
              : <span className='fp-custom-color-empty'>{et('暂无')}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
