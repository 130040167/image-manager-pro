export type SimilarityAlgorithm = 'dhash' | 'phash' | 'ahash' | 'histogram' | 'hybrid'
export type SimilaritySliceStrategy = 'first' | 'all'

export type SimilarityAlgorithmProfile = {
  description: string
  label: string
  threshold: {
    defaultValue: number
    max: number
    min: number
    recommended: [number, number]
    step: number
    unit: string
  }
  useCase: string
  value: SimilarityAlgorithm
}

export const DEFAULT_SIMILARITY_MAX_RESULTS = 50
export const MAX_SIMILARITY_RESULTS = 500
export const MIN_SIMILARITY_RESULTS = 1

const HASH_THRESHOLD_MAX = 64

export const SIMILARITY_ALGORITHM_ORDER: SimilarityAlgorithm[] = [
  'hybrid',
  'phash',
  'dhash',
  'ahash',
  'histogram',
]

export const SIMILARITY_ALGORITHM_PROFILES: Record<SimilarityAlgorithm, SimilarityAlgorithmProfile> = {
  hybrid: {
    description: 'Combines pHash structure with a color histogram so recolored look-alikes are less likely to match.',
    label: 'Hybrid',
    threshold: {
      defaultValue: 14,
      max: HASH_THRESHOLD_MAX,
      min: 0,
      recommended: [10, 18],
      step: 1,
      unit: 'combined distance',
    },
    useCase: 'Best default for ordinary folders with screenshots, photos, exports, and edited copies.',
    value: 'hybrid',
  },
  phash: {
    description: 'Perceptual hash based on low-frequency image structure. It is tolerant of resize, compression, and mild tone changes.',
    label: 'pHash',
    threshold: {
      defaultValue: 14,
      max: HASH_THRESHOLD_MAX,
      min: 0,
      recommended: [10, 18],
      step: 1,
      unit: 'Hamming bits',
    },
    useCase: 'Good for resized or compressed copies where colors may shift slightly.',
    value: 'phash',
  },
  dhash: {
    description: 'Difference hash compares local brightness gradients. It is fast and strict, but misses some crops or heavy edits.',
    label: 'dHash',
    threshold: {
      defaultValue: 8,
      max: HASH_THRESHOLD_MAX,
      min: 0,
      recommended: [4, 10],
      step: 1,
      unit: 'Hamming bits',
    },
    useCase: 'Fast duplicate and near-duplicate scans for simple resized images.',
    value: 'dhash',
  },
  ahash: {
    description: 'Average hash compares pixels against the image average. It is simple and strict, but sensitive to global edits.',
    label: 'aHash',
    threshold: {
      defaultValue: 8,
      max: HASH_THRESHOLD_MAX,
      min: 0,
      recommended: [4, 10],
      step: 1,
      unit: 'Hamming bits',
    },
    useCase: 'Quick checks for simple icons, diagrams, and low-edit duplicates.',
    value: 'ahash',
  },
  histogram: {
    description: 'Color histogram compares the distribution of RGB and intensity values. It ignores layout more than hash methods.',
    label: 'Histogram',
    threshold: {
      defaultValue: 14,
      max: HASH_THRESHOLD_MAX,
      min: 0,
      recommended: [10, 20],
      step: 1,
      unit: 'color distance',
    },
    useCase: 'Useful when color palette matters more than exact geometry; can match unrelated images with similar colors.',
    value: 'histogram',
  },
}

export function getSimilarityAlgorithmProfile(algorithm: SimilarityAlgorithm) {
  return SIMILARITY_ALGORITHM_PROFILES[algorithm] || SIMILARITY_ALGORITHM_PROFILES.hybrid
}

export function getSimilarityAlgorithmOptions() {
  return SIMILARITY_ALGORITHM_ORDER.map((algorithm) => {
    const profile = getSimilarityAlgorithmProfile(algorithm)
    return {
      label: profile.label,
      value: profile.value,
    }
  })
}

export function normalizeSimilarityMaxResults(maxResults: number | undefined) {
  if (maxResults == null)
    return DEFAULT_SIMILARITY_MAX_RESULTS
  const numeric = Number(maxResults)
  if (!Number.isFinite(numeric))
    return DEFAULT_SIMILARITY_MAX_RESULTS
  return Math.max(MIN_SIMILARITY_RESULTS, Math.min(MAX_SIMILARITY_RESULTS, Math.floor(numeric)))
}

export function normalizeSimilarityThreshold(algorithm: SimilarityAlgorithm, threshold: number | undefined) {
  const profile = getSimilarityAlgorithmProfile(algorithm)
  if (threshold == null)
    return undefined
  const numeric = Number(threshold)
  if (!Number.isFinite(numeric))
    return profile.threshold.defaultValue
  return Math.max(profile.threshold.min, Math.min(profile.threshold.max, Math.round(numeric)))
}

export function getSimilarityDefaultThreshold(algorithm: SimilarityAlgorithm, precision: number) {
  const profile = getSimilarityAlgorithmProfile(algorithm)
  const rawThreshold = algorithm === 'dhash' || algorithm === 'ahash'
    ? profile.threshold.defaultValue
    : precision
  return normalizeSimilarityThreshold(algorithm, rawThreshold) ?? profile.threshold.defaultValue
}

export function getSimilarityUiDefaultThreshold(algorithm: SimilarityAlgorithm) {
  const profile = getSimilarityAlgorithmProfile(algorithm)
  return algorithm === 'dhash' || algorithm === 'ahash' ? profile.threshold.defaultValue : undefined
}
