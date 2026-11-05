import type { MessageType } from '~/message/message-factory'
import type { CmdToWebviewMessage } from '~/message/webview-message-factory'
import type { ImageManagerPanel } from '~/webview/panel'
import { i18n } from '~/i18n'
import { CmdToVscode, CmdToWebview } from '~/message/cmd'
import { VscodeMessageFactory } from '~/message/message-factory'
import { Channel } from '~/utils/node/channel'

export class MessageCenter {
  constructor(public imageManagerPanel: ImageManagerPanel) {}

  slientMessages: string[] = [CmdToWebview.webview_callback]

  private backgroundWebviewCommands = new Set<string>([
    CmdToVscode.get_all_images_from_cwds,
    CmdToVscode.get_directory_children,
    CmdToVscode.warmup_directory_tree,
    CmdToVscode.get_image_info,
    CmdToVscode.get_images,
    CmdToVscode.get_images_metadata,
    CmdToVscode.get_images_extra_info,
    CmdToVscode.get_thumbnails,
    CmdToVscode.copy_image_as_base64,
    CmdToVscode.decode_image_for_preview,
    CmdToVscode.probe_custom_image,
    CmdToVscode.get_image_histogram,
  ])

  private hiddenFallback(message: MessageType) {
    switch (message.cmd) {
      case CmdToVscode.get_all_images_from_cwds:
      case CmdToVscode.warmup_directory_tree:
        return false
      case CmdToVscode.get_directory_children:
        return {
          childrenLoaded: false,
          count: 0,
          ok: false,
          pending: false,
          timeout: false,
        }
      case CmdToVscode.get_images_metadata:
        return []
      case CmdToVscode.get_images_extra_info:
        return {
          gitStaged: [],
          metadataResults: [],
        }
      case CmdToVscode.get_image_histogram:
        return null
      case CmdToVscode.copy_image_as_base64:
        return ''
      case CmdToVscode.decode_image_for_preview:
      case CmdToVscode.probe_custom_image:
        return null
      default:
        return []
    }
  }

  /**
   * 向webview发送消息
   * @param message
   */
  postMessage<T extends keyof CmdToWebviewMessage>(message: MessageType<CmdToWebviewMessage[T], T>) {
    if (this.imageManagerPanel.isDisposed) {
      return
    }

    if (!this.imageManagerPanel.visible && message.cmd === CmdToWebview.update_images) {
      if (message.traceId) {
        Channel.debug(`Skip postMessage(update_images): panel hidden trace=${message.traceId}`)
      }
      return
    }

    // Filter some message
    if (!this.slientMessages.includes(message.cmd)) {
      Channel.debug(`${i18n.t('core.post_message_to_webview')}: ${message.cmd}`)
    }

    try {
      if (message.cmd === CmdToWebview.update_images) {
        const payloads = Array.isArray((message as any).data?.payloads) ? (message as any).data.payloads : []
        const dirPayloads = payloads.filter((payload: any) => payload.origin === 'dir')
        const imagePayloads = payloads.filter((payload: any) => payload.origin === 'image')
        Channel.debug(
          `postMessage(update_images) trace=${message.traceId || ''} `
          + `(payloads=${payloads.length}, dirPayloads=${dirPayloads.length}, imagePayloads=${imagePayloads.length})`,
        )
      }
      if (message.cmd === CmdToWebview.webview_callback) {
        Channel.debug(
          `postMessage(webview_callback) trace=${message.traceId || ''} `
          + `(callback=${message.callbackId || ''})`,
        )
      }
      this.imageManagerPanel.panel.webview.postMessage(message)
    }
    catch (err) {
      Channel.warn(`Skip postMessage(${message.cmd}): ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /**
   * 处理webview发送给vscode的消息
   * @param message
   */
  async handleMessages(message: MessageType) {
    if (this.imageManagerPanel.isDisposed) {
      Channel.debug(`Skip message on disposed panel: ${message.cmd}`)
      return
    }

    if (!this.imageManagerPanel.visible && this.backgroundWebviewCommands.has(message.cmd)) {
      Channel.debug(
        `Skip background webview request: ${message.cmd} `
        + `(panel=${this.imageManagerPanel.id}, callback=${message.callbackId || ''}, trace=${message.traceId || ''})`,
      )
      if (message.callbackId) {
        this.postMessage({
          cmd: CmdToWebview.webview_callback,
          callbackId: message.callbackId,
          data: this.hiddenFallback(message),
          traceId: message.traceId,
        } as any)
      }
      return
    }

    if (message.cmd === 'get_directory_children') {
      Channel.debug(
        `handleMessages(get_directory_children) trace=${message.traceId || ''} `
        + `(callback=${message.callbackId || ''}, panel=${this.imageManagerPanel.id})`,
      )
    }

    const handler: (data: Record<string, any>, panel: ImageManagerPanel, message?: MessageType) => Thenable<any> = VscodeMessageFactory[
      message.cmd
    ] as any

    if (handler) {
      try {
        // 执行对应消息的处理函数
        const data = await handler(message.data, this.imageManagerPanel, message)

        // 如果消息有回调id，则返回数据给webview
        if (!this.imageManagerPanel.isDisposed) {
          if (message.cmd === 'get_directory_children') {
            Channel.debug(
              `handleMessages(get_directory_children) resolved trace=${message.traceId || ''} `
              + `(callback=${message.callbackId || ''})`,
            )
          }
          this.postMessage({ cmd: CmdToWebview.webview_callback, callbackId: message.callbackId, data, traceId: message.traceId })
        }
      }
      catch (err) {
        Channel.error(err)
        if (message.callbackId && !this.imageManagerPanel.isDisposed) {
          this.postMessage({ cmd: CmdToWebview.webview_callback, callbackId: message.callbackId, data: undefined, traceId: message.traceId })
        }
      }
    }
    else {
      Channel.error(i18n.t('core.handler_fn_not_exist', message.cmd))
      if (message.callbackId && !this.imageManagerPanel.isDisposed) {
        this.postMessage({ cmd: CmdToWebview.webview_callback, callbackId: message.callbackId, data: undefined, traceId: message.traceId })
      }
    }
  }
}
