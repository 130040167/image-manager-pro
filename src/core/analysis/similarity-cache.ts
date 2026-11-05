export type WeightedLruCacheStats = {
  bytes: number
  entries: number
  evictions: number
  hits: number
  maxBytes: number
  maxEntries: number
  misses: number
}

type CacheEntry<T> = {
  value: T
  weight: number
}

export class WeightedLruCache<K, T> {
  private cache = new Map<K, CacheEntry<T>>()
  private bytes = 0
  private evictions = 0
  private hits = 0
  private misses = 0

  constructor(
    private maxEntries: number,
    private maxBytes: number,
    private readonly weigh: (value: T, key: K) => number,
  ) {}

  clear() {
    this.cache.clear()
    this.bytes = 0
    this.evictions = 0
    this.hits = 0
    this.misses = 0
  }

  get(key: K): T | undefined {
    const entry = this.cache.get(key)
    if (!entry) {
      this.misses++
      return undefined
    }
    this.hits++
    this.cache.delete(key)
    this.cache.set(key, entry)
    return entry.value
  }

  set(key: K, value: T) {
    const existing = this.cache.get(key)
    if (existing) {
      this.bytes -= existing.weight
      this.cache.delete(key)
    }

    const weight = Math.max(0, Math.ceil(this.weigh(value, key)))
    if (this.maxEntries <= 0 || this.maxBytes <= 0 || weight > this.maxBytes) {
      return
    }

    this.cache.set(key, { value, weight })
    this.bytes += weight
    this.evictToLimits()
  }

  setLimits(limits: { maxBytes?: number, maxEntries?: number }) {
    if (limits.maxEntries !== undefined)
      this.maxEntries = Math.max(0, Math.floor(limits.maxEntries))
    if (limits.maxBytes !== undefined)
      this.maxBytes = Math.max(0, Math.floor(limits.maxBytes))
    this.evictToLimits()
  }

  stats(): WeightedLruCacheStats {
    return {
      bytes: this.bytes,
      entries: this.cache.size,
      evictions: this.evictions,
      hits: this.hits,
      maxBytes: this.maxBytes,
      maxEntries: this.maxEntries,
      misses: this.misses,
    }
  }

  private evictToLimits() {
    while (this.cache.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.cache.entries().next().value as [K, CacheEntry<T>] | undefined
      if (!oldest)
        break
      this.cache.delete(oldest[0])
      this.bytes -= oldest[1].weight
      this.evictions++
    }
  }
}
