import type { JSX } from 'react'
import type { Editor, EditorObject, FilterSettings, ImageObject, MosaicObject, PathObject, ShapeObject, TextObject } from '../core'
import {
  FiAlignCenter,
  FiAlignLeft,
  FiAlignRight,
  FiArrowDown,
  FiArrowUp,
  FiArrowUpRight,
  FiBold,
  FiChevronsDown,
  FiChevronsUp,
  FiCircle,
  FiEdit3,
  FiGrid,
  FiImage,
  FiItalic,
  FiLayers,
  FiMinus,
  FiRotateCcw,
  FiSquare,
  FiTrash2,
  FiTriangle,
  FiType,
  FiUnderline,
} from 'react-icons/fi'
import { DEFAULT_FILTERS } from '../core'
import { ColorSwatch } from './color-swatch'
import { ArrowHeadPicker, DashPicker } from './floating-options'
import { useEditor, useEditorState, useToolSettings } from './hooks'
import { MeasurementProperties } from './measurement-properties'
import { NumberField } from './number-field'
import { applyColor, modeToTool } from './tool-settings'
import './inspector-properties.css'

const AlignCenterIcon = FiAlignCenter as unknown as JSX.ElementType
const AlignLeftIcon = FiAlignLeft as unknown as JSX.ElementType
const AlignRightIcon = FiAlignRight as unknown as JSX.ElementType
const ArrowDownIcon = FiArrowDown as unknown as JSX.ElementType
const ArrowUpIcon = FiArrowUp as unknown as JSX.ElementType
const ArrowUpRightIcon = FiArrowUpRight as unknown as JSX.ElementType
const BoldIcon = FiBold as unknown as JSX.ElementType
const ChevronsDownIcon = FiChevronsDown as unknown as JSX.ElementType
const ChevronsUpIcon = FiChevronsUp as unknown as JSX.ElementType
const CircleIcon = FiCircle as unknown as JSX.ElementType
const EditIcon = FiEdit3 as unknown as JSX.ElementType
const GridIcon = FiGrid as unknown as JSX.ElementType
const ImageIcon = FiImage as unknown as JSX.ElementType
const ItalicIcon = FiItalic as unknown as JSX.ElementType
const LayersIcon = FiLayers as unknown as JSX.ElementType
const LineIcon = FiMinus as unknown as JSX.ElementType
const ResetIcon = FiRotateCcw as unknown as JSX.ElementType
const SquareIcon = FiSquare as unknown as JSX.ElementType
const TrashIcon = FiTrash2 as unknown as JSX.ElementType
const TriangleIcon = FiTriangle as unknown as JSX.ElementType
const TypeIcon = FiType as unknown as JSX.ElementType
const UnderlineIcon = FiUnderline as unknown as JSX.ElementType

function InspectorIconButton(props: {
  label: string
  icon: JSX.ElementType
  active?: boolean
  disabled?: boolean
  danger?: boolean
  onClick: () => void
}): JSX.Element {
  const Icon = props.icon
  const className = [
    'fp-inspector-icon-btn',
    props.active === true ? 'is-active' : '',
    props.danger === true ? 'is-danger' : '',
  ].filter(Boolean).join(' ')
  return (
    <button
      type='button'
      className={className}
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.active}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Icon size={15} aria-hidden='true' />
    </button>
  )
}

function SectionTitle(props: { children: string }): JSX.Element {
  return <div className='fp-inspector-section-title'>{props.children}</div>
}

function AlignTopIcon(): JSX.Element {
  return <svg viewBox='0 0 18 18' aria-hidden='true'><path d='M3 3h12M6 6v7M12 6v4' /></svg>
}

function AlignMiddleIcon(): JSX.Element {
  return <svg viewBox='0 0 18 18' aria-hidden='true'><path d='M3 9h12M6 5v8M12 6.5v5' /></svg>
}

