import type { WebviewApi } from 'vscode-webview'
import type {
  KeyofMessage,
  MessageType,
  ParameterOfMessage,
  ReturnOfMessage,
} from '~/message/message-factory'
import destr from 'destr'
import { isFunction } from 'es-toolkit'
import { nanoid } from 'nanoid'
import { CmdToVscode, CmdToWebview } from '~/message/cmd'
import logger from '~/utils/logger'

type MessageCallbackFn<T extends KeyofMessage> = (data: ReturnOfMessage<T>) => void

/**
 * 工具类，封装了acquireVsCodeApi()函数，
 * 使webview和扩展上下文之间能够进行消息传递和状态管理。
 *
 * 允许在基于web浏览器的开发服务器中运行webview代码，
 * 通过使用本机web浏览器功能来模拟acquireVsCodeApi启用的功能。
 */
class VscodeApi {
  private readonly vsCodeApi: WebviewApi<unknown> | undefined
  private callbacks: Record<string, (data: any) => void> = {}
  private timeoutCallbacks = new Set<string>()

  constructor() {
    // 检查acquireVsCodeApi函数是否存在于当前开发上下文中（VSCode开发窗口或web浏览器）
    if (typeof acquireVsCodeApi === 'function') {
      this.vsCodeApi = acquireVsCodeApi()
    }
  }

  public registerEventListener() {
    // 监听来自vscode的消息
    window.addEventListener('message', (event) => {
      const message = event.data as MessageType
      const { callbackId, data } = message
      if (!callbackId)
        return
      switch (message.cmd) {
        case CmdToWebview.webview_callback: {
          const callback = this.callbacks[callbackId]
          if (isFunction(callback)) {
            callback(data)
          }
          else {
            this.log('warn', 'webview callback without handler', {
              callbackId,
              data,
              traceId: message.traceId,
            })
          }
          if (!this.timeoutCallbacks.has(callbackId)) {
            delete this.callbacks[callbackId]
          }
          break
        }
        default:
          break
      }
    })
  }

  private getRandomId = () => `${Date.now()}_${nanoid()}`

  public log(level: 'debug' | 'info' | 'warn' | 'error', message: string, details?: Record<string, any>) {
    if (!this.vsCodeApi) {
      logger[level === 'warn' ? 'warn' : level === 'error' ? 'error' : 'log'](message, details)
      return
    }

    this.vsCodeApi.postMessage({
      cmd: CmdToVscode.webview_log,
      data: {
        details,
        level,
        message,
      },
      msgId: this.getRandomId(),
      postTime: new Date().toLocaleString(),
    })
  }

  /**
   * 向webview的拥有者（即vscode扩展）发送消息（即发送任意数据）。
   * @remarks 当在web浏览器中运行webview代码时，postMessage将把给定的消息记录到控制台。
   *
   * @param message 任意数据（必须是JSON可序列化的）发送到扩展上下文。
   */
  public postMessage<T extends KeyofMessage>(
    message: ParameterOfMessage<T> extends never ? Omit<Partial<MessageType>, 'cmd'> & {
      cmd: T
    } : MessageType<ParameterOfMessage<T>, T>,
    callback?: MessageCallbackFn<T>,
  ) {
    message.msgId = this.getRandomId()
    message.postTime = new Date().toLocaleString()
    if (callback) {
      const callbackId = this.getRandomId()
      this.callbacks[callbackId] = callback
      message.callbackId = callbackId
    }
    if (this.vsCodeApi) {
      // Post message to vscode listener
      this.vsCodeApi.postMessage(message)
    }
    else {
      logger.log(message)
    }
  }

  public postMessageWithTimeout<T extends KeyofMessage>(
    message: ParameterOfMessage<T> extends never ? Omit<Partial<MessageType>, 'cmd'> & {
      cmd: T
    } : MessageType<ParameterOfMessage<T>, T>,
    timeoutMs: number,
    callback: MessageCallbackFn<T>,
    fallback?: ReturnOfMessage<T>,
  ) {
    message.msgId = this.getRandomId()
    message.postTime = new Date().toLocaleString()
    message.traceId ||= this.getRandomId()

    const callbackId = this.getRandomId()
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const sentAt = performance.now()
    const requestTraceName = message.cmd === CmdToVscode.get_directory_children
      ? 'directory request'
      : message.cmd === CmdToVscode.get_thumbnails
        ? 'thumbnail request'
        : ''

    const finish = (data: ReturnOfMessage<T>) => {
      if (settled)
        return
      settled = true
      if (timer) {
        clearTimeout(timer)
      }
      delete this.callbacks[callbackId]
      this.timeoutCallbacks.delete(callbackId)
      if (requestTraceName) {
        this.log('debug', `${requestTraceName} callback`, {
          callbackId,
          cmd: message.cmd,
          elapsedMs: Math.round(performance.now() - sentAt),
          result: data,
          traceId: message.traceId,
        })
      }
      callback(data)
    }

    this.callbacks[callbackId] = finish
    this.timeoutCallbacks.add(callbackId)
    message.callbackId = callbackId

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        if (requestTraceName) {
          this.log('warn', `${requestTraceName} timeout fallback`, {
            callbackId,
            cmd: message.cmd,
            elapsedMs: Math.round(performance.now() - sentAt),
            timeoutMs,
            traceId: message.traceId,
          })
        }
        finish(fallback as ReturnOfMessage<T>)
      }, timeoutMs)
    }

    if (this.vsCodeApi) {
      if (requestTraceName) {
        this.log('debug', `${requestTraceName} send`, {
          callbackId,
          cmd: message.cmd,
          data: message.data,
          timeoutMs,
          traceId: message.traceId,
        })
      }
      this.vsCodeApi.postMessage(message)
    }
    else {
      logger.log(message)
    }
  }

  /** Remove a canceled request's callback without retaining its consumers. */
  public forgetCallback(callbackId: string | undefined) {
    if (callbackId)
      delete this.callbacks[callbackId]
  }

  /**
   * 获取webview存储的持久化状态。
   *
   * @remarks 当在web浏览器中运行webview源代码时，getState将从本地存储中检索状态 (https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)。
   *
   * @return 当前状态或 `undefined`（如果没有设置状态）
   */
  public getState(): unknown | undefined {
    if (this.vsCodeApi) {
      return this.vsCodeApi.getState()
    }
    else {
      const state = localStorage.getItem('vscodeState')
      return state ? destr<AnyObject>(state) : undefined
    }
  }

  /**
   * 设置webview存储的持久化状态。
   *
   * @remarks 当在web浏览器中运行webview源代码时，setState将使用本地存储设置给定的状态(https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)。
   *
   * @param newState 新的持久化状态。必须是一个JSON可序列化的对象。可以通过{@link getState}检索
   *
   * @return 新的持久化状态
   */
  public setState<T extends unknown | undefined>(newState: T): T {
    if (this.vsCodeApi) {
      return this.vsCodeApi.setState(newState)
    }
    else {
      localStorage.setItem('vscodeState', JSON.stringify(newState))
      return newState
    }
  }
}

// 导出单例，防止多次调用acquireVsCodeApi
export const vscodeApi = new VscodeApi()
