import path from 'node:path'
import { optionalDependencies, version as sharpVersion } from 'sharp/package.json'

/**
 * 固定使用当前已经打进扩展的 sharp 0.34.2，不追 latest。
 * sharp 0.35 要求 Node >= 20.9，而本扩展 engines.vscode 仍是 ^1.70，旧扩展主机直接加载失败。
 * 原生包必须和这份 sharp JS 同版本，不能只换 .node。
 * 0.34.2 实际携带的 libvips 是 8.16.1。package.json 的 config.libvips 只是 ">=8.16.1"，不能拿来拼下载地址。
 */
export const SHARP_VERSION = sharpVersion
export const LIBVIPS_VERSION = '8.16.1'

const MIRRORS = [
  'https://cdn.npmmirror.com/binaries',
  'https://registry.npmmirror.com/-/binary',
]

const optional = optionalDependencies as Record<string, string>

export function platformBundlesLibvips(platform: NodeJS.Platform) {
  // Windows 的 sharp 预编译包已经把 libvips-42.dll 放在 .node 旁边。
  // 单独的 sharp-libvips 包是头文件和导入库，运行时用不到，下载失败还会把整个安装拖垮。
  return platform === 'win32'
}

export function libvipsArmSuffix(arch: string, armVersion?: string) {
  if (arch === 'arm64')
    return `v${armVersion || '8'}`
  // sharp-libvips 8.16.1 发布的是 linux-armv6。扩展宿主是 Electron，旧逻辑会误选 v7，那个文件不存在。
  if (arch === 'arm')
    return `v${armVersion || '6'}`
  return ''
}

export function sharpAssetPath(platformArch: string) {
  return `v${SHARP_VERSION}/sharp-v${SHARP_VERSION}-napi-v9-${platformArch}.tar.gz`
}

export function libvipsAssetPath(platformArch: string, arch: string, armVersion?: string) {
  const suffix = libvipsArmSuffix(arch, armVersion)
  return `v${LIBVIPS_VERSION}/libvips-${LIBVIPS_VERSION}-${platformArch}${suffix}.tar.gz`
}

export function releaseUrls(repo: 'sharp' | 'sharp-libvips', assetPath: string) {
  const urls = MIRRORS.map(host => `${host}/${repo}/${assetPath}`)
  urls.push(`https://github.com/lovell/${repo}/releases/download/${assetPath}`)
  return urls
}

export function sharpDownloadUrls(platformArch: string) {
  return releaseUrls('sharp', sharpAssetPath(platformArch))
}

export function libvipsDownloadUrls(platformArch: string, arch: string, armVersion?: string) {
  return releaseUrls('sharp-libvips', libvipsAssetPath(platformArch, arch, armVersion))
}

export function npmPackageSpecs(platformArch: string) {
  return [`@img/sharp-${platformArch}`, `@img/sharp-libvips-${platformArch}`].flatMap((name) => {
    const pinned = optional[name]
    return pinned ? [`${name}@${pinned}`] : []
  })
}

export function isGzip(bytes: Uint8Array) {
  return bytes.byteLength >= 128 && bytes[0] === 0x1F && bytes[1] === 0x8B
}

function quoteWindows(value: string) {
  return `"${value.replace(/"/g, '')}"`
}

function quotePosix(value: string) {
  return `'${value.replace(/'/g, '\'\\\'\'')}'`
}

function downloadCommand(platform: NodeJS.Platform, output: string, url: string) {
  // Linux 和 WSL 的扩展宿主都是 linux，命令要能直接贴进 bash。
  // Windows PowerShell 里 curl 是 Invoke-WebRequest 的别名，所以必须调用 curl.exe。
  if (platform === 'win32')
    return `curl.exe -fL --retry 3 -o ${quoteWindows(output)} ${quoteWindows(url)}`
  return `curl -fL --retry 3 -o ${quotePosix(output)} ${quotePosix(url)}`
}

export function manualInstallCommands(options: {
  extensionRoot: string
  platformArch: string
  arch: string
  platform: NodeJS.Platform
  armVersion?: string
}) {
  const files: Array<{ asset: string, repo: 'sharp' | 'sharp-libvips' }> = [{
    asset: sharpAssetPath(options.platformArch),
    repo: 'sharp',
  }]
  if (!platformBundlesLibvips(options.platform)) {
    files.push({
      asset: libvipsAssetPath(options.platformArch, options.arch, options.armVersion),
      repo: 'sharp-libvips',
    })
  }

  const pathApi = options.platform === 'win32' ? path.win32 : path.posix
  const targets = files.map(file => ({
    output: pathApi.join(options.extensionRoot, path.posix.basename(file.asset)),
    urls: releaseUrls(file.repo, file.asset),
  }))

  const fromMirror = (index: number) => targets
    .map(target => downloadCommand(options.platform, target.output, target.urls[index]))
    .join(' && ')

  const commands = [
    fromMirror(0),
    fromMirror(targets[0].urls.length - 1),
  ]
  const specs = npmPackageSpecs(options.platformArch)
  if (specs.length) {
    commands.push(`npm install --prefix ${options.platform === 'win32' ? quoteWindows(options.extensionRoot) : quotePosix(options.extensionRoot)} --no-save --ignore-scripts ${specs.join(' ')}`)
  }
  return commands
}

export class DependencyInstallError extends Error {
  commands: string[]
  reported = false

  constructor(message: string, commands: string[]) {
    super(message)
    this.name = 'DependencyInstallError'
    this.commands = commands
  }
}