function AlignBottomIcon(): JSX.Element {
  return <svg viewBox='0 0 18 18' aria-hidden='true'><path d='M3 15h12M6 5v7M12 8v4' /></svg>
}

function DistributeHorizontalIcon(): JSX.Element {
  return <svg viewBox='0 0 18 18' aria-hidden='true'><path d='M3 3v12M15 3v12M6 6v6M12 5v8' /></svg>
}

function DistributeVerticalIcon(): JSX.Element {
  return <svg viewBox='0 0 18 18' aria-hidden='true'><path d='M3 3h12M3 15h12M6 6h6M5 12h8' /></svg>
}

function FlipHorizontalIcon(): JSX.Element {
  return <svg viewBox='0 0 18 18' aria-hidden='true'><path d='M9 2v14M7 5 2.5 9 7 13V5Zm4 0 4.5 4-4.5 4V5Z' /></svg>
}

function FlipVerticalIcon(): JSX.Element {
  return <svg viewBox='0 0 18 18' aria-hidden='true'><path d='M2 9h14M5 7l4-4.5L13 7H5Zm0 4 4 4.5 4-4.5H5Z' /></svg>
}

function MeasureIcon(): JSX.Element {
  return <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.6' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'><path d='m3 16 13-13 5 5L8 21 3 16Zm5-5 2 2m2-6 2 2m2-6 2 2M4 15l2 2' /></svg>
}

/**
 * 颜色字段：字段名与当前色块，完整色板通过弹层展开。
 */
function ColorField(props: { label: string, value: string, onChange: (color: string) => void }): JSX.Element {
  return (
    <div className='fp-color-field'>
      <span className='fp-color-field-label'>{props.label}</span>
      <ColorSwatch label={props.label} value={props.value} onChange={props.onChange} />
    </div>
  )
}

/**
 * 选中对象主色改色（shape fill / text fill / path color）：统一走 applyColor 路由，
 * 与工具选项条同一套「实时生效」语义；返回的回调直接绑到 ColorField.onChange。
 */
function useApplyObjectColor(object: EditorObject): (color: string) => void {
  const editor = useEditor()
  const { toolSettings, setToolSettings } = useToolSettings()
  const mode = useEditorState(state => state.mode)
  return color => applyColor(editor, toolSettings, setToolSettings, modeToTool(mode), [object], color)
}

/**
 * 滤镜滑杆（私有）：domain [-1,1] 映射为 -100..100，[0,1] 映射为 0..100 显示。
 * onChange 直接透传归一化值（连续拖动由调用方配 mergeKey 合并历史）。
 */
function FilterSlider(props: {
  label: string
  ariaLabel?: string
  value: number // 归一化（[-1,1] 或 [0,1]）
  min: number // 归一化域
  max: number
  onChange: (value: number) => void
}): JSX.Element {
  const display = Math.round(props.value * 100)
  return (
    <div className='fp-filter-field'>
      <div className='fp-filter-field-row'>
        <span className='fp-filter-field-label'>{props.label}</span>
        <span className='fp-filter-field-value'>{display}</span>
      </div>
      <input
        type='range'
        aria-label={props.ariaLabel ?? props.label}
        min={props.min * 100}
        max={props.max * 100}
        step={1}
        value={display}
        onChange={event => props.onChange(Number(event.target.value) / 100)}
      />
    </div>
  )
}

/**
 * 滤镜调整组（私有）：亮度/对比度/饱和度/模糊滑杆 + 灰度/褐色/反色 toggle + 重置。
 * 零编辑逻辑：onPatch/onReset 由调用方绑定 core 的 set*Filters/reset*Filters（含 mergeKey）。
 */
