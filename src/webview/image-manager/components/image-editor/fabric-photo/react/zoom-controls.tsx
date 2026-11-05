import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { FiCrosshair, FiMinus, FiPlus } from 'react-icons/fi'
import { nextEditorZoomPercent } from '../../editor-zoom'
import { useEditor, useEditorState } from './hooks'
import './zoom-controls.css'

const CrosshairIcon = FiCrosshair as unknown as JSX.ElementType
const MinusIcon = FiMinus as unknown as JSX.ElementType
const PlusIcon = FiPlus as unknown as JSX.ElementType

/**
 * 缩放控件：标题栏中的紧凑控件（− / 百分比输入 / ＋ / 复位居中）。
 */
export function ZoomControls(props: { className?: string }): JSX.Element {
  const editor = useEditor()
  const zoomPercent = useEditorState(() => Math.round(editor.getPixelZoom() * 100))
  const [draft, setDraft] = useState(String(zoomPercent))
  const [editing, setEditing] = useState(false)
  const canceled = useRef(false)

  useEffect(() => {
    if (!editing) {
      setDraft(String(zoomPercent))
    }
  }, [editing, zoomPercent])

  const restore = (): void => {
    setDraft(String(Math.round(editor.getPixelZoom() * 100)))
    setEditing(false)
  }
  const commit = (): void => {
    const value = Number(draft)
    if (draft.trim() === '' || !Number.isFinite(value)) {
      restore()
      return
    }
    editor.setPixelZoom(value / 100)
    setDraft(String(Math.round(editor.getPixelZoom() * 100)))
    setEditing(false)
  }

  const rootClassName
        = props.className === undefined ? 'fp-zoom-controls' : `fp-zoom-controls ${props.className}`
  return (
    <div className={rootClassName}>
      <button
        type='button'
        className='fp-zoom-btn'
        title='缩小'
        aria-label='缩小'
        onClick={() => editor.setPixelZoom(nextEditorZoomPercent(editor.getPixelZoom() * 100, -1) / 100)}
      >
        <MinusIcon size={16} aria-hidden />
      </button>
      <input
        type='number'
        className='fp-zoom-value'
        title='缩放百分比'
        aria-label='缩放百分比'
        value={draft}
        min={10}
        max={5000}
        step={10}
        onChange={event => setDraft(event.currentTarget.value)}
        onFocus={(event) => {
          setEditing(true)
          event.currentTarget.select()
        }}
        onBlur={() => {
          if (canceled.current) {
            canceled.current = false
            restore()
          }
          else {
            commit()
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            event.currentTarget.blur()
          }
          else if (event.key === 'Escape') {
            event.preventDefault()
            canceled.current = true
            event.currentTarget.blur()
          }
        }}
      />
      <span className='fp-zoom-unit' aria-hidden='true'>%</span>
      <button
        type='button'
        className='fp-zoom-btn'
        title='放大'
        aria-label='放大'
        onClick={() => editor.setPixelZoom(nextEditorZoomPercent(editor.getPixelZoom() * 100, 1) / 100)}
      >
        <PlusIcon size={16} aria-hidden />
      </button>
      <button
        type='button'
        className='fp-zoom-btn fp-zoom-reset'
        title='重置缩放并居中'
        aria-label='重置缩放并居中'
        onClick={() => editor.resetZoom()}
      >
        <CrosshairIcon size={15} aria-hidden />
      </button>
    </div>
  )
}
