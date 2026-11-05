import { useMemoizedFn } from 'ahooks'
import { Button, Empty, Input, Popover, Segmented, Space, Tabs, Tooltip } from 'antd'
import { useAtomValue, useSetAtom } from 'jotai'
import { memo, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IoIosMore } from 'react-icons/io'
import { MdCompress, MdOutlineTransform } from 'react-icons/md'
import { TbArrowsExchange2 } from 'react-icons/tb'
import { VscCopy, VscSearch } from 'react-icons/vsc'
import { slashPath } from '~/utils'
import useImageOperation from '~/webview/image-manager/hooks/use-image-operation'
import { ActionAtoms } from '~/webview/image-manager/stores/action/action-store'
import { FileAtoms } from '~/webview/image-manager/stores/file/file-store'
import { imageStateAtom } from '~/webview/image-manager/stores/image/image-store'
import { vscodeApi } from '~/webview/vscode-api'

function More() {
  const { t } = useTranslation()

  const openAllCollapse = useSetAtom(ActionAtoms.openAllCollapse)
  const closeAllCollapse = useSetAtom(ActionAtoms.closeAllCollapse)
  const selectedImages = useAtomValue(FileAtoms.imageSelected)
  const imageState = useAtomValue(imageStateAtom)
  const {
    beginCompressProcess,
    beginFindSimilarProcess,
    beginFormatConversionProcess,
    copyImageAsBase64,
  } = useImageOperation()

  const [open, setOpen] = useState(false)
  const [toolKey, setToolKey] = useState('compress')

  const toggleAllCollapse = useMemoizedFn((open: boolean) => {
    open
      ? openAllCollapse()
      : closeAllCollapse()
  })

  const workspaceImages = useMemo(() => imageState.workspaces.flatMap(workspace => workspace.images), [imageState.workspaces])
  const firstImage = selectedImages[0]
  const disabled = selectedImages.length === 0
  const toolOutputDirs = useMemo<Record<string, string>>(() => ({
    compress: 'compress',
    convert: 'convert',
    similar: 'similar-images',
  }), [])
  const defaultOutputDir = useMemo(() => {
    if (!firstImage)
      return ''
    return slashPath(`${firstImage.absDirPath}/${toolOutputDirs[toolKey] || 'more-tools'}`)
  }, [firstImage, toolOutputDirs, toolKey])
  const [outputDir, setOutputDir] = useState('')
  const resolvedOutputDir = outputDir || defaultOutputDir
  useEffect(() => {
    vscodeApi.log('debug', '[tools] output path resolved', {
      defaultOutputDir,
      resolvedOutputDir,
      toolKey,
      selectedCount: selectedImages.length,
      firstPath: firstImage?.path,
    })
  }, [defaultOutputDir, firstImage?.path, resolvedOutputDir, selectedImages.length, toolKey])
  const logToolAction = useMemoizedFn((action: string, extra?: Record<string, unknown>) => {
    vscodeApi.log('debug', '[tools] more panel action', {
      action,
      count: selectedImages.length,
      outputDir: resolvedOutputDir,
      selectedPaths: selectedImages.slice(0, 5).map(image => image.path),
      toolKey,
      ...extra,
    })
  })

  return (
    <Popover
      title={t('im.more_tools')}
      trigger={['click']}
      placement='left'
      open={open}
      onOpenChange={(open) => {
        setOpen(open)
        vscodeApi.log('debug', '[tools] more panel open change', {
          open,
          selectedCount: selectedImages.length,
          toolKey,
          defaultOutputDir,
          outputDir: resolvedOutputDir,
        })
      }}
      arrow={false}
      rootClassName='select-none'
      content={(
        <div className='w-[420px]'>
          <Tabs
            size='small'
            items={[
              {
                key: 'tools',
                label: t('im.more_tools'),
                children: disabled
                  ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('im.no_image')} />
                  : (
                      <div className='flex flex-col gap-3'>
                        <Segmented
                          block
                          value={toolKey}
                          onChange={(value) => {
                            setToolKey(String(value))
                            vscodeApi.log('debug', '[tools] more panel tab change', {
                              nextTool: String(value),
                              selectedCount: selectedImages.length,
                              resolvedOutputDir,
                              defaultOutputDir,
                            })
                          }}
                          options={[
                            { label: t('im.compress'), value: 'compress' },
                            { label: t('im.convert_format'), value: 'convert' },
                            { label: t('im.find_similar_images'), value: 'similar' },
                          ]}
                        />
                        <div className='flex flex-col gap-1.5'>
                          <div className='text-xs text-ant-color-text-secondary'>{t('im.output_path')}</div>
                          <Input
                            value={resolvedOutputDir}
                            onChange={(e) => {
                              setOutputDir(e.target.value)
                              vscodeApi.log('debug', '[tools] output path input', {
                                value: e.target.value,
                                toolKey,
                                defaultOutputDir,
                              })
                            }}
                            placeholder={t('im.output_path_placeholder')}
                            allowClear
                          />
                        </div>
                        <div className='grid grid-cols-2 gap-2'>
                          <Button
                            icon={<MdCompress />}
                            type={toolKey === 'compress' ? 'primary' : 'default'}
                            onClick={() => {
                              logToolAction('compress')
                              beginCompressProcess(selectedImages, { outputDir: resolvedOutputDir })
                            }}
                          >
                            {t('im.compress')}
                          </Button>
                          <Button
                            icon={<TbArrowsExchange2 />}
                            type={toolKey === 'convert' ? 'primary' : 'default'}
                            onClick={() => {
                              logToolAction('convert')
                              beginFormatConversionProcess(selectedImages, { outputDir: resolvedOutputDir })
                            }}
                          >
                            {t('im.convert_format')}
                          </Button>
                          <Button
                            icon={<VscSearch />}
                            disabled={!firstImage}
                            type={toolKey === 'similar' ? 'primary' : 'default'}
                            onClick={() => {
                              logToolAction('similar', { workspaceCount: workspaceImages.length })
                              firstImage && beginFindSimilarProcess(firstImage, workspaceImages)
                            }}
                          >
                            {t('im.find_similar_images')}
                          </Button>
                          <Button
                            icon={<VscCopy />}
                            disabled={!firstImage}
                            onClick={async () => {
                              if (!firstImage)
                                return
                              logToolAction('copy-base64')
                              const dataUrl = await copyImageAsBase64(firstImage.path)
                              await navigator.clipboard.writeText(dataUrl)
                            }}
                          >
                            {t('im.copy_image_base64')}
                          </Button>
                        </div>
                      </div>
                    ),
              },
              {
                key: 'folders',
                label: t('im.folder'),
                children: (
                  <Space.Compact>
                    <Button
                      icon={<MdOutlineTransform />}
                      onClick={() => {
                        setOpen(false)
                        toggleAllCollapse(true)
                      }}
                    >
                      {t('im.expand')}
                    </Button>
                    <Button
                      onClick={() => {
                        setOpen(false)
                        toggleAllCollapse(false)
                      }}
                    >
                      {t('im.collapse')}
                    </Button>
                  </Space.Compact>
                ),
              },
            ]}
          />
        </div>
      )}
    >
      <Tooltip title={t('im.more_tools')} arrow={false} placement='bottom'>
        <Button
          type='text'
          icon={(
            <div className='flex items-center text-xl'>
              <IoIosMore />
            </div>
          )}
        />
      </Tooltip>
    </Popover>
  )
}

export default memo(More)
