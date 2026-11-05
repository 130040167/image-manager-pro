import type { WebviewCompressorType, WebviewFormatConverterType } from '../stores/global/global-store'
import type { CmdToVscode } from '~/message/cmd'
import { vscodeApi } from '~/webview/vscode-api'

export type OperatorBootstrapResult = {
  compressor: WebviewCompressorType
  formatConverter: WebviewFormatConverterType
}

export type OperatorBootstrapDriver = {
  getCompressor: () => Promise<WebviewCompressorType>
  getFormatConverter: () => Promise<WebviewFormatConverterType>
  log?: typeof vscodeApi.log
}

const DEFAULT_TIMEOUT_MS = 8_000
let inFlight: Promise<OperatorBootstrapResult> | undefined

function timeoutError(timeoutMs: number) {
  return new Error(`Operator bootstrap timed out after ${timeoutMs}ms`)
}

export function requestOperator<T>(cmd: CmdToVscode, label: string) {
  return new Promise<T>((resolve, reject) => {
    vscodeApi.postMessage({ cmd }, (data) => {
      if (!data) {
        reject(new Error(`${label} not found`))
        return
      }
      resolve(data as T)
    })
  })
}

export function withOperatorTimeout<T>(promise: Promise<T>, timeoutMs = DEFAULT_TIMEOUT_MS) {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(timeoutError(timeoutMs)), timeoutMs)
    }),
  ]).finally(() => {
    if (timer)
      clearTimeout(timer)
  })
}

export function ensureOperatorBootstrap(driver: OperatorBootstrapDriver, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (inFlight)
    return inFlight

  const start = performance.now()
  driver.log?.('debug', '[tools] operator bootstrap start', {})
  inFlight = withOperatorTimeout(
    Promise.all([driver.getCompressor(), driver.getFormatConverter()]).then(([compressor, formatConverter]) => ({
      compressor,
      formatConverter,
    })),
    timeoutMs,
  )
    .then((result) => {
      driver.log?.('debug', '[tools] operator bootstrap done', {
        costMs: Math.round(performance.now() - start),
        hasCompressor: !!result.compressor?.option,
        hasFormatConverter: !!result.formatConverter?.option,
      })
      inFlight = undefined
      return result
    })
    .catch((err) => {
      driver.log?.('warn', '[tools] operator bootstrap failed', {
        costMs: Math.round(performance.now() - start),
        error: err instanceof Error ? err.message : String(err),
      })
      inFlight = undefined
      throw err
    })

  return inFlight
}

export function resetOperatorBootstrapForTest() {
  inFlight = undefined
}