function FilterAdjustGroup(props: {
  title: string
  filters: FilterSettings | undefined
  onPatch: (patch: Partial<FilterSettings>) => void
  onReset: () => void
}): JSX.Element {
  const effective = props.filters ?? DEFAULT_FILTERS
  const toggles = [
    { key: 'grayscale', label: '灰度', active: effective.grayscale },
    { key: 'sepia', label: '褐色', active: effective.sepia },
    { key: 'invert', label: '反色', active: effective.invert },
  ] as const
  return (
    <section className='fp-inspector-section fp-filter-adjustments'>
      <div className='fp-inspector-section-heading'>
        <SectionTitle>{props.title}</SectionTitle>
        <InspectorIconButton label='重置' icon={ResetIcon} onClick={props.onReset} />
      </div>
      <div className='fp-filter-slider-grid'>
        <FilterSlider label='亮度' value={effective.brightness} min={-1} max={1} onChange={brightness => props.onPatch({ brightness })} />
        <FilterSlider label='对比度' value={effective.contrast} min={-1} max={1} onChange={contrast => props.onPatch({ contrast })} />
        <FilterSlider label='饱和度' value={effective.saturation} min={-1} max={1} onChange={saturation => props.onPatch({ saturation })} />
        <FilterSlider label='模糊' value={effective.blur} min={0} max={1} onChange={blur => props.onPatch({ blur })} />
      </div>
      <div className='fp-props-style-toggles'>
        {toggles.map(toggle => (
          <button
            key={toggle.key}
            type='button'
            className={toggle.active ? 'fp-props-toggle fp-props-toggle-active' : 'fp-props-toggle'}
            aria-pressed={toggle.active}
            onClick={() => props.onPatch({ [toggle.key]: !toggle.active })}
          >
            {toggle.label}
          </button>
        ))}
      </div>
    </section>
  )
}

/**
 * 不透明度滑杆（私有）：单选/多选共用，0..1 ↔ 0..100 显示；
 * 委托 editor.setObjectOpacity（作用于全部选中对象），mergeKey 按选中集区分，
 * 同一选中集连续拖动合并为一个 undo 条目。多选显示第一个选中对象的值。
 */
function OpacitySlider(props: { editor: Editor, objects: EditorObject[] }): JSX.Element {
  const { editor, objects } = props
  const ids = objects.map(o => o.id)
  return (
    <div className='fp-object-opacity'>
      <FilterSlider
        label='整体不透明度'
        ariaLabel='不透明度'
        value={objects[0].opacity ?? 1}
        min={0}
        max={1}
        onChange={opacity => editor.setObjectOpacity(ids, opacity, { mergeKey: `opacity:${ids.join('+')}` })}
      />
    </div>
  )
}

/** 锁定提示（私有）：locked 单选时显示；几何类控件（NumberField）由调用方按 locked 禁用。 */
function LockedHint(): JSX.Element {
  return <div className='fp-props-locked-hint'>已锁定：几何类控件不可用，解锁后可编辑</div>
}

/** 检查器标题：展示对象类型；有选中对象时在右侧提供统一删除入口。 */
function InspectorHeader(props: {
  editor?: Editor
  icon: JSX.ElementType
  title: string
  subtitle?: string
}): JSX.Element {
  const Icon = props.icon
  return (
    <header className={props.editor ? 'fp-inspector-header' : 'fp-inspector-header fp-inspector-header-static'}>
      <span className='fp-inspector-type-icon' aria-hidden='true'><Icon size={16} /></span>
      <span className='fp-inspector-heading'>
        <strong>{props.title}</strong>
        {props.subtitle && <span>{props.subtitle}</span>}
      </span>
      {props.editor && (
        <InspectorIconButton
          label='删除'
          icon={TrashIcon}
          danger
          onClick={() => props.editor?.removeActiveObject()}
        />
      )}
    </header>
  )
}

/**
 * 图层顺序 + 翻转按钮组：单选与多选共用，全部委托 core 公开 API
 * （z 序多选保持相对顺序、已在顶/底 no-op；翻转对每个选中对象取负 scale）。
 */
