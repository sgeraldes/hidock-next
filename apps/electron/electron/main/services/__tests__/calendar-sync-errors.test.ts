import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * B-CAL-004: Unit tests for categorizeCalendarError
 * Ensures errors are categorized correctly for user-facing messages.
 */

// Mock Electron app
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp'),
    getName: vi.fn().mockReturnValue('test'),
  }
}))

// Mock file-storage (depends on Electron app)
vi.mock('../file-storage', () => ({
  getCachePath: vi.fn().mockReturnValue('/tmp/cache'),
}))

// Mock config (depends on Electron app)
vi.mock('../config', () => ({
  getConfig: vi.fn().mockReturnValue({
    calendar: { icsUrl: '', syncEnabled: false, syncIntervalMinutes: 15, lastSyncAt: null }
  }),
  updateConfig: vi.fn(),
}))

// Mock database
vi.mock('../database', () => ({
  upsertMeetingsBatch: vi.fn(),
}))

// Mock the event bus so we can assert the calendar:synced broadcast.
const { emitDomainEvent } = vi.hoisted(() => ({ emitDomainEvent: vi.fn() }))
vi.mock('../event-bus', () => ({
  getEventBus: () => ({ emitDomainEvent }),
}))

// Mock the side-effect modules syncCalendar dynamically imports.
vi.mock('../activity-log', () => ({ emitActivityLog: vi.fn() }))
vi.mock('../org-reconciler', () => ({ reconcileOrganization: vi.fn() }))
vi.mock('fs/promises', () => ({ writeFile: vi.fn().mockResolvedValue(undefined) }))

describe('syncCalendar — calendar:synced broadcast', () => {
  let syncCalendar: typeof import('../calendar-sync').syncCalendar

  // F15: syncCalendar defers itself until the boot tasks drain. No scheduler runs
  // in these tests, so they opt out explicitly — the boot gate has its own
  // coverage below.
  const now = { waitForBootMs: 0 } as const

  beforeEach(async () => {
    emitDomainEvent.mockClear()
    const mod = await import('../calendar-sync')
    syncCalendar = mod.syncCalendar
  })

  it('emits calendar:synced with the meeting count on a successful sync', async () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:evt-1@example.com',
      'SUMMARY:Standup',
      'DTSTART:20260708T140000Z',
      'DTEND:20260708T150000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => ics }) as any

    const result = await syncCalendar('https://calendar.example.com/test.ics', now)

    expect(result.success).toBe(true)
    expect(emitDomainEvent).toHaveBeenCalledTimes(1)
    expect(emitDomainEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'calendar:synced', payload: { meetingsCount: result.meetingsCount } })
    )
  })

  it('does NOT emit calendar:synced when the fetch fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' }) as any

    // Single attempt: 500 is retryable, and this test is about the broadcast.
    const result = await syncCalendar('https://calendar.example.com/test.ics', {
      ...now,
      fetchAttempts: 1
    })

    expect(result.success).toBe(false)
    expect(emitDomainEvent).not.toHaveBeenCalled()
  })
})

