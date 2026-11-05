import type { JSX, ReactNode } from 'react'
import type { EditorObject, ShapeObject } from '../core'
import { useEffect, useRef, useState } from 'react'
import { FiCircle, FiMinus } from 'react-icons/fi'
import { ColorPalette } from './color-palette'
import { useEditor, useEditorState, useToolSettings } from './hooks'
import { activateTool, applyColor, modeToTool } from './tool-settings'
import './shape-options.css'

const WIDTH_OPTIONS = [1, 2, 4, 8, 12] as const
const MOSAIC_DIMENSIONS = [4, 8, 16] as const
type ShapeKind = ShapeObject['shapeType'] | 'line' | 'arrow'
export type ArrowHeadStyle = 'none' | 'filled' | 'open'

const SHAPE_TYPES: { type: ShapeKind, label: string }[] = [
  { type: 'rect', label: '矩形' },
  { type: 'circle', label: '圆形' },
  { type: 'triangle', label: '三角' },
  { type: 'line', label: '直线' },
  { type: 'arrow', label: '箭头' },
]

function DashIcon(props: { dash: number[] }) {
  const pattern = props.dash.length === 0 ? undefined : props.dash.join(' ')
  return <svg className='fp-dash-icon' width='42' height='14' viewBox='0 0 42 14' aria-hidden='true'><line x1='2' y1='7' x2='40' y2='7' stroke='currentColor' strokeWidth='2' strokeDasharray={pattern} strokeLinecap='round' /></svg>
}

function PolygonIcon(props: { size?: number }) {
  return <svg width={props.size ?? 16} height={props.size ?? 16} viewBox='0 0 16 16' aria-hidden='true'><polygon points='8,1.5 14,6 11.5,14 4.5,14 2,6' fill='none' stroke='currentColor' strokeWidth='1.5' strokeLinejoin='round' /></svg>
}

function AngleIcon(props: { size?: number }) {
  return (
    <svg width={props.size ?? 16} height={props.size ?? 16} viewBox='0 0 20 20' aria-hidden='true' fill='none' stroke='currentColor' strokeWidth='1.6' strokeLinecap='round' strokeLinejoin='round'>
      <path d='M16 3 L3 16 H18' />
      <path d='M10 16 A7 7 0 0 0 7.95 11.05' />
    </svg>
  )
}

const DASH_OPTIONS = [
  { dash: [] as number[], label: '实线' },
  { dash: [12, 6], label: '长虚线' },
  { dash: [8, 4], label: '虚线' },
  { dash: [3, 2], label: '密集虚线' },
  { dash: [2, 5], label: '点线' },
  { dash: [12, 4, 2, 4], label: '点划线' },
] as const

export function DashPicker(props: { value: number[], disabled?: boolean, onChange: (dash: number[]) => void }) {
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
    <div className='fp-dash-picker' ref={rootRef}>
      <button type='button' className='fp-dash-trigger' aria-label='线型' aria-expanded={open} disabled={props.disabled} onClick={() => setOpen(value => !value)}>
        <DashIcon dash={props.value} />
      </button>
      {open
        ? (
            <div className='fp-dash-menu' role='listbox' aria-label='线型'>
              {DASH_OPTIONS.map(item => (
                <button
                  key={item.label}
                  type='button'
                  role='option'
                  aria-label={item.label}
                  aria-selected={JSON.stringify(item.dash) === JSON.stringify(props.value)}
                  onClick={() => {
                    props.onChange([...item.dash])
                    setOpen(false)
                  }}
                >
                  <DashIcon dash={[...item.dash]} />
                </button>
              ))}
            </div>
          )
        : null}
    </div>
  )
}

function ShapeKindIcon(props: { kind: ShapeKind, size?: number }) {
  const size = props.size ?? 18
  if (props.kind === 'circle')
    return <svg width={size} height={size} viewBox='0 0 20 20' aria-hidden='true'><circle cx='10' cy='10' r='6.5' fill='none' stroke='currentColor' strokeWidth='1.6' /></svg>
  if (props.kind === 'triangle')
    return <svg width={size} height={size} viewBox='0 0 20 20' aria-hidden='true'><path d='M10 3 L17 16 H3 Z' fill='none' stroke='currentColor' strokeWidth='1.6' strokeLinejoin='round' /></svg>
  if (props.kind === 'line')
    return <svg width={size} height={size} viewBox='0 0 20 20' aria-hidden='true'><path d='M3 16 L17 4' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' /></svg>
  if (props.kind === 'arrow')
    return <svg width={size} height={size} viewBox='0 0 20 20' aria-hidden='true'><path d='M3 16 L16 3 M9.5 3 H16 V9.5' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round' /></svg>
  return <svg width={size} height={size} viewBox='0 0 20 20' aria-hidden='true'><rect x='3.5' y='4' width='13' height='12' rx='1' fill='none' stroke='currentColor' strokeWidth='1.6' /></svg>
}