function ArrangeGroups(props: { editor: Editor }): JSX.Element {
  const { editor } = props
  return (
    <section className='fp-inspector-section fp-arrange-section'>
      <div className='fp-inspector-toolbar-row'>
        <SectionTitle>排列</SectionTitle>
        <div className='fp-inspector-icon-toolbar' role='group' aria-label='排列与翻转'>
          <InspectorIconButton label='置顶' icon={ChevronsUpIcon} onClick={() => editor.bringToFront()} />
          <InspectorIconButton label='上移' icon={ArrowUpIcon} onClick={() => editor.bringForward()} />
          <InspectorIconButton label='下移' icon={ArrowDownIcon} onClick={() => editor.sendBackward()} />
          <InspectorIconButton label='置底' icon={ChevronsDownIcon} onClick={() => editor.sendToBack()} />
          <span className='fp-inspector-toolbar-divider' aria-hidden='true' />
          <InspectorIconButton label='水平翻转' icon={FlipHorizontalIcon} onClick={() => editor.flipActiveObjects('horizontal')} />
          <InspectorIconButton label='垂直翻转' icon={FlipVerticalIcon} onClick={() => editor.flipActiveObjects('vertical')} />
        </div>
      </div>
    </section>
  )
}

/**
 * 对齐分布按钮组（多选专属，私有）：6 对齐 + 2 分布，全部委托 core 公开 API
 * （alignActiveObjects/distributeActiveObjects，一笔事务可撤销）；
 * 分布需 ≥3 选中才启用（core 侧 locked 过滤后不足亦 no-op 返回 false）。
 */
function AlignDistributeGroup(props: { editor: Editor, selectedCount: number }): JSX.Element {
  const { editor, selectedCount } = props
  const aligns = [
    { edge: 'left', label: '左对齐', icon: AlignLeftIcon },
    { edge: 'centerX', label: '水平居中', icon: AlignCenterIcon },
    { edge: 'right', label: '右对齐', icon: AlignRightIcon },
    { edge: 'top', label: '顶对齐', icon: AlignTopIcon },
    { edge: 'centerY', label: '垂直居中', icon: AlignMiddleIcon },
    { edge: 'bottom', label: '底对齐', icon: AlignBottomIcon },
  ] as const
  const distributes = [
    { axis: 'horizontal', label: '水平分布', icon: DistributeHorizontalIcon },
    { axis: 'vertical', label: '垂直分布', icon: DistributeVerticalIcon },
  ] as const
  return (
    <section className='fp-inspector-section'>
      <SectionTitle>对齐与分布</SectionTitle>
      <div className='fp-inspector-icon-toolbar fp-inspector-align-toolbar' role='group' aria-label='对齐分布'>
        {aligns.map(item => (
          <InspectorIconButton
            key={item.edge}
            label={item.label}
            icon={item.icon}
            onClick={() => editor.alignActiveObjects(item.edge)}
          />
        ))}
        <span className='fp-inspector-toolbar-divider' aria-hidden='true' />
        {distributes.map(item => (
          <InspectorIconButton
            key={item.axis}
            label={item.label}
            icon={item.icon}
            disabled={selectedCount < 3}
            onClick={() => editor.distributeActiveObjects(item.axis)}
          />
        ))}
      </div>
    </section>
  )
}

function ShapePanel(props: { editor: Editor, object: ShapeObject, locked: boolean }): JSX.Element {
  const { editor, object, locked } = props
  return (
    <section className='fp-inspector-section'>
      <SectionTitle>外观</SectionTitle>
      <div className='fp-inspector-color-row'>
        <ColorField label='填充' value={object.fill} onChange={fill => editor.changeShape({ fill })} />
        <ColorField label='描边' value={object.stroke} onChange={stroke => editor.changeShape({ stroke })} />
      </div>
      <div className='fp-inspector-stroke-row'>
        <NumberField label='描边宽度' value={object.strokeWidth} min={1} max={20} disabled={locked} onChange={strokeWidth => editor.changeShape({ strokeWidth })} />
        <div className='fp-inspector-dash-field'>
          <span>线型</span>
          <DashPicker value={object.strokeDash ?? []} disabled={locked} onChange={strokeDash => editor.changeShape({ strokeDash })} />
        </div>
      </div>
    </section>
  )
}

