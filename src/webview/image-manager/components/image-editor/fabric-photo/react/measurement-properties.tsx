import type { MeasurementMetricKind, MeasurementMetricLabelSettings } from '../../measurement-label'
import type { Editor, PathObject } from '../core'
import { measurementEndpointSettings } from '../../measurement-endpoints'
import { measurementDisplayName, measurementLabelSettings, measurementMetricDisplayName, measurementMetricLabelSettings, measurementValueDetails } from '../../measurement-label'
import { selectedMeasurementLabelKind, useMeasurementLabelSelection } from '../../measurement-label-selection'
import { ColorSwatch } from './color-swatch'
import { MeasurementEndpointPicker } from './measurement-endpoint-picker'
import { NumberField } from './number-field'
import './measurement-properties.css'

type LabelSettings = ReturnType<typeof measurementLabelSettings>
type LabelStyle = Pick<MeasurementMetricLabelSettings, 'fontSize' | 'fontFamily' | 'color' | 'background' | 'backgroundColor' | 'backgroundOpacity'>

function VisibilityButton({ label, visible, disabled, onChange }: { label: string, visible: boolean, disabled: boolean, onChange: (visible: boolean) => void }) {
  return (
    <button type='button' className='fp-label-eye' aria-label={label} aria-pressed={visible} title={label} disabled={disabled} onClick={() => onChange(!visible)}>
      <svg width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.6' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
        <path d='M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z' />
        <circle cx='12' cy='12' r='3' />
        {!visible && <path d='m3 3 18 18' />}
      </svg>
    </button>
  )
}

/** Exactly one effective style editor: a metric's own settings, or the single name/line/angle label. */
function LabelStyleFields({ settings, onChange }: { settings: LabelStyle, onChange: (patch: Partial<LabelStyle>) => void }) {
  return (
    <div className='fp-label-style'>
      <div className='fp-label-type-row'>
        <label className='fp-option-field'>
          <span>字体</span>
          <select aria-label='标注字体' value={settings.fontFamily} onChange={event => onChange({ fontFamily: event.target.value as LabelStyle['fontFamily'] })}>
            <option value='system-ui'>默认</option>
            <option value='serif'>衬线</option>
            <option value='monospace'>等宽</option>
          </select>
        </label>
        <NumberField label='字号' value={settings.fontSize} min={0.5} max={200} step={0.5} onChange={fontSize => onChange({ fontSize })} />
        <div className='fp-option-field'>
          <span>文字</span>
          <ColorSwatch label='标注文字' value={settings.color} onChange={color => onChange({ color })} />
        </div>
      </div>
      <div className='fp-label-background-row'>
        <label className='fp-option-field'>
          <span>背景</span>
          <select aria-label='标注背景' value={settings.background} onChange={event => onChange({ background: event.target.value as LabelStyle['background'] })}>
            <option value='none'>无背景</option>
            <option value='default'>深色半透明</option>
            <option value='custom'>自定义</option>
          </select>
        </label>
        <NumberField label='透明度 %' ariaLabel='背景透明度 (%)' value={Math.round(settings.backgroundOpacity * 100)} min={0} max={100} step={1} precision={0} disabled={settings.background === 'none'} onChange={value => onChange({ backgroundOpacity: value / 100 })} />
        <div className='fp-option-field'>
          <span>底色</span>
          <fieldset className='fp-label-color-field' disabled={settings.background !== 'custom'}>
            <ColorSwatch label='标注背景' value={settings.background === 'custom' ? settings.backgroundColor : '#0f172a'} onChange={backgroundColor => onChange({ backgroundColor })} />
          </fieldset>
        </div>
      </div>
    </div>
  )
}

