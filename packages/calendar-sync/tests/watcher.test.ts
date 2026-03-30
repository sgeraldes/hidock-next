import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CalendarWatcher } from '../src/calendar-watcher.js'
import type { CalendarEvent } from '../src/types.js'

// Sample ICS content for testing
const SAMPLE_ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:watcher-test-uid',
  'SUMMARY:Watcher Test Meeting',
  'DTSTART:20260329T140000Z',
  'DTEND:20260329T150000Z',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

// Top-level mock for node:fs/promises — configure per test via mockImplementation
const mockReadFile = vi.fn()
vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
}))

describe('CalendarWatcher lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Default: readFile resolves with empty calendar so lifecycle tests work
    mockReadFile.mockResolvedValue('BEGIN:VCALENDAR\r\nEND:VCALENDAR')
  })

  afterEach(() => {
    vi.useRealTimers()
    mockReadFile.mockReset()
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

  it('start() is idempotent', () => {
    const watcher = new CalendarWatcher({ source: 'test.ics' })
    watcher.start()
    expect(() => watcher.start()).not.toThrow()
    watcher.stop()
  })

  it('stop() is idempotent', () => {
    const watcher = new CalendarWatcher({ source: 'test.ics' })
    watcher.start()
    watcher.stop()
    expect(() => watcher.stop()).not.toThrow()
  })
})

describe('CalendarWatcher poll — file source', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockReadFile.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads a local file and emits parsed events', async () => {
    mockReadFile.mockResolvedValue(SAMPLE_ICS)

    const watcher = new CalendarWatcher({ source: '/path/to/cal.ics' })
    const received: CalendarEvent[][] = []
    watcher.on('events', (events) => received.push(events))
    watcher.start()

    await vi.advanceTimersByTimeAsync(0)

    expect(received.length).toBeGreaterThanOrEqual(1)
    expect(received[0]).toHaveLength(1)
    expect(received[0][0].uid).toBe('watcher-test-uid')
    expect(received[0][0].title).toBe('Watcher Test Meeting')
    watcher.stop()
  })

  it('emits error when file read fails', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT: file not found'))

    const watcher = new CalendarWatcher({ source: '/nonexistent.ics' })
    const errors: Error[] = []
    watcher.on('error', (err) => errors.push(err))
    watcher.start()

    await vi.advanceTimersByTimeAsync(0)

    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(errors[0].message).toContain('ENOENT')
    watcher.stop()
  })
})

describe('CalendarWatcher poll — URL source', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('fetches a URL and emits parsed events', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(SAMPLE_ICS),
    })
    vi.stubGlobal('fetch', mockFetch)

    const watcher = new CalendarWatcher({ source: 'https://example.com/cal.ics' })
    const received: CalendarEvent[][] = []
    watcher.on('events', (events) => received.push(events))
    watcher.start()

    await vi.advanceTimersByTimeAsync(0)

    expect(mockFetch).toHaveBeenCalledWith('https://example.com/cal.ics')
    expect(received.length).toBeGreaterThanOrEqual(1)
    expect(received[0]).toHaveLength(1)
    expect(received[0][0].uid).toBe('watcher-test-uid')
    watcher.stop()
  })

  it('emits error when fetch returns non-OK status', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    })
    vi.stubGlobal('fetch', mockFetch)

    const watcher = new CalendarWatcher({ source: 'https://example.com/missing.ics' })
    const errors: Error[] = []
    watcher.on('error', (err) => errors.push(err))
    watcher.start()

    await vi.advanceTimersByTimeAsync(0)

    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(errors[0].message).toContain('404')
    watcher.stop()
  })

  it('emits error when fetch throws', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'))
    vi.stubGlobal('fetch', mockFetch)

    const watcher = new CalendarWatcher({ source: 'http://unreachable.test/cal.ics' })
    const errors: Error[] = []
    watcher.on('error', (err) => errors.push(err))
    watcher.start()

    await vi.advanceTimersByTimeAsync(0)

    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(errors[0].message).toContain('Network error')
    watcher.stop()
  })

  it('emits events again after each poll interval', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(SAMPLE_ICS),
    })
    vi.stubGlobal('fetch', mockFetch)

    const watcher = new CalendarWatcher({
      source: 'https://example.com/cal.ics',
      pollIntervalMinutes: 1,
    })
    const received: CalendarEvent[][] = []
    watcher.on('events', (events) => received.push(events))
    watcher.start()

    await vi.advanceTimersByTimeAsync(0) // initial poll
    const countAfterStart = received.length

    await vi.advanceTimersByTimeAsync(60_000) // advance 1 minute

    expect(received.length).toBeGreaterThan(countAfterStart)
    watcher.stop()
  })

  it('on/off removes a specific listener', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(SAMPLE_ICS),
    })
    vi.stubGlobal('fetch', mockFetch)

    const watcher = new CalendarWatcher({ source: 'https://example.com/cal.ics' })
    let callCount = 0
    const listener = () => { callCount++ }
    watcher.on('events', listener)
    watcher.start()

    await vi.advanceTimersByTimeAsync(0)
    const beforeRemove = callCount

    watcher.off('events', listener)
    await vi.advanceTimersByTimeAsync(5 * 60_000)

    expect(callCount).toBe(beforeRemove)
    watcher.stop()
  })
})