function TextPanel(props: { editor: Editor, object: TextObject, locked: boolean }): JSX.Element {
  const { editor, object, locked } = props
  const applyObjectColor = useApplyObjectColor(object)
  // changeTextStyle 为 toggle 语义：按钮恒传目标值，active 态读对象当前值
  const toggles = [
    { label: '加粗', icon: BoldIcon, active: object.fontWeight === 'bold', apply: () => editor.changeTextStyle({ fontWeight: 'bold' }) },
    { label: '斜体', icon: ItalicIcon, active: object.fontStyle === 'italic', apply: () => editor.changeTextStyle({ fontStyle: 'italic' }) },
    {
      label: '下划线',
      icon: UnderlineIcon,
      active: object.textDecoration === 'underline',
      apply: () => editor.changeTextStyle({ textDecoration: 'underline' }),
    },
  ]
  return (
    <>
      <section className='fp-inspector-section'>
        <label className='fp-text-field'>
          <span className='fp-text-field-label'>文本内容</span>
          <textarea aria-label='文本内容' value={object.text} onChange={event => editor.changeText(event.target.value)} />
        </label>
      </section>
      <section className='fp-inspector-section'>
        <SectionTitle>文字样式</SectionTitle>
        <div className='fp-inspector-text-style-row'>
          <NumberField label='字号' value={object.fontSize} min={1} disabled={locked} onChange={fontSize => editor.changeTextStyle({ fontSize })} />
          <ColorField label='颜色' value={object.fill} onChange={applyObjectColor} />
          <div className='fp-inspector-icon-toolbar' role='group' aria-label='文字样式'>
            {toggles.map(toggle => (
              <InspectorIconButton
                key={toggle.label}
                label={toggle.label}
                icon={toggle.icon}
                active={toggle.active}
                onClick={toggle.apply}
              />
            ))}
          </div>
        </div>
      </section>
    </>
  )
}

function PathPanel(props: { editor: Editor, object: PathObject, locked: boolean }): JSX.Element {
  const { editor, object, locked } = props
  const applyObjectColor = useApplyObjectColor(object)
  // arrow 走 changeArrowStyle（同步头部 fill）；其余（freedraw/line）走 changeFreeDrawingPathStyle
  const change = object.tool === 'arrow' ? editor.changeArrowStyle : editor.changeFreeDrawingPathStyle
  return (
    <>
      <section className='fp-inspector-section'>
        <SectionTitle>外观</SectionTitle>
        <div className='fp-inspector-stroke-row fp-inspector-path-style'>
          <ColorField label='颜色' value={object.stroke} onChange={applyObjectColor} />
          <NumberField label='线宽' value={object.strokeWidth} min={1} max={20} disabled={locked} onChange={width => change.call(editor, { width })} />
          <div className='fp-inspector-dash-field'>
            <span>线型</span>
            <DashPicker value={object.strokeDash ?? []} disabled={locked} onChange={dash => object.tool === 'measurement' ? editor.changeMeasurementStyle({ dash }) : change.call(editor, { dash })} />
          </div>
        </div>
      </section>
      {object.tool === 'measurement' ? <MeasurementProperties editor={editor} object={object} locked={locked} /> : null}
      {object.tool === 'arrow'
        ? (
            <section className='fp-annotation-settings'>
              <div className='fp-annotation-heading'>箭头端点</div>
              <div className='fp-property-pair'>
                <div className='fp-option-field'>
                  <span>起点</span>
                  <ArrowHeadPicker label='起点' value={object.startHead ?? 'none'} onChange={startHead => editor.changeArrowStyle({ startHead })} />
                </div>
                <div className='fp-option-field'>
                  <span>终点</span>
                  <ArrowHeadPicker label='终点' value={object.endHead ?? 'filled'} onChange={endHead => editor.changeArrowStyle({ endHead })} />
                </div>
              </div>
              <div className='fp-property-pair'>
                <NumberField label='头部长度' value={object.headLength ?? 20} min={1} max={500} disabled={locked} onChange={headLength => editor.changeArrowStyle({ headLength })} />
                <NumberField label='头部宽度' value={object.headWidth ?? 20} min={1} max={500} disabled={locked} onChange={headWidth => editor.changeArrowStyle({ headWidth })} />
              </div>
              <p className='fp-property-hint'>拖动圆点调整端点，菱形调整头部。</p>
            </section>
          )
        : null}
    </>
  )
}

