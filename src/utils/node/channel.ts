import type { OutputChannel } from 'vscode'
import { window } from 'vscode'
import { Config } from '~/core/config/config'
import { Global } from '~/core/global'
import { i18n } from '~/i18n'
import { EXT_NAME } from '~/meta'
import { writeDebugLine } from './debug-log'

export class Channel {
  private static channel: OutputChannel

  static get outputChannel(): OutputChannel {
    if (!this.channel) {
      this.channel = window.createOutputChannel(EXT_NAME)
    }
    return this.channel
  }

  /**
   * Write to debug log file when debug mode is active.
   * Guard: Global.context may not be set yet during early activate() calls.
   */
  private static teeToFile(line: string) {
    if (!Global.context) {
      return
    }
    if (Global.isDevelopment() || Config.debug_enabled) {
      writeDebugLine(line)
    }
  }

  static raw(...values: any[]) {
    const line = values.map(i => i.toString()).join(' ')
    this.outputChannel.appendLine(line)
    this.teeToFile(line)
  }

  static info(message: string, prompt = false, indent = 0) {
    if (prompt) {
      window.showInformationMessage(`${message}`)
    }
    const line = `${'\t'.repeat(indent)}[${EXT_NAME}] ${message}`
    this.outputChannel.appendLine(line)
    this.teeToFile(line)
  }

  static warn(message: string, prompt = false, indent = 0) {
    if (prompt) {
      window.showWarningMessage(message)
    }
    Channel.info(`⚠ WARN: ${message}`, prompt, indent)
  }

  static async error(err: Error | string | any = {}, prompt = false, indent = 0) {
    if (typeof err !== 'string') {
      const messages = [err.message, err.response?.data, err.stack, err.toJSON?.()].filter(Boolean).join('\n')
      Channel.info(`🐛 ERROR: ${err.name}: ${messages}`, false, indent)
    }
    else {
      Channel.info(`🐛 ERROR: ${err}`, false, indent)
    }

    if (prompt) {
      const openOutputButton = i18n.t('prompt.show_logs')
      const message = typeof err === 'string' ? err : `${EXT_NAME} Error: ${err.toString()}`

      const result = await window.showErrorMessage(message, openOutputButton)
      if (result === openOutputButton)
        this.show()
    }
  }

  static debug(message: string, indent = 0) {
    if (!Global.context) {
      return
    }
    if (Global.isDevelopment() || Config.debug_enabled) {
      this.info(`[DEBUG]: ${message}`, false, indent)
    }
  }

  static show() {
    this.channel.show()
  }

  static divider() {
    const line = '\n――――――\n'
    this.outputChannel.appendLine(line)
    this.teeToFile(line)
  }
}
