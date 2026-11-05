import { lazy } from 'react'
import { useTranslation } from 'react-i18next'
import useImperativeModal from '../use-imperative-modal'

type ImageConverterModule = typeof import('./image-converter')
let imageConverterPromise: Promise<ImageConverterModule> | undefined
function loadImageConverter() {
  imageConverterPromise ||= import('./image-converter')
  return imageConverterPromise
}
const ImageConverter = lazy(loadImageConverter)

export function preloadImageConverter() {
  return loadImageConverter()
}

/**
 * 转化图片格式的弹窗
 */
export default function useImageConverter() {
  const { t } = useTranslation()

  const { showModal } = useImperativeModal({
    modalProps: {
      title: t('im.convert_format'),
    },
    FC: ImageConverter,
  })

  return {
    showImageConverter: showModal,
  }
}
