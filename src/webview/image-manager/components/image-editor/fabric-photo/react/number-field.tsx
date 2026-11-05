import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'

/** 数值字段（私有）：编辑中保留空值/越界草稿；有效值实时生效，失焦时再恢复或限制。 */
export function NumberField(props: {
  label: string
  ariaLabel?: string
  value: number
  min?: number
  max?: number
  step?: number
  precision?: number
  disabled?: boolean // locked 时几何类控件禁用
  onChange: (value: number) => void
}): JSX.Element {
  const precision = props.precision ?? 1
  const format = (value: number) => String(Number(value.toFixed(precision)))
  const [draft, setDraft] = useState(() => format(props.value))
  const edited = useRef(false)
  const lastEmittedValue = useRef<number | null>(null)
  useEffect(() => {
    if (lastEmittedValue.current === props.value) {
      lastEmittedValue.current = null
      return
    }
    setDraft(String(Number(props.value.toFixed(precision))))
    edited.current = false
  }, [props.value, precision])

  const inRange = (value: number) => value >= (props.min ?? -Infinity) && value <= (props.max ?? Infinity)
  const emit = (value: number) => {
    lastEmittedValue.current = value
    props.onChange(value)
  }

  return (
    <label className='fp-number-field'>
      <span className='fp-number-field-label'>{props.label}</span>
      <input
        type='number'
        aria-label={props.ariaLabel ?? props.label}
        value={draft}
        min={props.min}
        max={props.max}
        step={props.step ?? 0.1}
        disabled={props.disabled}
        onChange={(event) => {
          setDraft(event.target.value)
          edited.current = true
          // 清空只修改草稿，不将对象属性改为 0。
          if (event.target.value === '') {
            return
          }
          const value = Number(event.target.value)
          if (Number.isFinite(value) && inRange(value))
            emit(value)
        }}
        onBlur={() => {
          const value = Number(draft)
          if (!edited.current || draft === '' || !Number.isFinite(value)) {
            setDraft(format(props.value))
            edited.current = false
            return
          }
          const clamped = Math.min(props.max ?? Infinity, Math.max(props.min ?? -Infinity, Number(value.toFixed(precision))))
          setDraft(format(clamped))
          edited.current = false
          if (clamped !== props.value)
            emit(clamped)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur()
          }
        }}
      />
    </label>
  )
}
