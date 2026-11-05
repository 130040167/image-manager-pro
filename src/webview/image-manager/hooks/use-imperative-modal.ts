import type { ModalFuncProps } from 'antd'
import { useImperativeAntdModal } from '~/webview/image-manager/hooks/use-imperative-antd-modal'

const Modal_Instance_Props: ModalFuncProps = {
  icon: null,
  maskClosable: false,
  keyboard: false,
  footer: null,
  width: '80%',
  zIndex: 10020,
  destroyOnClose: true,
  closable: true,
}

const useImperativeModal: typeof useImperativeAntdModal = (args) => {
  const { id, imperativeModalMap, isOpened, showModal, updateModal } = useImperativeAntdModal({
    ...args,
    modalProps: {
      ...Modal_Instance_Props,
      ...args.modalProps,
    },
  })

  return {
    showModal,
    updateModal,
    isOpened,
    id,
    imperativeModalMap,
  }
}

export default useImperativeModal
