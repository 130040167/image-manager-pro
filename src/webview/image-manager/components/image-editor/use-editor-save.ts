import type { Editor, ExportImageOptions } from './fabric-photo/core'
import { useMemoizedFn } from 'ahooks'
import { App } from 'antd'
import { useTranslation } from 'react-i18next'
import { CmdToVscode } from '~/message/cmd'
import { vscodeApi } from '~/webview/vscode-api'
import { LOADING_DURATION } from '../../utils/duration'
import { EDITOR_LOG_PREFIX } from './editor-utils'

export function useEditorSave(editor: Editor | null, image: ImageType | undefined) {
  const { message, notification } = App.useApp()
  const { t } = useTranslation()
  const handleSaveEditedImage = useMemoizedFn(async (options: ExportImageOptions) => {
    if (!editor || !image)
      return
    const key = 'save-edited-image'
    message.loading({ content: t('im.saving'), duration: 0, key })
    try {
      const dataUrl = editor.toDataURL(options)
      vscodeApi.postMessage({
        cmd: CmdToVscode.save_edited_image,
        data: { dataUrl, image, prompt: true, suffix: '.download' },
      }, (res) => {
        message.destroy(key)
        if (res) {
          notification.success({
            description: t('im.save_success'),
            duration: LOADING_DURATION.slow,
            message: res.filename,
          })
        }
        else {
          message.error(t('im.save_fail'))
        }
      })
    }
    catch (err) {
      message.destroy(key)
      vscodeApi.log('error', `${EDITOR_LOG_PREFIX} save failed`, {
        error: err instanceof Error ? err.message : String(err),
      })
      message.error(t('im.save_fail'))
    }
  })

  return handleSaveEditedImage
}
