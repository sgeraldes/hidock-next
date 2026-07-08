import { describe, it, expect } from 'vitest'
import {
  classifyMeetingTimings,
  isCancelledSubject,
  isAllDayMeeting,
  recordingOverlapsMeeting,
  formatMinutesUntil,
  formatMinutesLeft,
  formatMinutesSinceEnd,
  type TimeableMeeting
} from '../meeting-timing'

const now = new Date('2026-07-08T10:00:00Z')
const t = (iso: string) => new Date(iso).getTime()

function m(id: string, subject: string, startOffsetMin: number, durationMin: number): TimeableMeeting {
  const start = new Date(now.getTime() + startOffsetMin * 60000)
  const end = new Date(start.getTime() + durationMin * 60000)
  return { id, subject, start_time: start.toISOString(), end_time: end.toISOString() }
}

describe('isCancelledSubject', () => {
  it('detects Spanish and English cancellation prefixes, case-insensitively', () => {
    expect(isCancelledSubject('Cancelado: Weekly sync')).toBe(true)
    expect(isCancelledSubject('Canceled - Standup')).toBe(true)
    expect(isCancelledSubject('CANCELLED review')).toBe(true)
    expect(isCancelledSubject('Weekly sync')).toBe(false)
    expect(isCancelledSubject(null)).toBe(false)
    expect(isCancelledSubject(undefined)).toBe(false)
  })
})

