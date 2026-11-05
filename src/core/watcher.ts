import type { GlobbyFilterFunction, GlobEntry } from 'globby'
import type { ConfigurationChangeEvent, FileSystemWatcher, Uri } from 'vscode'
import type { UpdatePayload } from '~/webview/image-manager/utils/tree/tree-manager'
import type { ImageManagerPanel } from '~/webview/panel'
import path from 'node:path'
import { max } from 'es-toolkit/compat'
import fs from 'fs-extra'
import { isGitIgnored } from 'globby'
import micromatch from 'micromatch'
import { nanoid } from 'nanoid'
import {
  Disposable,
  RelativePattern,
  workspace,
} from 'vscode'
import { i18n } from '~/i18n'
import { CmdToVscode, CmdToWebview } from '~/message/cmd'
import {
  clearAll as clearGlobbyCache,
  hasInFlightForCwd as globbyCacheInFlight,
  removeEntryByPath as globbyCacheRemove,
  upsertEntry as globbyCacheUpsert,
} from '~/message/globby-cache'
import { VscodeMessageFactory } from '~/message/message-factory'
import { EXT_NAMESPACE } from '~/meta'
import { slashPath } from '~/utils'
import { AbortError, abortPromise } from '~/utils/abort-promise'
import logger from '~/utils/logger'
import { resolveDirPath } from '~/utils/node'
import { Channel } from '~/utils/node/channel'
import { imageGlob } from '~/utils/node/glob'
import { UpdateEvent, UpdateOrigin, UpdateType } from '~/webview/image-manager/utils/tree/const'
import { ConfigKey } from './config/common'
import { Config } from './config/config'
import { getCustomFormatScanExtensions } from './custom-format'

export class Watcher {
  private watchers: FileSystemWatcher[] = []
  private glob: ReturnType<typeof imageGlob> | undefined
  private gitignores: GlobbyFilterFunction[] = []
  private rootpaths: string[] = []
  private disposed = false

  private disposables: Disposable[] = []

  constructor(
    rootpaths: string[],
    private imageManagerPanel: ImageManagerPanel,
  ) {
    this.restart(rootpaths)

    workspace.onDidChangeConfiguration(
      (e: ConfigurationChangeEvent) => {
        for (const config of [ConfigKey.file_exclude, ConfigKey.file_scan, ConfigKey.file_customFormats, ConfigKey.file_gitignore]) {
          const key = `${EXT_NAMESPACE}.${config}`
          if (e.affectsConfiguration(key)) {
            // 配置变更会让 glob 行为不一致，必须先清空 globby 缓存。
            clearGlobbyCache()
            this.restart(this.rootpaths)
            logger.debug(`Watcher: ${key} changed`)
            break
          }
        }
      },
      null,
      this.disposables,
    )
  }

  restart(rootpaths: string[]) {
    this.disposed = false
    this.dispose()
    this.disposed = false
    this.glob = imageGlob({
      scan: getCustomFormatScanExtensions(Config.file_scan, Config.file_customFormats),
      exclude: Config.file_exclude,
      cwds: rootpaths,
    })
    this.startWatch(rootpaths)
  }

  private isIgnored(e: Uri, isDirectory: boolean) {
    if (this.isGitIgnored(e)) {
      return true
    }

    if (isDirectory) {
      return !micromatch.all(this.fsPath(e), this.glob!.allCwdPatterns)
    }

    return !micromatch.all(this.fsPath(e), this.glob!.allImagePatterns)
  }

  private eventQueue: { e: Uri, type: UpdateEvent, isDirectory: boolean }[] = []
  private eventProcessingTimer: NodeJS.Timeout | null = null
  private abortController: AbortController | null = null

  private async processEventQueue() {
    if (this.disposed || this.imageManagerPanel.isDisposed) {
      this.eventQueue = []
      return
    }

    // 合并队列中的事件
    const uniqueEvents = this.mergeEvents(this.eventQueue)

    try {
      const payloads = (
        await abortPromise(() => this.processEvents(uniqueEvents), {
          abortController: this.abortController!,
        })
      ).filter(p => !!p)

      this.imageManagerPanel.messageCenter.postMessage({
        cmd: CmdToWebview.update_images,
        data: {
          updateType: UpdateType.patch,
          payloads,
          id: nanoid(),
        },
      })

      this.eventQueue = []
    }
    catch (e) {
      if (e instanceof AbortError) {
        logger.debug('Event processing aborted')
      }
    }
  }