function MosaicPanel(props: { object: MosaicObject }): JSX.Element {
  return (
    <section className='fp-inspector-section'>
      <SectionTitle>信息</SectionTitle>
      <div className='fp-props-readonly'>
        <span className='fp-props-readonly-label'>马赛克块数</span>
        <span className='fp-props-readonly-value'>{props.object.rects.length}</span>
      </div>
    </section>
  )
}

function ImagePanel(props: { editor: Editor, object: ImageObject }): JSX.Element {
  const { editor, object } = props
  return (
    <>
      <section className='fp-inspector-section'>
        <SectionTitle>信息</SectionTitle>
        <div className='fp-props-readonly'>
          <span className='fp-props-readonly-label'>尺寸</span>
          <span className='fp-props-readonly-value'>
            {object.width}
            {' '}
            ×
            {' '}
            {object.height}
          </span>
        </div>
      </section>
      <FilterAdjustGroup
        title='图像调整'
        filters={object.filters}
        onPatch={patch => editor.setImageFilters(object.id, patch, { mergeKey: `img-filters-${object.id}` })}
        onReset={() => editor.resetImageFilters(object.id)}
      />
    </>
  )
}

function objectPresentation(object: EditorObject): { icon: JSX.ElementType, title: string } {
  switch (object.kind) {
    case 'image': return { icon: ImageIcon, title: '图片' }
    case 'text': return { icon: TypeIcon, title: '文本' }
    case 'mosaic': return { icon: GridIcon, title: '马赛克' }
    case 'shape':
      return {
        icon: object.shapeType === 'circle' ? CircleIcon : object.shapeType === 'triangle' ? TriangleIcon : SquareIcon,
        title: object.shapeType === 'circle' ? '圆形' : object.shapeType === 'triangle' ? '三角形' : '矩形',
      }
    case 'path':
      if (object.tool === 'arrow')
        return { icon: ArrowUpRightIcon, title: '箭头' }
      if (object.tool === 'line')
        return { icon: LineIcon, title: '直线' }
      if (object.tool === 'measurement')
        return { icon: MeasureIcon, title: `${({ line: '直线', angle: '角度', polygon: '多边形', ellipse: '椭圆' })[object.measurementKind ?? 'line']}测量` }
      return { icon: EditIcon, title: '画笔' }
  }
}

/**
 * 属性面板（grid 右列，gridArea 'props'）：由选中驱动表单。
 * 无选中 → 画布属性（缩放只读、背景尺寸/「未加载图片」、对象数）+「背景调整」滤镜组
 * （已加载背景时，mergeKey 'bg-filters'，连续拖动一个 undo 条目）；
 * 单选按 kind 分派 shape/text/path/mosaic/image 表单（change* API 均可撤销），
 * image 表单带「图像调整」滤镜组（mergeKey `img-filters-${id}`）；
 * 多选 → 数量 + 删除 +「对齐分布」按钮组（6 对齐 + 2 分布，≥3 选中才启用分布，
 * 委托 alignActiveObjects/distributeActiveObjects）。单选与多选均有底部「整体不透明度」滑杆（0..100 ↔ 0..1，
 * setObjectOpacity + mergeKey 连续拖动一个 undo 条目）、「图层顺序」
 * （置顶/上移/下移/置底）与「翻转」（水平/垂直）按钮组，委托 core 公开 API。
 * 单选 locked 对象时显示「已锁定」提示并禁用几何类控件（描边宽度/字号/线宽）。
 */