export function MeasurementProperties({ editor, object, locked }: { editor: Editor, object: PathObject, locked: boolean }) {
  const { selection, selectLabel } = useMeasurementLabelSelection(editor)
  const selectedKind = selectedMeasurementLabelKind(object, selection)
  const selectedMetric = selectedKind === 'area' ? 'area' : 'perimeter'
  const settings = measurementLabelSettings(object)
  const updateLabel = (patch: Partial<LabelSettings>) => editor.changeMeasurementAnnotation(object.id, { measurementLabel: { ...settings, ...patch } })
  const updateMetric = (kind: MeasurementMetricKind, patch: Partial<MeasurementMetricLabelSettings>) => {
    const metricLabels = {
      ...(object.measurementLabel?.metricLabels ?? {}),
      [kind]: { ...(object.measurementLabel?.metricLabels?.[kind] ?? {}), ...patch },
    }
    const visibilityPatch = kind === 'perimeter'
      ? { showPerimeter: patch.visible ?? settings.showPerimeter }
      : { showArea: patch.visible ?? settings.showArea }
    updateLabel({ ...visibilityPatch, metricLabels })
  }
  const arc = object.measurementArc ?? { style: 'single' as const, radius: 22 }
  const endpoints = measurementEndpointSettings(object)
  const multipleMetrics = object.measurementKind === 'polygon' || object.measurementKind === 'ellipse'
  const useMetricStyle = multipleMetrics && settings.content !== 'name'
  const effectiveStyle = useMetricStyle ? measurementMetricLabelSettings(object, selectedMetric) : settings
  const displayedName = useMetricStyle ? measurementMetricDisplayName(object, selectedMetric) : measurementDisplayName(object)
  const defaultName = useMetricStyle ? (selectedMetric === 'perimeter' ? '周长' : '面积') : object.measurementName ?? '测量名称'
  const updateName = (patch: Pick<Partial<MeasurementMetricLabelSettings>, 'nameMode' | 'customName'>) => {
    if (useMetricStyle)
      updateMetric(selectedMetric, patch)
    else
      updateLabel(patch)
  }
  const updateStyle = (patch: Partial<LabelStyle>) => {
    if (useMetricStyle) {
      updateMetric(selectedMetric, patch)
      return
    }
    // Freeze inherited metric styles before editing the separate name-only label.
    // Changing its appearance must not silently restyle the perimeter or area.
    updateLabel(multipleMetrics
      ? {
          ...patch,
          metricLabels: {
            perimeter: measurementMetricLabelSettings(object, 'perimeter'),
            area: measurementMetricLabelSettings(object, 'area'),
          },
        }
      : patch)
  }
  const contentOptions = [
    { value: 'value', label: '数值' },
    { value: 'name', label: '名称' },
    { value: 'both', label: '名称与数值' },
  ] as const
  return (
    <>
      {object.measurementKind === 'line' && (
        <section className='fp-annotation-settings'>
          <div className='fp-annotation-heading'>测量端点</div>
          <div className='fp-endpoint-fields'>
            <MeasurementEndpointPicker label='起点样式' value={endpoints.start} disabled={locked} onChange={start => editor.changeMeasurementAnnotation(object.id, { measurementEndpoints: { ...object.measurementEndpoints, start, end: endpoints.end } })} />
            <MeasurementEndpointPicker label='终点样式' value={endpoints.end} disabled={locked} onChange={end => editor.changeMeasurementAnnotation(object.id, { measurementEndpoints: { ...object.measurementEndpoints, start: endpoints.start, end } })} />
            <NumberField label='端点大小' value={endpoints.size} min={1} max={2000} step={0.5} disabled={locked} onChange={size => editor.changeMeasurementAnnotation(object.id, { measurementEndpoints: { ...endpoints, size } })} />
          </div>
        </section>
      )}
      {object.measurementKind === 'angle' && (
        <section className='fp-annotation-settings'>
          <div className='fp-annotation-heading'>夹角标记</div>
          <div className='fp-property-pair'>
            <label className='fp-option-field'>
              <span>弧线样式</span>
              <select aria-label='弧线样式' value={arc.style} disabled={locked} onChange={event => editor.changeMeasurementAnnotation(object.id, { measurementArc: { ...arc, style: event.target.value as typeof arc.style } })}>
                <option value='none'>隐藏</option>
                <option value='single'>单弧线</option>
                <option value='double'>双弧线</option>
              </select>
            </label>
            <NumberField label='弧线半径' value={arc.radius} min={1} max={2000} disabled={locked || arc.style === 'none'} onChange={radius => editor.changeMeasurementAnnotation(object.id, { measurementArc: { ...arc, radius } })} />
          </div>
        </section>
      )}
      <section className='fp-annotation-settings fp-measurement-results-section'>
        <div className='fp-measurement-section-header'>
          <div className='fp-annotation-heading'>测量结果</div>
          <NumberField label='小数位数' value={object.measurementPrecision ?? 2} min={0} max={6} step={1} precision={0} disabled={locked} onChange={measurementPrecision => editor.changeMeasurementAnnotation(object.id, { measurementPrecision })} />
        </div>
        <div className='fp-measurement-summary'>
          {measurementValueDetails(object).map(detail => (
            <div className='fp-props-readonly fp-measurement-result-row' key={detail.label}>
              <span className='fp-props-readonly-label'>{detail.label}</span>
              <span className='fp-measurement-result-number'>{detail.value}</span>
              <span className='fp-measurement-result-unit'>{detail.unit}</span>
            </div>
          ))}
        </div>
      </section>
      <section className='fp-annotation-settings fp-label-section'>
        <div className='fp-annotation-header'>
          <div className='fp-annotation-heading' title='拖动画面中的标注可调整位置'>画面标注</div>
          <button type='button' className='fp-label-switch' role='switch' aria-label='在画面上显示标注' aria-checked={settings.visible} title={settings.visible ? '隐藏所有标注' : '显示标注'} disabled={locked} onClick={() => updateLabel({ visible: !settings.visible })}>
            <span />
          </button>
        </div>
        {settings.visible && (
          <fieldset className='fp-label-controls' disabled={locked}>
            <div className='fp-label-content-row'>
              <span className='fp-label-caption'>内容</span>
              <div className='fp-label-segments' role='group' aria-label='标注内容'>
                {contentOptions.map(option => (
                  <button key={option.value} type='button' aria-label={option.label} title={option.label} aria-pressed={settings.content === option.value} onClick={() => updateLabel({ content: option.value })}>
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            {useMetricStyle && (
              <div className='fp-label-metrics' role='group' aria-label='指标标注'>
                {(['perimeter', 'area'] as const).map((kind) => {
                  const metric = measurementMetricLabelSettings(object, kind)
                  const label = kind === 'perimeter' ? '周长' : '面积'
                  return (
                    <div className='fp-label-metric' data-active={selectedMetric === kind} key={kind}>
                      <button type='button' className='fp-label-metric-select' aria-label={`编辑${label}标注`} aria-pressed={selectedMetric === kind} onClick={() => selectLabel(object.id, kind)}>{label}</button>
                      <VisibilityButton label={`显示${label}`} visible={metric.visible} disabled={locked} onChange={visible => updateMetric(kind, { visible })} />
                    </div>
                  )
                })}
              </div>
            )}
            {settings.content !== 'value' && (
              <div className='fp-label-name-row'>
                <label className='fp-option-field'>
                  <span>名称</span>
                  <select aria-label='名称来源' value={effectiveStyle.nameMode} onChange={event => updateName({ nameMode: event.target.value as LabelSettings['nameMode'] })}>
                    <option value='default'>默认名称</option>
                    <option value='custom'>自定义</option>
                  </select>
                </label>
                {effectiveStyle.nameMode === 'custom'
                  ? <input key={`${object.id}-${selectedKind}`} className='fp-custom-name' type='text' aria-label='标注名称' placeholder={defaultName} maxLength={80} value={effectiveStyle.customName} onChange={event => updateName({ customName: event.target.value })} />
                  : <span className='fp-label-name-preview' title={displayedName}>{displayedName}</span>}
              </div>
            )}
            <LabelStyleFields key={`${object.id}-${useMetricStyle ? selectedMetric : 'general'}`} settings={effectiveStyle} onChange={updateStyle} />
          </fieldset>
        )}
      </section>
    </>
  )
}
