import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseICS } from '@hidock/calendar-sync'

/**
 * Recurring-event expansion tests for calendar-sync.
 *
 * Covers the fix for pure-RRULE series that previously stored only the master
 * VEVENT: daily expansion across the sync window, EXDATE exclusion,
 * RECURRENCE-ID override replacement (no duplicate), stable per-occurrence ids,
 * window bounds, and the pathological-series occurrence cap.
 */

// calendar-sync's module-level imports pull in Electron-backed services; mock
// them so the module loads in a plain node test environment.
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp'),
    getName: vi.fn().mockReturnValue('test'),
  },
}))

vi.mock('../file-storage', () => ({
  getCachePath: vi.fn().mockReturnValue('/tmp/cache'),
}))

vi.mock('../config', () => ({
  getConfig: vi.fn().mockReturnValue({
    calendar: { icsUrl: '', syncEnabled: false, syncIntervalMinutes: 15, lastSyncAt: null },
  }),
  updateConfig: vi.fn(),
}))

vi.mock('../database', () => ({
  upsertMeetingsBatch: vi.fn(),
}))

const DAILY_UID = 'devops-daily@example.com'

function dailyIcs(extraLines: string[] = []): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    `UID:${DAILY_UID}`,
    'SUMMARY:DEVOPs | Daily',
    'DTSTART:20260701T220000Z',
    'DTEND:20260701T223000Z',
    'RRULE:FREQ=DAILY',
    ...extraLines,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
}

