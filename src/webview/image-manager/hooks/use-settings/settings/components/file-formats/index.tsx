import type { FileFormatsDraft } from './model'
import type { CustomFormatConfig, CustomImageKind, CustomImagePreset } from '~/core/custom-format/types'
import { useMemoizedFn } from 'ahooks'
import { App, Button, Collapse, Form, Input, InputNumber, Select, Space, Tag, Typography } from 'antd'
import { isEqual, uniq } from 'es-toolkit'
import { memo, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FiPlus, FiRotateCcw, FiSave, FiTrash2 } from 'react-icons/fi'
import styles from '../../index.module.css'
import {
  addExtensionToDraft,
  CHANNEL_MODE_OPTIONS,
  createFileFormatsDraft,
  DTYPE_OPTIONS,

  formValueToPreset,
  LAYOUT_OPTIONS,
  normalizeDir,
  normalizeExt,
  presetToFormValue,
  removeExtensionFromDraft,
  removeFolderPresetDraft,
  updateExtensionPresetDraft,
  updateFolderPresetDraft,
} from './model'

type Props = {
  customFormats: CustomFormatConfig
  onCustomFormatsChange: (value: CustomFormatConfig) => void
  onScanChange: (value: string[]) => void
  scan: string[]
}

const BUILTIN_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'tif', 'tiff', 'svg', 'bmp', 'ico', 'avif', 'heif', 'heic', 'apng', 'npy']

function PresetForm(props: {
  id: string
  onChange: (preset: CustomImagePreset) => void
  preset: CustomImagePreset
  showExtensions?: boolean
}) {
  const { id, onChange, preset, showExtensions = false } = props
  const { t } = useTranslation()
  const [form] = Form.useForm()

  useEffect(() => {
    form.setFieldsValue(presetToFormValue(preset))
  }, [form, preset])

  const submitDraft = useMemoizedFn(() => {
    const value = form.getFieldsValue()
    onChange(formValueToPreset(id, value, preset))
  })

  return (
    <Form
      form={form}
      size='small'
      layout='vertical'
      initialValues={presetToFormValue(preset)}
      onValuesChange={submitDraft}
      className={styles.fileFormatPresetForm}
    >
      <div className={styles.fileFormatPresetGrid}>
        <Form.Item label={t('im.kind')} name='kind' className={styles.presetFieldWide}>
          <Select options={[
            { label: 'NPY', value: 'npy' },
            { label: 'Raw / Dat / Bin', value: 'raw' },
          ]}
          />
        </Form.Item>
        <Form.Item label={t('im.name')} name='name' className={styles.presetFieldWide}>
          <Input />
        </Form.Item>
        {showExtensions
          ? (
              <Form.Item label={t('im.file_suffix')} name='extensions' className={styles.presetFieldFull}>
                <Input placeholder='raw, dat, img, vol' />
              </Form.Item>
            )
          : null}
        <Form.Item label={t('im.width')} name='width' className={styles.presetField}>
          <InputNumber min={1} className='w-full' />
        </Form.Item>
        <Form.Item label={t('im.height')} name='height' className={styles.presetField}>
          <InputNumber min={1} className='w-full' />
        </Form.Item>
        <Form.Item label={t('im.channels')} name='channels' className={styles.presetField}>
          <InputNumber min={1} max={1024} className='w-full' />
        </Form.Item>
        <Form.Item label={t('im.pages')} name='pages' className={styles.presetField}>
          <InputNumber min={1} max={100000} className='w-full' />
        </Form.Item>
        <Form.Item label={t('im.dtype')} name='dtype' className={styles.presetField}>
          <Select options={DTYPE_OPTIONS.map(value => ({ label: value, value }))} />
        </Form.Item>
        <Form.Item label={t('im.endian')} name='endian' className={styles.presetField}>
          <Select options={[
            { label: t('im.little_endian'), value: 'little' },
            { label: t('im.big_endian'), value: 'big' },
          ]}
          />
        </Form.Item>
        <Form.Item label={t('im.offset')} name='offset' className={styles.presetField}>
          <InputNumber min={0} className='w-full' />
        </Form.Item>
        <Form.Item label={t('im.axes_layout')} name='layout' className={styles.presetField}>
          <Select
            showSearch
            options={LAYOUT_OPTIONS.map(value => ({ label: value, value }))}
          />
        </Form.Item>
        <Form.Item label={t('im.channel_mode')} name='channelMode' className={styles.presetFieldWide}>
          <Select options={CHANNEL_MODE_OPTIONS.map(value => ({ label: value, value }))} />
        </Form.Item>
        <Form.Item label={t('im.channel_index')} name='channelIndex' className={styles.presetField}>
          <InputNumber min={0} className='w-full' />
        </Form.Item>
        <Form.Item label={t('im.page_index')} name='pageIndex' className={styles.presetField}>
          <InputNumber min={0} className='w-full' />
        </Form.Item>
        <div className={styles.presetRangeGroup}>
          <Form.Item label={t('im.normalize_range')} name='normalizeMin'>
            <InputNumber className='w-full' placeholder={t('im.min')} />
          </Form.Item>
          <Form.Item label=' ' name='normalizeMax'>
            <InputNumber className='w-full' placeholder={t('im.max')} />
          </Form.Item>
        </div>
      </div>
    </Form>
  )
}

