import type { Props as ImageOperatorProps } from '../../components/image-operator'
import type { FormComponent } from '../use-operation/use-operation-form-logic'
import type { FormatConverterOptions } from '~/core/operator/format-converter'
import type { ImperativeModalProps } from '~/webview/image-manager/hooks/use-imperative-antd-modal'
import { useMemoizedFn } from 'ahooks'
import { Alert, Button, Checkbox, Form, Input, Spin, Tag } from 'antd'
import { mergeWith } from 'es-toolkit'
import { isArray, isEmpty, toLower } from 'es-toolkit/compat'
import { useAtomValue, useSetAtom } from 'jotai'
import { memo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CmdToVscode } from '~/message/cmd'
import { vscodeApi } from '~/webview/vscode-api'
import ImageOperator from '../../components/image-operator'
import Format from '../../components/image-operator/components/format'
import KeepOriginal from '../../components/image-operator/components/keep-original'
import { GlobalAtoms } from '../../stores/global/global-store'
import { ensureOperatorBootstrap, requestOperator } from '../../utils/operator-bootstrap'
import useImageOperation from '../use-image-operation'
import useOperationFormLogic, { OperatorMode } from '../use-operation/use-operation-form-logic'

type Props = {
  defaults?: {
    outputDir?: string
  }
} & ImageOperatorProps

type FormValue = FormatConverterOptions

function ImageConverter(props: Props & ImperativeModalProps) {
  const { defaults: defaultOptions, images: imagesProp, closeModal } = props
  const { t } = useTranslation()

  const formatConverter = useAtomValue(GlobalAtoms.formatConverterAtom)
  const setCompressor = useSetAtom(GlobalAtoms.compressorAtom)
  const setFormatConverter = useSetAtom(GlobalAtoms.formatConverterAtom)
  const converterReady = !!formatConverter?.option && !!formatConverter?.limit
  const [bootstrapError, setBootstrapError] = useState('')
  const [bootstrapRetry, setBootstrapRetry] = useState(0)
  const [form] = Form.useForm()

  const { beginFormatConversionProcess } = useImageOperation()

  const {
    images,
    submitting,
    setSubmitting,
    onFinish: onOperationFinish,
    setImages,
  } = useOperationFormLogic<FormValue>({
    images: imagesProp,
    apiCommand: CmdToVscode.convert_image_format,
    onOperation: {
      onRedoClick(images) {
        beginFormatConversionProcess(images)
      },
      onSuccess() {
        closeModal()
      },
      operationMode: OperatorMode.conversion,
    },
  })

  useEffect(() => {
    vscodeApi.log(converterReady ? 'debug' : 'warn', '[tools] converter bootstrap state', {
      hasLimit: !!formatConverter?.limit,
      hasOption: !!formatConverter?.option,
      imageCount: imagesProp.length,
      ready: converterReady,
    })
  }, [converterReady, formatConverter?.limit, formatConverter?.option, imagesProp.length])

  useEffect(() => {
    if (converterReady)
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
  }, [bootstrapRetry, converterReady, setCompressor, setFormatConverter])

  const onFinish = useMemoizedFn((value: FormValue) => {
    vscodeApi.log('debug', '[tools] converter submit', {
      count: images.length,
      format: value.format,
      outputDir: value.outputDir || defaultOptions?.outputDir || '',
      paths: images.slice(0, 5).map(image => image.path),
    })
    value = mergeWith(formatConverter?.option || {}, value, (_, srcValue) => {
      if (isArray(srcValue))
        return srcValue
    })

    onOperationFinish({
      ...value,
      outputDir: value.outputDir || defaultOptions?.outputDir,
    })
  })

  const tab = {
    options: formatConverter?.option,
    componentMap: {
      format: {
        el: () => <Format exts={formatConverter?.limit.to} />,
      },
      grayscale: {
        el: () => (
          <Form.Item label={t('im.grayscale')} name='grayscale' valuePropName='checked'>
            <Checkbox />
          </Form.Item>
        ),
      },
      icoSize: {
        el: () => {
          const sizes = [16, 32, 48, 64, 128, 256]
          return (
            <Form.Item noStyle dependencies={['format']}>
              {({ getFieldValue }) => {
                if (toLower(getFieldValue('format')) !== 'ico')
                  return null
                const icoTooltips = [
                  [16, t('im.ico_16')],
                  [32, t('im.ico_32')],
                  [48, t('im.ico_48')],
                  [128, t('im.ico_128')],
                  [256, t('im.ico_256')],
                ]

                return (
                  <Form.Item
                    valuePropName='value'
                    label={t('im.ico_size')}
                    name='icoSize'
                    tooltip={(
                      <div className='space-y-2'>
                        {icoTooltips.map(([size, text], index) => {
                          return (
                            <div key={index}>
                              <div className='flex flex-col'>
                                <Tag className='w-fit'>
                                  {size}
                                  x
                                  {size}
                                </Tag>
                                <div>{text}</div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                    rules={[
                      ({ getFieldValue }) => ({
                        validator() {
                          const icoSize = getFieldValue('icoSize')
                          if (icoSize.length === 0) {
                            return Promise.reject(t('im.ico_size_empty'))
                          }
                          return Promise.resolve()
                        },
                      }),
                    ]}
                  >
                    <Checkbox.Group options={sizes.map(size => ({ label: size, value: size }))}></Checkbox.Group>
                  </Form.Item>
                )
              }}
            </Form.Item>
          )
        },
      },
      keepOriginal: {
        el: () => <KeepOriginal />,
      },
      outputDir: {
        el: () => (
          <Form.Item label={t('im.output_path')} name='outputDir'>
            <Input placeholder={t('im.output_path_placeholder')} />
          </Form.Item>
        ),
        value: defaultOptions?.outputDir,
      },
    } as FormComponent<FormatConverterOptions>,
  }

  if (!converterReady || isEmpty(formatConverter?.option)) {
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
      <Form
        layout='horizontal'
        colon={false}
        name='image-converter'
        initialValues={{ ...formatConverter?.option, ...defaultOptions }}
        form={form}
        requiredMark={false}
        onFinish={onFinish}
      >
        <div className='max-h-[600px] overflow-auto'>
          {Object.keys(tab.componentMap).map((key, index) => {
            return <div key={index}>{tab.componentMap[key]?.el()}</div>
          })}
        </div>
      </Form>
    </ImageOperator>
  )
}

export default memo(ImageConverter)