function ArrowHeadIcon(props: { value: ArrowHeadStyle }) {
  return (
    <svg width='38' height='14' viewBox='0 0 38 14' aria-hidden='true'>
      <path d='M3 7 H31' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' />
      {props.value === 'filled' && <path d='M31 2 L37 7 L31 12 Z' fill='currentColor' />}
      {props.value === 'open' && <path d='M31 2 L37 7 L31 12' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round' />}
    </svg>
  )
}

export function ArrowHeadPicker(props: { value: ArrowHeadStyle, onChange: (value: ArrowHeadStyle) => void, label: string, disabled?: boolean }) {
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
  const options: { value: ArrowHeadStyle, label: string }[] = [
    { value: 'none', label: '无端点' },
    { value: 'filled', label: '实心箭头' },
    { value: 'open', label: '空心箭头' },
  ]
  return (
    <div className='fp-arrow-head-picker' ref={rootRef}>
      <button type='button' className='fp-arrow-head-trigger' aria-label={props.label} aria-expanded={open} disabled={props.disabled} onClick={() => setOpen(value => !value)}>
        <ArrowHeadIcon value={props.value} />
      </button>
      {open && (
        <div className='fp-arrow-head-menu' role='listbox' aria-label={props.label}>
          {options.map(option => (
            <button
              key={option.value}
              type='button'
              role='option'
              title={option.label}
              aria-label={option.label}
              aria-selected={props.value === option.value}
              onClick={() => {
                props.onChange(option.value)
                setOpen(false)
              }}
            >
              <ArrowHeadIcon value={option.value} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * 色板高亮值：选中优先——applyColor 是「选中优先」路由（core setMode 不清 selection，
 * brush/shape 模式下可存在残留选中），点色板改的是选中对象，故 value 必须取首个选中对象
 * 的主色且与该色板经 applyColor 实际作用的字段一致（shape→stroke、text→fill、path→stroke）；
 * mosaic/image 无颜色字段（applyColor no-op），回退工具预设色。
 */
function paletteValue(objects: readonly EditorObject[], preset: string): string {
  const target = objects[0]
  if (target === undefined) {
    return preset
  }
  switch (target.kind) {
    case 'shape':
      return target.stroke
    case 'text':
      return target.fill
    case 'path':
      return target.stroke
    default:
      return preset
  }
}

/**
 * 浮动工具选项条：定位在画布区顶部居中（.fp-floating-options 绝对定位，由 styles.css 承载），
 * 仅 crop/brush/shape/mosaic 渲染内容，其余 mode（text/normal/pan）返回 null——不占布局、不留空壳。
 * crop → Apply/Cancel；freedraw/line/arrow → 线宽（写 toolSettings + setBrush 实时生效）+ 色板；
 * shape → 形状类型（写 toolSettings + setDrawingShape）+ 色板（描边色）；mosaic → 粒度
 * （仅写 toolSettings，不重启模式，下次 startMosaicDrawing 生效）。
 * 色板改色统一走 applyColor 路由（选中对象优先改对象，否则写工具预设并实时同步 editor）。
 */
export function FloatingOptions(props: { className?: string, measureActive?: boolean, onMeasure?: (patch: Partial<{ kind: 'line' | 'polygon' | 'ellipse' | 'angle', color: string, width: number, dash: number[] }>) => void }): JSX.Element | null {
  const editor = useEditor()
  const { toolSettings, setToolSettings } = useToolSettings()
  const mode = useEditorState(state => state.mode)
  const selection = useEditorState(state => state.selection)
  const objects = useEditorState(state => state.doc.objects)
  // Creation presets must keep targeting the next object after auto-selection.
  const selectedObjects = mode === 'normal' && !props.measureActive ? objects.filter(object => selection.includes(object.id)) : []

  const onColor = (color: string): void => {
    applyColor(editor, toolSettings, setToolSettings, modeToTool(mode), selectedObjects, color)
  }

  let content: ReactNode = null
  if (mode === 'crop') {
    content = (
      <>
        <button type='button' className='fp-option-btn' onClick={() => editor.endCropping(true)}>
          Apply
        </button>
        <button type='button' className='fp-option-btn' onClick={() => editor.endCropping(false)}>
          Cancel
        </button>
      </>
    )
  }
  else if (mode === 'freedraw') {
    const brushMode = mode
    const setWidth = (width: number): void => {
      setToolSettings(prev => ({ ...prev, [brushMode]: { ...prev[brushMode], width } }))
      editor.setBrush({ width })
    }
    content = (
      <>
        {WIDTH_OPTIONS.map((width) => {
          const isActive = toolSettings[brushMode].width === width
          return (
            <button
              key={width}
              type='button'
              className={isActive ? 'fp-option-btn fp-option-btn-active' : 'fp-option-btn'}
              aria-pressed={isActive}
              onClick={() => setWidth(width)}
            >
              {width}
            </button>
          )
        })}
        <ColorPalette value={paletteValue(selectedObjects, toolSettings[brushMode].color)} onChange={onColor} />
      </>
    )
  }
  else if (mode === 'shape' || mode === 'line' || mode === 'arrow') {
    const shapeKind: ShapeKind = mode === 'line' || mode === 'arrow'
      ? mode
      : (toolSettings.shape.shapeKind ?? toolSettings.shape.shapeType)
    const width = shapeKind === 'line'
      ? toolSettings.line.width
      : shapeKind === 'arrow'
        ? toolSettings.arrow.width
        : toolSettings.shape.strokeWidth
    const dash = shapeKind === 'line'
      ? (toolSettings.line.dash ?? [])
      : shapeKind === 'arrow'
        ? (toolSettings.arrow.dash ?? [])
        : (toolSettings.shape.strokeDash ?? [])
    const color = shapeKind === 'line'
      ? toolSettings.line.color
      : shapeKind === 'arrow'
        ? toolSettings.arrow.color
        : toolSettings.shape.stroke

    const setShapeKind = (nextKind: ShapeKind): void => {
      const nextShape = {
        ...toolSettings.shape,
        shapeKind: nextKind,
        shapeType: nextKind === 'line' || nextKind === 'arrow' ? toolSettings.shape.shapeType : nextKind,
      }
      setToolSettings(prev => ({ ...prev, shape: nextShape }))
      activateTool(editor, 'shape', { ...toolSettings, shape: nextShape })
    }
    const setWidth = (nextWidth: number): void => {
      if (shapeKind === 'line' || shapeKind === 'arrow') {
        setToolSettings(prev => ({ ...prev, [shapeKind]: { ...prev[shapeKind], width: nextWidth } }))
        editor.setBrush({ width: nextWidth })
      }
      else {
        setToolSettings(prev => ({ ...prev, shape: { ...prev.shape, strokeWidth: nextWidth } }))
        editor.setDrawingShape(shapeKind, { strokeWidth: nextWidth })
      }
    }
    const setDash = (nextDash: number[]): void => {
      if (shapeKind === 'line' || shapeKind === 'arrow') {
        setToolSettings(prev => ({ ...prev, [shapeKind]: { ...prev[shapeKind], dash: nextDash } }))
        editor.setBrush({ dash: nextDash })
      }
      else {
        setToolSettings(prev => ({ ...prev, shape: { ...prev.shape, strokeDash: nextDash } }))
        editor.setDrawingShape(shapeKind, { strokeDash: nextDash })
      }
    }
    content = (
      <div className='fp-shape-options'>
        <div className='fp-shape-primary'>
          <div className='fp-shape-kind-group' role='group' aria-label='形状类型'>
            {SHAPE_TYPES.map(({ type, label }) => {
              const isActive = shapeKind === type
              return (
                <button
                  key={type}
                  type='button'
                  className={isActive ? 'fp-option-btn fp-shape-kind-btn fp-option-btn-active' : 'fp-option-btn fp-shape-kind-btn'}
                  title={label}
                  aria-label={label}
                  aria-pressed={isActive}
                  onClick={() => setShapeKind(type)}
                >
                  <ShapeKindIcon kind={type} />
                </button>
              )
            })}
          </div>
          <span className='fp-shape-divider' aria-hidden='true' />
          <label className='fp-shape-width'>
            <span>线宽</span>
            <select aria-label='形状线宽' value={width} onChange={event => setWidth(Number(event.target.value))}>
              {WIDTH_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <DashPicker value={dash} onChange={setDash} />
        </div>
        <div className='fp-shape-secondary'>
          <ColorPalette value={paletteValue(selectedObjects, color)} onChange={onColor} />
          {shapeKind === 'arrow' && (
            <div className='fp-shape-arrow-ends'>
              <span>起点</span>
              <ArrowHeadPicker
                label='创建箭头起点'
                value={toolSettings.arrow.startHead ?? 'none'}
                onChange={(startHead) => {
                  setToolSettings(prev => ({ ...prev, arrow: { ...prev.arrow, startHead } }))
                  editor.setBrush({ startHead })
                }}
              />
              <span>终点</span>
              <ArrowHeadPicker
                label='创建箭头终点'
                value={toolSettings.arrow.endHead ?? 'filled'}
                onChange={(endHead) => {
                  setToolSettings(prev => ({ ...prev, arrow: { ...prev.arrow, endHead } }))
                  editor.setBrush({ endHead })
                }}
              />
            </div>
          )}
        </div>
      </div>
    )
  }
  else if (props.measureActive === true) {
    const changeMeasure = (patch: Partial<typeof toolSettings.measure>) => {
      setToolSettings(prev => ({ ...prev, measure: { ...prev.measure, ...patch } }))
      props.onMeasure?.(patch)
    }
    const kinds = [
      { kind: 'line', icon: FiMinus, label: '直线' },
      { kind: 'polygon', icon: PolygonIcon, label: '多边形' },
      { kind: 'ellipse', icon: FiCircle, label: '椭圆' },
      { kind: 'angle', icon: AngleIcon, label: '角度' },
    ] as const
    content = (
      <div className='fp-measure-options'>
        <div className='fp-option-group'>
          {kinds.map(({ kind, icon: Icon, label }) => (
            <button key={kind} type='button' className={toolSettings.measure.kind === kind ? 'fp-option-btn fp-option-btn-icon fp-option-btn-active' : 'fp-option-btn fp-option-btn-icon'} title={label} aria-label={label} onClick={() => changeMeasure({ kind })}><Icon size={16} /></button>
          ))}
          <label className='fp-measure-select'>
            <span>线宽</span>
            <select aria-label='线宽' value={toolSettings.measure.width} onChange={event => changeMeasure({ width: Number(event.target.value) })}>
              {WIDTH_OPTIONS.map(width => (
                <option key={width} value={width}>
                  {width}
                  px
                </option>
              ))}
            </select>
          </label>
          <DashPicker value={toolSettings.measure.dash} onChange={dash => changeMeasure({ dash })} />
        </div>
        <ColorPalette value={toolSettings.measure.color} inputLabel='测量颜色' onChange={color => changeMeasure({ color })} />
      </div>
    )
  }
  else if (mode === 'mosaic') {
    // 输入与预设都写入 UI 设置，并同步当前控制器，拖动过程中即可改变块大小。
    const setDimensions = (dimensions: number): void => {
      const next = Math.max(1, Math.min(512, Math.floor(dimensions)))
      if (!Number.isFinite(next))
        return
      setToolSettings(prev => ({ ...prev, mosaic: { dimensions: next } }))
      editor.setMosaicDimensions(next)
    }
    content = (
      <span className='fp-option-group' title='马赛克块边长（像素）'>
        {MOSAIC_DIMENSIONS.map((dimensions) => {
          const isActive = toolSettings.mosaic.dimensions === dimensions
          return (
            <button
              key={dimensions}
              type='button'
              className={isActive ? 'fp-option-btn fp-option-btn-active' : 'fp-option-btn'}
              aria-pressed={isActive}
              onClick={() => setDimensions(dimensions)}
            >
              {dimensions}
            </button>
          )
        })}
        <label className='fp-mosaic-input'>
          <span>大小</span>
          <input
            type='number'
            min={1}
            max={512}
            step={1}
            value={toolSettings.mosaic.dimensions}
            aria-label='马赛克大小'
            onChange={event => setDimensions(Number(event.currentTarget.value))}
          />
        </label>
      </span>
    )
  }

  if (content === null) {
    return null
  }
  const rootClassName
        = props.className === undefined ? 'fp-floating-options' : `fp-floating-options ${props.className}`
  return <div className={rootClassName}>{content}</div>
}
