import { lazy } from 'react'
import { useTranslation } from 'react-i18next'
import useImperativeModal from '../use-imperative-modal'

type ImageCompressorModule = typeof import('./image-compressor')
let imageCompressorPromise: Promise<ImageCompressorModule> | undefined
function loadImageCompressor() {
  imageCompressorPromise ||= import('./image-compressor')
  return imageCompressorPromise
}
const ImageCompressor = lazy(loadImageCompressor)

export function preloadImageCompressor() {
  return loadImageCompressor()
}

/**
 * 图片压缩的弹窗
 */
export default function useImageCompressor() {
  const { t } = useTranslation()

  const { showModal } = useImperativeModal({
    modalProps: {
      title: t('im.image_compression'),
    },
    FC: ImageCompressor,
  })

  return {
    showImageCompressor: showModal,
  }
}
