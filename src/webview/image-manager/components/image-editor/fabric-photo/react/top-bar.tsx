import type { JSX, ReactNode } from 'react'
import type { ExportImageOptions } from '../core'
import type { SegmentedOption } from './segmented'
import { useContext, useEffect, useRef, useState } from 'react'
import { FiDownload, FiMoon, FiRotateCcw, FiRotateCw, FiSun, FiX } from 'react-icons/fi'
import { useEditorTranslation } from '../../editor-i18n'
import { EditorActionsContext } from './context'
import { useEditor, useEditorEvent, useEditorState, useTheme } from './hooks'
import { SegmentedControl } from './segmented'
import { ZoomControls } from './zoom-controls'

/** 导出格式三选；MIME 为 `image/${format}`，扩展名与格式同名。 */
type ExportFormat = 'png' | 'jpeg' | 'webp'
/** 质量滑杆范围（仅 JPEG/WebP 显示）；默认值须落在 min + n×step 网格上（0.9 = 0.1 + 16×0.05）。 */
const QUALITY_MIN = 0.1
const QUALITY_MAX = 1
const QUALITY_STEP = 0.05
const QUALITY_DEFAULT = 0.9
const MULTIPLIERS = [1, 2, 3] as const

const FORMAT_OPTIONS = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'webp', label: 'WEBP' },
] as const satisfies readonly SegmentedOption<ExportFormat>[]

const UndoIcon = FiRotateCcw as unknown as JSX.ElementType
const RedoIcon = FiRotateCw as unknown as JSX.ElementType
const DownloadIcon = FiDownload as unknown as JSX.ElementType
const SunIcon = FiSun as unknown as JSX.ElementType
const MoonIcon = FiMoon as unknown as JSX.ElementType
const CloseIcon = FiX as unknown as JSX.ElementType

/**
 * 顶栏（grid 行 1）：左图名与像素读数 / undo·redo / 缩放 / 右主题切换与导出。
 * history 不在 EditorState 里：undo/redo 禁用态以 historyChange 事件驱动本地 state，
 * 初值取 editor.isEmptyUndoStack()/isEmptyRedoStack()。
 * 导出为弹层（绝对定位面板，Esc/点外部关闭）：格式 PNG/JPEG/WebP、质量滑杆（仅 JPEG/WebP，
 * 0.1..1 步进 0.05 默认 0.9）、倍率 1x/2x/3x、范围整图/仅选中（无选中禁用）；确认导出 →
 * core toDataURL → a[download=<图名>-<宽>x<高>@<倍率>x[-selection].<ext>] 并点击。
 */
