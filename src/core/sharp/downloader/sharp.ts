import process from 'node:process'
import { runtimePlatformArch } from 'sharp/lib/libvips'
import { BaseDownloader } from './base'
import { SHARP_VERSION, sharpAssetPath, sharpDownloadUrls } from './releases'

export class SharpDownloader extends BaseDownloader {
  protected name = 'sharp'
  protected dest = ''
  protected version = SHARP_VERSION

  protected genRemoteReleaseName() {
    return sharpAssetPath(runtimePlatformArch())
  }

  protected generateDownloadUrls() {
    return sharpDownloadUrls(runtimePlatformArch())
  }

  protected sentinelFiles() {
    const arch = runtimePlatformArch()
    const files = [{ relativePath: `build/Release/sharp-${arch}.node`, minBytes: 64 * 1024 }]
    if (process.platform === 'win32')
      files.push({ relativePath: 'build/Release/libvips-42.dll', minBytes: 1024 * 1024 })
    return files
  }

  protected cleanRelativePaths() {
    return ['build/Release']
  }

  protected async hasMatchingNpmBinary() {
    const arch = runtimePlatformArch()
    const pkgDir = this.npmPackageDir(`sharp-${arch}`)
    const nodeFile = this.join(pkgDir, 'lib', `sharp-${arch}.node`)
    if (!this.fileReady(nodeFile, 64 * 1024))
      return false
    if (process.platform === 'win32' && !this.fileReady(this.join(pkgDir, 'lib', 'libvips-42.dll'), 1024 * 1024))
      return false
    return this.packageVersion(pkgDir) === this.version
  }
}