describe('expandMeetingOccurrences', () => {
  let expandMeetingOccurrences: typeof import('../calendar-sync').expandMeetingOccurrences
  // Fixed "sync time": window = [2026-05-09T12:00Z, 2026-10-06T12:00Z]
  const now = new Date('2026-07-08T12:00:00Z')

  beforeEach(async () => {
    const mod = await import('../calendar-sync')
    expandMeetingOccurrences = mod.expandMeetingOccurrences
  })

  it('expands a daily RRULE across the window (the DEVOPs Daily bug)', () => {
    const rows = expandMeetingOccurrences(parseICS(dailyIcs()), now)

    // The user is sitting in "today" (Jul 8) — that occurrence must exist.
    const jul8 = rows.find((r) => r.start_time === '2026-07-08T22:00:00.000Z')
    expect(jul8).toBeDefined()
    expect(jul8?.subject).toBe('DEVOPs | Daily')
    expect(jul8?.is_recurring).toBe(1)

    // And a spread of other days across the window is present.
    expect(rows.find((r) => r.start_time === '2026-07-02T22:00:00.000Z')).toBeDefined()
    // Last in-window occurrence is Oct 5 22:00 (Oct 6 22:00 is past the Oct 6 12:00 window end).
    expect(rows.find((r) => r.start_time === '2026-10-05T22:00:00.000Z')).toBeDefined()
    expect(rows.find((r) => r.start_time === '2026-10-06T22:00:00.000Z')).toBeUndefined()
    // Series starts Jul 1 → nothing before it, even though the window opens May 9.
    expect(rows.every((r) => r.start_time >= '2026-07-01T22:00:00.000Z')).toBe(true)
    // Jul 1 (master) .. Oct 5 inclusive = 97 daily occurrences.
    expect(rows).toHaveLength(97)
  })

  it('re-anchors an all-day (VALUE=DATE) event to LOCAL midnight and flags it', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:holiday@example.com',
      'SUMMARY:Feriado',
      'DTSTART;VALUE=DATE:20260709',
      'DTEND;VALUE=DATE:20260710',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const rows = expandMeetingOccurrences(parseICS(ics), now)
    expect(rows).toHaveLength(1)
    const row = rows[0]
    // Flag + timezone-independent named date.
    expect(row.is_all_day).toBe(1)
    expect(row.all_day_date).toBe('2026-07-09')
    // start_time is LOCAL midnight of Jul 9 (not UTC midnight, which would be
    // Jul 8 21:00 in a negative-offset zone and leak onto the wrong day).
    expect(row.start_time).toBe(new Date(2026, 6, 9).toISOString())
    expect(row.end_time).toBe(new Date(2026, 6, 10).toISOString())
  })

  it('keeps the master-DTSTART occurrence keyed on the bare uid (back-compat)', () => {
    const rows = expandMeetingOccurrences(parseICS(dailyIcs()), now)

    const bare = rows.filter((r) => r.id === DAILY_UID)
    expect(bare).toHaveLength(1)
    expect(bare[0].start_time).toBe('2026-07-01T22:00:00.000Z')

    // Every other occurrence is keyed `${uid}::${slotISO}`.
    const others = rows.filter((r) => r.id !== DAILY_UID)
    expect(others.length).toBeGreaterThan(0)
    expect(others.every((r) => r.id.startsWith(`${DAILY_UID}::`))).toBe(true)
    const jul8 = rows.find((r) => r.start_time === '2026-07-08T22:00:00.000Z')
    expect(jul8?.id).toBe(`${DAILY_UID}::2026-07-08T22:00:00.000Z`)
  })

  it('excludes EXDATE occurrences', () => {
    const rows = expandMeetingOccurrences(
      parseICS(dailyIcs(['EXDATE:20260703T220000Z'])),
      now
    )

    expect(rows.find((r) => r.start_time === '2026-07-03T22:00:00.000Z')).toBeUndefined()
    // One fewer than the un-excluded series (97 → 96).
    expect(rows).toHaveLength(96)
  })

  it('replaces an occurrence with its RECURRENCE-ID override without duplicating', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      `UID:${DAILY_UID}`,
      'SUMMARY:DEVOPs | Daily',
      'DTSTART:20260701T220000Z',
      'DTEND:20260701T223000Z',
      'RRULE:FREQ=DAILY',
      'END:VEVENT',
      'BEGIN:VEVENT',
      `UID:${DAILY_UID}`,
      'RECURRENCE-ID:20260704T220000Z',
      'DTSTART:20260704T230000Z',
      'DTEND:20260704T233000Z',
      'SUMMARY:DEVOPs | Daily (moved)',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const rows = expandMeetingOccurrences(parseICS(ics), now)

    // Original Jul-04 22:00 slot is gone; the moved 23:00 instance takes its place.
    expect(rows.find((r) => r.start_time === '2026-07-04T22:00:00.000Z')).toBeUndefined()
    const moved = rows.filter((r) => r.start_time === '2026-07-04T23:00:00.000Z')
    expect(moved).toHaveLength(1)
    expect(moved[0].subject).toBe('DEVOPs | Daily (moved)')
    // Keyed on the original slot so it's stable, not on the moved time.
    expect(moved[0].id).toBe(`${DAILY_UID}::2026-07-04T22:00:00.000Z`)
    // No net change in occurrence count — the override replaced, not added.
    expect(rows).toHaveLength(97)
  })

  it('produces identical ids across two parses (stable identity → UPSERT)', () => {
    const first = expandMeetingOccurrences(parseICS(dailyIcs()), now)
    const second = expandMeetingOccurrences(parseICS(dailyIcs()), now)
    expect(second.map((r) => r.id)).toEqual(first.map((r) => r.id))
  })

  it('respects window bounds for a series anchored before the window', () => {
    // Weekly from Jan 1; window opens 2026-05-09. Nothing before the window,
    // nothing after it, and the master (Jan 1) is out of window so no bare-uid row.
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:weekly@example.com',
      'DTSTART:20260101T150000Z',
      'DTEND:20260101T160000Z',
      'RRULE:FREQ=WEEKLY',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const rows = expandMeetingOccurrences(parseICS(ics), now)

    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.start_time >= '2026-05-09T12:00:00.000Z')).toBe(true)
    expect(rows.every((r) => r.start_time <= '2026-10-06T12:00:00.000Z')).toBe(true)
    // Master out of window → every row is slot-keyed, none bare.
    expect(rows.every((r) => r.id.startsWith('weekly@example.com::'))).toBe(true)
  })

  it('caps a pathological unbounded series at 400 occurrences', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:hourly@example.com',
      'DTSTART:20260701T000000Z',
      'DTEND:20260701T003000Z',
      'RRULE:FREQ=HOURLY',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const rows = expandMeetingOccurrences(parseICS(ics), now)
    expect(rows).toHaveLength(400)
  })

  it('leaves non-recurring events unchanged (id === uid)', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:one-off@example.com',
      'SUMMARY:One-off sync',
      'DTSTART:20260708T140000Z',
      'DTEND:20260708T150000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const rows = expandMeetingOccurrences(parseICS(ics), now)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('one-off@example.com')
    expect(rows[0].start_time).toBe('2026-07-08T14:00:00.000Z')
    expect(rows[0].is_recurring).toBe(0)
  })
})
