export const THUMBNAIL_BATCH_MIN_SIZE = 1
export const THUMBNAIL_BATCH_MAX_SIZE = 10
export const THUMBNAIL_BATCH_BASELINE_SIZE = 6
export const THUMBNAIL_BATCH_FAST_DIRECTORY_SIZE = 8
export const THUMBNAIL_BATCH_SLOW_DIRECTORY_SIZE = 3
export const THUMBNAIL_BATCH_VERY_SLOW_DIRECTORY_SIZE = 2

export const THUMBNAIL_FAST_DIRECTORY_MS = 250
export const THUMBNAIL_SLOW_DIRECTORY_MS = 1200
export const THUMBNAIL_VERY_SLOW_DIRECTORY_MS = 3500

export type ThumbnailBatchDecision = {
  nextBatchSize: number
  perImageMs: number
  reason: string
  successRatio: number
}

export type ThumbnailBatchMetrics = {
  elapsedMs: number
  requested: number
  returned: number
}

export type ThumbnailDirectoryBatchState = {
  batchSize: number
  samples: number
}

export function clampThumbnailBatchSize(value: number) {
  return Math.max(THUMBNAIL_BATCH_MIN_SIZE, Math.min(THUMBNAIL_BATCH_MAX_SIZE, Math.round(value)))
}

function deriveTargetBatchSize(perImageMs: number) {
  if (perImageMs <= 180)
    return THUMBNAIL_BATCH_MAX_SIZE
  if (perImageMs <= 320)
    return 8
  if (perImageMs <= 550)
    return THUMBNAIL_BATCH_BASELINE_SIZE
  if (perImageMs <= 800)
    return 4
  if (perImageMs <= 1200)
    return THUMBNAIL_BATCH_SLOW_DIRECTORY_SIZE
  if (perImageMs <= 1700)
    return THUMBNAIL_BATCH_VERY_SLOW_DIRECTORY_SIZE
  return THUMBNAIL_BATCH_MIN_SIZE
}

export function seedThumbnailBatchSizeAfterDirectoryLoad(currentBatchSize: number, elapsedMs: number, ok = true): ThumbnailBatchDecision {
  if (!ok) {
    return {
      nextBatchSize: THUMBNAIL_BATCH_MIN_SIZE,
      perImageMs: elapsedMs,
      reason: 'directory-load-failed',
      successRatio: 0,
    }
  }

  if (elapsedMs <= THUMBNAIL_FAST_DIRECTORY_MS) {
    return {
      nextBatchSize: clampThumbnailBatchSize(Math.max(currentBatchSize, THUMBNAIL_BATCH_FAST_DIRECTORY_SIZE)),
      perImageMs: elapsedMs,
      reason: 'directory-load-fast',
      successRatio: 1,
    }
  }

  if (elapsedMs >= THUMBNAIL_VERY_SLOW_DIRECTORY_MS) {
    return {
      nextBatchSize: THUMBNAIL_BATCH_VERY_SLOW_DIRECTORY_SIZE,
      perImageMs: elapsedMs,
      reason: 'directory-load-very-slow',
      successRatio: 1,
    }
  }

  if (elapsedMs >= THUMBNAIL_SLOW_DIRECTORY_MS) {
    return {
      nextBatchSize: THUMBNAIL_BATCH_SLOW_DIRECTORY_SIZE,
      perImageMs: elapsedMs,
      reason: 'directory-load-slow',
      successRatio: 1,
    }
  }

  return {
    nextBatchSize: THUMBNAIL_BATCH_BASELINE_SIZE,
    perImageMs: elapsedMs,
    reason: 'directory-load-baseline',
    successRatio: 1,
  }
}

export function adaptThumbnailBatchSizeAfterBatch(state: ThumbnailDirectoryBatchState, metrics: ThumbnailBatchMetrics): ThumbnailBatchDecision {
  const requested = Math.max(0, metrics.requested)
  const returned = Math.max(0, Math.min(metrics.returned, requested))
  const successRatio = requested > 0 ? returned / requested : 0
  const perImageMs = returned > 0 ? metrics.elapsedMs / returned : metrics.elapsedMs

  if (!requested || returned === 0 || successRatio < 0.5) {
    return {
      nextBatchSize: THUMBNAIL_BATCH_MIN_SIZE,
      perImageMs,
      reason: 'thumbnail-batch-empty',
      successRatio,
    }
  }

  let target = deriveTargetBatchSize(perImageMs)
  if (successRatio < 0.75) {
    target = Math.min(target, THUMBNAIL_BATCH_VERY_SLOW_DIRECTORY_SIZE)
  }
  else if (successRatio < 0.9) {
    target = Math.min(target, 4)
  }

  if (state.samples === 0) {
    const baselineTarget = Math.min(target, THUMBNAIL_BATCH_FAST_DIRECTORY_SIZE)
    return {
      nextBatchSize: baselineTarget,
      perImageMs,
      reason: `thumbnail-batch-baseline:${baselineTarget}`,
      successRatio,
    }
  }

  const current = clampThumbnailBatchSize(state.batchSize)
  if (target > current) {
    const step = target >= current + 3 ? 2 : 1
    return {
      nextBatchSize: clampThumbnailBatchSize(Math.min(target, current + step)),
      perImageMs,
      reason: `thumbnail-batch-ramp-up:${target}`,
      successRatio,
    }
  }

  if (target < current) {
    if (target <= THUMBNAIL_BATCH_VERY_SLOW_DIRECTORY_SIZE || perImageMs >= 1200 || successRatio < 0.75) {
      return {
        nextBatchSize: target,
        perImageMs,
        reason: `thumbnail-batch-heavy-penalty:${target}`,
        successRatio,
      }
    }

    return {
      nextBatchSize: clampThumbnailBatchSize(Math.max(target, current - 2)),
      perImageMs,
      reason: `thumbnail-batch-trim:${target}`,
      successRatio,
    }
  }

  return {
    nextBatchSize: current,
    perImageMs,
    reason: `thumbnail-batch-hold:${target}`,
    successRatio,
  }
}
