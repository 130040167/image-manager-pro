// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearUnsupportedBase64Cache, fetchUnsupportedAsBase64, getCachedUnsupportedBase64, getUnsupportedBase64CacheKey, getUnsupportedCacheUsage, releaseUnsupportedDataUrls } from '~/webview/image-manager/utils/unsupported-image-cache'
import { vscodeApi } from '~/webview/vscode-api'

describe('unsupported image cache keys', () => {
  it('includes custom decode options so npy pages do not reuse stale data URLs', () => {
    const first = getUnsupportedBase64CacheKey('c:/data/a.npy', { layout: 'BHW', pageIndex: 0 })
    const second = getUnsupportedBase64CacheKey('c:/data/a.npy', { layout: 'BHW', pageIndex: 1 })

    expect(first).not.toBe(second)
    expect(first).toContain('pageIndex')
    expect(second).toContain('pageIndex')
  })

  it('keeps option key order stable', () => {
    const first = getUnsupportedBase64CacheKey('c:/data/a.raw', { height: 2, layout: 'HW', width: 3 })
    const second = getUnsupportedBase64CacheKey('c:/data/a.raw', { layout: 'HW', width: 3, height: 2 })

    expect(first).toBe(second)
  })
})

describe('unsupported preview request lifecycle', () => {
  let callbacks: Array<(data: unknown) => void>
  let requests: Array<{ data: { delivery: string, filePath: string } }>

  beforeEach(() => {
    vi.useFakeTimers()
    callbacks = []
    requests = []
    vi.spyOn(vscodeApi, 'log').mockImplementation(() => undefined)
    vi.spyOn(vscodeApi, 'postMessage').mockImplementation(((message: any, callback: (data: unknown) => void) => {
      requests.push(message)
      callbacks.push(callback)
    }) as typeof vscodeApi.postMessage)
    clearUnsupportedBase64Cache()
  })

  afterEach(async () => {
    clearUnsupportedBase64Cache()
    for (const callback of callbacks)
      callback('')
    await vi.runAllTimersAsync()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('prefers URI delivery and coalesces simultaneous consumers', async () => {
    const first = fetchUnsupportedAsBase64('a.tiff')
    const second = fetchUnsupportedAsBase64('a.tiff')
    expect(first).toBe(second)
    expect(requests[0].data.delivery).toBe('uri')
    callbacks[0]('https://preview/a.jpg?v=1')
    await expect(first).resolves.toBe('https://preview/a.jpg?v=1')
    await expect(fetchUnsupportedAsBase64('a.tiff')).resolves.toBe('https://preview/a.jpg?v=1')
    expect(requests).toHaveLength(1)
  })

  it('prevents a stale in-flight response from repopulating an updated file', async () => {
    const stale = fetchUnsupportedAsBase64('changed.tiff')
    clearUnsupportedBase64Cache('changed.tiff')
    const fresh = fetchUnsupportedAsBase64('changed.tiff')
    await expect(stale).resolves.toBe('')
    expect(fetchUnsupportedAsBase64('changed.tiff')).toBe(fresh)
    callbacks[0]('https://preview/old.jpg')
    expect(getCachedUnsupportedBase64('changed.tiff')).toBeUndefined()
    expect(requests).toHaveLength(2)
    callbacks[1]('https://preview/new.jpg')
    await expect(fresh).resolves.toBe('https://preview/new.jpg')
    expect(getCachedUnsupportedBase64('changed.tiff')).toBe('https://preview/new.jpg')
  })

  it('invalidates queued requests without starting unnecessary decodes', async () => {
    const active = fetchUnsupportedAsBase64('first.tiff')
    const queued = fetchUnsupportedAsBase64('deleted.tiff')
    clearUnsupportedBase64Cache('deleted.tiff')
    await expect(queued).resolves.toBe('')
    callbacks[0]('https://preview/first.jpg')
    await active
    expect(requests).toHaveLength(1)
  })

  it('releases data URLs and ignores late data URL replies after close', async () => {
    const first = fetchUnsupportedAsBase64('first.tiff', { delivery: 'data-url' })
    callbacks[0]('data:image/jpeg;base64,AAAA')
    await first
    const pending = fetchUnsupportedAsBase64('pending.tiff', { delivery: 'data-url' })
    releaseUnsupportedDataUrls()
    await expect(pending).resolves.toBe('')
    callbacks[1]('data:image/jpeg;base64,BBBB')
    expect(getUnsupportedCacheUsage()).toMatchObject({ bytes: 0, entries: 0 })
  })

  it('clears all retained values when the webview closes', async () => {
    const first = fetchUnsupportedAsBase64('a.tiff')
    callbacks[0]('https://preview/a.jpg')
    await first
    window.dispatchEvent(new Event('pagehide'))
    expect(getUnsupportedCacheUsage().entries).toBe(0)
  })
})
