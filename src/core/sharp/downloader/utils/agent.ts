import process from 'node:process'
import url from 'node:url'
import { isString } from 'es-toolkit'
import tunnelAgent from 'tunnel-agent'

const proxies = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'npm_config_https_proxy', 'npm_config_proxy']

function envProxy() {
  return proxies.map(key => process.env[key]).find(value => isString(value) && value.trim()) || ''
}

function vscodeHttp() {
  try {
    const { workspace } = require('vscode') as typeof import('vscode')
    const http = workspace.getConfiguration('http')
    return {
      support: http.get<string>('proxySupport') || 'override',
      proxy: http.get<string>('proxy')?.trim() || '',
    }
  }
  catch {
    return { support: 'override', proxy: '' }
  }
}

export function resolveProxyUrl() {
  const fromEnv = envProxy()
  const { support, proxy } = vscodeHttp()
  if (support === 'off')
    return ''
  if (support === 'override')
    return proxy || fromEnv
  return fromEnv || proxy
}

export function agent(log: (message: string) => void) {
  try {
    const proxyUrl = resolveProxyUrl()
    if (!proxyUrl)
      return null
    const proxy = new url.URL(proxyUrl)
    const tunnel = proxy.protocol === 'https:' ? tunnelAgent.httpsOverHttps : tunnelAgent.httpsOverHttp
    const proxyAuth
      = proxy.username && proxy.password
        ? `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`
        : null
    log(`Via proxy ${proxy.protocol}//${proxy.hostname}:${proxy.port} ${proxyAuth ? 'with' : 'no'} credentials`)
    return tunnel({
      proxy: {
        port: Number(proxy.port),
        host: proxy.hostname,
        proxyAuth,
      },
    })
  }
  catch {
    return null
  }
}
