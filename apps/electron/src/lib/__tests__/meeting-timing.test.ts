import { describe, it, expect } from 'vitest'
import {
  classifyMeetingTimings,
  isCancelledSubject,
  formatMinutesUntil,
  formatMinutesLeft,
  type TimeableMeeting
} from '../meeting-timing'

const now = new Date('2026-07-08T10:00:00Z')

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

  it('does not crash on unparseable timestamps', () => {
    const meetings: TimeableMeeting[] = [{ id: 'bad', subject: 'Mystery', start_time: 'nope', end_time: 'nope' }]
    const timings = classifyMeetingTimings(meetings, now)
    expect(timings.get('bad')?.state).toBe('upcoming')
    expect(timings.get('bad')?.minutes).toBe(0)
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
})