describe('categorizeCalendarError', () => {
  let categorizeCalendarError: typeof import('../calendar-sync').categorizeCalendarError

  beforeEach(async () => {
    const mod = await import('../calendar-sync')
    categorizeCalendarError = mod.categorizeCalendarError
  })

  describe('network errors', () => {
    it('should categorize fetch TypeError', () => {
      const result = categorizeCalendarError(new TypeError('Failed to fetch'))
      expect(result.category).toBe('network')
    })

    it('should categorize ECONNREFUSED errors', () => {
      const result = categorizeCalendarError(new Error('connect ECONNREFUSED 127.0.0.1:443'))
      expect(result.category).toBe('network')
    })

    it('should categorize ENOTFOUND errors', () => {
      const result = categorizeCalendarError(new Error('getaddrinfo ENOTFOUND calendar.example.com'))
      expect(result.category).toBe('network')
    })

    it('should categorize ETIMEDOUT errors', () => {
      const result = categorizeCalendarError(new Error('connect ETIMEDOUT'))
      expect(result.category).toBe('network')
    })

    it('should categorize HTTP status errors', () => {
      const result = categorizeCalendarError(new Error('Failed to fetch calendar: 500 Internal Server Error'))
      expect(result.category).toBe('network')
    })

    it('should categorize ERR_NETWORK errors', () => {
      const result = categorizeCalendarError(new Error('ERR_NETWORK'))
      expect(result.category).toBe('network')
    })
  })

  describe('parse errors', () => {
    it('should categorize ICAL parse errors', () => {
      const result = categorizeCalendarError(new Error('ICAL parse error: unexpected token'))
      expect(result.category).toBe('parse')
    })

    it('should categorize SyntaxError messages', () => {
      const result = categorizeCalendarError(new Error('SyntaxError: Unexpected end of input'))
      expect(result.category).toBe('parse')
    })

    it('should categorize invalid ical errors', () => {
      const result = categorizeCalendarError(new Error('invalid ical body'))
      expect(result.category).toBe('parse')
    })

    it('should categorize Unexpected token errors', () => {
      const result = categorizeCalendarError(new Error('Unexpected token < in JSON'))
      expect(result.category).toBe('parse')
    })
  })

  describe('database errors', () => {
    it('should categorize database error messages', () => {
      const result = categorizeCalendarError(new Error('Database error: SQLITE_CONSTRAINT'))
      expect(result.category).toBe('database')
    })

    it('should categorize sqlite constraint errors', () => {
      const result = categorizeCalendarError(new Error('SQLITE_BUSY: database is locked'))
      expect(result.category).toBe('database')
    })

    it('should categorize constraint violation errors', () => {
      const result = categorizeCalendarError(new Error('UNIQUE constraint failed: meetings.id'))
      expect(result.category).toBe('database')
    })
  })

  describe('validation errors', () => {
    it('should categorize URL validation errors', () => {
      const result = categorizeCalendarError(new Error('Only HTTP/HTTPS URLs are allowed'))
      expect(result.category).toBe('validation')
    })

    it('should categorize HTTPS requirement errors', () => {
      const result = categorizeCalendarError(new Error('HTTPS is required for calendar URLs'))
      expect(result.category).toBe('validation')
    })

    it('should categorize blocked URL errors', () => {
      const result = categorizeCalendarError(new Error('This URL is blocked for security reasons'))
      expect(result.category).toBe('validation')
    })

    it('should categorize Private IP errors', () => {
      const result = categorizeCalendarError(new Error('Private IP addresses are not allowed'))
      expect(result.category).toBe('validation')
    })
  })

  describe('unknown errors', () => {
    it('should categorize generic errors as unknown', () => {
      const result = categorizeCalendarError(new Error('Something went wrong'))
      expect(result.category).toBe('unknown')
    })

    it('should handle non-Error objects', () => {
      const result = categorizeCalendarError('a string error')
      expect(result.category).toBe('unknown')
      expect(result.message).toBe('a string error')
    })

    it('should handle null/undefined', () => {
      const result = categorizeCalendarError(null)
      expect(result.category).toBe('unknown')
    })
  })

  describe('message preservation', () => {
    it('should preserve the original error message for Error instances', () => {
      const error = new Error('connect ECONNREFUSED 127.0.0.1:443')
      const result = categorizeCalendarError(error)
      expect(result.message).toBe('connect ECONNREFUSED 127.0.0.1:443')
    })

    it('should stringify non-Error objects', () => {
      const result = categorizeCalendarError(42)
      expect(result.message).toBe('42')
    })
  })
})

/** ICS body reused by the F15 suites below. */
const SAMPLE_ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'UID:evt-f15@example.com',
  'SUMMARY:F15',
  'DTSTART:20260708T140000Z',
  'DTEND:20260708T150000Z',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n')

const okResponse = () => ({ ok: true, status: 200, text: async () => SAMPLE_ICS })

/**
 * How node's fetch actually surfaces a reset: a bare `TypeError: fetch failed`
 * with the real code hidden on `.cause`. This is what the owner's F15 log showed.
 */
const econnreset = (): Error =>
  Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
  })

/**
 * F15: the boot-freeze log showed the periodic calendar sync failing twice with
 * `TypeError: fetch failed` / `read ECONNRESET`. One reset killed the whole pass,
 * and the next timer tick simply retried everything from scratch.
 */
