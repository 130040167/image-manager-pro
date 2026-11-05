import type { FormComponent } from '../use-operation/use-operation-form-logic'
import type { CompressionOptions } from '~/core/operator/compressor/type'
import type { ImperativeModalProps } from '~/webview/image-manager/hooks/use-imperative-antd-modal'
import { useMemoizedFn } from 'ahooks'
import { Alert, Button, Divider, Form, Input, InputNumber, Segmented, Select, Spin, Tooltip } from 'antd'
import { intersection, mapValues } from 'es-toolkit'
import { defaults } from 'es-toolkit/compat'
import { flatten as flattenObject, unflatten } from 'flat'
import { useAtomValue, useSetAtom } from 'jotai'
import { motion } from 'motion/react'
import { memo, useEffect, useMemo, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { BsQuestionCircleFill } from 'react-icons/bs'
import { DEFAULT_CONFIG } from '~/core/config/common'
import { CmdToVscode } from '~/message/cmd'
import { vscodeApi } from '~/webview/vscode-api'
import ImageOperator from '../../components/image-operator'
import Format from '../../components/image-operator/components/format'
import KeepOriginal from '../../components/image-operator/components/keep-original'
import SkipCompressed from '../../components/image-operator/components/skip-compressed'
import { GlobalAtoms } from '../../stores/global/global-store'
import { ANIMATION_DURATION } from '../../utils/duration'
import { ensureOperatorBootstrap, requestOperator } from '../../utils/operator-bootstrap'
import useImageOperation from '../use-image-operation'
import useOperationFormLogic, { OperatorMode } from '../use-operation/use-operation-form-logic'
import {
  includesCompressionTargetFormat,
  resolveCompressionTargetFormats,
  shouldShowCompressionQuality,
} from './compression-target-formats'
import styles from './index.module.css'

type FormValue = CompressionOptions & {
  customResize?: number
}

type Props = {
  defaults?: {
    outputDir?: string
  }
  images: ImageType[]
  /**
   * 上层控制渲染表单字段
   */
  fields?: FormComponent<CompressionOptions>
}

function ImageCompressor(props: Props & ImperativeModalProps) {
  const { defaults: defaultOptions, images: imagesProp, fields, closeModal } = props

  const { t } = useTranslation()

  const [form] = Form.useForm()

  const { beginCompressProcess } = useImageOperation()

  const {
    images,
    submitting,
    setSubmitting,
    onFinish: onOperationFinish,
    setImages,
  } = useOperationFormLogic<FormValue>({
    apiCommand: CmdToVscode.compress_image,
    images: imagesProp,
    onOperation: {
      onRedoClick(images) {
        beginCompressProcess(images)
      },
      onSuccess() {
        closeModal()
      },
      operationMode: OperatorMode.compression,
    },
  })

  const compressor = useAtomValue(GlobalAtoms.compressorAtom)
  const setCompressor = useSetAtom(GlobalAtoms.compressorAtom)
  const setFormatConverter = useSetAtom(GlobalAtoms.formatConverterAtom)
  const compressorReady = !!compressor?.option && !!compressor?.limit
  const [bootstrapError, setBootstrapError] = useState('')
  const [bootstrapRetry, setBootstrapRetry] = useState(0)

  useEffect(() => {
    vscodeApi.log(compressorReady ? 'debug' : 'warn', '[tools] compressor bootstrap state', {
      hasLimit: !!compressor?.limit,
      hasOption: !!compressor?.option,
      imageCount: imagesProp.length,
      ready: compressorReady,
    })
  }, [compressor?.limit, compressor?.option, compressorReady, imagesProp.length])

  useEffect(() => {
    if (compressorReady)
      return
    let disposed = false
    setBootstrapError('')
    void ensureOperatorBootstrap({
      getCompressor: () => requestOperator(CmdToVscode.get_compressor, 'Compressor'),
      getFormatConverter: () => requestOperator(CmdToVscode.get_format_converter, 'Format converter'),
      log: vscodeApi.log,
    })
      .then(({ compressor, formatConverter }) => {
        if (disposed)
          return
        setCompressor(compressor)
        setFormatConverter(formatConverter)
      })
      .catch((err) => {
        if (!disposed)
          setBootstrapError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      disposed = true
    }
  }, [bootstrapRetry, compressorReady, setCompressor, setFormatConverter])

  const onFinish = useMemoizedFn((_value: FormValue) => {
    const value = defaults(_value, flattenObject(compressor?.option) as AnyObject)
    vscodeApi.log('debug', '[tools] compressor submit', {
      count: images.length,
      outputDir: value.outputDir || defaultOptions?.outputDir || '',
      paths: images.slice(0, 5).map(image => image.path),
    })

    if (value) {
      if (Number(value.size) === 0) {
        value.size = value.customResize!
      }
      value.size = Number(value.size)
    }

    onOperationFinish(unflatten(value))
  })

  /* ------------------ 压缩配置相关 ------------------ */

  const [activeTab, setActiveTab] = useState<'not-svg' | 'svg'>('not-svg')
  const { svg: _svg, ...nonSvgOptions } = compressor?.option || {}
  const selectedFormat = Form.useWatch('format', form) as string | undefined

  const hasSomeImageType = useMemoizedFn((type: string) => {
    return images?.some(img => img.extname === type)
  })

  const hasAllImageType = useMemoizedFn((type: string) => {
    return images?.every(img => img.extname === type)
  })

  const [svgoOpenLoading, setSvgoOpenLoading] = useState(false)
  const targetFormats = useMemo(
    () => resolveCompressionTargetFormats(images, selectedFormat),
    [images, selectedFormat],
  )

  const tabList = [
    {
      value: 'not-svg',
      label: t('im.not_svg'),
      compressorOption: flattenObject(nonSvgOptions) as AnyObject,
      componentMap: {
        // png
        'png.compressionLevel': {
          el: () =>
            includesCompressionTargetFormat(targetFormats, 'png')
              ? (
                  <Form.Item
                    label={t('im.compress_level')}
                    name='png.compressionLevel'
                    tooltip={t('im.compress_level_tip')}
                  >
                    <InputNumber min={1} max={9} step={1} />
                  </Form.Item>
                )
              : null,
        },
        'quality': {
          el: () =>
            shouldShowCompressionQuality(targetFormats, compressor?.option || DEFAULT_CONFIG.compression)
              ? (
                  <Form.Item label={t('im.image_quality')} name='quality' tooltip={t('im.quality_tip')}>
                    <InputNumber min={1} max={100} step={10} />
                  </Form.Item>
                )
              : null,
        },
        'gif.colors': {
          el: () =>
            includesCompressionTargetFormat(targetFormats, 'gif')
              ? (
                  <Form.Item label={t('im.colors')} name='gif.colors' tooltip={t('im.colors_tip')}>
                    <InputNumber min={2} max={256} step={1} />
                  </Form.Item>
                )
              : null,
        },
        'tiff.compression': {
          el: () =>
            includesCompressionTargetFormat(targetFormats, 'tiff')
              ? (
                  <Form.Item label={t('im.tiff_compression')} name='tiff.compression' tooltip={t('im.tiff_compression_tip')}>
                    <Select
                      options={[
                        { label: 'LZW', value: 'lzw' },
                        { label: 'Deflate', value: 'deflate' },
                        { label: 'ZSTD', value: 'zstd' },
                        { label: 'JPEG', value: 'jpeg' },
                        { label: 'WebP', value: 'webp' },
                        { label: t('im.none'), value: 'none' },
                      ]}
                    />
                  </Form.Item>
                )
              : null,
        },
        'size': {
          el: () => (
            <div className='flex items-center'>
              <Form.Item label={t('im.image_size')} name='size' className='center'>
                <Segmented
                  options={[
                    {
                      value: 1,
                      label: '@1x',
                    },
                    {
                      value: 2,
                      label: '@2x',
                    },
                    {
                      value: 3,
                      label: '@3x',
                    },
                    {
                      value: 0,
                      label: t('im.custom'),
                    },
                  ]}
                >
                </Segmented>
              </Form.Item>
              <Form.Item noStyle shouldUpdate={(p, c) => p.size !== c.size}>
                {({ getFieldValue }) =>
                  getFieldValue('size') === 0
                    ? (
                        <Form.Item
                          name='customResize'
                          className={styles.custom_resize}
                          rules={[{ required: true, message: '' }]}
                        >
                          <InputNumber
                            placeholder={t('im.scale_factor')}
                            className='h-full'
                            min={0.01}
                            max={10}
                            step={1}
                          />
                        </Form.Item>
                      )
                    : null}
              </Form.Item>
            </div>
          ),
        },
        'format': {
          el: () => {
            return <Format exts={compressor?.limit?.to} />
          },
        },
      } as FormComponent<CompressionOptions>,
      hidden: hasAllImageType('svg'),
    },
    {
      value: 'svg',
      label: 'svg',
      compressorOption: { 'svg.tip': true },
      componentMap: {
        'svg.tip': {
          el: () => (
            <Alert
              className='mb-3'
              message={(
                <div className='flex items-center justify-center gap-x-2'>
                  <Trans
                    i18nKey='im.svgo_config'
                    components={[
                      <Button
                        key='svgo-config-button'
                        type='dashed'
                        className='mx-1 text-lg font-semibold'
                        loading={svgoOpenLoading}
                        onClick={() => {
                          setSvgoOpenLoading(true)
                          vscodeApi.postMessage({ cmd: CmdToVscode.open_svgo_config }, () => {
                            setSvgoOpenLoading(false)
                          })
                        }}
                      >
                      </Button>,
                    ]}
                  >
                  </Trans>
                  <Tooltip
                    mouseEnterDelay={0}
                    title={<Trans i18nKey='im.refer_to_svgo' components={[<a href='https://svgo.dev/' key='refer_to_svgo'></a>]}></Trans>}
                  >
                    <BsQuestionCircleFill className='cursor-pointer' />
                  </Tooltip>
                </div>
              )}
              type='info'
            />
          ),
        },
      },
      hidden: !hasSomeImageType('svg'),
    },
  ]

  useEffect(() => {
    if (!open || !images.length)
      return
    if (hasAllImageType('svg')) {
      // 全都是svg
      setActiveTab('svg')
    }
    else if (!hasSomeImageType('svg')) {
      // 全都不是svg
      setActiveTab('not-svg')
    }
  }, [images])

  const allCompressorOption = useMemo(
    () =>
      defaults(
        mapValues(fields || {}, item => item?.value),
        flattenObject({
          ...(compressor?.option || {}),
          ...defaultOptions,
        }) as AnyObject,
      ),
    [compressor?.option, defaultOptions, fields],
  )

  const allComponents = useMemo(() => {
    return tabList.reduce((prev, current) => {
      return {
        ...prev,
        ...current.componentMap,
      }
    }, {} as FormComponent<CompressionOptions>)
  }, [tabList])

  const displayComponents = useMemo(() => {
    const active = tabList.find(item => item.value === activeTab)!
    return {
      keys: intersection(Object.keys(active.componentMap), Object.keys(active.compressorOption)),
      componentMap: active.componentMap,
    }
  }, [tabList, activeTab])

  const displayTabs = useMemo(() => tabList.filter(item => !item.hidden), [tabList])

  if (!compressorReady) {
    return (
      <div className='flex min-h-40 flex-col items-center justify-center gap-3 p-4'>
        {bootstrapError
          ? (
              <Alert
                showIcon
                type='error'
                message={t('im.operation_failed')}
                description={bootstrapError}
                action={(
                  <Button size='small' onClick={() => setBootstrapRetry(value => value + 1)}>
                    {t('im.retry')}
                  </Button>
                )}
              />
            )
          : (
              <>
                <Spin />
                <div className='text-sm text-ant-color-text-secondary'>{t('im.wait')}</div>
              </>
            )}
      </div>
    )
  }

  return (
    <ImageOperator
      images={images}
      onImagesChange={setImages}
      form={form}
      submitting={submitting}
      onSubmittingChange={setSubmitting}
    >
      <div className='flex flex-col'>
        {displayTabs.length > 1
          ? (
              <motion.div
                initial={{
                  opacity: 0,
                }}
                animate={{
                  opacity: 1,
                }}
                transition={{
                  duration: ANIMATION_DURATION.fast,
                }}
              >
                <div className='flex justify-center'>
                  <Segmented
                    options={displayTabs.map(t => ({
                      label: t.label,
                      value: t.value,
                    }))}
                    value={activeTab}
                    onChange={value => setActiveTab(value as typeof activeTab)}
                  >
                  </Segmented>
                </div>
                <Divider />
              </motion.div>
            )
          : null}
        <Form
          layout='horizontal'
          colon={false}
          name='image-compressor'
          initialValues={allCompressorOption}
          form={form}
          requiredMark={false}
          onFinish={onFinish}
        >
          <div className='overflow-auto'>
            {Object.keys(allComponents).map((key, index) => {
              return (
                <div key={index} hidden={!displayComponents.keys.includes(key)}>
                  {fields?.[key]?.el ? fields[key]?.el() : allComponents[key]?.el()}
                </div>
              )
            })}
          </div>

          {displayTabs.length > 1
            ? (
                <Divider plain className='!my-0'>
                  {t('im.universal')}
                </Divider>
              )
            : null}

          <SkipCompressed />

          <KeepOriginal />

          <Form.Item label={t('im.output_path')} name='outputDir'>
            <Input type='text' className='w-full' placeholder={t('im.output_path_placeholder')} />
          </Form.Item>

          <Form.Item noStyle shouldUpdate={(p, c) => p.keepOriginal !== c.keepOriginal}>
            {({ getFieldValue }) =>
              getFieldValue('keepOriginal')
                ? (
                    <Form.Item label={t('im.suffix')} name='fileSuffix' rules={[{ required: true, message: '' }]}>
                      <Input type='text' className='w-auto' placeholder={t('im.file_suffix')} />
                    </Form.Item>
                  )
                : null}
          </Form.Item>
        </Form>
      </div>
    </ImageOperator>
  )
}

export default memo(ImageCompressor)
