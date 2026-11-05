import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearImageMetaCache, fetchImageMetadata } from '~/webview/image-manager/utils/image-metadata-cache'
import { vscodeApi } from '~/webview/vscode-api'

describe('image metadata cache', () => {
  const originalPostMessageWithTimeout = vscodeApi.postMessageWithTimeout.bind(vscodeApi)

  afterEach(() => {
    vi.useRealTimers()
    vscodeApi.postMessageWithTimeout = originalPostMessageWithTimeout as typeof vscodeApi.postMessageWithTimeout
    clearImageMetaCache()
  })

  it('caches a size-only result without image dimensions', async () => {
    const callbacks: Array<(data: any[]) => void> = []
    const requestedBatches: string[][] = []
    vscodeApi.postMessageWithTimeout = ((message: any, _timeoutMs: number, callback: (data: any[]) => void) => {
      requestedBatches.push(message.data.images)
      callbacks.push(callback)
    }) as typeof vscodeApi.postMessageWithTimeout

    const first = fetchImageMetadata('C:/images/large.png')
    await new Promise(resolve => setTimeout(resolve, 40))
    callbacks[0]([{
      compressed: 0,
      filePath: 'C:/images/large.png',
      metadata: {},
      stats: { mtimeMs: 5, size: 900_000 },
    }])
    await expect(first).resolves.toMatchObject({
      metadata: {},
      stats: { size: 900_000 },
    })

    const second = fetchImageMetadata('C:/images/large.png')
    await expect(second).resolves.toMatchObject({ stats: { size: 900_000 } })
    expect(requestedBatches).toHaveLength(1)
  })

  it('waits through a deferred directory read instead of retrying immediately', async () => {
    vi.useFakeTimers()
    const callbacks: Array<(data: any[]) => void> = []
    const requestedBatches: string[][] = []
    vscodeApi.postMessageWithTimeout = ((message: any, _timeoutMs: number, callback: (data: any[]) => void) => {
      requestedBatches.push(message.data.images)
      callbacks.push(callback)
    }) as typeof vscodeApi.postMessageWithTimeout

    const first = fetchImageMetadata('C:/images/during-expand.png')
    await vi.advanceTimersByTimeAsync(30)
    callbacks[0]([{
      compressed: 0,
      deferred: true,
      filePath: 'C:/images/during-expand.png',
      metadata: {},
    }])

    await vi.advanceTimersByTimeAsync(3_999)
    const joined = fetchImageMetadata('C:/images/during-expand.png')
    expect(requestedBatches).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(2)
    await vi.advanceTimersByTimeAsync(30)
    expect(requestedBatches).toHaveLength(2)
    callbacks[1]([{
      compressed: 0,
      filePath: 'C:/images/during-expand.png',
      metadata: {},
      stats: { mtimeMs: 1, size: 4096 },
    }])
    await expect(first).resolves.toMatchObject({ stats: { size: 4096 } })
    await expect(joined).resolves.toMatchObject({ stats: { size: 4096 } })
  })
})
