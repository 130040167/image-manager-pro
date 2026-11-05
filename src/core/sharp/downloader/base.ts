import type { Promisable } from 'type-fest'
import { Buffer } from 'node:buffer'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import stream from 'node:stream'
import util from 'node:util'
import zlib from 'node:zlib'
import fs from 'fs-extra'
import { globby } from 'globby'
import { nanoid } from 'nanoid'
import fetch from 'node-fetch'
import pTimeout from 'p-timeout'
import tarFs from 'tar-fs'
import { FileCache } from '~/core/file-cache'
import { Global } from '~/core/global'
import { i18n } from '~/i18n'
import { slashPath } from '~/utils'
import logger from '~/utils/logger'
import { Channel } from '~/utils/node/channel'
import { isGzip } from './releases'
import { agent } from './utils/agent'

const pipeline = util.promisify(stream.pipeline)
const DOWNLOAD_ATTEMPTS = 2
const DOWNLOAD_TIMEOUT_MS = 60_000

type SentinelFile = {
  relativePath: string
  minBytes: number
}

async function firstFulfilled<T>(tasks: Array<() => Promise<T>>): Promise<T> {
  if (!tasks.length)
    throw new Error('no download url')

  return new Promise<T>((resolve, reject) => {
    const errors: string[] = []
    let pending = tasks.length
    for (const task of tasks) {
      task().then(resolve, (error: unknown) => {
        errors.push(error instanceof Error ? error.message : String(error))
        pending -= 1
        if (pending === 0)
          reject(new Error(errors.join(' | ') || 'all sharp dependency downloads failed'))
      })
    }
  })
}

export abstract class BaseDownloader {
  protected abstract name: string
  protected abstract version: string
  protected abstract dest: string

  protected abstract genRemoteReleaseName(): string
  protected abstract generateDownloadUrls(): string[]

  protected extensionCwd = Global.context.extensionUri.fsPath
  private osCacheDir = slashPath(path.join(FileCache.cacheDir, 'lib/src'))
  private extensionCacheDir = slashPath(path.join(this.extensionCwd, 'dist/lib/src'))

  constructor(
    private options: {
      readCacheJson: () => Record<string, string>
      writeCacheJson: (cache: Record<string, string>) => Promisable<void>
    },
  ) {}

  protected sentinelFiles(): SentinelFile[] {
    return []
  }

  protected cleanRelativePaths() {
    return [] as string[]
  }

  protected join(...parts: string[]) {
    return path.join(...parts)
  }

  protected npmPackageDir(packageName: string) {
    return path.join(this.extensionCwd, 'node_modules', '@img', packageName)
  }

  protected exists(file: string) {
    try {
      return fs.existsSync(file)
    }
    catch {
      return false
    }
  }

  protected fileReady(file: string, minBytes: number) {
    try {
      const stat = fs.statSync(file)
      return stat.isFile() && stat.size >= minBytes
    }
    catch {
      return false
    }
  }

  protected async listDir(dir: string) {
    return fs.readdir(dir)
  }

  protected packageVersion(pkgDir: string) {
    try {
      const pkg = fs.readJsonSync(path.join(pkgDir, 'package.json')) as { version?: string }
      return pkg.version || ''
    }
    catch {
      return ''
    }
  }

  protected async hasMatchingNpmBinary() {
    return false
  }

  protected async treeReady(dest: string) {
    const files = this.sentinelFiles()
    if (!files.length)
      return false
    return files.every(file => this.fileReady(path.join(dest, file.relativePath), file.minBytes))
  }

  private async addToOsCache() {
    if (!FileCache.osCachable)
      return
    const from = path.join(this.extensionCacheDir, this.dest)
    const to = path.join(this.osCacheDir, this.dest)
    await fs.ensureDir(to)
    await fs.copy(from, to)
    await this.options.writeCacheJson({
      [this.name]: this.version,
    })
  }

  private async detectUserLocalRelease() {
    const bins = await globby(path.basename(this.genRemoteReleaseName()), {
      cwd: this.extensionCwd,
      absolute: true,
      deep: 0,
    })
    return bins
  }

  private shouldUpdate() {
    const cache = this.options.readCacheJson()
    if (!cache[this.name])
      return false
    return cache[this.name] !== this.version
  }