function FileFormats(props: Props) {
  const { customFormats, onCustomFormatsChange, onScanChange, scan } = props
  const { message } = App.useApp()
  const { t } = useTranslation()
  const [draftExts, setDraftExts] = useState('')
  const [draftPresetName, setDraftPresetName] = useState('')
  const [draftKind, setDraftKind] = useState<CustomImageKind>('raw')
  const [draftFolder, setDraftFolder] = useState('')
  const [draft, setDraft] = useState<FileFormatsDraft>(() => createFileFormatsDraft(scan, customFormats))

  useEffect(() => {
    setDraft(createFileFormatsDraft(scan, customFormats))
  }, [customFormats, scan])

  const dirty = useMemo(() => {
    const current = createFileFormatsDraft(scan, customFormats)
    return !isEqual(current, draft)
  }, [customFormats, draft, scan])

  const extensionPresets = draft.customFormats.extensionPresets || {}
  const folderPresets = draft.customFormats.folderPresets || {}

  const addExt = useMemoizedFn(() => {
    setDraft(prev => addExtensionToDraft(prev, {
      extensions: draftExts,
      kind: draftKind,
      name: draftPresetName,
    }))
    setDraftExts('')
    setDraftPresetName('')
  })

  const removeExt = useMemoizedFn((ext: string) => {
    setDraft(prev => removeExtensionFromDraft(prev, ext))
  })

  const addFolder = useMemoizedFn(() => {
    const dir = normalizeDir(draftFolder)
    if (!dir)
      return
    setDraft(prev => updateFolderPresetDraft(prev, dir, {
      extensions: [],
      kind: 'raw',
      name: dir.split('/').pop() || 'Raw preset',
      options: {
        channelMode: 'single',
        channels: 1,
        dtype: 'uint8',
        endian: 'little',
        height: 512,
        layout: 'HW',
        offset: 0,
        pages: 1,
        width: 512,
      },
    }))
    setDraftFolder('')
  })

  const removeFolder = useMemoizedFn((dir: string) => {
    setDraft(prev => removeFolderPresetDraft(prev, dir))
  })

  const applyDraft = useMemoizedFn(() => {
    if (!isEqual(draft.scan, scan.map(normalizeExt).filter(Boolean))) {
      onScanChange(draft.scan)
    }
    if (!isEqual(draft.customFormats, customFormats)) {
      onCustomFormatsChange(draft.customFormats)
    }
    message.success(t('im.modify_success'))
  })

  const resetDraft = useMemoizedFn(() => {
    setDraft(createFileFormatsDraft(scan, customFormats))
  })

  const presetExts = uniq([...draft.scan, ...Object.keys(extensionPresets)]).sort()
  const visiblePresetExts = presetExts.filter(ext => extensionPresets[ext] || !BUILTIN_EXTS.includes(ext))
  const folderKeys = Object.keys(folderPresets).sort()

  return (
    <div className={`${styles.fileFormatsRoot} flex flex-col gap-3`}>
      <div>
        <Typography.Text strong>{t('im.file_suffix')}</Typography.Text>
        <div className={`mt-2 ${styles.fileFormatControls}`}>
          <Input
            value={draftExts}
            onChange={e => setDraftExts(e.target.value)}
            placeholder='raw, dat, img'
            onPressEnter={addExt}
          />
          <Input
            value={draftPresetName}
            onChange={e => setDraftPresetName(e.target.value)}
            placeholder={t('im.preset_name')}
            onPressEnter={addExt}
          />
          <Select
            value={draftKind}
            onChange={setDraftKind}
            options={[
              { label: 'Raw-like', value: 'raw' },
              { label: 'NPY', value: 'npy' },
            ]}
          />
          <Button icon={<FiPlus />} onClick={addExt}>{t('im.add')}</Button>
        </div>
        <div className={`mt-2 ${styles.fileFormatTagList}`}>
          {draft.scan.map(ext => (
            <Tag
              key={ext}
              className={styles.fileFormatTag}
              closeIcon={<FiTrash2 className={styles.fileFormatTagCloseIcon} />}
              onClose={(e) => {
                e.preventDefault()
                removeExt(ext)
              }}
            >
              {ext}
            </Tag>
          ))}
        </div>
      </div>

      <Collapse
        size='small'
        items={[
          {
            key: 'extension',
            label: t('im.extension_presets'),
            children: (
              <Collapse
                size='small'
                items={visiblePresetExts.map(ext => ({
                  key: ext,
                  label: (
                    <div className='flex min-w-0 items-center justify-between gap-3'>
                      <span className='min-w-0 truncate'>
                        {ext}
                        {extensionPresets[ext]?.name ? ` · ${extensionPresets[ext].name}` : ''}
                      </span>
                      <Button
                        danger
                        size='small'
                        type='text'
                        icon={<FiTrash2 />}
                        onClick={(e) => {
                          e.stopPropagation()
                          removeExt(ext)
                        }}
                      />
                    </div>
                  ),
                  children: (
                    <PresetForm
                      id={ext}
                      preset={extensionPresets[ext] || addExtensionToDraft(createFileFormatsDraft([], { extensionPresets: {}, folderPresets: {} }), { extensions: ext }).customFormats.extensionPresets[ext]}
                      showExtensions
                      onChange={preset => setDraft(prev => updateExtensionPresetDraft(prev, ext, preset))}
                    />
                  ),
                }))}
              />
            ),
          },
          {
            key: 'folder',
            label: t('im.folder_presets'),
            children: (
              <div className='flex flex-col gap-3'>
                <Space.Compact>
                  <Input
                    value={draftFolder}
                    onChange={e => setDraftFolder(e.target.value)}
                    placeholder='C:/images/raw-set'
                    onPressEnter={addFolder}
                  />
                  <Button icon={<FiPlus />} onClick={addFolder}>{t('im.add')}</Button>
                </Space.Compact>
                <Collapse
                  size='small'
                  items={folderKeys.map(dir => ({
                    key: dir,
                    label: (
                      <div className='flex min-w-0 items-center justify-between gap-3'>
                        <span className='min-w-0 truncate'>
                          {dir}
                          {folderPresets[dir]?.name ? ` · ${folderPresets[dir].name}` : ''}
                        </span>
                        <Button
                          danger
                          size='small'
                          type='text'
                          icon={<FiTrash2 />}
                          onClick={(e) => {
                            e.stopPropagation()
                            removeFolder(dir)
                          }}
                        />
                      </div>
                    ),
                    children: (
                      <PresetForm
                        id={dir}
                        preset={folderPresets[dir]}
                        showExtensions
                        onChange={preset => setDraft(prev => updateFolderPresetDraft(prev, dir, preset))}
                      />
                    ),
                  }))}
                />
              </div>
            ),
          },
        ]}
      />

      <div className='sticky bottom-0 flex items-center justify-between gap-3 border-t border-white/10 bg-[var(--vscode-editor-background)] py-3'>
        <Typography.Text type={dirty ? 'warning' : 'secondary'}>
          {dirty ? t('im.unsaved_changes') : t('im.settings_saved')}
        </Typography.Text>
        <Space>
          <Button icon={<FiRotateCcw />} disabled={!dirty} onClick={resetDraft}>{t('im.reset')}</Button>
          <Button type='primary' icon={<FiSave />} disabled={!dirty} onClick={applyDraft}>{t('im.save')}</Button>
        </Space>
      </div>
    </div>
  )
}

export default memo(FileFormats)
