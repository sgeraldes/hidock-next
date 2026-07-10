/**
 * Boot scheduler — proves the restart-freeze fix: heavy boot work is DEFERRED
 * and CHUNKED (one task at a time, yielding between tasks), never run as a
 * synchronous burst in the app-ready handler.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  registerBootTask,
  startBootScheduler,
  pendingBootTaskCount,
  _resetBootSchedulerForTests
} from '../boot-scheduler'

const silent = { log: () => {} }

describe('boot-scheduler', () => {
  beforeEach(() => _resetBootSchedulerForTests())
  afterEach(() => _resetBootSchedulerForTests())

  it('defers work — nothing runs synchronously in the tick that starts the scheduler', async () => {
    const order: string[] = []
    registerBootTask({ name: 'a', run: () => { order.push('a') } })

    const settle = startBootScheduler({ startDelayMs: 5, gapMs: 0, ...silent })

    // Right after starting, the task has NOT run yet — it is scheduled behind the
    // initial idle delay. This is exactly what keeps the ready handler from
    // blocking on heavy work.
    expect(order).toEqual([])
    expect(pendingBootTaskCount()).toBe(1)

    await settle
    expect(order).toEqual(['a'])
    expect(pendingBootTaskCount()).toBe(0)
  })

  it('runs tasks one at a time (concurrency cap = 1) and in registration order', async () => {
    const events: string[] = []
    let active = 0
    let maxActive = 0

    const makeTask = (name: string) => ({
      name,
      run: async () => {
        active++
        maxActive = Math.max(maxActive, active)
        events.push(`start:${name}`)
        await new Promise((r) => setTimeout(r, 10))
        events.push(`end:${name}`)
        active--
      }
    })

    registerBootTask(makeTask('t1'))
    registerBootTask(makeTask('t2'))
    registerBootTask(makeTask('t3'))

    await startBootScheduler({ startDelayMs: 0, gapMs: 0, ...silent })

    // Never more than one heavy task in flight — the whole point of the fix.
    expect(maxActive).toBe(1)
    expect(events).toEqual([
      'start:t1', 'end:t1',
      'start:t2', 'end:t2',
      'start:t3', 'end:t3'
    ])
  })

  it('one failing task never aborts the rest (best-effort, like the old per-backfill catch)', async () => {
    const ran: string[] = []
    registerBootTask({ name: 'ok1', run: () => { ran.push('ok1') } })
    registerBootTask({ name: 'boom', run: () => { throw new Error('nope') } })
    registerBootTask({ name: 'ok2', run: async () => { ran.push('ok2') } })

    await startBootScheduler({ startDelayMs: 0, gapMs: 0, ...silent })

    expect(ran).toEqual(['ok1', 'ok2'])
    expect(pendingBootTaskCount()).toBe(0)
  })

  it('is idempotent — a second start does not re-run tasks (safe to wire to two triggers)', async () => {
    const ran: string[] = []
    registerBootTask({ name: 'once', run: () => { ran.push('x') } })

    const p1 = startBootScheduler({ startDelayMs: 0, gapMs: 0, ...silent })
    const p2 = startBootScheduler({ startDelayMs: 0, gapMs: 0, ...silent })
    await Promise.all([p1, p2])

    expect(ran).toEqual(['x'])
  })

  it('inserts an idle gap BETWEEN tasks so the event loop is yielded to the renderer', async () => {
    const startTimes: number[] = []
    registerBootTask({ name: 'g1', run: () => { startTimes.push(Date.now()) } })
    registerBootTask({ name: 'g2', run: () => { startTimes.push(Date.now()) } })

    await startBootScheduler({ startDelayMs: 0, gapMs: 40, ...silent })

    expect(startTimes.length).toBe(2)
    // The second task starts at least ~one gap after the first — proof the loop
    // yields between heavy passes rather than running them back-to-back.
    expect(startTimes[1] - startTimes[0]).toBeGreaterThanOrEqual(30)
  })
})
