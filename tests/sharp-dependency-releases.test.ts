import fs from 'node:fs'
import path from 'node:path'
import { config } from 'sharp/package.json'
import { describe, expect, it } from 'vitest'
import {
  isGzip,
  LIBVIPS_VERSION,
  libvipsArmSuffix,
  libvipsAssetPath,
  libvipsDownloadUrls,
  manualInstallCommands,
  npmPackageSpecs,
  platformBundlesLibvips,
  SHARP_VERSION,
  sharpDownloadUrls,
} from '~/core/sharp/downloader/releases'

describe('sharp dependency releases', () => {
  it('pins sharp 0.34.2 instead of latest 0.35', () => {
    expect(SHARP_VERSION).toBe('0.34.2')
    expect(String(config.libvips).startsWith('>=')).toBe(true)
    expect(LIBVIPS_VERSION).toBe('8.16.1')
    expect(LIBVIPS_VERSION).not.toBe(config.libvips)
  })

  it('matches the libvips build shipped inside the Windows sharp binary', () => {
    const versionsPath = path.resolve('node_modules/@img/sharp-win32-x64/versions.json')
    if (!fs.existsSync(versionsPath))
      return
    const versions = JSON.parse(fs.readFileSync(versionsPath, 'utf8')) as { vips: string }
    expect(versions.vips).toBe(LIBVIPS_VERSION)
  })

  it('uses the verified mirrors and keeps the published asset names', () => {
    const urls = sharpDownloadUrls('linux-x64')
    expect(urls[0]).toBe('https://cdn.npmmirror.com/binaries/sharp/v0.34.2/sharp-v0.34.2-napi-v9-linux-x64.tar.gz')
    expect(urls.at(-1)).toBe('https://github.com/lovell/sharp/releases/download/v0.34.2/sharp-v0.34.2-napi-v9-linux-x64.tar.gz')
    expect(urls.join('\n')).not.toContain('npmmirror.com/mirrors')
    expect(libvipsDownloadUrls('linuxmusl-x64', 'x64')[0]).toContain('libvips-8.16.1-linuxmusl-x64.tar.gz')
    expect(libvipsDownloadUrls('linux-arm64', 'arm64')[0]).toContain('libvips-8.16.1-linux-arm64v8.tar.gz')
  })

  it('selects armv6 rather than the missing Electron armv7 archive', () => {
    expect(libvipsArmSuffix('arm')).toBe('v6')
    expect(libvipsArmSuffix('arm64')).toBe('v8')
    expect(libvipsAssetPath('linux-arm', 'arm')).toContain('linux-armv6.tar.gz')
    expect(libvipsAssetPath('win32-arm64', 'arm64')).toContain('win32-arm64v8.tar.gz')
  })

  it('does not ask Windows to download the separate libvips dev archive', () => {
    expect(platformBundlesLibvips('win32')).toBe(true)
    const commands = manualInstallCommands({
      extensionRoot: 'C:\\ext dir',
      platformArch: 'win32-x64',
      arch: 'x64',
      platform: 'win32',
    })
    expect(commands[0]).toContain('curl.exe -fL --retry 3')
    expect(commands[0]).toContain('sharp-v0.34.2-napi-v9-win32-x64.tar.gz')
    expect(commands.join('\n')).not.toContain('libvips-')
    expect(commands.at(-1)).toBe('npm install --prefix "C:\\ext dir" --no-save --ignore-scripts @img/sharp-win32-x64@0.34.2')
  })

  it('gives Linux and WSL bash commands for both sharp and libvips', () => {
    expect(platformBundlesLibvips('linux')).toBe(false)
    const root = '/home/lucy/.vscode-server/extensions/image manager'
    const commands = manualInstallCommands({
      extensionRoot: root,
      platformArch: 'linux-x64',
      arch: 'x64',
      platform: 'linux',
    })
    expect(commands[0].startsWith('curl ')).toBe(true)
    expect(commands[0]).not.toContain('curl.exe')
    expect(commands[0]).toContain(`'${root}/sharp-v0.34.2-napi-v9-linux-x64.tar.gz'`)
    expect(commands[0]).toContain(`'${root}/libvips-8.16.1-linux-x64.tar.gz'`)
    expect(commands[1]).toContain('github.com/lovell/sharp-libvips')
    expect(commands.at(-1)).toBe(`npm install --prefix '${root}' --no-save --ignore-scripts @img/sharp-linux-x64@0.34.2 @img/sharp-libvips-linux-x64@1.1.0`)
    expect(npmPackageSpecs('linuxmusl-x64')).toEqual([
      '@img/sharp-linuxmusl-x64@0.34.2',
      '@img/sharp-libvips-linuxmusl-x64@1.1.0',
    ])
  })

  it('rejects a short or non-gzip payload before extraction', () => {
    expect(isGzip(new Uint8Array([0x1F, 0x8B]))).toBe(false)
    const gzip = new Uint8Array(128)
    gzip[0] = 0x1F
    gzip[1] = 0x8B
    expect(isGzip(gzip)).toBe(true)
  })
})
