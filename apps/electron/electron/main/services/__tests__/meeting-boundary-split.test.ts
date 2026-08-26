// @vitest-environment node

import { describe, it, expect, vi } from 'vitest'

// recording-split imports database types, which reach for electron's app
// singleton at import time. These suggestion helpers are pure.
vi.mock('electron', () => ({ app: { getPath: () => 'test-path' } }))

import {
  suggestMeetingBoundarySplits,
  rankSplitSuggestions,
  type SplitMeetingWindow
} from '../recording-split'

// The live case: one capture ran from a Delivery Framework 1:1 straight into a
// candidate interview. The device cannot cut there — the mic never closed.
const START = '2026-08-18T17:25:05.000Z'
const DURATION = 4815 // 17:25:05 -> 18:45:20

const MEETINGS: SplitMeetingWindow[] = [
  { subject: 'Delivery Framework 1:1', startTime: '2026-08-18T17:00:00.000Z', endTime: '2026-08-18T17:45:00.000Z' },
  { subject: 'DFX5 Interview is scheduled', startTime: '2026-08-18T17:45:00.000Z', endTime: '2026-08-18T18:45:00.000Z' }
]

describe('suggestMeetingBoundarySplits', () => {
  it('proposes a cut where one meeting hands over to the next', () => {
    const out = suggestMeetingBoundarySplits(START, DURATION, MEETINGS, [])
    expect(out).toHaveLength(1)
    expect(out[0].reason).toBe('meeting-boundary')
    expect(out[0].timeSec).toBeCloseTo(1195, 0) // 17:45:00 is 1195s in
    expect(out[0].endingMeetingSubject).toBe('Delivery Framework 1:1')
    expect(out[0].startingMeetingSubject).toBe('DFX5 Interview is scheduled')
  })

  it('snaps onto nearby silence so the cut is not mid-word', () => {
    const silences = [{ startSec: 1200, endSec: 1209 }]
    const out = suggestMeetingBoundarySplits(START, DURATION, MEETINGS, silences)
    expect(out[0].reason).toBe('meeting-boundary-and-silence')
    expect(out[0].timeSec).toBeCloseTo(1204.5, 1)
    expect(out[0].confidence).toBeGreaterThan(0.9)
  })

  it('ignores silence too far from the boundary to be the handover', () => {
    const out = suggestMeetingBoundarySplits(START, DURATION, MEETINGS, [{ startSec: 400, endSec: 409 }])
    expect(out[0].reason).toBe('meeting-boundary')
  })

  it('ignores an all-day event', () => {
    const withAllDay: SplitMeetingWindow[] = [
      { subject: 'Vacaciones', startTime: '2026-08-18T00:00:00.000Z', endTime: '2026-08-19T00:00:00.000Z', isAllDay: true },
      MEETINGS[1]
    ]
    expect(suggestMeetingBoundarySplits(START, DURATION, withAllDay, [])).toEqual([])
  })

  it('ignores a long calendar gap — that is not a back-to-back transition', () => {
    const spread: SplitMeetingWindow[] = [
      MEETINGS[0],
      { subject: 'Much later', startTime: '2026-08-18T18:30:00.000Z', endTime: '2026-08-18T19:00:00.000Z' }
    ]
    expect(suggestMeetingBoundarySplits(START, DURATION, spread, [])).toEqual([])
  })

  it('ignores overlapping entries (double-booking, not a handover)', () => {
    const overlapping: SplitMeetingWindow[] = [
      { subject: 'A', startTime: '2026-08-18T17:30:00.000Z', endTime: '2026-08-18T18:15:00.000Z' },
      { subject: 'B', startTime: '2026-08-18T17:50:00.000Z', endTime: '2026-08-18T18:45:00.000Z' }
    ]
    expect(suggestMeetingBoundarySplits(START, DURATION, overlapping, [])).toEqual([])
  })

  it('never proposes a cut that would leave a sliver part', () => {
    const nearEnd: SplitMeetingWindow[] = [
      { subject: 'A', startTime: '2026-08-18T17:25:05.000Z', endTime: '2026-08-18T18:45:15.000Z' },
      { subject: 'B', startTime: '2026-08-18T18:45:16.000Z', endTime: '2026-08-18T19:30:00.000Z' }
    ]
    expect(suggestMeetingBoundarySplits(START, DURATION, nearEnd, [])).toEqual([])
  })

  it('returns nothing without a usable recording start', () => {
    expect(suggestMeetingBoundarySplits('not-a-date', DURATION, MEETINGS, [])).toEqual([])
    expect(suggestMeetingBoundarySplits(START, 0, MEETINGS, [])).toEqual([])
  })
})

describe('rankSplitSuggestions with a calendar boundary', () => {
  it('ranks the calendar boundary above every acoustic guess', () => {
    const boundaries = suggestMeetingBoundarySplits(START, DURATION, MEETINGS, [])
    const silences = [
      { startSec: 600, endSec: 615 },
      { startSec: 2000, endSec: 2020 }
    ]
    const ranked = rankSplitSuggestions(silences, DURATION, null, boundaries)
    expect(ranked[0].reason).toBe('meeting-boundary')
    expect(ranked.length).toBeGreaterThan(1)
  })

  it('does not list the same cut twice when silence coincides with the boundary', () => {
    const silences = [{ startSec: 1190, endSec: 1200 }]
    const boundaries = suggestMeetingBoundarySplits(START, DURATION, MEETINGS, silences)
    const ranked = rankSplitSuggestions(silences, DURATION, null, boundaries)
    expect(ranked).toHaveLength(1)
    expect(ranked[0].reason).toBe('meeting-boundary-and-silence')
  })

  it('still works with no calendar at all', () => {
    const ranked = rankSplitSuggestions([{ startSec: 600, endSec: 615 }], DURATION, null)
    expect(ranked).toHaveLength(1)
    expect(ranked[0].reason).toBe('silence')
  })
})
