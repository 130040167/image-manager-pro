import { describe, expect, it } from 'vitest'
import {
  adaptThumbnailBatchSizeAfterBatch,
  seedThumbnailBatchSizeAfterDirectoryLoad,
  THUMBNAIL_BATCH_BASELINE_SIZE,
  THUMBNAIL_BATCH_FAST_DIRECTORY_SIZE,
  THUMBNAIL_BATCH_MAX_SIZE,
  THUMBNAIL_BATCH_MIN_SIZE,
  THUMBNAIL_BATCH_SLOW_DIRECTORY_SIZE,
  THUMBNAIL_BATCH_VERY_SLOW_DIRECTORY_SIZE,
} from '../src/webview/image-manager/utils/thumbnail-batch-strategy'

describe('thumbnail batch strategy', () => {
  it('keeps the first batch as a moderate baseline instead of fully opening up', () => {
    const decision = adaptThumbnailBatchSizeAfterBatch(
      { batchSize: THUMBNAIL_BATCH_BASELINE_SIZE, samples: 0 },
      { elapsedMs: 900, requested: 6, returned: 6 },
    )

    expect(decision.nextBatchSize).toBe(8)
    expect(decision.reason).toContain('baseline')
  })

  it('ramps up gradually after the baseline when average per-image time stays fast', () => {
    const decision = adaptThumbnailBatchSizeAfterBatch(
      { batchSize: THUMBNAIL_BATCH_BASELINE_SIZE, samples: 2 },
      { elapsedMs: 800, requested: 6, returned: 6 },
    )

    expect(decision.nextBatchSize).toBe(8)
    expect(decision.nextBatchSize).toBeLessThanOrEqual(THUMBNAIL_BATCH_MAX_SIZE)
    expect(decision.reason).toContain('ramp-up')
  })

  it('applies a heavy penalty only when average per-image time is clearly high', () => {
    const decision = adaptThumbnailBatchSizeAfterBatch(
      { batchSize: 8, samples: 3 },
      { elapsedMs: 5200, requested: 4, returned: 4 },
    )

    expect(decision.nextBatchSize).toBe(THUMBNAIL_BATCH_VERY_SLOW_DIRECTORY_SIZE)
    expect(decision.reason).toContain('heavy-penalty')
  })

  it('trims gently for middling batches instead of collapsing to single-image mode', () => {
    const decision = adaptThumbnailBatchSizeAfterBatch(
      { batchSize: 8, samples: 3 },
      { elapsedMs: 2400, requested: 4, returned: 4 },
    )

    expect(decision.nextBatchSize).toBe(6)
    expect(decision.reason).toContain('trim')
  })

  it('keeps fast local directory seeds aggressive without jumping straight to the max', () => {
    const decision = seedThumbnailBatchSizeAfterDirectoryLoad(THUMBNAIL_BATCH_BASELINE_SIZE, 120, true)

    expect(decision.nextBatchSize).toBe(THUMBNAIL_BATCH_FAST_DIRECTORY_SIZE)
    expect(decision.reason).toBe('directory-load-fast')
  })

  it('reduces slow directory seeds but avoids single-image mode for merely slow loads', () => {
    const decision = seedThumbnailBatchSizeAfterDirectoryLoad(THUMBNAIL_BATCH_BASELINE_SIZE, 1800, true)

    expect(decision.nextBatchSize).toBe(THUMBNAIL_BATCH_SLOW_DIRECTORY_SIZE)
    expect(decision.nextBatchSize).toBeGreaterThan(THUMBNAIL_BATCH_MIN_SIZE)
  })

  it('drops very slow or failed directory seeds harder', () => {
    expect(seedThumbnailBatchSizeAfterDirectoryLoad(THUMBNAIL_BATCH_BASELINE_SIZE, 4200, true).nextBatchSize)
      .toBe(THUMBNAIL_BATCH_VERY_SLOW_DIRECTORY_SIZE)
    expect(seedThumbnailBatchSizeAfterDirectoryLoad(THUMBNAIL_BATCH_BASELINE_SIZE, 800, false).nextBatchSize)
      .toBe(THUMBNAIL_BATCH_MIN_SIZE)
  })
})