describe('classifyMeetingTimings', () => {
  it('classifies past, in-progress and upcoming meetings', () => {
    const meetings = [
      m('past', 'Morning review', -120, 30), // ended 90 min ago
      m('current', 'Delivery Managers Weekly', -10, 30), // started 10 min ago, 20 left
      m('soon', 'Client call', 4, 30), // starts in 4 min
      m('later', 'Retro', 180, 60) // starts in 3 h
    ]
    const timings = classifyMeetingTimings(meetings, now)

    expect(timings.get('past')?.state).toBe('past')
    expect(timings.get('current')?.state).toBe('in_progress')
    expect(timings.get('current')?.minutes).toBe(20)
    expect(timings.get('soon')?.state).toBe('upcoming')
    expect(timings.get('soon')?.minutes).toBe(4)
    expect(timings.get('later')?.state).toBe('upcoming')
    expect(timings.get('later')?.minutes).toBe(180)
  })

  it('focuses the in-progress meeting finishing soonest', () => {
    const meetings = [
      m('running-long', 'All hands', -5, 120), // in progress, ends later
      m('running-short', 'Quick sync', -5, 15), // in progress, ends sooner
      m('next', 'Client call', 5, 30)
    ]
    const timings = classifyMeetingTimings(meetings, now)
    expect(timings.get('running-short')?.isFocus).toBe(true)
    expect(timings.get('running-long')?.isFocus).toBe(false)
    expect(timings.get('next')?.isFocus).toBe(false)
  })

  it('focuses the next upcoming meeting when nothing is in progress', () => {
    const meetings = [
      m('past', 'Morning review', -120, 30),
      m('next', 'Delivery Managers Weekly', 4, 30),
      m('later', 'Retro', 180, 60)
    ]
    const timings = classifyMeetingTimings(meetings, now)
    expect(timings.get('next')?.isFocus).toBe(true)
    expect(timings.get('later')?.isFocus).toBe(false)
    expect(timings.get('past')?.isFocus).toBe(false)
  })

  it('flags the next-up meeting separately from focus while one is in progress', () => {
    const meetings = [
      m('running', 'All hands', -5, 60), // in progress → focus
      m('next', 'Client call', 10, 30), // soonest upcoming → next-up but not focus
      m('later', 'Retro', 180, 60)
    ]
    const timings = classifyMeetingTimings(meetings, now)
    expect(timings.get('running')?.isFocus).toBe(true)
    expect(timings.get('running')?.isNextUp).toBe(false)
    expect(timings.get('next')?.isFocus).toBe(false)
    expect(timings.get('next')?.isNextUp).toBe(true)
    expect(timings.get('later')?.isNextUp).toBe(false)
  })

  it('makes the next-up meeting the focus when nothing is in progress', () => {
    const meetings = [m('past', 'Morning review', -120, 30), m('next', 'Client call', 4, 30)]
    const timings = classifyMeetingTimings(meetings, now)
    expect(timings.get('next')?.isFocus).toBe(true)
    expect(timings.get('next')?.isNextUp).toBe(true)
  })

  it('marks cancelled meetings and never focuses them', () => {
    const meetings = [
      { ...m('cancelled', 'Cancelado: Standup', 4, 30) },
      m('next', 'Client call', 10, 30)
    ]
    const timings = classifyMeetingTimings(meetings, now)
    expect(timings.get('cancelled')?.state).toBe('cancelled')
    expect(timings.get('cancelled')?.isFocus).toBe(false)
    // Focus falls through to the next real upcoming meeting.
    expect(timings.get('next')?.isFocus).toBe(true)
  })

  it('marks a recently-ended meeting as ran_over with minutes since end', () => {
    const meetings = [
      m('ranover', 'Retro Belcorp', -66, 60), // ended 6 min ago
      m('longpast', 'Morning review', -120, 30) // ended 90 min ago
    ]
    const timings = classifyMeetingTimings(meetings, now)
    expect(timings.get('ranover')?.state).toBe('ran_over')
    expect(timings.get('ranover')?.minutes).toBe(6)
    expect(timings.get('longpast')?.state).toBe('past')
  })

  it('keeps a ran_over meeting subtle (does not steal focus from the next upcoming)', () => {
    const meetings = [
      m('ranover', 'Retro Belcorp', -66, 60), // ended 6 min ago
      m('next', 'Client call', 10, 30)
    ]
    const timings = classifyMeetingTimings(meetings, now)
    expect(timings.get('ranover')?.isFocus).toBe(false)
    expect(timings.get('next')?.isFocus).toBe(true)
  })

  it('treats a meeting exactly at the ran_over boundary as ran_over, and beyond it as past', () => {
    const meetings = [
      m('edge', 'Edge', -80, 60), // ended exactly 20 min ago → ran_over
      m('beyond', 'Beyond', -81, 60) // ended 21 min ago → past
    ]
    const timings = classifyMeetingTimings(meetings, now)
    expect(timings.get('edge')?.state).toBe('ran_over')
    expect(timings.get('beyond')?.state).toBe('past')
  })

  it('does not crash on unparseable timestamps', () => {
    const meetings: TimeableMeeting[] = [{ id: 'bad', subject: 'Mystery', start_time: 'nope', end_time: 'nope' }]
    const timings = classifyMeetingTimings(meetings, now)
    expect(timings.get('bad')?.state).toBe('upcoming')
    expect(timings.get('bad')?.minutes).toBe(0)
  })

  it('classifies all-day events and never focuses or flags them as next-up', () => {
    const meetings: TimeableMeeting[] = [
      // 24h span (single all-day event, e.g. "Feriado")
      { id: 'holiday', subject: 'Feriado', start_time: '2026-07-08T00:00:00Z', end_time: '2026-07-09T00:00:00Z' },
      // zero-duration marker (feed stores DTSTART == DTEND)
      { id: 'marker', subject: 'Payday', start_time: '2026-07-08T21:00:00Z', end_time: '2026-07-08T21:00:00Z' },
      m('next', 'Client call', 4, 30) // real upcoming meeting
    ]
    const timings = classifyMeetingTimings(meetings, now)

    expect(timings.get('holiday')?.state).toBe('all_day')
    expect(timings.get('holiday')?.isFocus).toBe(false)
    expect(timings.get('holiday')?.isNextUp).toBe(false)
    expect(timings.get('marker')?.state).toBe('all_day')
    expect(timings.get('marker')?.isFocus).toBe(false)
    expect(timings.get('marker')?.isNextUp).toBe(false)

    // Focus/next-up fall through to the real timed meeting, unaffected by all-day events.
    expect(timings.get('next')?.state).toBe('upcoming')
    expect(timings.get('next')?.isFocus).toBe(true)
    expect(timings.get('next')?.isNextUp).toBe(true)
  })
})

