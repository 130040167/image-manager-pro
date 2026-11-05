import type * as vscode from 'vscode'
import process from 'node:process'

import { flatten } from 'es-toolkit'
import commandsModules from '~/commands'
import { version } from '../package.json'
import { Global } from './core/global'
import { VscodeSettings } from './core/vscode-setting/vscode-settings'
import { i18n } from './i18n'
import { Channel } from './utils/node/channel'
import { closeDebugLog, getDebugLogFilePath, writeDebugLine } from './utils/node/debug-log'

// libuv 线程池默认 4 线程。sharp (libvips) + fs.readdir/stat 共享这个池，
// 缩略图生成会饿死目录读取，导致展开目录时卡住。
// 必须在任何异步 IO 之前设置，否则不生效。
process.env.UV_THREADPOOL_SIZE = String(Math.max(16, Number(process.env.UV_THREADPOOL_SIZE) || 0))

export function activate(ctx: vscode.ExtensionContext) {
  // MUST be the very first statement — many modules (Channel, SharpjsCache, etc.)
  // access Global.context.extensionMode / extensionUri during initialisation.
  Global.context = ctx

  Channel.info(`Activated, v${version}`)
  // Write a divider header so a fresh activation is easy to find in the debug log.
  writeDebugLine(`==== activate v${version} pid=${process.pid} log=${getDebugLogFilePath()} ====`)

  VscodeSettings.init(ctx, (settings) => {
    i18n.init(ctx, settings.language)
    Global.initVscodeSettings(settings)
  })

  Global.init(ctx)

  const modules = [commandsModules]

  const disposables = flatten(modules.map(m => m(ctx)))

  disposables.forEach(d => ctx.subscriptions.push(d))
}

export function deactivate() {
  Channel.info('Deactivated')
  // 关闭目录 I/O worker 池，让 worker 进程退出
  try {
    // 动态 require，避免活性激活时把 message-factory 的整个图都拽进来
    const factory = require('~/message/message-factory') as { disposeDirectoryIoPool?: () => void }
    factory.disposeDirectoryIoPool?.()
  }
  catch {}
  // Flush the debug log stream so the file handle does not leak.
  closeDebugLog()
}
