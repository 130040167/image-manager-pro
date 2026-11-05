import { lazy } from 'react'
import { useTranslation } from 'react-i18next'
import useImperativeModal from '../use-imperative-modal'

const loadImageSearch = () => import('./image-search')
const ImageSearch = lazy(loadImageSearch)

export function preloadImageSearch() {
  void loadImageSearch()
}

/**
 * 查找图片弹窗
 */
export default function useImageSearch() {
  const { t } = useTranslation()

  const { showModal, id, imperativeModalMap } = useImperativeModal({
    modalProps: {
      title: t('im.search_image'),
      keyboard: false,
      width: 900,
    },
    FC: ImageSearch,
  })

  return {
    showImageSearch: showModal,
    id,
    imperativeModalMap,
  }
}