describe('syncCalendar — transient fetch retry (F15)', () => {
  let syncCalendar: typeof import('../calendar-sync').syncCalendar
  const now = { waitForBootMs: 0, fetchBaseDelayMs: 1 } as const

  beforeEach(async () => {
    emitDomainEvent.mockClear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    syncCalendar = (await import('../calendar-sync')).syncCalendar
  })

  afterEach(() => vi.restoreAllMocks())

  it('retries an ECONNRESET and succeeds on a later attempt', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(econnreset())
      .mockRejectedValueOnce(econnreset())
      .mockResolvedValue(okResponse())
    global.fetch = fetchMock as never

    const result = await syncCalendar('https://calendar.example.com/retry.ics', now)

    expect(result.success).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('backs off between attempts instead of hammering the feed', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(econnreset()).mockResolvedValue(okResponse())
    global.fetch = fetchMock as never

    const t0 = Date.now()
    // 40ms base => the single retry waits 20-60ms (0.5x-1.5x jitter).
    await syncCalendar('https://calendar.example.com/backoff.ics', {
      waitForBootMs: 0,
      fetchBaseDelayMs: 40
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(15)
  })

  it('gives up after the attempt budget and reports a network error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(econnreset())
    global.fetch = fetchMock as never

    const result = await syncCalendar('https://calendar.example.com/down.ics', {
      ...now,
      fetchAttempts: 3
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.success).toBe(false)
    expect(result.errorCategory).toBe('network')
  })

  it('does NOT retry a permanent failure — a 404 must not burn the boot window', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' })
    global.fetch = fetchMock as never

    const result = await syncCalendar('https://calendar.example.com/missing.ics', now)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.success).toBe(false)
  })

  it('retries a 503 (server-side blip) but not a 401 (bad credentials)', async () => {
    const serverError = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable' })
      .mockResolvedValue(okResponse())
    global.fetch = serverError as never
    await syncCalendar('https://calendar.example.com/503.ics', now)
    expect(serverError).toHaveBeenCalledTimes(2)

    const authError = vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: 'Unauthorized' })
    global.fetch = authError as never
    const result = await syncCalendar('https://calendar.example.com/401.ics', now)
    expect(authError).toHaveBeenCalledTimes(1)
    expect(result.errorCategory).toBe('auth')
  })

  it('categorizes a reset hidden behind TypeError.cause as network, not unknown', async () => {
    const { categorizeCalendarError } = await import('../calendar-sync')
    expect(categorizeCalendarError(econnreset()).category).toBe('network')
    expect(categorizeCalendarError(new Error('read ECONNRESET')).category).toBe('network')
  })

  /**
   * Adversarial review #4: node wraps ECONNREFUSED and ENOTFOUND in exactly the
   * same `TypeError: fetch failed` as a reset, so falling back to the wrapper
   * message retried both — contradicting the documented exclusion and burning
   * the boot window on failures that cannot succeed.
   */
  it('does NOT retry a wrapped ECONNREFUSED — nothing is listening, retrying cannot help', async () => {
    const wrapped = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:443'), { code: 'ECONNREFUSED' })
    })
    const fetchMock = vi.fn().mockRejectedValue(wrapped)
    global.fetch = fetchMock as never

    const result = await syncCalendar('https://calendar.example.com/refused.ics', now)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.success).toBe(false)
  })

  it('does NOT retry a wrapped ENOTFOUND — the host does not resolve', async () => {
    const wrapped = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('getaddrinfo ENOTFOUND nope.example.com'), {
        code: 'ENOTFOUND'
      })
    })
    const fetchMock = vi.fn().mockRejectedValue(wrapped)
    global.fetch = fetchMock as never

    const result = await syncCalendar('https://nope.example.com/f.ics', now)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.success).toBe(false)
  })

  it('classifies from the concrete code, not the generic wrapper message', async () => {
    const { isTransientNetworkError } = await import('../calendar-sync')
    const wrap = (code: string) =>
      Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error(`socket ${code}`), { code })
      })

    expect(isTransientNetworkError(wrap('ECONNRESET'))).toBe(true)
    expect(isTransientNetworkError(wrap('ETIMEDOUT'))).toBe(true)
    expect(isTransientNetworkError(wrap('ECONNREFUSED'))).toBe(false)
    expect(isTransientNetworkError(wrap('ENOTFOUND'))).toBe(false)
    expect(isTransientNetworkError(wrap('CERT_HAS_EXPIRED'))).toBe(false)
    // A bare wrapper with no cause is not evidence of anything retryable.
    expect(isTransientNetworkError(new TypeError('fetch failed'))).toBe(false)
  })
})

/**
 * F15: the app fired TWO startup syncs (main's initializeCalendarAutoSync plus
 * the renderer's Layout mount effect), and the periodic timer could stack a third
 * on a slow pass — each one a full fetch/parse/expand/DB/reconcile pass on the
 * single main-process event loop, competing with the boot tasks.
 */
