/**
 * Boot scheduler — proves the restart-freeze fix: heavy boot work is DEFERRED
 * and CHUNKED (one task at a time, yielding between tasks), never run as a
 * synchronous burst in the app-ready handler.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  registerBootTask,
  startBootScheduler,
  pendingBootTaskCount,
  getBootTaskTimings,
  isBootDrainActive,
  areBootTasksSettled,
  whenBootTasksSettled,
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

/**
 * F15: sequencing alone did not stop the boot freeze — one task could still hold
 * the main process for tens of seconds. These cover the evidence surface that
 * makes such a stall attributable to a specific task.
 */
describe('boot-scheduler — per-task timing (F15)', () => {
  beforeEach(() => _resetBootSchedulerForTests())
  afterEach(() => {
    _resetBootSchedulerForTests()
    vi.restoreAllMocks()
  })

  it('records name, start and elapsed for every task, in completion order', async () => {
    registerBootTask({ name: 'fast', run: () => {} })
    registerBootTask({ name: 'slower', run: async () => { await new Promise((r) => setTimeout(r, 30)) } })

    const before = Date.now()
    await startBootScheduler({ startDelayMs: 0, gapMs: 0, ...silent })

    const timings = getBootTaskTimings()
    expect(timings.map((t) => t.name)).toEqual(['fast', 'slower'])
    expect(timings.every((t) => t.ok)).toBe(true)
    expect(timings.every((t) => t.startedAt >= before)).toBe(true)
    // The slow task's measured elapsed reflects the awaited work, not just the
    // synchronous part — this is what attributes a stall to the right task.
    expect(timings[1].elapsedMs).toBeGreaterThanOrEqual(25)
  })

  it('records a failing task as ok:false with its message, and keeps going', async () => {
    registerBootTask({ name: 'boom', run: () => { throw new Error('disk on fire') } })
    registerBootTask({ name: 'after', run: () => {} })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await startBootScheduler({ startDelayMs: 0, gapMs: 0, ...silent })

    const timings = getBootTaskTimings()
    expect(timings.map((t) => t.name)).toEqual(['boom', 'after'])
    expect(timings[0].ok).toBe(false)
    expect(timings[0].error).toBe('disk on fire')
    expect(timings[1].ok).toBe(true)
  })

  it('always warns about a task slow enough to freeze the window, even with QA logs off', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // 3000ms is the warn threshold; fake the clock rather than actually stalling.
    const realNow = Date.now
    let t = realNow()
    vi.spyOn(Date, 'now').mockImplementation(() => t)
    registerBootTask({ name: 'hog', run: () => { t += 9000 } })

    await startBootScheduler({ startDelayMs: 0, gapMs: 0, ...silent })

    expect(getBootTaskTimings()[0].elapsedMs).toBe(9000)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('SLOW boot task "hog" took 9000ms')
  })
})

/**
 * F15: heavy work outside the scheduler (the startup/periodic calendar sync) must
 * not overlap the boot drain. `whenBootTasksSettled` is the gate it waits on.
 */
describe('boot-scheduler — settle gate (F15)', () => {
  beforeEach(() => _resetBootSchedulerForTests())
  afterEach(() => _resetBootSchedulerForTests())

  it('holds a waiter until the drain finishes, then releases it', async () => {
    let released = false
    registerBootTask({ name: 'slow', run: async () => { await new Promise((r) => setTimeout(r, 40)) } })

    const gate = whenBootTasksSettled(5000).then(() => { released = true })
    const drain = startBootScheduler({ startDelayMs: 0, gapMs: 0, ...silent })

    // Still inside the drain: the waiter has NOT been let through.
    await new Promise((r) => setTimeout(r, 10))
    expect(isBootDrainActive()).toBe(true)
    expect(released).toBe(false)

    await drain
    await gate
    expect(released).toBe(true)
    expect(isBootDrainActive()).toBe(false)
  })

  it('resolves immediately once the drain has already settled', async () => {
    registerBootTask({ name: 'x', run: () => {} })
    await startBootScheduler({ startDelayMs: 0, gapMs: 0, ...silent })

    // No timers involved — an already-settled gate must not re-queue a waiter.
    await expect(whenBootTasksSettled(0)).resolves.toBeUndefined()
  })

  it('is NOT "settled" before the scheduler starts — the window boot syncs arrive in', () => {
    registerBootTask({ name: 'pending', run: () => {} })

    // Nothing is draining yet, but the work is still ahead. A caller keying off
    // isBootDrainActive() alone would wrongly conclude it may start now.
    expect(isBootDrainActive()).toBe(false)
    expect(areBootTasksSettled()).toBe(false)
  })

  it('resolves on timeout so a scheduler that never starts cannot wedge callers', async () => {
    // Nothing registered, nothing started — the waiter must still be released.
    const t0 = Date.now()
    await whenBootTasksSettled(30)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(20)
    expect(isBootDrainActive()).toBe(false)
  })
})
