import type { ModalFuncProps } from 'antd'
import type { HookAPI } from 'antd/es/modal/useModal'
import type { ComponentType, DependencyList } from 'react'
import { useDeepCompareEffect, useMemoizedFn } from 'ahooks'
import { App, Spin } from 'antd'
import { motion } from 'motion/react'
import { createElement, Suspense, useMemo, useRef } from 'react'
import { vscodeApi } from '~/webview/vscode-api'

export type ImperativeModalProps = {
  closeModal: () => void
}

export const imperativeModalMap: Map<string, ReturnType<HookAPI['confirm']>> = new Map()
const MODAL_LOG_PREFIX = '[modal]'

function randomId() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36).slice(-2)
}

export type Props = {
  id?: string
  modalProps?: ModalFuncProps
  /**
   * @description modal刷新依赖
   */
  deps?: DependencyList
}

export function useImperativeAntdModal<T extends object>(
  props: Props & {
    FC: ComponentType<T>
  },
) {
  const { FC, modalProps: initialModalProps, id: idProp, deps } = props
  const { modal } = App.useApp()

  const initialModalDetails = useMemo(
    () => ({
      id: idProp || '',
      genProps: () => ({}) as any,
      instance: undefined,
      modalProps: undefined,
      componentProps: undefined,
    }),
    [idProp],
  )

  const modalDetails = useRef<{
    id: string
    genProps: (
      modalProps: ModalFuncProps | undefined,
      componentProps: Omit<T, keyof ImperativeModalProps> | undefined,
    ) => ModalFuncProps
    instance: ReturnType<HookAPI['confirm']> | undefined
    modalProps: ModalFuncProps | undefined
    componentProps: Omit<T, keyof ImperativeModalProps> | undefined
  }>(initialModalDetails)

  const onClose = useMemoizedFn((id: string) => {
    vscodeApi.log('debug', `${MODAL_LOG_PREFIX} close`, { id })
    const instance = imperativeModalMap.get(id)
    instance?.destroy()
    imperativeModalMap.delete(id)
  })

  const updateOpenedModal = useMemoizedFn(
    (componentProps?: Omit<T, keyof ImperativeModalProps>, modalProps?: ModalFuncProps | undefined) => {
      if (!modalDetails.current.id) {
        vscodeApi.log('debug', `${MODAL_LOG_PREFIX} update skipped`, {
          reason: 'missing-id',
          title: String((modalProps?.title ?? initialModalProps?.title) || ''),
        })
        return
      }

      const instance = imperativeModalMap.get(modalDetails.current.id)
      if (!instance) {
        vscodeApi.log('debug', `${MODAL_LOG_PREFIX} update skipped`, {
          id: modalDetails.current.id,
          reason: 'missing-instance',
        })
        return
      }

      vscodeApi.log('debug', `${MODAL_LOG_PREFIX} update`, {
        id: modalDetails.current.id,
        title: String((modalProps?.title ?? initialModalProps?.title) || ''),
      })
      instance.update(modalDetails.current.genProps(modalProps, componentProps) || {})

      return {
        destroy: instance.destroy,
      }
    },
  )

  const showModal = useMemoizedFn(
    (componentProps: Omit<T, keyof ImperativeModalProps>, modalProps?: ModalFuncProps) => {
      if (imperativeModalMap.get(modalDetails.current.id)) {
        vscodeApi.log('debug', `${MODAL_LOG_PREFIX} show updates existing`, {
          id: modalDetails.current.id,
          title: String((modalProps?.title ?? initialModalProps?.title) || ''),
        })
        return updateOpenedModal(componentProps, modalProps)
      }

      const id = idProp || randomId()
      vscodeApi.log('debug', `${MODAL_LOG_PREFIX} show`, {
        id,
        hasModal: !!modal,
        title: String((modalProps?.title ?? initialModalProps?.title) || ''),
      })

      const genProps = (
        modalProps: ModalFuncProps | undefined,
        componentProps: Omit<T, keyof ImperativeModalProps> | undefined,
      ): ModalFuncProps => {
        modalDetails.current = {
          ...modalDetails.current,
          modalProps: {
            ...initialModalProps,
            ...modalDetails.current.modalProps,
            ...modalProps,
          },
          componentProps: {
            ...(modalDetails.current.componentProps as Omit<T, keyof ImperativeModalProps>),
            ...componentProps,
          },
        }

        return {
          ...modalDetails.current.modalProps,
          afterClose() {
            onClose(id)
            modalDetails.current.modalProps?.afterClose?.()

            modalDetails.current = initialModalDetails
          },
          // content 渲染的是 lazy 组件，且 showModalWithLazy 用 startTransition 包裹。
          // antd 的 modal holder 是 <App> 下 children 的兄弟节点，头顶没有 main.tsx 里那个
          // <Suspense>。lazy chunk 冷加载挂起时，若无 Suspense 边界，startTransition 会一直
          // pending、永不提交 —— 表现为"点了右键菜单没反应、弹窗静默不出现"。
          // 这里必须自带 Suspense 兜底（此前在 692a4b4 被误删，导致整片菜单功能回归失效）。
          content: (
            <Suspense
              fallback={(
                <Spin
                  spinning
                  delay={300}
                  className='flex size-full min-h-[480px] items-center justify-center py-12'
                />
              )}
            >
              <motion.div
                initial={{
                  opacity: 0,
                }}
                animate={{
                  opacity: 1,
                }}
              >
                {createElement(FC, {
                  ...modalDetails.current.componentProps,
                  closeModal: () => {
                    onClose(id)
                  },
                } as T)}
              </motion.div>
            </Suspense>
          ),
        }
      }

      const instance = modal.confirm(genProps(modalProps, componentProps))
      vscodeApi.log('debug', `${MODAL_LOG_PREFIX} created`, { id })

      modalDetails.current = {
        ...modalDetails.current,
        id,
        genProps,
        instance,
      }

      imperativeModalMap.set(id, instance)

      return {
        destroy: instance.destroy,
      }
    },
  )

  const updateModal = updateOpenedModal

  const mounted = useRef(false)
  useDeepCompareEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }

    if (modalDetails.current.id) {
      const instance = imperativeModalMap.get(modalDetails.current.id)
      instance?.update(modalDetails.current.genProps(initialModalProps, undefined) || {})
    }
  }, [...(deps || []), initialModalProps])

  return {
    // Imperative antd modals must be created synchronously from menu/toolbar
    // handlers. Lazy modal contents already have a local Suspense fallback above;
    // wrapping modal.confirm in startTransition can leave the holder update pending
    // and make right-click actions look like no-ops.
    showModal,
    updateModal,
    isOpened: () => !!modalDetails.current.id && imperativeModalMap.has(modalDetails.current.id),
    id: modalDetails.current.id,
    imperativeModalMap,
  }
}
