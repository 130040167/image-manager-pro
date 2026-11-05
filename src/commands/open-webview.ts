import type { Uri } from 'vscode'
import type { ExtensionModule } from '~/module'
import path from 'node:path'
import { isEqual, once, trim } from 'es-toolkit'
import { commands, FileType, window, workspace } from 'vscode'
import { Config } from '~/core/config/config'
import { Global } from '~/core/global'
import { Svgo } from '~/core/operator/svgo'
import { WorkspaceState } from '~/core/persist/workspace/workspace-state'
import { Watcher } from '~/core/watcher'
import { slashPath } from '~/utils'
import logger from '~/utils/logger'
import { ImageManagerPanel } from '~/webview/panel'
import { Commands } from './commands'

// 给可能挂死的 await 一个上限。sshfs / sftp / 远程目录的 stat 偶尔会永久 pending，
// 一旦发生，外层 isLoading 永远复位不了，后续再也打不开任何 image 管理窗口。
function withTimeout<T>(p: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

export default <ExtensionModule> function (ctx) {
  let rootpaths = Global.resolveRootPath()
  let previousRoot: string[] = []
  let sharpInstalled: boolean

  const init = once(() => {
    WorkspaceState.init()
    Svgo.init()
  })

  let isLoading = false
  async function openWebview(uri: Uri | undefined) {
    init()

    if (isLoading)
      return

    isLoading = true

    try {
      let imagePath = ''
      if (uri?.fsPath) {
        let rootPath = ''
        const fsPath = slashPath(uri.fsPath)

        // sshfs / sftp 等远程文件系统上 stat 可能永远 pending，给 5s 上限。
        // 超时时按"目录"兜底继续走，至少能尝试扫描；最差情况是用户拿到错误提示，
        // 而不是整个命令卡死把 isLoading 钉死。
        let stat: { type: FileType }
        try {
          stat = await withTimeout(workspace.fs.stat(uri), 5000, 'workspace.fs.stat')
        }
        catch (err) {
          logger.error('stat failed, fallback to directory', err)
          stat = { type: FileType.Directory }
        }

        if (stat.type !== FileType.Directory) {
          rootPath = path.dirname(fsPath)
          imagePath = fsPath
        }
        else {
          rootPath = fsPath
        }

        rootpaths = Global.resolveRootPath([rootPath])
      }

      try {
        if (Config.core_installDependencies) {
          // 不必每次打开插件时都安装 sharp
          // 只要一次失败，就认为不支持 sharp
          if (sharpInstalled === undefined) {
            await Global.installSharp()
            sharpInstalled = true
          }
        }
      }
      catch (e) {
        logger.error(e)
        sharpInstalled = false
      }

      const imageReveal = trim(imagePath).length ? `${trim(imagePath)}?t=${Date.now()}` : ''

      if (Global.imageManagerPanels.length) {
        const { abortDirectoryWorkForPanel, resetDirectoryIoRuntime } = await import('~/message/message-factory')
        Global.imageManagerPanels.forEach((panel) => {
          const aborted = abortDirectoryWorkForPanel(panel.id, 'open-webview')
          logger.debug(
            `Open image manager aborted previous panel work: ${panel.id}, `
            + `aborted=${aborted.abortedCancelable}, queuedForeground=${aborted.queuedForeground}`,
          )
        })
        resetDirectoryIoRuntime('open-webview')
      }

      const createPanel = (rootpaths: string[]) => {
        const imageManagerPanel = new ImageManagerPanel(ctx, {
          sharpInstalled,
          imageReveal,
          rootpaths,
        })

        Global.imageManagerPanels.push(imageManagerPanel)
        // watcher 在 SSHFS / 映射盘上可能触发一轮昂贵的后台初始化。
        // 让 webview 先完成首屏绘制和扫描请求，再延后启动监听，避免打开时黑屏。
        setTimeout(() => {
          if (imageManagerPanel.isDisposed)
            return
          if (!Global.imageManagerPanels.includes(imageManagerPanel))
            return
          imageManagerPanel.watcher = new Watcher(rootpaths, imageManagerPanel)
        }, 1500)

        imageManagerPanel.onDidChange((e) => {
          if (!e) {
            Global.imageManagerPanels = Global.imageManagerPanels.filter(p => p.id !== imageManagerPanel.id)
          }
        })
      }

      if (Config.core_multiplePanels) {
        createPanel(rootpaths)
      }
      else {
        if (Global.imageManagerPanels.length) {
          const reload = !isEqual(previousRoot, rootpaths)

          const onPanelOpen = (panel: ImageManagerPanel) => {
            // 如果前后的 rootpaths 不一样，则reload webview
            if (reload) {
              panel.reloadWebview()
            }
            else if (imageReveal) {
              panel.revealImageInViewer(imageReveal)
            }
          }

          const imageManagerPanel = Global.imageManagerPanels[0]

          imageManagerPanel.initialData = {
            ...imageManagerPanel.initialData,
            imageReveal,
            rootpaths,
          }

          Global.imageManagerPanels[0].show(onPanelOpen)
          // rootpaths变了，重新watch
          if (reload) {
            imageManagerPanel.watcher?.restart(rootpaths)
          }
        }
        else {
          createPanel(rootpaths)
        }
      }

      previousRoot = rootpaths
    }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.error('openWebview failed', e)
      void window.showErrorMessage(`Image Manager failed to open: ${msg}`)
    }
    finally {
      // 不论成功、异常、还是 stat 超时，都必须复位，否则用户再也开不出新窗口。
      isLoading = false
    }
  }

  return [commands.registerCommand(Commands.open_webview, openWebview)]
}
