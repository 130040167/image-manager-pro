import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ColorPalette } from './color-palette'
import './annotation-properties.css'

export function ColorSwatch(props: { label: string, value: string, onChange: (color: string) => void }) {
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number, top: number } | null>(null)
  useEffect(() => {
    if (!position)
      return
    const dismiss = (event: PointerEvent) => {
      if (!button.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node))
        setPosition(null)
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if ((event.target as Element | null)?.closest?.('.fp-custom-color-panel'))
          return
        event.stopPropagation()
        setPosition(null)
        button.current?.focus()
      }
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', key, true)
    }
  }, [position])
  return (
    <>
      <button
        ref={button}
        type='button'
        className='fp-current-color'
        aria-label={`${props.label}颜色选择`}
        aria-expanded={Boolean(position)}
        title={`${props.label} · ${props.value}`}
        onClick={() => {
          const rect = button.current!.getBoundingClientRect()
          const top = rect.bottom + 94 <= window.innerHeight ? rect.bottom + 6 : rect.top - 88
          setPosition(position ? null : { left: Math.max(8, Math.min(window.innerWidth - 268, rect.right - 260)), top: Math.max(8, top) })
        }}
      >
        <span style={{ background: props.value }} />
        <svg viewBox='0 0 12 12' width='12' height='12' aria-hidden='true'><path d='m3 4.5 3 3 3-3' stroke='currentColor' fill='none' /></svg>
      </button>
      {position && createPortal(
        <div ref={menu} role='dialog' aria-label={`${props.label}色板`} className='fp-color-popover fp-color-popover-v2' style={position}>
          <div className='fp-color-popover-title'>
            <span>{props.label}</span>
            <code>{props.value}</code>
          </div>
          <ColorPalette value={props.value} onChange={props.onChange} inputLabel={props.label} />
        </div>,
        button.current?.closest('.fp-editor') ?? document.body,
      )}
    </>
  )
}
