import { describe, it, expect } from 'vitest'
import {
  toDateInputValue,
  toTimeInputValue,
  combineDateTimeToISO,
  diffMeetingTimes
} from '../meeting-edit'

describe('date/time input conversion', () => {
  it('round-trips a local date and time through ISO', () => {
    const iso = combineDateTimeToISO('2026-07-08', '14:30')
    expect(iso).not.toBeNull()
    // Reading the parts back yields the same local values regardless of timezone.
    expect(toDateInputValue(iso!)).toBe('2026-07-08')
    expect(toTimeInputValue(iso!)).toBe('14:30')
  })

  it('returns empty strings for unparseable ISO', () => {
    expect(toDateInputValue('nonsense')).toBe('')
    expect(toTimeInputValue('nonsense')).toBe('')
  })

  it('returns null for malformed date/time parts', () => {
    expect(combineDateTimeToISO('2026-7-8', '14:30')).toBeNull()
    expect(combineDateTimeToISO('2026-07-08', '2pm')).toBeNull()
    expect(combineDateTimeToISO('', '')).toBeNull()
  })
})

describe('diffMeetingTimes', () => {
  const original = { start_time: '2026-07-08T10:00:00Z', end_time: '2026-07-08T11:00:00Z' }

  it('returns no updates when nothing changed', () => {
    const result = diffMeetingTimes(original, { ...original })
    expect(result).toEqual({ ok: true, updates: {} })
  })

  it('treats an ISO round-trip as unchanged (compares by instant)', () => {
    const result = diffMeetingTimes(original, {
      start_time: '2026-07-08T10:00:00.000Z',
      end_time: '2026-07-08T11:00:00.000Z'
    })
    expect(result).toEqual({ ok: true, updates: {} })
  })

  it('reports only the changed field', () => {
    const result = diffMeetingTimes(original, {
      start_time: '2026-07-08T10:00:00Z',
      end_time: '2026-07-08T11:30:00Z'
    })
    expect(result).toEqual({ ok: true, updates: { end_time: '2026-07-08T11:30:00Z' } })
  })

  it('reports both fields when the whole slot moves', () => {
    const edited = { start_time: '2026-07-09T09:00:00Z', end_time: '2026-07-09T10:00:00Z' }
    const result = diffMeetingTimes(original, edited)
    expect(result).toEqual({ ok: true, updates: edited })
  })

  it('errors when the edited end is at or before the start', () => {
    const result = diffMeetingTimes(original, {
      start_time: '2026-07-08T12:00:00Z',
      end_time: '2026-07-08T11:00:00Z'
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/after/i)
  })
})
