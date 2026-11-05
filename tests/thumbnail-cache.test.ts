import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearThumbnailCache, fetchThumbnail } from '~/webview/image-manager/utils/thumbnail-cache'
import { vscodeApi } from '~/webview/vscode-api'

describe('thumbnail cache queue', () => {
  const originalPostMessageWithTimeout = vscodeApi.postMessageWithTimeout.bind(vscodeApi)
  const originalLog = vscodeApi.log.bind(vscodeApi)

  afterEach(() => {
    vi.useRealTimers()
    vscodeApi.postMessageWithTimeout = originalPostMessageWithTimeout as typeof vscodeApi.postMessageWithTimeout
    vscodeApi.log = originalLog as typeof vscodeApi.log
    clearThumbnailCache()
  })

  it('dispatches a second thumbnail batch while the first one is still in flight', async () => {
    vi.useFakeTimers()
    const callbacks: Array<(data: any[]) => void> = []
    const timeouts: number[] = []
    const requestedBatches: string[][] = []
    vscodeApi.log = vi.fn() as typeof vscodeApi.log
    vscodeApi.postMessageWithTimeout = ((message: any, timeoutMs: number, callback: (data: any[]) => void) => {
      timeouts.push(timeoutMs)
      requestedBatches.push(message.data.images)
      callbacks.push(callback)
    }) as typeof vscodeApi.postMessageWithTimeout

    const paths = Array.from({ length: 12 }, (_, index) => `C:/images/${index}.png`)
    const promises = paths.map(path => fetchThumbnail(path))

    await vi.advanceTimersByTimeAsync(24)
    expect(requestedBatches).toHaveLength(2)
    expect(timeouts).toEqual([22_000, 22_000])

    callbacks[0](requestedBatches[0].map(filePath => ({ filePath, thumbPath: `thumb://${filePath}` })))
    callbacks[1](requestedBatches[1].map(filePath => ({ filePath, thumbPath: `thumb://${filePath}` })))

    await expect(Promise.all(promises)).resolves.toEqual(paths.map(path => `thumb://${path}`))
  })

  it('retries quickly after an empty thumbnail batch instead of staying blank for a long backoff', async () => {
    vi.useFakeTimers()
    const callbacks: Array<(data: any[]) => void> = []
    const requestedBatches: string[][] = []
    vscodeApi.log = vi.fn() as typeof vscodeApi.log
    vscodeApi.postMessageWithTimeout = ((message: any, _timeoutMs: number, callback: (data: any[]) => void) => {
      requestedBatches.push(message.data.images)
      callbacks.push(callback)
    }) as typeof vscodeApi.postMessageWithTimeout

    const filePath = 'C:/images/empty-then-ok.png'
    const first = fetchThumbnail(filePath)
    await vi.advanceTimersByTimeAsync(24)
    expect(requestedBatches).toEqual([[filePath]])

    callbacks[0]([])
    await expect(first).resolves.toBeUndefined()
    expect(vscodeApi.log).toHaveBeenCalledWith('warn', 'thumbnail request missing item', expect.objectContaining({
      backoff: 1_500,
      filePath,
      responseKind: 'empty',
    }))

    await expect(fetchThumbnail(filePath)).resolves.toBeUndefined()
    expect(requestedBatches).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1_500)
    const second = fetchThumbnail(filePath)
    await vi.advanceTimersByTimeAsync(24)
    expect(requestedBatches).toHaveLength(2)
    callbacks[1]([{ filePath, thumbPath: 'thumb://empty-then-ok.png' }])

    await expect(second).resolves.toBe('thumb://empty-then-ok.png')
  })
})
