import { describe, expect, it } from 'vitest'
import { PreviewSourceCache } from '~/webview/image-manager/utils/preview-source-cache'

describe('preview source memory budget', () => {
  it('evicts the least recently used value within byte and entry budgets', () => {
    const cache = new PreviewSourceCache(24, 3)
    cache.set('a', '111')
    cache.set('b', '222')
    cache.set('c', '333')
    expect(cache.get('a')).toBe('111')
    cache.set('d', '444')
    expect(cache.get('b')).toBeUndefined()
    expect(cache.usage).toMatchObject({ bytes: 24, entries: 3 })
    cache.set('a', 'x')
    expect(cache.usage.bytes).toBe(20)
  })

  it('bounds retained strings after scanning ten thousand previews', () => {
    const cache = new PreviewSourceCache(4096, 20)
    for (let i = 0; i < 10_000; i++)
      cache.set(`${i}`, `data:image/jpeg;base64,${'a'.repeat(100)}`)
    expect(cache.usage.bytes).toBeLessThanOrEqual(4096)
    expect(cache.usage.entries).toBeLessThanOrEqual(20)
    expect(cache.get('0')).toBeUndefined()
    expect(cache.get('9999')).toBeDefined()
    cache.releaseDataUrls()
    expect(cache.usage).toMatchObject({ bytes: 0, entries: 0 })
  })

  it('releases base64 on close while retaining file URIs', () => {
    const cache = new PreviewSourceCache()
    cache.set('uri', 'https://file.vscode-resource.vscode-cdn.net/a.jpg')
    cache.set('fallback', 'data:image/jpeg;base64,AAAA')
    cache.releaseDataUrls()
    expect(cache.get('fallback')).toBeUndefined()
    expect(cache.get('uri')).toBeDefined()
    cache.clear()
    expect(cache.usage.bytes).toBe(0)
  })

  it('does not retain oversized values or values in a disabled cache', () => {
    const cache = new PreviewSourceCache(10)
    cache.set('large', 'xxxxxxxxxxxx')
    expect(cache.usage.entries).toBe(0)
    const disabled = new PreviewSourceCache(100, 0)
    disabled.set('a', 'b')
    expect(disabled.usage.entries).toBe(0)
  })
})
