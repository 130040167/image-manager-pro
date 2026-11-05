import type { GlobEntry } from 'globby'
import fs from 'node:fs'

/**
 * Module-level globby result cache + in-flight de-duplication.
 *
 * On SSHFS / slow disks / large directories `globby(..., { stats: true })` is
 * the dominant cold-start cost. Scan results are cached by
 * `(realpath(cwd), normalizedGlob)`:
 *
 * - Reopening a panel for the same cwd hits the cache instead of doing IO.
 * - When two callers (e.g. opening a second panel) race the same scan, the
 *   second one shares the in-flight Promise rather than starting another.
 * - When two panels are mounted on different symlinked aliases of the same
 *   real directory, realpath normalization lets them share a single cached
 *   result.
 * - Watcher create/change/delete events keep the cache in sync via
 *   `upsertEntry` / `removeEntryByPath`.
 * - `clearAll` is invoked on relevant config changes (scan / exclude /
 *   gitignore) to drop everything.
 *
 * Cached entries hold raw globby `GlobEntry` rows (with stats) and are
 * panel-agnostic, so the cache survives panel close/reopen.
 */

/**
 * cwd -> realpath. realpath is one network RTT on SSHFS, but cwds are very
 * few (≈ open workspaces) and we resolve each only once. If the path does
 * not exist or the call fails, we fall back to the original value so callers
 * that share the same un-resolvable input still hit the same key.
 */
const realpathCache = new Map<string, string>()

function normalizeCwd(cwd: string): string {
  const cached = realpathCache.get(cwd)
  if (cached !== undefined)
    return cached
  let resolved = cwd
  try {
    resolved = fs.realpathSync.native(cwd)
  }
  catch {
    // Path may not exist yet, or be unreadable. Fall back to the input value.
  }
  realpathCache.set(cwd, resolved)
  return resolved
}

export type CachedEntry = {
  entries: GlobEntry[]
  /** Write timestamp (ms), kept around for a future TTL knob. */
  at: number
}

const cache = new Map<string, CachedEntry>()

/** Promises currently in flight per key. The first caller does the IO; later callers share the Promise. */
const inFlight = new Map<string, Promise<GlobEntry[]>>()

/**
 * Normalize a glob (string | string[]) into a stable key fragment.
 */
function normalizeGlob(glob: string | string[]): string {
  if (Array.isArray(glob)) {
    // Preserve element order — globby is order-sensitive.
    return glob.join('\n')
  }
  return glob
}

function makeKey(cwd: string, glob: string | string[]): string {
  return `${normalizeCwd(cwd)} ${normalizeGlob(glob)}`
}

export function getCachedEntries(cwd: string, glob: string | string[]): GlobEntry[] | undefined {
  return cache.get(makeKey(cwd, glob))?.entries
}

export function setCachedEntries(cwd: string, glob: string | string[], entries: GlobEntry[]): void {
  cache.set(makeKey(cwd, glob), { entries, at: Date.now() })
}

/**
 * Hit the cache, share an in-flight Promise, or run `fetcher` and cache the
 * result. This is the only entry point used by message-factory.ts so that
 * concurrent get_image_info calls collapse to a single globby invocation.
 */
export async function withCache(
  cwd: string,
  glob: string | string[],
  fetcher: () => Promise<GlobEntry[]>,
): Promise<{ entries: GlobEntry[], hit: 'memo' | 'inflight' | 'miss' }> {
  const key = makeKey(cwd, glob)

  const cached = cache.get(key)
  if (cached) {
    return { entries: cached.entries, hit: 'memo' }
  }

  const existing = inFlight.get(key)
  if (existing) {
    const entries = await existing
    return { entries, hit: 'inflight' }
  }

  const promise = (async () => {
    try {
      const entries = await fetcher()
      cache.set(key, { entries, at: Date.now() })
      return entries
    }
    finally {
      // Always clear the in-flight slot so a rejected Promise is not pinned.
      inFlight.delete(key)
    }
  })()
  inFlight.set(key, promise)
  const entries = await promise
  return { entries, hit: 'miss' }
}

/**
 * Remove every cached entry whose path matches `filePath` (used by onDidDelete).
 */
export function removeEntryByPath(filePath: string): void {
  for (const [, value] of cache) {
    const idx = value.entries.findIndex(e => e.path === filePath)
    if (idx !== -1) {
      value.entries.splice(idx, 1)
    }
  }
}

/**
 * Upsert one entry under a cwd (used by onDidCreate / onDidChange).
 *
 * If `newEntry.path` matches an existing entry it replaces it; otherwise it
 * is appended — but only into caches that already exist for this cwd, so we
 * never seed a partial result for a cwd that has not been scanned yet.
 */
export function upsertEntry(cwd: string, newEntry: GlobEntry): void {
  const cwdPrefix = `${normalizeCwd(cwd)} `
  for (const [key, value] of cache) {
    if (!key.startsWith(cwdPrefix)) {
      continue
    }
    const idx = value.entries.findIndex(e => e.path === newEntry.path)
    if (idx !== -1) {
      value.entries[idx] = newEntry
    }
    else {
      value.entries.push(newEntry)
    }
  }
}

/**
 * Drop every cached scan and in-flight Promise. Called when scan-related
 * configuration changes invalidate every glob.
 */
export function clearAll(): void {
  cache.clear()
  inFlight.clear()
  realpathCache.clear()
}

/**
 * Is there still an in-flight scan rooted at this cwd?
 *
 * On SSHFS the initial scan can take minutes. During that window the watcher
 * fires a "file appeared" event for every file (each one a remote fs.stat),
 * and those compete with the main scan over the same SSH connection. The
 * watcher uses this helper to defer incremental cache patches until the
 * main scan finishes; the final scan result will overwrite the cache so no
 * data is lost.
 */
export function hasInFlightForCwd(cwd: string): boolean {
  const cwdPrefix = `${normalizeCwd(cwd)} `
  for (const key of inFlight.keys()) {
    if (key.startsWith(cwdPrefix)) {
      return true
    }
  }
  return false
}

/**
 * Drop every cached scan and in-flight Promise rooted at a single cwd.
 */
export function clearByCwd(cwd: string): void {
  const cwdPrefix = `${normalizeCwd(cwd)} `
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(cwdPrefix)) {
      cache.delete(key)
    }
  }
  for (const key of Array.from(inFlight.keys())) {
    if (key.startsWith(cwdPrefix)) {
      inFlight.delete(key)
    }
  }
}
