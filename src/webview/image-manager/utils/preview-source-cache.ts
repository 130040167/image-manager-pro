/** Conservative UTF-16 budget, including keys; oversized values are returned but not retained. */
export class PreviewSourceCache {
  private entries = new Map<string, { value: string, bytes: number }>()
  private bytes = 0

  constructor(readonly maxBytes = 32 * 1024 * 1024, readonly maxEntries = 2048) {}

  get(key: string) {
    const entry = this.entries.get(key)
    if (!entry)
      return undefined
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }

  set(key: string, value: string) {
    this.delete(key)
    const bytes = (key.length + value.length) * 2
    if (this.maxEntries <= 0 || bytes > this.maxBytes)
      return
    while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes)
      this.delete(this.entries.keys().next().value!)
    this.entries.set(key, { value, bytes })
    this.bytes += bytes
  }

  delete(key: string) {
    const entry = this.entries.get(key)
    if (!entry)
      return
    this.bytes -= entry.bytes
    this.entries.delete(key)
  }

  clear() {
    this.entries.clear()
    this.bytes = 0
  }

  keys() { return this.entries.keys() }

  releaseDataUrls() {
    for (const [key, entry] of this.entries) {
      if (entry.value.startsWith('data:'))
        this.delete(key)
    }
  }

  get usage() { return { bytes: this.bytes, entries: this.entries.size, maxBytes: this.maxBytes, maxEntries: this.maxEntries } }
}
