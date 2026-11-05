import type { CustomFormatSessionState } from './session'
import type { CustomFormatSessionController } from './use-custom-format-session'
import type { CustomImageChannelMode, CustomImageDecodeOptions, CustomImageDtype, CustomImageEndian } from '~/core/custom-format/types'
import { useMemoizedFn } from 'ahooks'
import { Button, Checkbox, Form, Input, InputNumber, Popover, Select, Space, Tooltip, Typography } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FiChevronLeft, FiChevronRight, FiSave, FiSettings } from 'react-icons/fi'
import { CmdToVscode } from '~/message/cmd'
import { vscodeApi } from '~/webview/vscode-api'
import {
  buildCustomFormatDecodeOptions,
  buildRawExtensionPresetConfig,
  buildRawFolderPresetConfig,

  getCustomFormatLayoutOptionsForRank,
  isCustomFormatLayoutCompatibleWithRank,
  normalizeCustomFormatLayout,
  resolveRawExtensionPreset,
} from './session'

type Props = {
  className?: string
  controller: CustomFormatSessionController
  image: ImageType | undefined
  variant?: 'editor' | 'preview'
}

const dtypeOptions: CustomImageDtype[] = ['uint8', 'int8', 'uint16', 'int16', 'uint32', 'int32', 'float32', 'float64']
const endianOptions: CustomImageEndian[] = ['little', 'big']
const channelModeOptions: CustomImageChannelMode[] = ['auto', 'rgb', 'rgba', 'stack', 'single']

function asNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function toFormInitial(session: CustomFormatSessionState) {
  return {
    channelIndex: session.channelIndex,
    channelMode: session.channelMode || 'single',
    channels: session.channels,
    dtype: session.dtype || 'uint8',
    endian: session.endian || 'little',
    height: session.height,
    layout: session.layout || 'HW',
    normalizeMax: session.normalizeMax,
    normalizeMin: session.normalizeMin,
    offset: session.offset || 0,
    pages: session.pages || 1,
    width: session.width,
  }
}

function formToSession(value: Record<string, unknown>): CustomFormatSessionState {
  return {
    channelIndex: asNumber(value.channelIndex),
    channelMode: value.channelMode as CustomImageChannelMode | undefined,
    channels: asNumber(value.channels),
    dtype: value.dtype as CustomImageDtype | undefined,
    endian: value.endian as CustomImageEndian | undefined,
    height: asNumber(value.height),
    layout: typeof value.layout === 'string' ? value.layout : undefined,
    normalizeMax: asNumber(value.normalizeMax),
    normalizeMin: asNumber(value.normalizeMin),
    offset: asNumber(value.offset),
    pages: asNumber(value.pages),
    width: asNumber(value.width),
  }
}

