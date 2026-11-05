import { describe, expect, it } from 'vitest'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function createDirectoryRequestDedupe(maxAgeMs: number) {
  const inFlight = new Map<string, { promise: Promise<string>, startedAt: number }>()
  let executions = 0

  const run = (key: string, factory: () => Promise<string>) => {
    const existing = inFlight.get(key)
    if (existing && Date.now() - existing.startedAt < maxAgeMs) {
      return existing.promise
    }

    executions++
    const promise = factory().finally(() => {
      const current = inFlight.get(key)
      if (current?.promise === promise) {
        inFlight.delete(key)
      }
    })
    inFlight.set(key, { promise, startedAt: Date.now() })
    return promise
  }

  return {
    get executions() {
      return executions
    },
    run,
  }
}

describe('directory request dedupe', () => {
  it('joins concurrent requests for the same directory payload', async () => {
    const slow = createDeferred<string>()
    const dedupe = createDirectoryRequestDedupe(14_000)

    const first = dedupe.run('panel::cwd::dir::images::0::128', async () => slow.promise)
    const second = dedupe.run('panel::cwd::dir::images::0::128', async () => 'second')

    expect(dedupe.executions).toBe(1)
    expect(first).toBe(second)

    slow.resolve('done')

    await expect(first).resolves.toBe('done')
    await expect(second).resolves.toBe('done')
  })
})