export function PropertiesPanel(props: { className?: string }): JSX.Element {
  const editor = useEditor()
  const selection = useEditorState(state => state.selection)
  const objects = useEditorState(state => state.doc.objects)
  const background = useEditorState(state => state.doc.background)
  const zoomText = useEditorState(() => `${Math.round(editor.getPixelZoom() * 100)}%`)
  const selected = objects.filter(object => selection.includes(object.id))

  let content: JSX.Element
  if (selected.length === 0) {
    content = (
      <div className='fp-props-canvas'>
        <InspectorHeader icon={LayersIcon} title='画布属性' subtitle={background === null ? '未加载图片' : '文档概览'} />
        <section className='fp-inspector-section'>
          <SectionTitle>文档</SectionTitle>
          <div className='fp-inspector-facts'>
            <div className='fp-props-readonly'>
              <span className='fp-props-readonly-label'>缩放</span>
              <span className='fp-props-readonly-value'>{zoomText}</span>
            </div>
            <div className='fp-props-readonly'>
              <span className='fp-props-readonly-label'>背景</span>
              <span className='fp-props-readonly-value'>{background !== null ? `${Number(background.width.toFixed(2))} × ${Number(background.height.toFixed(2))}` : '未加载图片'}</span>
            </div>
            <div className='fp-props-readonly'>
              <span className='fp-props-readonly-label'>对象数</span>
              <span className='fp-props-canvas-count'>{objects.length}</span>
            </div>
          </div>
        </section>
        {background !== null && (
          <FilterAdjustGroup
            title='背景调整'
            filters={background.filters}
            onPatch={patch => editor.setBackgroundFilters(patch, { mergeKey: 'bg-filters' })}
            onReset={() => editor.resetBackgroundFilters()}
          />
        )}
      </div>
    )
  }
  else if (selected.length > 1) {
    content = (
      <div className='fp-props-multi'>
        <InspectorHeader editor={editor} icon={LayersIcon} title='多个图层' subtitle={`已选 ${selected.length} 个对象`} />
        <AlignDistributeGroup editor={editor} selectedCount={selected.length} />
        <ArrangeGroups editor={editor} />
        <OpacitySlider editor={editor} objects={selected} />
      </div>
    )
  }
  else {
    const object = selected[0]
    const locked = object.locked === true
    const presentation = objectPresentation(object)
    let form: JSX.Element
    switch (object.kind) {
      case 'shape':
        form = <ShapePanel editor={editor} object={object} locked={locked} />
        break
      case 'text':
        form = <TextPanel editor={editor} object={object} locked={locked} />
        break
      case 'path':
        form = <PathPanel editor={editor} object={object} locked={locked} />
        break
      case 'mosaic':
        form = <MosaicPanel object={object} />
        break
      case 'image':
        form = <ImagePanel editor={editor} object={object} />
        break
    }
    content = (
      <div key={object.id} className={`fp-props-object fp-props-object-${object.kind}`}>
        <InspectorHeader editor={editor} icon={presentation.icon} title={presentation.title} />
        {locked && <LockedHint />}
        {form}
        <ArrangeGroups editor={editor} />
        <OpacitySlider editor={editor} objects={selected} />
      </div>
    )
  }

  const rootClassName = props.className === undefined ? 'fp-props-panel' : `fp-props-panel ${props.className}`
  return (
    <div className={rootClassName}>
      {content}
    </div>
  )
}