describe('isAllDayMeeting', () => {
  it('detects a full-day (24h) span', () => {
    expect(isAllDayMeeting('2026-07-08T00:00:00Z', '2026-07-09T00:00:00Z')).toBe(true)
  })

  it('detects a zero-duration (start == end) marker', () => {
    expect(isAllDayMeeting('2026-07-08T21:00:00Z', '2026-07-08T21:00:00Z')).toBe(true)
  })

  it('detects a multi-day span', () => {
    expect(isAllDayMeeting('2026-07-08T00:00:00Z', '2026-07-11T00:00:00Z')).toBe(true)
  })

  it('does not treat a normal timed meeting as all-day', () => {
    expect(isAllDayMeeting('2026-07-08T10:00:00Z', '2026-07-08T11:00:00Z')).toBe(false)
    expect(isAllDayMeeting('2026-07-08T09:00:00Z', '2026-07-08T17:00:00Z')).toBe(false) // long 8h workshop
  })

  it('returns false for unparseable timestamps', () => {
    expect(isAllDayMeeting('nope', 'nope')).toBe(false)
  })
})

describe('recordingOverlapsMeeting', () => {
  const meeting: TimeableMeeting = {
    id: 'm',
    subject: 'Weekly',
    start_time: '2026-07-08T10:00:00Z',
    end_time: '2026-07-08T11:00:00Z'
  }

  it('matches when the recording started inside the meeting window', () => {
    const rec = { startMs: t('2026-07-08T10:05:00Z'), endMs: t('2026-07-08T10:07:00Z') }
    expect(recordingOverlapsMeeting(rec, meeting)).toBe(true)
  })

  it('matches when the span overlaps at least 25% though it started before the meeting', () => {
    // 09:00–10:20 → 20 min of overlap out of 60 (33%), start not inside window.
    const rec = { startMs: t('2026-07-08T09:00:00Z'), endMs: t('2026-07-08T10:20:00Z') }
    expect(recordingOverlapsMeeting(rec, meeting)).toBe(true)
  })

  it('does not match when overlap is below the 25% threshold', () => {
    // 09:00–10:10 → 10 min of overlap out of 60 (17%), start not inside window.
    const rec = { startMs: t('2026-07-08T09:00:00Z'), endMs: t('2026-07-08T10:10:00Z') }
    expect(recordingOverlapsMeeting(rec, meeting)).toBe(false)
  })

  it('does not match a recording entirely outside the meeting', () => {
    const rec = { startMs: t('2026-07-08T12:00:00Z'), endMs: t('2026-07-08T12:30:00Z') }
    expect(recordingOverlapsMeeting(rec, meeting)).toBe(false)
  })

  it('handles a zero-duration recording via the start-within rule', () => {
    const inside = { startMs: t('2026-07-08T10:30:00Z'), endMs: t('2026-07-08T10:30:00Z') }
    const outside = { startMs: t('2026-07-08T09:30:00Z'), endMs: t('2026-07-08T09:30:00Z') }
    expect(recordingOverlapsMeeting(inside, meeting)).toBe(true)
    expect(recordingOverlapsMeeting(outside, meeting)).toBe(false)
  })
})

describe('relative time formatting', () => {
  it('formats minutes-until', () => {
    expect(formatMinutesUntil(4)).toBe('in 4 min')
    expect(formatMinutesUntil(59)).toBe('in 59 min')
    expect(formatMinutesUntil(60)).toBe('in 1 h')
    expect(formatMinutesUntil(85)).toBe('in 1 h 25 min')
    expect(formatMinutesUntil(0)).toBe('starting now')
  })

  it('formats minutes-left for in-progress meetings', () => {
    expect(formatMinutesLeft(12)).toBe('Now · 12 min left')
    expect(formatMinutesLeft(60)).toBe('Now · 1 h left')
    expect(formatMinutesLeft(0)).toBe('Now · wrapping up')
  })

  it('formats minutes-since-end for ran-over meetings', () => {
    expect(formatMinutesSinceEnd(6)).toBe('ended 6 min ago')
    expect(formatMinutesSinceEnd(60)).toBe('ended 1 h ago')
    expect(formatMinutesSinceEnd(75)).toBe('ended 1 h 15 min ago')
    expect(formatMinutesSinceEnd(0)).toBe('just ended')
  })
})
