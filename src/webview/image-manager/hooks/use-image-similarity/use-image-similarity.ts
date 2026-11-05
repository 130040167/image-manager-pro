import { lazy } from 'react'
import { useTranslation } from 'react-i18next'
import useImperativeModal from '../use-imperative-modal'
import { showOrUpdateSimilarityModal } from './similarity-ui'

const ImageSimilarity = lazy(() => import('./image-similarity'))

/**
 * 查看相似图片的弹窗
 */
export default function useImageSimilarity() {
  const { t } = useTranslation()

  const { isOpened, showModal, updateModal } = useImperativeModal({
    modalProps: {
      title: t('im.find_similar_images'),
    },
    FC: ImageSimilarity,
  })

  return {
    showImageSimilarity: (props: Parameters<typeof showModal>[0]) => {
      return showOrUpdateSimilarityModal({
        isOpened,
        showModal,
        updateModal,
      }, props)
    },
    isOpened,
  }
}
