import type { SimilarityOptions } from './similarity-ui'
import type { SimilarityFindResult, SimilarityProgress } from '~/core/analysis/similarity'
import { CmdToVscode, CmdToWebview } from '~/message/cmd'
import { vscodeApi } from '~/webview/vscode-api'

export type SimilarityReply = SimilarityFindResult | Error | string | { cancelled: true }
let active: { requestId: string, cancel: () => void } | undefined

export function cancelActiveSimilaritySearch() {
  active?.cancel()
}

/** One active search per webview, including searches launched by different menus. */
export function startSimilaritySearch(image: ImageType, scope: ImageType[], options: SimilarityOptions, onProgress: (progress: SimilarityProgress) => void) {
  active?.cancel()
  const requestId = crypto.randomUUID()
  let settle!: (reply: SimilarityReply) => void
  let done = false
  let timer: ReturnType<typeof setTimeout>
  const request = { cmd: CmdToVscode.find_similar_images as const, data: { image, ...options, scope, requestId }, callbackId: undefined as string | undefined }
  const result = new Promise<SimilarityReply>((resolve) => {
    settle = resolve
  })
  const onMessage = (event: MessageEvent) => {
    if (!done && event.data?.cmd === CmdToWebview.similarity_progress && event.data.data?.requestId === requestId)
      onProgress(event.data.data)
  }
  const finish = (reply: SimilarityReply) => {
    if (done)
      return
    done = true
    clearTimeout(timer)
    window.removeEventListener('message', onMessage)
    window.removeEventListener('pagehide', cancel)
    vscodeApi.forgetCallback(request.callbackId)
    if (active?.requestId === requestId)
      active = undefined
    settle(reply)
  }
  function cancel() {
    if (done)
      return
    vscodeApi.postMessage({ cmd: CmdToVscode.cancel_find_similar_images, data: { requestId } })
    finish({ cancelled: true })
  }
  timer = setTimeout(() => {
    vscodeApi.postMessage({ cmd: CmdToVscode.cancel_find_similar_images, data: { requestId } })
    finish(new Error('Similarity search timed out'))
  }, 30 * 60_000)
  active = { requestId, cancel }
  window.addEventListener('message', onMessage)
  window.addEventListener('pagehide', cancel)
  vscodeApi.postMessage(request, (reply) => {
    if (reply && typeof reply === 'object' && 'requestId' in reply && reply.requestId !== requestId)
      return
    finish(reply)
  })
  return { requestId, result, cancel }
}
