import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CalendarWatcher } from '../src/calendar-watcher.js'

describe('CalendarWatcher lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('is not running after construction', () => {
    const watcher = new CalendarWatcher({ source: 'test.ics' })
    expect(watcher.isRunning).toBe(false)
  })

  it('is running after start()', () => {
    const watcher = new CalendarWatcher({ source: 'test.ics' })
    watcher.start()
    expect(watcher.isRunning).toBe(true)
    watcher.stop()
  })

  it('is not running after stop()', () => {
    const watcher = new CalendarWatcher({ source: 'test.ics' })
    watcher.start()
    watcher.stop()
    expect(watcher.isRunning).toBe(false)
  })

  it('start() is idempotent — calling twice does not throw', () => {
    const watcher = new CalendarWatcher({ source: 'test.ics' })
    watcher.start()
    expect(() => watcher.start()).not.toThrow()
    watcher.stop()
  })

  it('stop() is idempotent — calling twice does not throw', () => {
    const watcher = new CalendarWatcher({ source: 'test.ics' })
    watcher.start()
    watcher.stop()
    expect(() => watcher.stop()).not.toThrow()
  })

  it('emits events on the initial poll after start()', async () => {
    const watcher = new CalendarWatcher({ source: 'test.ics' })
    const received: unknown[][] = []
    watcher.on('events', (events) => received.push(events))
    watcher.start()
    // Allow micro-tasks to flush
    await Promise.resolve()
    expect(received.length).toBeGreaterThanOrEqual(1)
    watcher.stop()
  })

  it('emits events again after each poll interval', async () => {
    const watcher = new CalendarWatcher({
      source: 'test.ics',
      pollIntervalMinutes: 1
    })
    const received: unknown[][] = []
    watcher.on('events', (events) => received.push(events))
    watcher.start()
    await Promise.resolve() // initial poll
    const countAfterStart = received.length

    vi.advanceTimersByTime(60_000) // advance 1 minute
    await Promise.resolve()

    expect(received.length).toBeGreaterThan(countAfterStart)
    watcher.stop()
  })

  it('on/off removes a specific listener', async () => {
    const watcher = new CalendarWatcher({ source: 'test.ics' })
    let callCount = 0
    const listener = () => { callCount++ }
    watcher.on('events', listener)
    watcher.start()
    await Promise.resolve()
    const beforeRemove = callCount

    watcher.off('events', listener)
    vi.advanceTimersByTime(5 * 60_000) // advance past poll interval
    await Promise.resolve()

    expect(callCount).toBe(beforeRemove)
    watcher.stop()
  })
})