function CustomFormatToolbar(props: Props) {
  const { className = '', controller, image, variant = 'preview' } = props
  const { t } = useTranslation()
  const [rawOpen, setRawOpen] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [selectedPresetName, setSelectedPresetName] = useState<string>()
  const [applyFolderDefault, setApplyFolderDefault] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testMessage, setTestMessage] = useState('')
  const [dragPosition, setDragPosition] = useState<{ left: number, top: number } | null>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const suppressNextClickRef = useRef(false)
  const [form] = Form.useForm()

  const {
    customFormats,
    decodeOptions,
    isCustom,
    isNpy,
    isRawLike,
    probe,
    probeError,
    probeLoading,
    session,
    setCustomFormats,
    setSession,
  } = controller

  const layoutValidation = useMemo(() => normalizeCustomFormatLayout(session.layout || probe?.layout || ''), [probe?.layout, session.layout])
  const layoutValue = session.layout || probe?.layout || ''
  const layoutRank = probe?.shape?.length
  const layoutOptions = useMemo(() => {
    const options = getCustomFormatLayoutOptionsForRank(layoutRank)
    const normalized = normalizeCustomFormatLayout(layoutValue)
    if (
      normalized.valid
      && normalized.layout
      && isCustomFormatLayoutCompatibleWithRank(normalized.layout, layoutRank)
      && !options.includes(normalized.layout as any)
    ) {
      return [...options, normalized.layout]
    }
    return options
  }, [layoutRank, layoutValue])
  const rawExtensionPreset = useMemo(() => resolveRawExtensionPreset(customFormats, image), [customFormats, image])
  const rawFolderPreset = useMemo(() => {
    if (!image)
      return undefined
    const folderPath = (image.absDirPath || image.dirPath || '').replace(/\\/g, '/').replace(/\/+$/g, '')
    return Object.entries(customFormats.folderPresets || {})
      .map(([dir, preset]) => [dir.replace(/\\/g, '/').replace(/\/+$/g, ''), preset] as const)
      .filter(([dir, preset]) => {
        const extensions = (preset.extensions || []).map(ext => ext.replace(/^\./, '').toLowerCase())
        return (folderPath === dir || folderPath.startsWith(`${dir}/`))
          && (!extensions.length || extensions.includes((image.extname || '').toLowerCase()))
      })
      .sort((a, b) => b[0].length - a[0].length)[0]?.[1]
  }, [customFormats.folderPresets, image])
  const pageCount = Math.max(1, probe?.pageCount || session.pages || 1)
  const pageIndex = Math.max(0, Math.min(pageCount - 1, session.pageIndex || probe?.pageIndex || 0))
  const hasBatch = normalizeCustomFormatLayout(layoutValue).layout.includes('B') || pageCount > 1
  const shapeText = probe?.shape?.length ? probe.shape.join(' x ') : ''
  const rawPresetEntries = useMemo(() => {
    if (!image)
      return []
    const ext = (image.extname || '').toLowerCase()
    const items: Array<{ applyFolderDefault: boolean, label: string, presetOptions?: CustomImageDecodeOptions, presetName: string, value: string }> = []
    if (rawFolderPreset?.name) {
      items.push({
        applyFolderDefault: true,
        label: `${rawFolderPreset.name} (${t('im.folder_presets')})`,
        presetName: rawFolderPreset.name,
        presetOptions: rawFolderPreset.options,
        value: 'folder:current',
      })
    }
    Object.entries(customFormats.extensionPresets || {}).forEach(([key, preset]) => {
      const extensions = (preset.extensions || []).map(item => item.replace(/^\./, '').toLowerCase())
      if (!extensions.includes(ext))
        return
      const name = preset.name?.trim() || ext.toUpperCase()
      items.push({
        applyFolderDefault: false,
        label: `${name} (${t('im.extension_presets')})`,
        presetName: name,
        presetOptions: preset.options,
        value: `ext:${key}:${name}`,
      })
    })
    return items
  }, [customFormats.extensionPresets, image, rawFolderPreset?.name, t])
  const rawPresetOptions = useMemo(
    () => rawPresetEntries.map(({ label, value }) => ({ label, value })),
    [rawPresetEntries],
  )
  const toolbarClass = variant === 'editor'
    ? `vim-custom-format-toolbar vim-custom-format-toolbar-editor ${className}`
    : `fixed bottom-5 right-5 z-[10060] flex cursor-grab items-center gap-2 rounded-xl bg-[rgba(118,118,118,0.34)] px-2.5 py-2 text-white shadow-lg ring-1 ring-white/10 backdrop-blur-md active:cursor-grabbing ${className}`
  const toolbarStyle = dragPosition
    ? {
        bottom: 'auto',
        left: dragPosition.left,
        right: 'auto',
        top: dragPosition.top,
      }
    : undefined
  const buttonClass = variant === 'editor'
    ? ''
    : '!h-9 !w-9 !rounded-md !p-0 !text-white hover:!bg-white/10'

  const getToolbarPopupContainer = useCallback(() => toolbarRef.current || document.body, [])
  const getRawSelectPopupContainer = useCallback((trigger: HTMLElement) => {
    return (trigger.closest('[data-custom-format-toolbar]') as HTMLElement | null) || toolbarRef.current || document.body
  }, [])

  const beginDrag = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const toolbar = toolbarRef.current
    if (!toolbar)
      return
    const target = event.target as HTMLElement
    const isRawButton = isRawLike && !isNpy && !!target.closest('button')
    if (!isRawButton && target.closest('button,input,textarea,[role="button"],.ant-select,.ant-input-number,.ant-checkbox-wrapper,.ant-popover,.ant-tooltip,.ant-select-dropdown,[data-custom-format-raw-panel]')) {
      return
    }
    event.stopPropagation()
    const rect = toolbar.getBoundingClientRect()
    const start = {
      left: rect.left,
      pointerX: event.clientX,
      pointerY: event.clientY,
      top: rect.top,
    }
    let dragged = false
    const onMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - start.pointerX
      const dy = moveEvent.clientY - start.pointerY
      if (!dragged && Math.hypot(dx, dy) < 4)
        return
      dragged = true
      suppressNextClickRef.current = true
      moveEvent.preventDefault()
      const nextLeft = Math.max(8, Math.min(window.innerWidth - rect.width - 8, start.left + moveEvent.clientX - start.pointerX))
      const nextTop = Math.max(8, Math.min(window.innerHeight - rect.height - 8, start.top + moveEvent.clientY - start.pointerY))
      setDragPosition({ left: nextLeft, top: nextTop })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
  }, [isNpy, isRawLike])

  useEffect(() => {
    if (!rawOpen || !isRawLike)
      return
    form.setFieldsValue(toFormInitial(session))
  }, [form, isRawLike, rawOpen, session])

  useEffect(() => {
    if (!rawOpen || !isRawLike)
      return
    setPresetName(rawFolderPreset?.name || rawExtensionPreset?.name || '')
    setSelectedPresetName(undefined)
    setApplyFolderDefault(!!rawFolderPreset)
  }, [isRawLike, rawExtensionPreset?.name, rawFolderPreset?.name, rawOpen])

  const updateSession = useMemoizedFn((patch: Partial<CustomFormatSessionState>) => {
    setSession(prev => ({
      ...prev,
      ...patch,
    }))
  })

  const runRawProbe = useMemoizedFn(() => {
    if (!image)
      return
    setTesting(true)
    setTestMessage('')
    const values = form.getFieldsValue()
    const rawSession = formToSession(values)
    const options = buildCustomFormatDecodeOptions(rawSession, probe || undefined)
    vscodeApi.postMessage({
      cmd: CmdToVscode.probe_custom_image,
      data: { filePath: image.path, options },
    }, (result: { error?: string, height?: number, pageCount?: number, width?: number } | null) => {
      setTesting(false)
      if (!result || result.error) {
        setTestMessage(result?.error || t('im.operation_failed'))
        return
      }
      setSession(prev => ({ ...prev, ...rawSession, pageIndex: Math.min(prev.pageIndex || 0, Math.max(0, (result.pageCount || 1) - 1)) }))
      setTestMessage(`${result.width || 0} x ${result.height || 0}`)
    })
  })

  const applySelectedRawPreset = useMemoizedFn((value: string) => {
    setSelectedPresetName(value)
    const preset = rawPresetEntries.find(entry => entry.value === value)
    if (!preset?.presetOptions)
      return
    const nextSession = {
      ...session,
      ...formToSession({
        ...toFormInitial(session),
        ...preset.presetOptions,
        normalizeMax: preset.presetOptions.normalize?.max,
        normalizeMin: preset.presetOptions.normalize?.min,
      }),
    }
    setSession(prev => ({ ...prev, ...nextSession }))
    form.setFieldsValue(toFormInitial(nextSession))
    setPresetName(preset.presetName)
    setApplyFolderDefault(preset.applyFolderDefault)
    setTestMessage('')
  })

  const saveRawPreset = useMemoizedFn(() => {
    if (!image)
      return
    const values = form.getFieldsValue()
    const rawSession = formToSession(values)
    const options = buildCustomFormatDecodeOptions(rawSession, probe || undefined)
    setSession(prev => ({ ...prev, ...rawSession }))
    const name = presetName.trim() || image.extname.toUpperCase()
    setCustomFormats(applyFolderDefault
      ? buildRawFolderPresetConfig(customFormats, image, name, options)
      : buildRawExtensionPresetConfig(customFormats, image, name, options))
    setRawOpen(false)
  })

  const handleRawOpenChange = useMemoizedFn((nextOpen: boolean) => {
    if (suppressNextClickRef.current) {
      window.setTimeout(() => {
        suppressNextClickRef.current = false
      }, 0)
      return
    }
    setRawOpen(nextOpen)
  })

  const handleRawButtonClick = useMemoizedFn((event: React.MouseEvent<HTMLElement>) => {
    if (!suppressNextClickRef.current)
      return
    event.preventDefault()
    event.stopPropagation()
    window.setTimeout(() => {
      suppressNextClickRef.current = false
    }, 0)
  })

  const updateNpyLayout = useMemoizedFn((value: string, locked: boolean) => {
    const normalized = normalizeCustomFormatLayout(value)
    if (!normalized.valid)
      return
    if (normalized.layout && !isCustomFormatLayoutCompatibleWithRank(normalized.layout, layoutRank))
      return
    updateSession({ layout: normalized.layout, layoutLocked: locked, pageIndex: 0 })
  })

  if (!image || !isCustom)
    return null

  return (
    <div
      ref={toolbarRef}
      className={toolbarClass}
      style={toolbarStyle}
      data-custom-format-toolbar
      data-custom-format-kind={image.extname}
      onPointerDown={beginDrag}
    >
      {isNpy
        ? (
            <>
              <Select
                size='small'
                value={layoutValue || undefined}
                placeholder={t('im.axes_layout')}
                popupMatchSelectWidth={false}
                popupClassName='vim-custom-format-popup'
                getPopupContainer={getToolbarPopupContainer}
                className='min-w-[92px]'
                status={layoutValidation.valid ? undefined : 'error'}
                options={layoutOptions.map(value => ({ label: value, value }))}
                showSearch
                onSearch={value => updateNpyLayout(value, true)}
                onChange={value => updateNpyLayout(value, true)}
                onInputKeyDown={event => event.stopPropagation()}
              />
              {hasBatch
                ? (
                    <div className='flex items-center gap-1 tabular-nums'>
                      <Button className={buttonClass} size='small' type='text' icon={<FiChevronLeft />} disabled={pageIndex <= 0} onClick={() => updateSession({ pageIndex: pageIndex - 1 })} />
                      <InputNumber
                        size='small'
                        min={1}
                        max={pageCount}
                        value={pageIndex + 1}
                        controls={false}
                        className='w-[54px]'
                        onChange={value => updateSession({ pageIndex: Math.max(0, Math.min(pageCount - 1, Number(value || 1) - 1)) })}
                        onKeyDown={event => event.stopPropagation()}
                      />
                      <Typography.Text className={variant === 'preview' ? '!text-white/82' : ''}>
                        /
                        {pageCount}
                      </Typography.Text>
                      <Button className={buttonClass} size='small' type='text' icon={<FiChevronRight />} disabled={pageIndex >= pageCount - 1} onClick={() => updateSession({ pageIndex: pageIndex + 1 })} />
                    </div>
                  )
                : null}
              <Tooltip title={shapeText || probeError || (probeLoading ? t('im.loading') : '')}>
                <Typography.Text className={`max-w-[160px] truncate text-xs ${variant === 'preview' ? '!text-white/72' : ''}`}>
                  {shapeText || (probeLoading ? '...' : probeError)}
                </Typography.Text>
              </Tooltip>
            </>
          )
        : null}
      {isRawLike
        ? (
            <Popover
              open={rawOpen}
              onOpenChange={handleRawOpenChange}
              trigger='click'
              placement={variant === 'preview' ? 'topRight' : 'bottomRight'}
              getPopupContainer={getToolbarPopupContainer}
              overlayClassName='vim-custom-format-popover'
              zIndex={10070}
              content={(
                <div className='max-h-[min(520px,calc(100vh-88px))] w-[320px] max-w-[calc(100vw-32px)] overflow-auto p-1' data-custom-format-raw-panel>
                  <Form
                    form={form}
                    size='small'
                    layout='vertical'
                    initialValues={toFormInitial(session)}
                    onValuesChange={() => setTestMessage('')}
                    className='vim-custom-format-raw-form'
                  >
                    {rawPresetOptions.length
                      ? (
                          <Form.Item label={t('im.extension_presets')} className='!mb-2'>
                            <Select
                              allowClear
                              value={selectedPresetName}
                              options={rawPresetOptions}
                              placeholder={t('im.loading')}
                              popupClassName='vim-custom-format-popup'
                              getPopupContainer={getRawSelectPopupContainer}
                              onChange={value => value ? applySelectedRawPreset(value) : setSelectedPresetName(undefined)}
                            />
                          </Form.Item>
                        )
                      : null}
                    <div className='grid grid-cols-2 gap-x-2'>
                      <Form.Item label={t('im.width')} name='width' rules={[{ required: true }]} className='!mb-2'>
                        <InputNumber min={1} className='w-full' />
                      </Form.Item>
                      <Form.Item label={t('im.height')} name='height' rules={[{ required: true }]} className='!mb-2'>
                        <InputNumber min={1} className='w-full' />
                      </Form.Item>
                      <Form.Item label={t('im.dtype')} name='dtype' className='!mb-2'>
                        <Select popupClassName='vim-custom-format-popup' getPopupContainer={getRawSelectPopupContainer} options={dtypeOptions.map(value => ({ label: value, value }))} />
                      </Form.Item>
                      <Form.Item label={t('im.endian')} name='endian' className='!mb-2'>
                        <Select popupClassName='vim-custom-format-popup' getPopupContainer={getRawSelectPopupContainer} options={endianOptions.map(value => ({ label: value === 'little' ? t('im.little_endian') : t('im.big_endian'), value }))} />
                      </Form.Item>
                      <Form.Item label={t('im.channels')} name='channels' className='!mb-2'>
                        <InputNumber min={1} max={1024} className='w-full' />
                      </Form.Item>
                      <Form.Item label={t('im.pages')} name='pages' className='!mb-2'>
                        <InputNumber min={1} max={100000} className='w-full' />
                      </Form.Item>
                      <Form.Item label={t('im.offset')} name='offset' className='!mb-2'>
                        <InputNumber min={0} className='w-full' />
                      </Form.Item>
                      <Form.Item label={t('im.axes_layout')} name='layout' className='!mb-2'>
                        <Select
                          showSearch
                          options={getCustomFormatLayoutOptionsForRank(undefined).map(value => ({ label: value, value }))}
                          popupClassName='vim-custom-format-popup'
                          getPopupContainer={getRawSelectPopupContainer}
                          onSearch={value => form.setFieldValue('layout', normalizeCustomFormatLayout(value).layout || value)}
                        />
                      </Form.Item>
                      <Form.Item label={t('im.channel_mode')} name='channelMode' className='!mb-2'>
                        <Select popupClassName='vim-custom-format-popup' getPopupContainer={getRawSelectPopupContainer} options={channelModeOptions.map(value => ({ label: value, value }))} />
                      </Form.Item>
                      <Form.Item label={t('im.channel_index')} name='channelIndex' className='!mb-2'>
                        <InputNumber min={0} className='w-full' />
                      </Form.Item>
                    </div>
                    <Space.Compact className='mb-2 w-full'>
                      <Form.Item label={t('im.normalize_range')} name='normalizeMin' className='!mb-0 flex-1'>
                        <InputNumber className='w-full' placeholder={t('im.min')} />
                      </Form.Item>
                      <Form.Item label=' ' name='normalizeMax' className='!mb-0 flex-1'>
                        <InputNumber className='w-full' placeholder={t('im.max')} />
                      </Form.Item>
                    </Space.Compact>
                  </Form>
                  <div className='mb-2 grid grid-cols-[72px_1fr] items-center gap-2'>
                    <Typography.Text className='text-xs' type='secondary'>{t('im.preset_name')}</Typography.Text>
                    <Input
                      size='small'
                      value={presetName}
                      placeholder={t('im.preset_name')}
                      onChange={event => setPresetName(event.target.value)}
                    />
                  </div>
                  <Checkbox className='text-xs' checked={applyFolderDefault} onChange={event => setApplyFolderDefault(event.target.checked)}>
                    {t('im.apply_preset_to_folder')}
                  </Checkbox>
                  <div className='mt-2 flex items-center justify-between gap-2'>
                    <Typography.Text type={testMessage.includes('x') ? 'secondary' : 'danger'} className='min-w-0 truncate text-xs'>
                      {testMessage || probeError}
                    </Typography.Text>
                    <Space size='small'>
                      <Button size='small' loading={testing} onClick={runRawProbe}>{t('im.test')}</Button>
                      <Button size='small' type='primary' icon={<FiSave />} onClick={saveRawPreset}>{t('im.save')}</Button>
                    </Space>
                  </div>
                </div>
              )}
            >
              <Button className={buttonClass} size='small' type={Object.keys(decodeOptions).length ? 'primary' : 'text'} icon={<FiSettings />} onClick={handleRawButtonClick} />
            </Popover>
          )
        : null}
    </div>
  )
}

export default CustomFormatToolbar
