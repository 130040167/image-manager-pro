import { describe, expect, it } from 'vitest'
import { createDirectoryForegroundScheduler } from '~/message/directory-foreground-scheduler'

type RequestLog = {
  dirPath: string
  phase: 'finish' | 'send'
  time: number
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function flush() {
  // 多次 yield 让调度器内部 .finally 链有机会跑完
  for (let i = 0; i < 5; i++) {
    await Promise.resolve()
  }
}

describe('directory foreground expansion scheduler', () => {
  it('serializes foreground directory opens to avoid remote filesystem contention', async () => {
    const slow = createDeferred<void>()
    const fast = createDeferred<void>()
    const log: RequestLog[] = []
    const startedAt = performance.now()

    const scheduler = createDirectoryForegroundScheduler({ concurrency: 1 })

    const handler = (dirPath: string) => async () => {
      log.push({ dirPath, phase: 'send', time: performance.now() - startedAt })
      if (dirPath.endsWith('/slow')) {
        await slow.promise
      }
      else {
        await fast.promise
      }
      log.push({ dirPath, phase: 'finish', time: performance.now() - startedAt })
    }

    void scheduler.enqueue('f:/workspace/my-de-flow/slow', handler('f:/workspace/my-de-flow/slow'))
    void scheduler.enqueue('f:/workspace/my-de-flow/fast', handler('f:/workspace/my-de-flow/fast'))

    await flush()

    const sends = log.filter(item => item.phase === 'send')
    expect(sends.map(item => item.dirPath)).toEqual(['f:/workspace/my-de-flow/slow'])

    slow.resolve()
    await flush()

    expect(log.filter(item => item.phase === 'send').map(item => item.dirPath)).toEqual([
      'f:/workspace/my-de-flow/slow',
      'f:/workspace/my-de-flow/fast',
    ])

    fast.resolve()
    await flush()
  })

  it('lets click priority preempt and run before pending normal tasks', async () => {
    const blocker = createDeferred<void>()
    const click = createDeferred<void>()
    const log: RequestLog[] = []
    const startedAt = performance.now()

    const scheduler = createDirectoryForegroundScheduler({ concurrency: 1 })

    const blockingTask = () => async () => {
      log.push({ dirPath: 'blocker', phase: 'send', time: performance.now() - startedAt })
      await blocker.promise
      log.push({ dirPath: 'blocker', phase: 'finish', time: performance.now() - startedAt })
    }

    const normalTask = (id: string) => async () => {
      log.push({ dirPath: id, phase: 'send', time: performance.now() - startedAt })
      log.push({ dirPath: id, phase: 'finish', time: performance.now() - startedAt })
    }

    const clickTask = (id: string) => async () => {
      log.push({ dirPath: id, phase: 'send', time: performance.now() - startedAt })
      await click.promise
      log.push({ dirPath: id, phase: 'finish', time: performance.now() - startedAt })
    }

    // 第一个任务正在执行，占住唯一并发槽
    void scheduler.enqueue('blocker', blockingTask())

    // 排队的两个 normal 任务（模拟同级目录连锁请求）
    const sibling1 = scheduler.enqueue('sibling1', normalTask('sibling1'), { priority: 'normal' })
    const sibling2 = scheduler.enqueue('sibling2', normalTask('sibling2'), { priority: 'normal' })

    await flush()

    // 此时用户点击了一个新目录
    const clickPromise = scheduler.enqueue('user-click', clickTask('user-click'), { priority: 'click' })

    await flush()

    // 旧的 normal 兄弟应当被 click 抢占（reject AbortError）
    await expect(sibling1).rejects.toThrow()
    await expect(sibling2).rejects.toThrow()

    // 当 blocker 完成后，下一个执行的应该是 click 而不是任何残留的 normal
    blocker.resolve()
    await flush()

    const sends = log.filter(item => item.phase === 'send').map(item => item.dirPath)
    expect(sends).toEqual(['blocker', 'user-click'])

    click.resolve()
    await clickPromise
    await flush()
  })

  it('processes the newest click first when multiple clicks are queued', async () => {
    const blocker = createDeferred<void>()
    const click1 = createDeferred<void>()
    const click2 = createDeferred<void>()
    const log: RequestLog[] = []
    const startedAt = performance.now()

    const scheduler = createDirectoryForegroundScheduler({ concurrency: 1 })

    void scheduler.enqueue('blocker', async () => {
      log.push({ dirPath: 'blocker', phase: 'send', time: performance.now() - startedAt })
      await blocker.promise
      log.push({ dirPath: 'blocker', phase: 'finish', time: performance.now() - startedAt })
    })

    const c1 = scheduler.enqueue('click1', async () => {
      log.push({ dirPath: 'click1', phase: 'send', time: performance.now() - startedAt })
      await click1.promise
      log.push({ dirPath: 'click1', phase: 'finish', time: performance.now() - startedAt })
    }, { priority: 'click' })

    const c2 = scheduler.enqueue('click2', async () => {
      log.push({ dirPath: 'click2', phase: 'send', time: performance.now() - startedAt })
      await click2.promise
      log.push({ dirPath: 'click2', phase: 'finish', time: performance.now() - startedAt })
    }, { priority: 'click' })

    await flush()

    blocker.resolve()
    await flush()

    // click2（更晚入队）应当先于 click1 执行
    const sends = log.filter(item => item.phase === 'send').map(item => item.dirPath)
    expect(sends).toEqual(['blocker', 'click2'])

    click2.resolve()
    await c2
    await flush()
    click1.resolve()
    await c1
    await flush()
  })

  it('clearForPanel rejects only tasks belonging to the panel', async () => {
    const blocker = createDeferred<void>()
    const scheduler = createDirectoryForegroundScheduler({ concurrency: 1 })

    void scheduler.enqueue('blocker', async () => {
      await blocker.promise
    })

    const a = scheduler.enqueue('panel-a-1', async () => 'a1', { panelId: 'panel-a' })
    const b = scheduler.enqueue('panel-b-1', async () => 'b1', { panelId: 'panel-b' })

    await flush()

    const removed = scheduler.clearForPanel('panel-a')
    expect(removed).toBe(1)

    await expect(a).rejects.toThrow()

    blocker.resolve()
    await expect(b).resolves.toBe('b1')
  })
})