describe('syncCalendar — serialization (F15)', () => {
  let calendarSync: typeof import('../calendar-sync')

  /** A sync slow enough that a second caller definitely arrives mid-pass. */
  const slowFetch = () =>
    vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20))
      return okResponse()
    })

  beforeEach(async () => {
    emitDomainEvent.mockClear()
    calendarSync = await import('../calendar-sync')
  })

  it('concurrent callers join ONE pass instead of each running their own', async () => {
    const fetchMock = slowFetch()
    global.fetch = fetchMock as never

    const [a, b, c] = await Promise.all([
      calendarSync.syncCalendar('https://calendar.example.com/s.ics', { waitForBootMs: 0 }),
      calendarSync.syncCalendar('https://calendar.example.com/s.ics', { waitForBootMs: 0 }),
      calendarSync.syncCalendar('https://calendar.example.com/s.ics', { waitForBootMs: 0 })
    ])

    // One fetch, one parse, one DB pass — all three callers got the same result.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(a.success).toBe(true)
    expect(b).toBe(a)
    expect(c).toBe(a)
  })

  it('reports an active sync so a periodic tick can skip instead of stacking', async () => {
    global.fetch = slowFetch() as never

    expect(calendarSync.isCalendarSyncActive()).toBe(false)
    const pending = calendarSync.syncCalendar('https://calendar.example.com/a.ics', {
      waitForBootMs: 0
    })
    expect(calendarSync.isCalendarSyncActive()).toBe(true)
    await pending
    expect(calendarSync.isCalendarSyncActive()).toBe(false)
  })

  it('fresh:true runs its own pass (clear-and-sync must not get pre-clear data)', async () => {
    const fetchMock = slowFetch()
    global.fetch = fetchMock as never

    const first = calendarSync.syncCalendar('https://calendar.example.com/f.ics', {
      waitForBootMs: 0
    })
    const fresh = calendarSync.syncCalendar('https://calendar.example.com/f.ics', {
      waitForBootMs: 0,
      fresh: true
    })
    const [a, b] = await Promise.all([first, fresh])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(b).not.toBe(a)
  })

  /**
   * Adversarial review #3: the generation was only checked AFTER syncCalendar
   * returned — by which point the pass had already written the cache, upserted
   * meetings, reconciled and broadcast. Stopping auto-sync suppressed the log
   * line and nothing else.
   */
  it('a pass invalidated while parked on the boot gate performs NO side effects', async () => {
    const boot = await import('../boot-scheduler')
    const { upsertMeetingsBatch } = await import('../database')
    const { writeFile } = await import('fs/promises')
    boot._resetBootSchedulerForTests()
    emitDomainEvent.mockClear()
    vi.mocked(upsertMeetingsBatch).mockClear()
    vi.mocked(writeFile).mockClear()

    const fetchMock = vi.fn().mockResolvedValue(okResponse())
    global.fetch = fetchMock as never

    // The pass is abandoned the moment this flips.
    let wanted = true
    boot.registerBootTask({
      name: 'slow-boot',
      run: async () => {
        await new Promise((r) => setTimeout(r, 40))
        wanted = false // e.g. stopAutoSync() ran while the sync waited
      }
    })

    const sync = calendarSync.syncCalendar('https://calendar.example.com/cancel.ics', {
      waitForBootMs: 5000,
      isStillWanted: () => wanted
    })
    const drain = boot.startBootScheduler({ startDelayMs: 0, gapMs: 0, log: () => {} })
    const [result] = await Promise.all([sync, drain])
    boot._resetBootSchedulerForTests()

    expect(result.success).toBe(false)
    expect(result.errorCategory).toBe('cancelled')
    // Nothing was fetched, cached, written or broadcast.
    expect(fetchMock).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
    expect(upsertMeetingsBatch).not.toHaveBeenCalled()
    expect(emitDomainEvent).not.toHaveBeenCalled()
  })

  it('a joined caller keeps the pass alive when the scheduled sync that started it is cancelled', async () => {
    const { upsertMeetingsBatch } = await import('../database')
    vi.mocked(upsertMeetingsBatch).mockClear()
    global.fetch = slowFetch() as never

    // Scheduled sync starts, then its schedule is torn down...
    let scheduleWanted = true
    const scheduled = calendarSync.syncCalendar('https://calendar.example.com/j.ics', {
      waitForBootMs: 0,
      isStillWanted: () => scheduleWanted
    })
    // ...but a user-initiated sync joined it and still wants the result.
    const joined = calendarSync.syncCalendar('https://calendar.example.com/j.ics', {
      waitForBootMs: 0
    })
    scheduleWanted = false

    const [a, b] = await Promise.all([scheduled, joined])

    expect(a.success).toBe(true)
    expect(b).toBe(a)
    expect(upsertMeetingsBatch).toHaveBeenCalled()
  })

  it('waits for the boot drain before touching the feed', async () => {
    const boot = await import('../boot-scheduler')
    boot._resetBootSchedulerForTests()

    let fetchedAt = 0
    global.fetch = vi.fn().mockImplementation(async () => {
      fetchedAt = Date.now()
      return okResponse()
    }) as never

    let bootFinishedAt = 0
    boot.registerBootTask({
      name: 'heavy',
      run: async () => {
        await new Promise((r) => setTimeout(r, 60))
        bootFinishedAt = Date.now()
      }
    })

    const sync = calendarSync.syncCalendar('https://calendar.example.com/boot.ics', {
      waitForBootMs: 5000
    })
    const drain = boot.startBootScheduler({ startDelayMs: 0, gapMs: 0, log: () => {} })

    await Promise.all([sync, drain])
    boot._resetBootSchedulerForTests()

    // The feed was not touched until the boot task had finished.
    expect(bootFinishedAt).toBeGreaterThan(0)
    expect(fetchedAt).toBeGreaterThanOrEqual(bootFinishedAt)
  })
})
