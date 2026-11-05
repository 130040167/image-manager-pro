import type { Props } from './editor-utils'
import type { Editor } from './fabric-photo/core'
import type { PixelValueMode } from './histogram-range'
import { useMemoizedFn } from 'ahooks'
import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FiBarChart2 } from 'react-icons/fi'
import CustomFormatToolbar from '../custom-format-toolbar'
import { useCustomFormatSession } from '../custom-format-toolbar/use-custom-format-session'
import HistogramPanel from '../histogram-panel'
import { EditorGeometryControls } from './editor-geometry-controls'
import { normalizeImageName } from './editor-utils'
import { FabricPhotoEditor } from './fabric-photo/react'
import { activateTool } from './fabric-photo/react/tool-settings'
import { DEFAULT_PIXEL_VALUE_MODE } from './histogram-range'
import { getActiveNodeRadius } from './measurement'
import { MeasurementNode } from './measurement-node'
import { useEditorImage } from './use-editor-image'
import { useEditorMeasurements } from './use-editor-measurements'
import { useEditorPixels } from './use-editor-pixels'
import { useEditorSave } from './use-editor-save'
import { useEditorViewport } from './use-editor-viewport'
import './index.css'

export type { Props } from './editor-utils'

function ImageEditorView(props: Props) {
  const { closeEditor, defaultTool = 'select', image } = props
  const { t } = useTranslation()
  const customFormatController = useCustomFormatSession(image)
  const customDecodeOptions = customFormatController.decodeOptions
  const customOptionsKey = customFormatController.optionsKey
  const [editor, setEditor] = useState<Editor | null>(null)

  const [histogramVisible, setHistogramVisible] = useState(false)
  const [pixelValueMode, setPixelValueMode] = useState<PixelValueMode>(DEFAULT_PIXEL_VALUE_MODE)
  const { sourceSrc, rawImageData, displayImageData, valueRange, setEditorValueRange, editorLoading, editorError } = useEditorImage({ editor, image, customOptionsKey, customDecodeOptions, isCustom: customFormatController.isCustom })
  const imageName = normalizeImageName(image)
  const sampledImageData = pixelValueMode === 'raw' ? rawImageData : displayImageData
  const { mountRef, placement, canvasMax, collectPoint, syncPlacement } = useEditorViewport(editor)
  const handleSaveEditedImage = useEditorSave(editor, image)
  const { pixelReadout, pixelGridCanvasRef, updatePixelFromPointer } = useEditorPixels({ editor, rawImageData, sampledImageData, displayImageData, image, placement, mountRef, pixelValueMode })

  const { overlayRef, activeMeasurementId, activeNodeIndex, measureKind, measurementStyle, setMeasurementStyle, setHoverPoint, finishMeasurement, addMeasurement, handleNodePointerDown, renderedMeasurements, previewPath } = useEditorMeasurements({ editor, sourceKey: `${image?.path}|${customOptionsKey}`, placement, collectPoint })
  useEffect(() => {
    document.addEventListener('image-editor-close', closeEditor)
    return () => document.removeEventListener('image-editor-close', closeEditor)
  }, [closeEditor])

  const handleReady = useMemoizedFn((editor: Editor) => {
    ;(window as any).__IM_EDITOR_INSTANCE__ = editor
    setEditor(editor)
    if (defaultTool === 'crop') {
      activateTool(editor, 'crop', {
        arrow: { color: '#1677ff', width: 1 },
        freedraw: { color: '#1677ff', width: 4 },
        line: { color: '#1677ff', width: 1 },
        measure: { color: '#0d99ff', dash: [], kind: 'line', width: 1 },
        mosaic: { dimensions: 8 },
        shape: { fill: 'transparent', shapeType: 'rect', stroke: '#1677ff', strokeWidth: 1 },
        text: { fill: '#1677ff', fontSize: 32 },
      })
    }
    window.requestAnimationFrame(() => {
      editor.notifyResize()
      syncPlacement()
    })
  })

  useEffect(() => {
    if (editor)
      (window as any).__IM_EDITOR_INSTANCE__ = editor
    return () => {
      if ((window as any).__IM_EDITOR_INSTANCE__ === editor)
        delete (window as any).__IM_EDITOR_INSTANCE__
    }
  }, [editor])

  const topbarActions = (
    <div className='fp-extra-actions'>
      <button type='button' className={histogramVisible ? 'fp-icon-btn fp-histogram-btn is-active' : 'fp-icon-btn fp-histogram-btn'} title={t('im.histogram')} aria-label={t('im.histogram')} onClick={() => setHistogramVisible(value => !value)}><FiBarChart2 size={18} viewBox='2 2 20 20' strokeWidth={1.75} aria-hidden /></button>
    </div>
  )

  return (
    <div
      className='vim-image-editor-page h-screen w-screen overflow-hidden bg-[#111] text-ant-color-text'
      onPointerMove={(event) => {
        updatePixelFromPointer(event)
        if (measureKind)
          setHoverPoint(collectPoint(event))
      }}
      onContextMenuCapture={(event) => {
        if (!mountRef.current?.contains(event.target as Node))
          return
        event.preventDefault()
        event.stopPropagation()
        finishMeasurement()
        editor?.endAll()
      }}
    >
      {sourceSrc
        ? (
            <FabricPhotoEditor
              imageName={imageName}
              cssMaxWidth={canvasMax.width}
              cssMaxHeight={canvasMax.height}
              onReady={handleReady}
              onExport={handleSaveEditedImage}
              topbarActions={topbarActions}
              pixelReadout={pixelReadout}
              measureActive={measureKind !== null}
              onMeasure={(patch) => {
                if (patch.kind) {
                  addMeasurement(patch.kind)
                }
                setMeasurementStyle(style => ({ ...style, color: patch.color ?? style.color, dash: patch.dash ?? style.dash, width: patch.width ?? style.width }))
              }}
              canvasOverlay={(
                <div ref={overlayRef} className='fp-editor-overlays'>
                  <canvas ref={pixelGridCanvasRef} className='fp-pixel-grid' data-editor-pixel-grid />
                  {placement
                    ? (
                        <svg
                          className='fp-measure-overlay'
                          data-editor-overlay
                          style={{ height: placement.height, left: placement.left, top: placement.top, width: placement.width }}
                          viewBox={`0 0 ${placement.documentWidth} ${placement.documentHeight}`}
                        >
                          {renderedMeasurements.filter(item => (editor?.state.mode === 'normal' && !measureKind && editor.state.selection.includes(item.id)) || (measureKind && item.id === activeMeasurementId)).map(item => (
                            <g key={item.id}>
                              {item.points.map((point, index) => (
                                <MeasurementNode
                                  key={`${item.id}-${index}`}
                                  objectId={item.id}
                                  index={index}
                                  style={{ pointerEvents: measureKind || editor?.state.getObject(item.id)?.locked || editor?.isSelectionControlAtPoint(point.x, point.y) ? 'none' : 'auto' }}
                                  x={point.x}
                                  y={point.y}
                                  radius={(index === activeNodeIndex && item.id === activeMeasurementId ? getActiveNodeRadius(measurementStyle.nodeRadius) : measurementStyle.nodeRadius) / (placement.pixelWidth || 1)}
                                  color={item.color}
                                  opacity={measurementStyle.nodeOpacity}
                                  onPointerDown={event => handleNodePointerDown(event, item.id, index)}
                                />
                              ))}
                            </g>
                          ))}
                          {editor && <EditorGeometryControls editor={editor} placement={placement} measurements={renderedMeasurements} creating={measureKind !== null || editor.state.mode !== 'normal'} />}
                          {previewPath
                            ? <path d={previewPath} fill='none' stroke={measurementStyle.color} strokeWidth={1.25} strokeOpacity={0.85} strokeDasharray='5 5' strokeLinecap='round' strokeLinejoin='round' vectorEffect='non-scaling-stroke' />
                            : null}
                        </svg>
                      )
                    : null}
                </div>
              )}
            />
          )
        : null}
      {editorLoading ? <div className='fp-editor-status'><span className='fp-editor-spinner' /></div> : null}
      {editorError
        ? (
            <div className='fp-editor-error'>
              <strong>{t('im.operation_failed')}</strong>
              <span>{editorError}</span>
            </div>
          )
        : null}
      {image && customFormatController.isCustom
        ? <CustomFormatToolbar className='vim-editor-custom-format-toolbar' controller={customFormatController} image={image} variant='editor' />
        : null}
      <HistogramPanel
        src={sourceSrc || image?.vscodePath}
        imageData={sampledImageData}
        visible={histogramVisible}
        range={valueRange}
        pixelValueMode={pixelValueMode}
        onChange={setEditorValueRange}
        onClose={() => setHistogramVisible(false)}
        onPixelValueModeChange={setPixelValueMode}
      />
    </div>
  )
}

export default memo(ImageEditorView)
