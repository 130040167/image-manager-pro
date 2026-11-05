import process from 'node:process'
import { runtimePlatformArch } from 'sharp/lib/libvips'
import { BaseDownloader } from './base'
import { LIBVIPS_VERSION, libvipsAssetPath, libvipsDownloadUrls, npmPackageSpecs } from './releases'

export class LibvipsDownloader extends BaseDownloader {
  protected name = 'sharp-libvips'
  protected dest = `sharp-libvips-${runtimePlatformArch()}`
  protected version = LIBVIPS_VERSION

  protected genRemoteReleaseName() {
    return libvipsAssetPath(runtimePlatformArch(), process.arch, process.env.npm_config_arm_version)
  }

  protected generateDownloadUrls() {
    return libvipsDownloadUrls(runtimePlatformArch(), process.arch, process.env.npm_config_arm_version)
  }

  protected cleanRelativePaths() {
    return ['.']
  }

  protected async treeReady(dest: string) {
    const libDir = this.join(dest, 'lib')
    if (!this.exists(libDir))
      return false
    const files = await this.listDir(libDir)
    return files.some(name => name.startsWith('libvips') && this.fileReady(this.join(libDir, name), 64 * 1024))
  }

  protected async hasMatchingNpmBinary() {
    const arch = runtimePlatformArch()
    const spec = npmPackageSpecs(arch).find(item => item.startsWith(`@img/sharp-libvips-${arch}@`))
    if (!spec)
      return false
    const pkgDir = this.npmPackageDir(`sharp-libvips-${arch}`)
    if (!await this.treeReady(pkgDir))
      return false
    return this.packageVersion(pkgDir) === spec.split('@').at(-1)
  }
}