  async isInstalled() {
    if (await this.hasMatchingNpmBinary()) {
      Channel.debug(`${this.name} found installed npm binary`)
      return true
    }

    if (this.shouldUpdate()) {
      Channel.debug(`${this.name} cached version differs from ${this.version}`)
      this.warmTip()
      return false
    }

    for (const root of [this.extensionCacheDir, this.osCacheDir]) {
      if (await this.treeReady(path.join(root, this.dest))) {
        Channel.debug(`${this.name} is already installed: true`)
        return true
      }
    }

    Channel.debug(`${this.name} is already installed: false`)
    this.warmTip()
    return false
  }

  async install() {
    const userLocalReleases = await this.detectUserLocalRelease()
    if (userLocalReleases.length) {
      Channel.info(`Discover Local Resource of ${this.name}, start installing...`)
      for (const release of userLocalReleases) {
        await this.extractRelease({
          tarPath: release,
          dest: path.join(this.extensionCacheDir, this.dest),
          clean: false,
        })
      }
      return
    }

    Channel.info(`No Local Resource of ${this.name}, start downloading...`)
    await this.download()
  }

  private async download() {
    const urls = this.generateDownloadUrls()
    let lastError: unknown
    for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
      try {
        const buffer = await this.downloadFirst(urls)
        const tarTempPath = path.join(os.tmpdir(), `${process.pid}-${this.name}-${nanoid(6)}.tar.gz`)
        try {
          await fs.writeFile(tarTempPath, Buffer.from(buffer))
          await this.extractRelease({
            tarPath: tarTempPath,
            dest: path.join(this.extensionCacheDir, this.dest),
          })
        }
        finally {
          await fs.rm(tarTempPath, { force: true })
        }
        return
      }
      catch (error) {
        lastError = error
        const message = error instanceof Error ? error.message : String(error)
        Channel.warn(`${this.name} download attempt ${attempt} failed: ${message}`)
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`${this.name} download failed`)
  }

  private async downloadFirst(urls: string[]) {
    const parent = new AbortController()
    try {
      return await firstFulfilled(urls.map(url => () => this.fetchGzip(url, parent.signal).then((buffer) => {
        parent.abort()
        return buffer
      })))
    }
    finally {
      parent.abort()
    }
  }

  private async fetchGzip(url: string, parent: AbortSignal) {
    const controller = new AbortController()
    const abort = () => controller.abort()
    if (parent.aborted)
      abort()
    else
      parent.addEventListener('abort', abort, { once: true })

    try {
      Channel.debug(`Downloading ${this.name} from: ${url}`)
      const buffer = await pTimeout(this.downloadRelease(url, controller.signal), {
        milliseconds: DOWNLOAD_TIMEOUT_MS,
      })
      Channel.info(`${this.name} downloaded from: ${url}`)
      return buffer
    }
    finally {
      parent.removeEventListener('abort', abort)
      controller.abort()
    }
  }

  private async downloadRelease(url: string, signal: AbortSignal) {
    const res = await fetch(url, {
      agent: agent(logger.log),
      redirect: 'follow',
      signal,
      headers: {
        'user-agent': 'vscode-image-manager',
      },
    })
    if (!res.ok)
      throw new Error(`Failed to download ${url}: ${res.status} ${res.statusText}`)

    const data = new Uint8Array(await res.arrayBuffer())
    if (!isGzip(data))
      throw new Error(`Response is not a gzip tarball: ${url}`)
    return data
  }

  private async extractRelease(options: { tarPath: string, dest: string, clean?: boolean }) {
    const { tarPath, dest, clean = true } = options
    for (const relativePath of this.cleanRelativePaths()) {
      const target = relativePath === '.' ? dest : path.join(dest, relativePath)
      await fs.remove(target)
    }
    await fs.ensureDir(dest)
    await pipeline(fs.createReadStream(tarPath), zlib.createGunzip(), tarFs.extract(dest))
    logger.info(`Extracted ${tarPath} to ${dest}`)

    if (!await this.treeReady(dest))
      throw new Error(`${this.name} extracted but the required binary is missing in ${dest}`)

    if (clean) {
      await fs.rm(tarPath, { force: true })
      Channel.debug(`Removed temporary file: ${tarPath}`)
    }

    try {
      await this.addToOsCache()
    }
    catch (error) {
      logger.error(error)
    }
  }

  private warmTip() {
    Channel.divider()
    Channel.info(`${i18n.t('core.tip')}: ${i18n.t('core.dep_url_tip')} ⬇️`)
    this.generateDownloadUrls().forEach((url) => {
      Channel.info(`${i18n.t('core.dep_url')}: ${url}`)
    })
    Channel.divider()
  }
}
