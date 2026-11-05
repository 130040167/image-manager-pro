import { lazy } from 'react'
import { useTranslation } from 'react-i18next'
import useImperativeModal from '../use-imperative-modal'

const Settings = lazy(() => import('./settings'))

export default function useSettings() {
  const { t } = useTranslation()

  const { showModal } = useImperativeModal({
    modalProps: {
      className: 'vim-settings-modal',
      title: t('im.settings'),
      keyboard: true,
      width: 'min(920px, calc(100vw - 32px))',
      style: {
        maxHeight: 'calc(100vh - 24px)',
        maxWidth: 'calc(100vw - 32px)',
        minWidth: 'min(400px, calc(100vw - 32px))',
      },
      centered: true,
    },
    FC: Settings,
  })

  return {
    showSettings: showModal,
  }
}