  private processEvents(events: typeof this.eventQueue) {
    return Promise.all(
      events.map(async (event): Promise<UpdatePayload | undefined> => {
        const { e, type, isDirectory } = event

        const basename = path.basename(this.fsPath(e))
        const absWorkspaceFolder = this.guessCwdFromPath(this.fsPath(e))
        const dirPath = resolveDirPath(this.fsPath(e), absWorkspaceFolder)
        const workspaceFolder = path.basename(absWorkspaceFolder)

        if (isDirectory) {
          // 目录不会触发 onDidChange
          switch (type) {
            // 目录创建只把目录节点补进树。不要再递归扫描新目录，
            // SSHFS/远程目录上一次 mkdir/copy 可能展开成巨大 IO。
            case UpdateEvent.create: {
              break
            }
            default: {
              break
            }
          }
          return {
            origin: UpdateOrigin.dir,
            data: {
              type,
              payload: {
                absDirPath: this.fsPath(e),
                dirPath,
                workspaceFolder,
              },
            },
          }
        }
        else {
          // 1. 如果有新增，则把新增图片查询出来，返回给webview
          // 2. 如果有修改，也需要查询修改后的图片
          // 3. 如果有删除，只需要返回删除的图片路径
          if ([UpdateEvent.create, UpdateEvent.update].includes(type)) {
            const res = await VscodeMessageFactory[CmdToVscode.get_images](
              {
                filePaths: [this.fsPath(e)],
                cwd: absWorkspaceFolder,
              },
              this.imageManagerPanel,
            )
            return {
              origin: UpdateOrigin.image,
              data: {
                type,
                payload: res[0],
              },
            }
          }
          if (type === UpdateEvent.delete) {
            const parsedPath = path.parse(this.fsPath(e))
            return {
              origin: UpdateOrigin.image,
              data: {
                payload: {
                  path: this.fsPath(e),
                  name: parsedPath.name,
                  extname: parsedPath.ext.replace('.', ''),
                  basename,
                  dirPath,
                  workspaceFolder,
                  absWorkspaceFolder,
                } as ImageType,
                type,
              },
            }
          }
        }
      }),
    )
  }

  /**
   * 兼容 Windows 和 Linux 的路径
   */
  private fsPath(e: Uri) {
    return slashPath(e.fsPath)
  }

  private guessCwdFromPath(path: string) {
    const weight = this.rootpaths.map(r => r.split(path)[0].length)
    const index = weight.indexOf(max(weight)!)
    return this.rootpaths[index]
  }

  private mergeEvents(events: typeof this.eventQueue) {
    const eventMap = new Map<string, (typeof events)[number]>()

    for (const event of events) {
      const key = slashPath(event.e.fsPath)
      // 如果已经存在该路径的事件，则后来的事件覆盖之前的事件
      eventMap.set(key, event)
    }

    return Array.from(eventMap.values())
  }