export function TopBar(props: { className?: string, pixelReadout?: ReactNode, onExport?: (options: ExportImageOptions) => void }): JSX.Element {
  const et = useEditorTranslation()
  const actions = useContext(EditorActionsContext)
  const editor = useEditor()
  const { theme, toggleTheme } = useTheme()
  const imageName = useEditorState(state => state.doc.background?.name ?? '')
  const hasSelection = useEditorState(state => state.selection.length > 0)
  const [undoDisabled, setUndoDisabled] = useState(() => editor.isEmptyUndoStack())
  const [redoDisabled, setRedoDisabled] = useState(() => editor.isEmptyRedoStack())
  useEditorEvent('historyChange', ({ undoSize, redoSize }) => {
    setUndoDisabled(undoSize === 0)
    setRedoDisabled(redoSize === 0)
  })

  const [exportOpen, setExportOpen] = useState(false)
  const [format, setFormat] = useState<ExportFormat>('png')
  const [quality, setQuality] = useState(QUALITY_DEFAULT)
  const [multiplier, setMultiplier] = useState<(typeof MULTIPLIERS)[number]>(1)
  const [scope, setScope] = useState<'full' | 'selection'>('full')
  const exportRef = useRef<HTMLDivElement>(null)

  // 弹层开合：Esc / 点击面板（含触发按钮的 wrapper）外部关闭
  useEffect(() => {
    if (!exportOpen) {
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setExportOpen(false)
      }
    }
    const onMouseDown = (event: MouseEvent): void => {
      if (exportRef.current !== null && !exportRef.current.contains(event.target as Node)) {
        setExportOpen(false)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onMouseDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [exportOpen])

  // 选中集清空时「仅选中」失效：退回整图（弹层开着期间删光对象的兜底）
  useEffect(() => {
    if (!hasSelection && scope === 'selection') {
      setScope('full')
    }
  }, [hasSelection, scope])

  const handleExport = (): void => {
    const selectionOnly = scope === 'selection' && hasSelection
    const options: ExportImageOptions = { type: `image/${format}`, multiplier, selectionOnly }
    if (format !== 'png') {
      options.quality = quality
    }
    if (props.onExport) {
      props.onExport(options)
      setExportOpen(false)
      return
    }
    const size = editor.getExportSize({ multiplier, selectionOnly })
    const dataURL = editor.toDataURL(options)
    // 图名可能来自 File.name（自带扩展名），剥掉再拼避免双扩展名；
    // size 为 null（无背景整图）时省略尺寸段
    const baseName = (editor.getImageName() || 'image').replace(/\.[a-z0-9]+$/i, '')
    const sizePart = size === null ? '' : `-${size.width}x${size.height}@${multiplier}x`
    const link = document.createElement('a')
    link.href = dataURL
    link.download = `${baseName}${sizePart}${selectionOnly ? '-selection' : ''}.${format}`
    link.click()
    setExportOpen(false)
  }

  const rootClassName = props.className === undefined ? 'fp-topbar' : `fp-topbar ${props.className}`
  const [sourcePixel, adjustedPixel] = typeof props.pixelReadout === 'string' ? props.pixelReadout.split(' → ') : []
  return (
    <div className={rootClassName}>
      <div className='fp-topbar-title'>
        <span className='fp-topbar-name'>{imageName}</span>
        {props.pixelReadout
          ? (
              <span className='fp-topbar-pixel' title={typeof props.pixelReadout === 'string' ? props.pixelReadout : undefined}>
                {adjustedPixel
                  ? (
                      <>
                        <span className='fp-pixel-before'>{sourcePixel}</span>
                        <span className='fp-pixel-after'>{` → ${adjustedPixel}`}</span>
                      </>
                    )
                  : props.pixelReadout}
              </span>
            )
          : null}
      </div>
      <div className='fp-topbar-history'>
        <button
          type='button'
          className='fp-topbar-btn'
          title={et('撤销')}
          aria-label={et('撤销')}
          disabled={undoDisabled}
          onClick={() => editor.undo()}
        >
          <UndoIcon size={18} aria-hidden />
        </button>
        <button
          type='button'
          className='fp-topbar-btn'
          title={et('重做')}
          aria-label={et('重做')}
          disabled={redoDisabled}
          onClick={() => editor.redo()}
        >
          <RedoIcon size={18} aria-hidden />
        </button>
      </div>
      <ZoomControls />
      <div className='fp-topbar-actions'>
        {actions}
        <button
          type='button'
          className='fp-topbar-btn'
          title={et('切换主题')}
          aria-label={et('切换主题')}
          onClick={toggleTheme}
        >
          {theme === 'dark' ? <SunIcon size={18} aria-hidden /> : <MoonIcon size={18} aria-hidden />}
        </button>
        <span className='fp-topbar-separator' aria-hidden />
        <div className='fp-topbar-export' ref={exportRef}>
          <button
            type='button'
            className='fp-topbar-btn'
            title={et('导出')}
            aria-label={et('导出')}
            aria-expanded={exportOpen}
            onClick={() => setExportOpen(open => !open)}
          >
            <DownloadIcon size={18} aria-hidden />
          </button>
          {exportOpen && (
            <div className='fp-export-panel' role='dialog' aria-label={et('导出设置')}>
              <span className='fp-export-label'>{et('格式')}</span>
              <SegmentedControl
                ariaLabel={et('格式')}
                options={FORMAT_OPTIONS}
                value={format}
                onChange={setFormat}
              />
              {format !== 'png' && (
                <>
                  <span className='fp-export-label'>{et('质量')}</span>
                  <div className='fp-export-row'>
                    <input
                      type='range'
                      aria-label={et('质量')}
                      min={QUALITY_MIN}
                      max={QUALITY_MAX}
                      step={QUALITY_STEP}
                      value={quality}
                      onChange={event => setQuality(Number(event.target.value))}
                    />
                    <span className='fp-export-value'>{quality.toFixed(2)}</span>
                  </div>
                </>
              )}
              <span className='fp-export-label'>{et('倍率')}</span>
              <SegmentedControl
                ariaLabel={et('倍率')}
                options={MULTIPLIERS.map(m => ({ value: m, label: `${m}x` }))}
                value={multiplier}
                onChange={setMultiplier}
              />
              <span className='fp-export-label'>{et('范围')}</span>
              <SegmentedControl
                ariaLabel={et('范围')}
                options={
                                    [
                                      { value: 'full', label: et('整图') },
                                      { value: 'selection', label: et('仅选中'), disabled: !hasSelection },
                                    ] as const satisfies readonly SegmentedOption<'full' | 'selection'>[]
                }
                value={scope}
                onChange={setScope}
              />
              <button type='button' className='fp-export-confirm' onClick={handleExport}>
                {et('导出')}
              </button>
            </div>
          )}
        </div>
        <button type='button' className='fp-topbar-btn' title={et('关闭')} aria-label={et('关闭')} onClick={() => document.dispatchEvent(new CustomEvent('image-editor-close'))}>
          <CloseIcon size={18} viewBox='3 3 18 18' strokeWidth={1.5} aria-hidden />
        </button>
      </div>
    </div>
  )
}
