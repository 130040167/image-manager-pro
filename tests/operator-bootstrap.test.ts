import { afterEach, describe, expect, it, vi } from 'vitest'
import { ensureOperatorBootstrap, resetOperatorBootstrapForTest } from '~/webview/image-manager/utils/operator-bootstrap'

const compressor = {
  limit: { from: ['png'], to: ['png'] },
  option: { quality: 80 },
} as any

const formatConverter = {
  limit: { from: ['png'], to: ['webp'] },
  option: { format: 'webp' },
} as any

describe('operator bootstrap', () => {
  afterEach(() => {
    resetOperatorBootstrapForTest()
    vi.useRealTimers()
  })

  it('reuses the in-flight bootstrap promise', async () => {
    const getCompressor = vi.fn(async () => compressor)
    const getFormatConverter = vi.fn(async () => formatConverter)

    const first = ensureOperatorBootstrap({ getCompressor, getFormatConverter })
    const second = ensureOperatorBootstrap({ getCompressor, getFormatConverter })

    await expect(first).resolves.toEqual({ compressor, formatConverter })
    await expect(second).resolves.toEqual({ compressor, formatConverter })
    expect(getCompressor).toHaveBeenCalledTimes(1)
    expect(getFormatConverter).toHaveBeenCalledTimes(1)
  })

  it('clears the in-flight promise after failure so retry can recover', async () => {
    const getCompressor = vi.fn()
      .mockRejectedValueOnce(new Error('missing compressor'))
      .mockResolvedValueOnce(compressor)
    const getFormatConverter = vi.fn(async () => formatConverter)

    await expect(ensureOperatorBootstrap({ getCompressor, getFormatConverter })).rejects.toThrow('missing compressor')
    await expect(ensureOperatorBootstrap({ getCompressor, getFormatConverter })).resolves.toEqual({ compressor, formatConverter })
    expect(getCompressor).toHaveBeenCalledTimes(2)
  })
})