  private handleEvent(e: Uri, type: UpdateEvent) {
    if (this.disposed || this.imageManagerPanel.isDisposed)
      return

    if (e.scheme !== 'file')
      return

    const isDirectory = !path.extname(this.fsPath(e))

    if (this.isIgnored(e, isDirectory)) {
      logger.debug(`Ignored: ${this.fsPath(e)}`)
      return
    }

    // 同步增量维护 globby 缓存：
    // - 文件删除：从所有命中该 cwd 的缓存条目里移除该路径
    // - 文件创建/修改：异步 fs.stat 后 upsert 到所属 cwd 的缓存里
    // 目录事件不直接动缓存——目录创建会通过 get_all_images_from_cwds 重新走 globby，
    // 那条路径会自然填入新的缓存项。
    //
    // SSHFS 上初始扫描可能跑几分钟，期间 watcher 会被大量"文件可见"事件
    // 触发（每个文件一次远程 fs.stat），抢同一条 SSH 连接，把主扫描拖慢一倍。
    // 如果当前 cwd 还有 globby 扫描在飞，就跳过缓存增量补丁——
    // 主扫描结束时缓存会被一次性覆盖到最新状态，没有数据丢失。
    if (!isDirectory) {
      const filePath = this.fsPath(e)
      if (type === UpdateEvent.delete) {
        globbyCacheRemove(filePath)
      }
      else {
        const cwd = this.guessCwdFromPath(filePath)
        if (!globbyCacheInFlight(cwd)) {
          // fs.stat 失败（极少见，比如刚创建立刻被删）就跳过缓存更新，
          // 让下一次完整 globby 自己修正。
          fs.stat(filePath)
            .then((stats) => {
              if (this.disposed || this.imageManagerPanel.isDisposed)
                return

              const entry: GlobEntry = {
                path: filePath,
                name: path.basename(filePath),
                // globby 的 GlobEntry 期望一个 dirent 对象。我们用一个最小可用 shim：
                // 现有消费方（message-factory.ts）只读 entry.path 和 entry.stats。
                dirent: {
                  name: path.basename(filePath),
                  isFile: () => true,
                  isDirectory: () => false,
                  isBlockDevice: () => false,
                  isCharacterDevice: () => false,
                  isSymbolicLink: () => false,
                  isFIFO: () => false,
                  isSocket: () => false,
                } as any,
                stats,
              }
              globbyCacheUpsert(cwd, entry)
            })
            .catch(() => {
              // ignore
            })
        }
      }
    }

    // 将事件加入队列
    this.eventQueue.push({ e, type, isDirectory })

    this.eventProcessingTimer && clearTimeout(this.eventProcessingTimer)
    this.eventProcessingTimer = null

    this.abortController?.abort()
    this.abortController = new AbortController()

    this.eventProcessingTimer = setTimeout(() => {
      this.processEventQueue()
    }, 120) // timer大的话，会影响第一次的响应时间，所以要尽量小，但也要保持好防抖
  }

  private onDidChange(e: Uri) {
    this.handleEvent(e, UpdateEvent.update)
  }

  private onDidCreate(e: Uri) {
    this.handleEvent(e, UpdateEvent.create)
  }

  private onDidDelete(e: Uri) {
    this.handleEvent(e, UpdateEvent.delete)
  }

  private isGitIgnored(e: Uri) {
    if (!Config.file_gitignore)
      return false

    const ignored = this.gitignores.some(fn => fn(this.fsPath(e)))
    if (ignored) {
      logger.debug(`git ignored: ${this.fsPath(e)}`)
    }
    return ignored
  }

  private startWatch(rootpaths: string[]) {
    if (this.disposed || this.imageManagerPanel.isDisposed)
      return

    this.rootpaths = rootpaths
    // 不要在 watcher 初始化里同步读取 .gitignore。SSHFS / 映射盘断连时，
    // isGitIgnoredSync 会把 extension host 主线程钉死，连本地新窗口都会被拖住。
    // 这里先无过滤启动 watcher，再异步补上 gitignore 过滤器；失败则降级为不使用 gitignore。
    this.gitignores = []
    if (Config.file_gitignore) {
      void Promise.all(
        rootpaths.map(async (r): Promise<GlobbyFilterFunction | undefined> => {
          try {
            return await isGitIgnored({ cwd: r })
          }
          catch (err) {
            logger.error(`isGitIgnored failed for ${r}, gitignore filtering disabled for this root`, err)
            return undefined
          }
        }),
      ).then((gitignores) => {
        if (this.disposed || this.imageManagerPanel.isDisposed)
          return

        this.gitignores = gitignores.filter((t): t is GlobbyFilterFunction => !!t)
      })
    }

    Channel.info(i18n.t('prompt.watch_root', rootpaths.join(',')))

    // 只监听目标图片类型。旧实现用 `**/` 递归监听所有目录，
    // 在 SSHFS / 映射盘上可能导致打开面板时 VS Code 先枚举整棵目录树。
    // 图片管理器真正需要的是图片文件的 create/change/delete，目录结构会随图片事件自然更新。
    const watcher = rootpaths.map((r) => {
      return workspace.createFileSystemWatcher(new RelativePattern(r, this.glob!.imagePattern))
    })

    this.watchers = [...watcher]

    this.watchers?.forEach(w => w.onDidChange(this.onDidChange, this))
    this.watchers?.forEach(w => w.onDidCreate(this.onDidCreate, this))
    this.watchers?.forEach(w => w.onDidDelete(this.onDidDelete, this))
  }

  public dispose() {
    this.disposed = true
    Disposable.from(...this.disposables, ...this.watchers).dispose()
    this.eventProcessingTimer && clearTimeout(this.eventProcessingTimer)
    this.abortController?.abort()
    this.eventQueue = []
    this.watchers = []
    Channel.debug('Watcher disposed')
  }
}
