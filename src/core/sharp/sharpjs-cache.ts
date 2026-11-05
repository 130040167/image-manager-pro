import path from 'node:path'
import fs from 'fs-extra'
import { runtimePlatformArch } from 'sharp/lib/libvips'
import { slashPath } from '~/utils'
import { FileCache } from '../file-cache'
import { Global } from '../global'

export class SharpjsCache {
  extensionCwd = Global.context.extensionUri.fsPath
  osCacheDir = slashPath(path.join(FileCache.cacheDir, 'lib/sharp'))
  extensionCacheDir = slashPath(path.join(this.extensionCwd, 'dist/lib/sharp'))

  constructor() {
    this.addToOsCache()
  }

  private async addToOsCache() {
    if (FileCache.osCachable) {
      await fs.ensureDir(this.osCacheDir)
      await fs.copy(this.extensionCacheDir, this.osCacheDir)
    }
  }

  getSharpPath() {
    const nativeName = `sharp-${runtimePlatformArch()}.node`
    const indexes = [this.extensionCacheDir, this.osCacheDir].map(dir => path.join(dir, 'index.js'))
    const withNative = indexes.find((file) => {
      if (!fs.existsSync(file))
        return false
      const native = path.resolve(path.dirname(file), '../src/build/Release', nativeName)
      return fs.existsSync(native)
    })
    if (withNative)
      return withNative
    return indexes.find(file => fs.existsSync(file))
  }
}
