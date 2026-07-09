/**
 * Time-ribbon zone/grouping/category helpers — pure, deterministic.
 *
 * These drive Today's compression: how far a meeting sits from NOW decides
 * whether it collapses into a capsule, fades into a slim row, blooms into a full
 * card, or waits as a compact line. Boundaries are contractual, so they're
 * pinned here.
 */

import { describe, it, expect } from 'vitest'
import {
  meetingZone,
  groupEarlierMeetings,
  dayPartLabel,
  categorizeMeeting,
  RECENT_WINDOW_MS,
  FOCUS_AHEAD_MS,
  GROUP_GAP_MS
} from '../meeting-timing'

const NOW = new Date('2026-07-08T15:00:00.000Z')
const nowMs = NOW.getTime()

/** Build a meeting spanning [startOffsetMin, endOffsetMin] minutes from NOW. */
function m(startOffsetMin: number, endOffsetMin: number) {
  return {
    start_time: new Date(nowMs + startOffsetMin * 60000).toISOString(),
    end_time: new Date(nowMs + endOffsetMin * 60000).toISOString()
  }
}

describe('meetingZone', () => {
  it('classifies an in-progress meeting as focus', () => {
    expect(meetingZone(m(-10, 20), NOW)).toBe('focus')
  })

  it('classifies upcoming within the focus window as focus, beyond it as later', () => {
    expect(meetingZone(m(30, 60), NOW)).toBe('focus')
    // Exactly at the boundary (2h ahead) is still focus…
    expect(meetingZone(m(FOCUS_AHEAD_MS / 60000, FOCUS_AHEAD_MS / 60000 + 30), NOW)).toBe('focus')
    // …one minute past it drops to later.
    expect(meetingZone(m(FOCUS_AHEAD_MS / 60000 + 1, FOCUS_AHEAD_MS / 60000 + 31), NOW)).toBe('later')
  })

  it('classifies recently-ended within the recent window as recent, older as earlier', () => {
    expect(meetingZone(m(-40, -20), NOW)).toBe('recent')
    // Exactly one hour since end is still recent…
    expect(meetingZone(m(-90, -RECENT_WINDOW_MS / 60000), NOW)).toBe('recent')
    // …a minute older collapses into earlier.
    expect(meetingZone(m(-120, -RECENT_WINDOW_MS / 60000 - 1), NOW)).toBe('earlier')
  })

  it('keeps unparseable meetings visible in the focus band', () => {
    expect(meetingZone({ start_time: 'nope', end_time: 'nope' }, NOW)).toBe('focus')
  })
})

describe('groupEarlierMeetings', () => {
  it('collapses contiguous meetings into one block and splits on a large gap', () => {
    // Two back-to-back in the morning, then a lone meeting after a >90-min gap.
    const morning1 = m(-300, -270)
    const morning2 = m(-265, -240) // 5-min gap → same block
    const gapMin = GROUP_GAP_MS / 60000 + 30
    const afternoon = m(-240 + gapMin, -240 + gapMin + 20) // beyond the gap → new block

    const groups = groupEarlierMeetings([afternoon, morning1, morning2]) // unsorted input
    expect(groups).toHaveLength(2)
    expect(groups[0].meetings.map((x) => x.start_time)).toEqual([morning1.start_time, morning2.start_time])
    expect(groups[1].meetings).toHaveLength(1)
    // Labels come from each block's first meeting's local time-of-day.
    expect(groups[0].label).toBe(dayPartLabel(new Date(morning1.start_time)))
  })

  it('returns an empty array for no earlier meetings', () => {
    expect(groupEarlierMeetings([])).toEqual([])
  })
})

describe('dayPartLabel', () => {
  it('labels by local hour', () => {
    expect(dayPartLabel(new Date(2026, 6, 8, 9, 0))).toBe('Morning')
    expect(dayPartLabel(new Date(2026, 6, 8, 14, 0))).toBe('Afternoon')
    expect(dayPartLabel(new Date(2026, 6, 8, 20, 0))).toBe('Evening')
  })
})

describe('categorizeMeeting', () => {
  it('detects personal blocks first', () => {
    expect(categorizeMeeting({ subject: 'Almuerzo con Ana', attendeeCount: 2 })).toBe('personal')
    expect(categorizeMeeting({ subject: 'Lunch break' })).toBe('personal')
  })

  it('detects 1:1s by subject or two attendees', () => {
    expect(categorizeMeeting({ subject: '1:1 Sebastián / María' })).toBe('one_on_one')
    expect(categorizeMeeting({ subject: 'Sync with Diego' })).toBe('one_on_one')
    expect(categorizeMeeting({ subject: 'Chat', attendeeCount: 2 })).toBe('one_on_one')
  })

  it('detects client/external work by name or large groups', () => {
    expect(categorizeMeeting({ subject: 'Belcorp kickoff' })).toBe('external')
    expect(categorizeMeeting({ subject: 'All hands', attendeeCount: 9 })).toBe('external')
  })

  it('detects recurring team ceremonies', () => {
    expect(categorizeMeeting({ subject: 'Daily standup' })).toBe('recurring')
    expect(categorizeMeeting({ subject: 'Sprint retro' })).toBe('recurring')
  })

  it('falls back to general', () => {
    expect(categorizeMeeting({ subject: 'Some random topic' })).toBe('general')
    expect(categorizeMeeting({ subject: '' })).toBe('general')
  })
})
