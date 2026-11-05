import type { WebviewCompressorType, WebviewFormatConverterType } from './stores/global/global-store'
import type { CmdToWebviewMessage } from '~/message/webview-message-factory'
import { useEventListener, useMemoizedFn } from 'ahooks'
import { App, Button, FloatButton } from 'antd'
import { enableMapSet, setAutoFreeze } from 'immer'
import { useAtomValue, useSetAtom } from 'jotai'
import { selectAtom } from 'jotai/utils'
import { memo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { GoMoveToTop } from 'react-icons/go'
import { CmdToVscode, CmdToWebview } from '~/message/cmd'
import logger from '~/utils/logger'
import { getAppRoot } from '../utils'
import { vscodeApi } from '../vscode-api'
import ContextMenus from './components/context-menus'
import Debug from './components/debug'
import ImageEditorHost from './components/image-editor/image-editor-host'
import ImageForSize from './components/image-for-size'
import Layout from './components/layout'
import { ToasterWithMax } from './components/toaster-with-max'
import Viewer from './components/viewer'
import useFetchExtension from './hooks/use-fetch-extension'
import useImageOperation from './hooks/use-image-operation'
import useUpdateImages from './hooks/use-update-images'
import useUpdateWebview from './hooks/use-update-webview'
import { GlobalAtoms } from './stores/global/global-store'
import { VscodeAtoms } from './stores/vscode/vscode-store'
import { shouldRefreshImageTreeForConfigKeys } from './utils/config-refresh'
import { clearImageMetaCache, invalidateImageMeta } from './utils/image-metadata-cache'
import { ensureOperatorBootstrap, requestOperator } from './utils/operator-bootstrap'
import { UpdateType } from './utils/tree/const'
import { clearUnsupportedBase64Cache } from './utils/unsupported-image-cache'

vscodeApi.registerEventListener()

const DIRECTORY_ONLY_DEBUG_MODE = false

setAutoFreeze(false)
enableMapSet()

function ImageManager() {
  const { notification } = App.useApp()
  const { t } = useTranslation()

  const installDependencies = useAtomValue(
    selectAtom(
      VscodeAtoms.extConfigAtom,
      useMemoizedFn(state => state.core.installDependencies),
    ),
  )

  const setVscodeSettings = useSetAtom(VscodeAtoms.vscodeConfigAtom)

  const setCompressor = useSetAtom(GlobalAtoms.compressorAtom)
  const setFormatConverter = useSetAtom(GlobalAtoms.formatConverterAtom)
  const sharpInstalled = useAtomValue(GlobalAtoms.sharpInstalledAtom)

  useFetchExtension(!DIRECTORY_ONLY_DEBUG_MODE)

  useEffect(() => {
    if (installDependencies && sharpInstalled === false) {
      const key = 'deps_not_found'
      notification.warning({
        message: t('im.deps_not_found'),
        key,
        description: (
          <div className='flex flex-col gap-y-2'>
            <div>{t('im.no_sharp')}</div>
            <div className='flex w-full justify-end'>
              <Button
                type='primary'
                href={import.meta.env.IM_QA_URL}
                onClick={() => {
                  notification.destroy(key)
                }}
              >
                {t('im.view_solution')}
              </Button>
            </div>
          </div>
        ),
        duration: 0,
      })
    }
  }, [installDependencies, notification, sharpInstalled, t])

  const getCompressor = useMemoizedFn(() => {
    return requestOperator<WebviewCompressorType>(CmdToVscode.get_compressor, 'Compressor')
  })

  const getFormatConverter = useMemoizedFn(() => {
    return requestOperator<WebviewFormatConverterType>(CmdToVscode.get_format_converter, 'Format converter')
  })

  const getOperator = useMemoizedFn(async () => {
    if (DIRECTORY_ONLY_DEBUG_MODE) {
      vscodeApi.log('debug', 'skip operator bootstrap', {
        reason: 'directory-only-debug-mode',
      })
      return
    }
    try {
      const { compressor, formatConverter } = await ensureOperatorBootstrap({
        getCompressor,
        getFormatConverter,
        log: vscodeApi.log,
      })

      setCompressor(compressor)
      setFormatConverter(formatConverter)
    }
    catch (err) {
      logger.error(t('im.deps_not_found'), err)
    }
  })

  const { getAllImages, patchUpdate, fullUpdate } = useUpdateImages()

  useEffect(() => {
    void getAllImages()
    return () => clearUnsupportedBase64Cache()
  }, [])

  useEffect(() => {
    if (DIRECTORY_ONLY_DEBUG_MODE) {
      return
    }
    if (sharpInstalled === true) {
      void getOperator()
    }
  }, [getOperator, sharpInstalled])

  const { updateConfig, updateWorkspaceState } = useUpdateWebview()

  const { beginRevealInViewer } = useImageOperation()

  const onMessage = useMemoizedFn((e: MessageEvent) => {
    type CmdToWebviewData<K extends keyof CmdToWebviewMessage> = CmdToWebviewMessage[K]

    let { cmd, data } = e.data as {
      cmd: keyof CmdToWebviewMessage
      data: CmdToWebviewMessage[typeof cmd]
    }

    switch (cmd) {
      case CmdToWebview.update_images: {
        data = data as CmdToWebviewData<CmdToWebview.update_images>
        if (data.updateType === UpdateType.full) {
          clearUnsupportedBase64Cache()
          clearImageMetaCache()
        }
        else {
          for (const payload of data.payloads) {
            if (payload.origin === 'image') {
              clearUnsupportedBase64Cache(payload.data.payload.path)
              invalidateImageMeta(payload.data.payload.path)
            }
          }
        }
        logger.debug('更新图片', data)
        if (data.traceId) {
          const dirPayload = data.payloads.find(payload => payload.origin === 'dir')
          const dirData = dirPayload?.origin === 'dir' ? dirPayload.data.payload : undefined
          vscodeApi.log('debug', 'update_images received', {
            childrenLoaded: dirData?.childrenLoaded,
            directFolderCount: dirData?.directFolderCount,
            directImageCount: dirData?.directImageCount,
            imagePayloads: data.payloads.filter(payload => payload.origin === 'image').length,
            loadedImageCount: dirData?.loadedImageCount,
            loadingChildren: dirData?.loadingChildren,
            payloads: data.payloads.length,
            targetAbsDirPath: dirData?.absDirPath,
            traceId: data.traceId,
            updateType: data.updateType,
          })
        }

        switch (data.updateType) {
          case UpdateType.full:
            fullUpdate(data)
            break
          case UpdateType.patch:
            patchUpdate(data)
            break
          default:
            break
        }
        break
      }
      case CmdToWebview.program_reload_webview: {
        window.mountApp(true)
        break
      }
      case CmdToWebview.update_config: {
        data = data as CmdToWebviewData<CmdToWebview.update_config>
        updateConfig()
        const changedKeys = data?.keys || []
        if (shouldRefreshImageTreeForConfigKeys(changedKeys)) {
          void getAllImages({ refresh: true })
        }
        if (DIRECTORY_ONLY_DEBUG_MODE) {
          vscodeApi.log('debug', 'skip operator refresh after config update', {
            reason: 'directory-only-debug-mode',
          })
          break
        }
        if (sharpInstalled === true) {
          void getOperator()
        }
        break
      }
      case CmdToWebview.update_workspaceState: {
        updateWorkspaceState()
        break
      }
      case CmdToWebview.reveal_image_in_viewer: {
        data = data as CmdToWebviewData<CmdToWebview.reveal_image_in_viewer>
        logger.debug(CmdToWebview.reveal_image_in_viewer, data.imagePath)
        beginRevealInViewer(data.imagePath)
        break
      }
      case CmdToWebview.update_vscode_settings: {
        data = data as CmdToWebviewData<CmdToWebview.update_vscode_settings>
        setVscodeSettings(data)
        break
      }
      default:
        break
    }
  })

  useEventListener('message', onMessage)

  return (
    <>
      <ContextMenus />
      <ImageEditorHost />

      <Layout>
        <Viewer />
      </Layout>

      <ImageForSize />

      <FloatButton.BackTop
        target={getAppRoot}
        duration={0}
        icon={<GoMoveToTop />}
        type='primary'
        shape='square'
        visibilityHeight={1000}
      />

      <ToasterWithMax />

      <Debug />
    </>
  )
}

export default memo(ImageManager)
