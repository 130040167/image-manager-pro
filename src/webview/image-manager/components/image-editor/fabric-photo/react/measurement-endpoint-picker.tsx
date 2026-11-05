import type { MeasurementEndpointStyle } from '../core/model/doc'
import { useEffect, useRef, useState } from 'react'
import { useEditorTranslation } from '../../editor-i18n'

const OPTIONS: { value: MeasurementEndpointStyle, label: string }[] = [
  { value: 'none', label: '无' },
  { value: 'filled-arrow', label: '实心箭头' },
  { value: 'simple-arrow', label: '简约箭头' },
  { value: 'hollow-circle', label: '空心圆' },
  { value: 'filled-circle', label: '实心圆' },
  { value: 'bar', label: '垂直短线' },
]

export function MeasurementEndpointPicker(props: {
  label: string
  value: MeasurementEndpointStyle
  disabled?: boolean
  onChange: (value: MeasurementEndpointStyle) => void
}) {
  const et = useEditorTranslation()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open)
      return
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node))
        setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  return (
    <div className='fp-option-field'>
      <span>{props.label}</span>
      <div className='fp-arrow-head-picker' ref={rootRef}>
        <button type='button' className='fp-arrow-head-trigger' aria-label={props.label} aria-expanded={open} disabled={props.disabled} onClick={() => setOpen(value => !value)}>
          <MeasurementEndpointIcon value={props.value} />
        </button>
        {open && (
          <div className='fp-arrow-head-menu' role='listbox' aria-label={props.label}>
            {OPTIONS.map(option => (
              <button
                key={option.value}
                type='button'
                role='option'
                title={et(option.label)}
                aria-label={et(option.label)}
                aria-selected={props.value === option.value}
                onClick={() => {
                  props.onChange(option.value)
                  setOpen(false)
                }}
              >
                <MeasurementEndpointIcon value={option.value} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function MeasurementEndpointIcon({ value }: { value: MeasurementEndpointStyle }) {
  return (
    <svg width='38' height='14' viewBox='0 0 38 14' aria-hidden='true'>
      <path d={value === 'filled-arrow' ? 'M3 7 H29' : value === 'hollow-circle' || value === 'filled-circle' ? 'M3 7 H31' : 'M3 7 H35'} fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' />
      {value === 'filled-arrow' && <path d='M29 2 L37 7 L29 12 Z' fill='currentColor' />}
      {value === 'simple-arrow' && <path d='M30 2 L37 7 L30 12' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round' />}
      {value === 'hollow-circle' && <circle cx='34' cy='7' r='3.5' fill='var(--fp-bg-panel)' stroke='currentColor' strokeWidth='1.8' />}
      {value === 'filled-circle' && <circle cx='34' cy='7' r='3.5' fill='currentColor' />}
      {value === 'bar' && <path d='M35 2 V12' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' />}
    </svg>
  )
}
