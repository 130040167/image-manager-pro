// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CmdToVscode, CmdToWebview } from '~/message/cmd'
import { cancelActiveSimilaritySearch, startSimilaritySearch } from '~/webview/image-manager/hooks/use-image-similarity/similarity-client'
import { vscodeApi } from '~/webview/vscode-api'

describe('similarity webview lifecycle', () => {
  const source = { path: 'source.png' } as ImageType
  let sent: any[]
  let replies: Array<(reply: any) => void>
  beforeEach(() => {
    sent = []
    replies = []
    vi.spyOn(vscodeApi, 'postMessage').mockImplementation(((message: any, reply?: (value: any) => void) => {
      message.callbackId = `callback-${sent.length}`
      sent.push(message)
      if (reply)
        replies.push(reply)
    }) as typeof vscodeApi.postMessage)
    vi.spyOn(vscodeApi, 'forgetCallback')
  })
  afterEach(() => {
    cancelActiveSimilaritySearch()
    vi.restoreAllMocks()
  })
  const progress = (requestId: string, completed: number) => window.dispatchEvent(new MessageEvent('message', {
    data: { cmd: CmdToWebview.similarity_progress, data: { requestId, completed, total: 10_000 } },
  }))

  it('supersedes across callers and filters stale progress and completion', async () => {
    const oldProgress = vi.fn()
    const newProgress = vi.fn()
    const scope = [{ path: 'a.png' }] as ImageType[]
    const old = startSimilaritySearch(source, scope, { scope: 'all' }, oldProgress)
    expect(sent[0].data.scope).toEqual(scope)
    progress(old.requestId, 20)
    expect(oldProgress).toHaveBeenCalledTimes(1)
    const fresh = startSimilaritySearch(source, scope, {}, newProgress)
    await expect(old.result).resolves.toEqual({ cancelled: true })
    expect(sent[1]).toMatchObject({ cmd: CmdToVscode.cancel_find_similar_images, data: { requestId: old.requestId } })
    progress(old.requestId, 9000)
    progress(fresh.requestId, 150)
    replies[0]({ requestId: old.requestId, results: [] })
    expect(oldProgress).toHaveBeenCalledTimes(1)
    expect(newProgress).toHaveBeenCalledTimes(1)
    replies[1]({ requestId: fresh.requestId, results: [], scanned: 200 })
    await expect(fresh.result).resolves.toMatchObject({ scanned: 200 })
    expect(vscodeApi.forgetCallback).toHaveBeenCalledWith('callback-0')
    progress(fresh.requestId, 300)
    expect(newProgress).toHaveBeenCalledTimes(1)
  })

  it('cancels explicitly and releases listeners when the webview closes', async () => {
    const report = vi.fn()
    const first = startSimilaritySearch(source, [], {}, report)
    first.cancel()
    first.cancel()
    await expect(first.result).resolves.toEqual({ cancelled: true })
    expect(sent.filter(message => message.cmd === CmdToVscode.cancel_find_similar_images)).toHaveLength(1)
    const second = startSimilaritySearch(source, [], {}, report)
    window.dispatchEvent(new Event('pagehide'))
    await expect(second.result).resolves.toEqual({ cancelled: true })
    progress(second.requestId, 5)
    expect(report).not.toHaveBeenCalled()
  })
})
