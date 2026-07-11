import { describe, it, expect } from 'vitest'
import {
  computeVisibleHourRange,
  matchRecordingsToMeetings,
  buildCalendarRecordings,
  createPlaceholderMeetings,
  getRecordingMeetingMatchScore,
  groupByDay,
  formatDurationStr,
  recordingCategory,
  formatUnmatchedRecordingMeta,
  recordingBlockTitle,
  sortMeetingsByProximity,
  type CalendarRecording,
  type CalendarMeetingOverlay,
} from '../calendar-utils'
import type { Meeting } from '@/types'
import type { UnifiedRecording } from '@/types/unified-recording'
import { UNKNOWN_DATE } from '@/lib/unknownDate'

/**
 * B-CAL-003: Unit tests for computeVisibleHourRange
 * Ensures the calendar timeline adjusts hour range to fit actual events.
 */

function makeRecording(
  startHour: number,
  startMin: number,
  endHour: number,
  endMin: number
): CalendarRecording {
  const startTime = new Date(2026, 2, 2, startHour, startMin, 0)
  const endTime = new Date(2026, 2, 2, endHour, endMin, 0)
  return {
    id: `rec-${startHour}-${startMin}`,
    filename: 'test.wav',
    startTime,
    endTime,
    durationSeconds: (endTime.getTime() - startTime.getTime()) / 1000,
    location: 'local-only',
    transcriptionStatus: 'none',
  }
}

function makeMeeting(
  startHour: number,
  startMin: number,
  endHour: number,
  endMin: number
): CalendarMeetingOverlay {
  const startTime = new Date(2026, 2, 2, startHour, startMin, 0)
  const endTime = new Date(2026, 2, 2, endHour, endMin, 0)
  return {
    id: `meet-${startHour}-${startMin}`,
    subject: 'Test Meeting',
    startTime,
    endTime,
    location: null,
    organizer: null,
    hasRecording: false,
  }
}

describe('computeVisibleHourRange', () => {
  it('should return default range when no recordings or meetings', () => {
    const result = computeVisibleHourRange([], [], 6, 23)

    expect(result.startHour).toBe(5) // 6 - 1 padding
    expect(result.endHour).toBe(24) // 23 + 1 padding
    expect(result.hours).toHaveLength(19) // 5 to 24
    expect(result.hours[0]).toBe(5)
    expect(result.hours[result.hours.length - 1]).toBe(23)
  })

  it('should expand range for early morning recording', () => {
    const recordings = [makeRecording(3, 30, 4, 30)]
    const result = computeVisibleHourRange(recordings, [], 6, 23)

    // Recording at 3:30 => minHour = 3, with -1 padding => startHour = 2
    expect(result.startHour).toBe(2)
    // End still at 23 + 1 = 24
    expect(result.endHour).toBe(24)
  })

  it('should expand range for late night meeting', () => {
    const meetings = [makeMeeting(22, 0, 23, 30)]
    const result = computeVisibleHourRange([], meetings, 6, 23)

    // Meeting ends at 23:30 => endH = 24 (23 + 1 for non-zero minutes)
    // Max(23, 24) = 24, + 1 padding = 25, clamped to 24
    expect(result.endHour).toBe(24)
    // Start still at default 6 - 1 = 5
    expect(result.startHour).toBe(5)
  })

  it('should not go below 0 for very early recordings', () => {
    const recordings = [makeRecording(0, 15, 1, 0)]
    const result = computeVisibleHourRange(recordings, [], 6, 23)

    // Recording at 0:15 => minHour = 0, -1 padding = -1, clamped to 0
    expect(result.startHour).toBe(0)
  })

  it('should not exceed 24 for late night events', () => {
    const recordings = [makeRecording(22, 0, 23, 59)]
    const result = computeVisibleHourRange(recordings, [], 6, 23)

    // endH = 24 (23 hours + 59 min > 0), max(23, 24) = 24, +1 = 25, clamped to 24
    expect(result.endHour).toBe(24)
  })

  it('should use default range when events are within defaults', () => {
    const recordings = [makeRecording(9, 0, 10, 0)]
    const meetings = [makeMeeting(14, 0, 15, 0)]
    const result = computeVisibleHourRange(recordings, meetings, 6, 23)

    // All events within 6-23, so range stays at default with padding
    expect(result.startHour).toBe(5) // 6 - 1
    expect(result.endHour).toBe(24) // 23 + 1
  })

  it('should handle recordings on exact hour boundaries', () => {
    const recordings = [makeRecording(5, 0, 6, 0)]
    const result = computeVisibleHourRange(recordings, [], 8, 18)

    // Recording at 5:00-6:00 => minHour = 5, endH = 6 (no extra since minutes are 0)
    // startHour = max(0, 5-1) = 4
    // maxHour stays at 18 (6 < 18), endHour = 18 + 1 = 19
    expect(result.startHour).toBe(4)
    expect(result.endHour).toBe(19)
  })

  it('should generate correct hours array', () => {
    const result = computeVisibleHourRange([], [], 9, 17)

    // default 9, 17 with padding: 8-18
    expect(result.startHour).toBe(8)
    expect(result.endHour).toBe(18)
    expect(result.hours).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17])
  })

  it('should expand for both early and late events simultaneously', () => {
    const recordings = [makeRecording(2, 0, 3, 0)]
    const meetings = [makeMeeting(22, 0, 23, 30)]
    const result = computeVisibleHourRange(recordings, meetings, 8, 18)

    // Early recording: startHour = max(0, 2-1) = 1
    // Late meeting: endH = 24, endHour = min(24, 24+1) = 24
    expect(result.startHour).toBe(1)
    expect(result.endHour).toBe(24)
  })

  it('should use custom default range', () => {
    const result = computeVisibleHourRange([], [], 9, 17)

    expect(result.startHour).toBe(8) // 9 - 1
    expect(result.endHour).toBe(18) // 17 + 1
  })
})

/**
 * C-CAL-005: Tests for meeting deduplication in matchRecordingsToMeetings
 */

function makeMeetingEntity(id: string, subject: string, startHour: number, endHour: number): Meeting {
  const start = new Date(2026, 2, 2, startHour, 0, 0)
  const end = new Date(2026, 2, 2, endHour, 0, 0)
  return {
    id,
    subject,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    location: null,
    organizer_name: null,
    organizer_email: null,
    attendees: null,
    description: null,
    is_recurring: 0,
    recurrence_rule: null,
    meeting_url: null,
    created_at: start.toISOString(),
    updated_at: start.toISOString(),
  }
}

function makeUnifiedRecording(
  id: string,
  startHour: number,
  durationMinutes: number,
  meetingId?: string
): UnifiedRecording {
  const dateRecorded = new Date(2026, 2, 2, startHour, 0, 0)
  return {
    id,
    filename: `recording-${id}.wav`,
    dateRecorded,
    duration: durationMinutes * 60,
    size: 1024,
    location: 'local-only' as const,
    localPath: `/recordings/${id}.wav`,
    transcriptionStatus: 'none' as const,
    meetingId: meetingId ?? null,
  } as UnifiedRecording
}

describe('matchRecordingsToMeetings', () => {
  it('should match a recording to its overlapping meeting', () => {
    const meetings = [makeMeetingEntity('m1', 'Team Standup', 9, 10)]
    const recordings = [makeUnifiedRecording('r1', 9, 60)]

    const { calendarMeetings, orphanRecordings } = matchRecordingsToMeetings(meetings, recordings)

    expect(calendarMeetings).toHaveLength(1)
    expect(calendarMeetings[0].hasRecording).toBe(true)
    expect(calendarMeetings[0].matchedRecordingId).toBe('r1')
    expect(orphanRecordings).toHaveLength(0)
  })

  it('should produce orphan recordings when no meeting matches', () => {
    const meetings = [makeMeetingEntity('m1', 'Team Standup', 9, 10)]
    const recordings = [makeUnifiedRecording('r1', 14, 30)] // 2PM, no overlap with 9AM meeting

    const { calendarMeetings, orphanRecordings } = matchRecordingsToMeetings(meetings, recordings)

    expect(calendarMeetings).toHaveLength(1)
    expect(calendarMeetings[0].hasRecording).toBe(false)
    expect(orphanRecordings).toHaveLength(1)
    expect(orphanRecordings[0].id).toBe('r1')
  })

  it('should handle meetings with no recordings', () => {
    const meetings = [
      makeMeetingEntity('m1', 'Standup', 9, 10),
      makeMeetingEntity('m2', 'Planning', 14, 15),
    ]

    const { calendarMeetings, orphanRecordings } = matchRecordingsToMeetings(meetings, [])

    expect(calendarMeetings).toHaveLength(2)
    expect(calendarMeetings.every(m => !m.hasRecording)).toBe(true)
    expect(orphanRecordings).toHaveLength(0)
  })

  it('should prefer manually linked recording over time-based match', () => {
    const meetings = [
      makeMeetingEntity('m1', 'Standup', 9, 10),
      makeMeetingEntity('m2', 'Planning', 9, 10), // same time
    ]
    // Recording manually linked to m2
    const recordings = [makeUnifiedRecording('r1', 9, 60, 'm2')]

    const { calendarMeetings } = matchRecordingsToMeetings(meetings, recordings)

    const m1 = calendarMeetings.find(m => m.id === 'm1')
    const m2 = calendarMeetings.find(m => m.id === 'm2')

    expect(m2?.hasRecording).toBe(true)
    expect(m2?.matchedRecordingId).toBe('r1')
    expect(m1?.hasRecording).toBe(false)
  })
})

describe('buildCalendarRecordings', () => {
  it('should build recording-centric data with linked meetings', () => {
    const meetings = [makeMeetingEntity('m1', 'Team Standup', 9, 10)]
    const recordings = [makeUnifiedRecording('r1', 9, 60)]

    const { calendarRecordings, meetingOverlays } = buildCalendarRecordings(recordings, meetings)

    expect(calendarRecordings).toHaveLength(1)
    expect(calendarRecordings[0].linkedMeeting).toBeDefined()
    expect(calendarRecordings[0].linkedMeeting?.subject).toBe('Team Standup')
    expect(meetingOverlays).toHaveLength(1)
    expect(meetingOverlays[0].hasRecording).toBe(true)
  })

  it('should mark meetings without recordings in overlays', () => {
    const meetings = [
      makeMeetingEntity('m1', 'Standup', 9, 10),
      makeMeetingEntity('m2', 'Planning', 14, 15),
    ]
    const recordings = [makeUnifiedRecording('r1', 9, 60)]

    const { meetingOverlays } = buildCalendarRecordings(recordings, meetings)

    const m1Overlay = meetingOverlays.find(m => m.id === 'm1')
    const m2Overlay = meetingOverlays.find(m => m.id === 'm2')

    expect(m1Overlay?.hasRecording).toBe(true)
    expect(m2Overlay?.hasRecording).toBe(false)
  })
})

describe('all-day / bridge over-attribution', () => {
  // A 9h all-day "War Room" event that a 20-min recording is fully contained in.
  const allDayBridge: Meeting = {
    ...makeMeetingEntity('warroom', 'War Room WTS', 10, 19),
    is_all_day: 1
  }
  const tightMeeting = makeMeetingEntity('apigw', 'API Gateway', 14, 15)

  it('does not pick an all-day bridge as a recording best match by containment alone', () => {
    const rec = makeUnifiedRecording('r1', 14, 20) // 2:00–2:20 PM, inside the 9h event
    const { calendarRecordings } = buildCalendarRecordings([rec], [allDayBridge])
    // No tight meeting exists → the recording is left UNLINKED, not attributed to the bridge.
    expect(calendarRecordings[0].linkedMeeting).toBeUndefined()
  })

  it('links a contained recording to the tightly-fitting meeting, not the all-day bridge', () => {
    const rec = makeUnifiedRecording('r1', 14, 20)
    const { calendarRecordings } = buildCalendarRecordings([rec], [allDayBridge, tightMeeting])
    expect(calendarRecordings[0].linkedMeeting?.id).toBe('apigw')
  })

  it('treats a plain ≥4h meeting as a bridge (no containment-only match)', () => {
    const longMeeting = makeMeetingEntity('offsite', 'Offsite', 9, 15) // 6h, no flag
    const rec = makeUnifiedRecording('r1', 13, 20)
    const { calendarRecordings } = buildCalendarRecordings([rec], [longMeeting])
    expect(calendarRecordings[0].linkedMeeting).toBeUndefined()
  })
})

describe('createPlaceholderMeetings', () => {
  it('should create placeholder meetings from orphan recordings', () => {
    const orphans = [makeUnifiedRecording('r1', 14, 30)]

    const placeholders = createPlaceholderMeetings(orphans)

    expect(placeholders).toHaveLength(1)
    expect(placeholders[0].id).toBe('placeholder_r1')
    expect(placeholders[0].isPlaceholder).toBe(true)
    expect(placeholders[0].hasRecording).toBe(true)
    expect(placeholders[0].matchedRecordingId).toBe('r1')
  })
})

describe('groupByDay', () => {
  it('should group items by their date key', () => {
    const items = [
      { name: 'a', date: new Date(2026, 2, 2, 9, 0) },
      { name: 'b', date: new Date(2026, 2, 2, 14, 0) },
      { name: 'c', date: new Date(2026, 2, 3, 10, 0) },
    ]
    const viewDates = [new Date(2026, 2, 2), new Date(2026, 2, 3)]

    const grouped = groupByDay(items, (i) => i.date, viewDates)

    const key1 = '2026-03-02'
    const key2 = '2026-03-03'
    expect(grouped[key1]).toHaveLength(2)
    expect(grouped[key2]).toHaveLength(1)
    expect(grouped[key1][0].name).toBe('a')
    expect(grouped[key2][0].name).toBe('c')
  })

  it('should return empty arrays for days with no items', () => {
    const viewDates = [new Date(2026, 2, 5)]
    const grouped = groupByDay([], (i: any) => i.date, viewDates)

    const key = '2026-03-05'
    expect(grouped[key]).toEqual([])
  })

  it('should ignore items not matching any view date', () => {
    const items = [
      { name: 'a', date: new Date(2026, 2, 10, 9, 0) }, // not in viewDates
    ]
    const viewDates = [new Date(2026, 2, 2)]
    const grouped = groupByDay(items, (i) => i.date, viewDates)

    const key = '2026-03-02'
    expect(grouped[key]).toEqual([])
  })
})

/**
 * C-CAL-008: Tests for formatDurationStr edge cases
 */
describe('formatDurationStr', () => {
  it('should format hours and minutes correctly', () => {
    expect(formatDurationStr(3600)).toBe('1h 0m')
    expect(formatDurationStr(5400)).toBe('1h 30m')
    expect(formatDurationStr(7200)).toBe('2h 0m')
  })

  it('should format minutes only correctly', () => {
    expect(formatDurationStr(60)).toBe('1m')
    expect(formatDurationStr(300)).toBe('5m')
    expect(formatDurationStr(2700)).toBe('45m')
  })

  it('should return "0m" for zero seconds', () => {
    expect(formatDurationStr(0)).toBe('0m')
  })

  it('should return "0m" for negative seconds', () => {
    expect(formatDurationStr(-100)).toBe('0m')
    expect(formatDurationStr(-3600)).toBe('0m')
  })

  it('should return "0m" for NaN', () => {
    expect(formatDurationStr(NaN)).toBe('0m')
  })

  it('should return "0m" for Infinity', () => {
    expect(formatDurationStr(Infinity)).toBe('0m')
    expect(formatDurationStr(-Infinity)).toBe('0m')
  })

  it('should handle fractional seconds', () => {
    expect(formatDurationStr(90)).toBe('2m') // 1.5 minutes rounds to 2
    expect(formatDurationStr(30)).toBe('1m') // 0.5 minutes rounds to 1
  })
})

/**
 * Calendar design language: a recording block's category is derived from its
 * linked meeting's subject, and an unmatched recording is labeled by a human
 * string (never the raw device filename).
 */
describe('recordingCategory', () => {
  const withMeeting = (subject: string): CalendarRecording => ({
    ...makeRecording(9, 0, 10, 0),
    linkedMeeting: {
      id: 'm1',
      subject,
      startTime: new Date(2026, 2, 2, 9, 0, 0),
      endTime: new Date(2026, 2, 2, 10, 0, 0),
      location: null,
      organizer: null,
    },
  })

  it('classifies a recurring meeting subject as recurring', () => {
    expect(recordingCategory(withMeeting('Daily WTS Standup'))).toBe('recurring')
  })

  it('classifies a 1:1 subject as one_on_one', () => {
    expect(recordingCategory(withMeeting('1:1 with Yaraví'))).toBe('one_on_one')
  })

  it('classifies a client subject as external', () => {
    expect(recordingCategory(withMeeting('Belcorp kickoff'))).toBe('external')
  })

  it('falls back to general for a recording with no linked meeting', () => {
    expect(recordingCategory(makeRecording(9, 0, 10, 0))).toBe('general')
  })
})

describe('recordingBlockTitle', () => {
  const linked = (subject: string): CalendarRecording => ({
    ...makeRecording(9, 0, 10, 0),
    linkedMeeting: {
      id: 'm1',
      subject,
      startTime: new Date(2026, 2, 2, 9, 0, 0),
      endTime: new Date(2026, 2, 2, 10, 0, 0),
      location: null,
      organizer: null,
    },
  })

  it('shows the meeting subject when linked', () => {
    expect(recordingBlockTitle(linked('Weekly sync'))).toBe('Weekly sync')
  })

  it('shows the transcript-derived title for an unlinked recording (never the filename)', () => {
    const rec: CalendarRecording = {
      ...makeRecording(14, 7, 14, 19),
      filename: '2026Jul08-140719-Rec46.hda',
      title: 'Cierre de Proyecto y Acciones de Retrospectiva',
    }
    expect(recordingBlockTitle(rec)).toBe('Cierre de Proyecto y Acciones de Retrospectiva')
    expect(recordingBlockTitle(rec)).not.toContain('.hda')
  })

  it('falls back to "Recording · <time>" (not the filename) when untitled', () => {
    const rec: CalendarRecording = {
      ...makeRecording(14, 7, 14, 19),
      filename: '2026Jul08-140719-Rec46.hda',
    }
    const label = recordingBlockTitle(rec)
    expect(label).toMatch(/^Recording · \d{1,2}:\d{2}/)
    expect(label).not.toContain('.hda')
  })
})

describe('formatUnmatchedRecordingMeta', () => {
  it('formats duration + start time (no filename)', () => {
    const rec: CalendarRecording = {
      ...makeRecording(14, 7, 14, 19),
      filename: '2026Jul08-140719-Rec46.hda',
    }
    const meta = formatUnmatchedRecordingMeta(rec)
    expect(meta).toContain('12m')
    expect(meta).toMatch(/\d{1,2}:\d{2}/) // e.g. "2:07 PM"
    expect(meta).not.toContain('.hda')
  })
})

describe('sortMeetingsByProximity', () => {
  it('orders candidate meetings by closeness to the recording time', () => {
    const ref = '2026-03-02T14:00:00.000Z'
    const meetings = [
      { id: 'far', start_time: '2026-03-02T09:00:00.000Z' },
      { id: 'near', start_time: '2026-03-02T13:45:00.000Z' },
      { id: 'mid', start_time: '2026-03-02T16:00:00.000Z' },
    ]
    expect(sortMeetingsByProximity(meetings, ref).map((m) => m.id)).toEqual(['near', 'mid', 'far'])
  })

  it('does not mutate the input array', () => {
    const meetings = [
      { id: 'a', start_time: '2026-03-02T16:00:00.000Z' },
      { id: 'b', start_time: '2026-03-02T13:45:00.000Z' },
    ]
    const copy = [...meetings]
    sortMeetingsByProximity(meetings, '2026-03-02T14:00:00.000Z')
    expect(meetings).toEqual(copy)
  })
})

/**
 * #58 — the UNKNOWN_DATE (Unix-epoch) sentinel must NEVER leak into the Calendar
 * as a real 1970 date. Undated recordings (unparseable filename + no device/db
 * date) carry `dateRecorded = UNKNOWN_DATE`; they stay fully visible in the
 * Library as "Unknown date" but are simply not PLACED on the Calendar: not
 * matched to a meeting, not turned into a 1970 placeholder meeting, not built into
 * a recording block, and not bucketed into any day. Dated recordings are
 * unaffected.
 */
describe('#58 UNKNOWN_DATE sentinel does not leak into the Calendar', () => {
  // An undated recording: a normal recording stamped with the epoch sentinel
  // instead of a real capture time (unparseable filename + no device/db date).
  // Optionally carries an explicit manual link (meetingId): that link is
  // AUTHORITATIVE and keeps the recording on the Calendar at the linked meeting's
  // time; without it the recording is simply not placed.
  const makeUndatedRecording = (id: string, meetingId?: string): UnifiedRecording => ({
    ...makeUnifiedRecording(id, 9, 20, meetingId),
    filename: `undated-${id}.hda`,
    dateRecorded: UNKNOWN_DATE,
  })

  // Serialize anything the Calendar produces and assert no 1970/1969 date leaked.
  const hasEpochDate = (value: unknown): boolean => {
    const s = JSON.stringify(value)
    return /1970|1969|Dec 31, 1969|Jan 1, 1970/.test(s)
  }

  it('getRecordingMeetingMatchScore returns 0 for an undated recording (matches nothing)', () => {
    // A meeting positioned at the epoch would "overlap" a raw epoch recStart — the
    // guard must short-circuit before any such arithmetic.
    const epochMeeting: Meeting = {
      ...makeMeetingEntity('m-epoch', 'Epoch trap', 0, 1),
      start_time: new Date(0).toISOString(),
      end_time: new Date(60 * 60 * 1000).toISOString(),
    }
    expect(getRecordingMeetingMatchScore(makeUndatedRecording('u1'), epochMeeting)).toBe(0)
  })

  it('does not match an undated recording to a meeting and does not orphan it (no placeholder source)', () => {
    const meetings = [makeMeetingEntity('m1', 'Team Standup', 9, 10)]
    const recordings = [makeUndatedRecording('u1')]

    const { calendarMeetings, orphanRecordings } = matchRecordingsToMeetings(meetings, recordings)

    // The real meeting shows as "no recording"; the undated recording is neither
    // matched nor orphaned (so it can never become a 1970 placeholder).
    expect(calendarMeetings).toHaveLength(1)
    expect(calendarMeetings[0].hasRecording).toBe(false)
    expect(orphanRecordings).toHaveLength(0)
    expect(hasEpochDate(calendarMeetings)).toBe(false)
  })

  it('creates no 1970 placeholder meeting from an undated recording', () => {
    // Direct call (defense-in-depth): even if handed an undated recording, no
    // placeholder is synthesized and no epoch ISO appears.
    const placeholders = createPlaceholderMeetings([
      makeUndatedRecording('u1'),
      makeUnifiedRecording('r1', 14, 30),
    ])
    expect(placeholders).toHaveLength(1)
    expect(placeholders[0].matchedRecordingId).toBe('r1')
    expect(hasEpochDate(placeholders)).toBe(false)
  })

  it('does not build a recording block for an undated recording', () => {
    const meetings = [makeMeetingEntity('m1', 'Team Standup', 9, 10)]
    const { calendarRecordings } = buildCalendarRecordings(
      [makeUndatedRecording('u1'), makeUnifiedRecording('r1', 9, 60)],
      meetings
    )
    // Only the dated recording produces a block; no 1970 timestamp anywhere.
    expect(calendarRecordings.map((r) => r.id)).toEqual(['r1'])
    expect(hasEpochDate(calendarRecordings)).toBe(false)
  })

  it('does not bucket an undated recording into any calendar day', () => {
    const { calendarRecordings } = buildCalendarRecordings(
      [makeUndatedRecording('u1'), makeUnifiedRecording('r1', 9, 60)],
      []
    )
    const viewDates = [new Date(2026, 2, 2), new Date(2026, 2, 3)]
    const grouped = groupByDay(calendarRecordings, (r) => r.startTime, viewDates)

    // The dated recording lands in its day; nothing lands in a 1970 bucket, and no
    // "1970-01-01" key exists.
    expect(grouped['2026-03-02']).toHaveLength(1)
    expect(grouped['1970-01-01']).toBeUndefined()
    const totalBucketed = Object.values(grouped).reduce((n, arr) => n + arr.length, 0)
    expect(totalBucketed).toBe(1)
  })

  it('leaves dated recordings fully placed and matched (control)', () => {
    const meetings = [makeMeetingEntity('m1', 'Team Standup', 9, 10)]
    const recordings = [makeUnifiedRecording('r1', 9, 60), makeUndatedRecording('u1')]

    const { calendarMeetings, orphanRecordings } = matchRecordingsToMeetings(meetings, recordings)
    expect(calendarMeetings[0].hasRecording).toBe(true)
    expect(calendarMeetings[0].matchedRecordingId).toBe('r1')
    expect(orphanRecordings).toHaveLength(0)

    const { calendarRecordings } = buildCalendarRecordings(recordings, meetings)
    expect(calendarRecordings).toHaveLength(1)
    expect(calendarRecordings[0].id).toBe('r1')
    expect(calendarRecordings[0].linkedMeeting?.subject).toBe('Team Standup')
  })

  // Review follow-up: an explicit manual link (meetingId) is AUTHORITATIVE — an
  // undated recording that the user linked to a meeting must NOT vanish from the
  // Calendar. It stays in meeting-match state and is placed at the LINKED
  // MEETING's time (the link supplies the timestamp the recording lacks).
  describe('explicitly-linked undated recordings stay on the Calendar', () => {
    const meeting = makeMeetingEntity('m1', 'Team Standup', 9, 10)

    it('getRecordingMeetingMatchScore honors the manual link before the unknown-date guard', () => {
      const linked = makeUndatedRecording('u1', 'm1')
      expect(getRecordingMeetingMatchScore(linked, meeting)).toBe(1000)
      // Same recording against a DIFFERENT meeting still matches nothing.
      const other = makeMeetingEntity('m2', 'Planning', 14, 15)
      expect(getRecordingMeetingMatchScore(linked, other)).toBe(0)
    })

    it('matchRecordingsToMeetings matches it to the linked meeting at the MEETING time', () => {
      const { calendarMeetings, orphanRecordings } = matchRecordingsToMeetings(
        [meeting],
        [makeUndatedRecording('u1', 'm1')]
      )

      expect(calendarMeetings).toHaveLength(1)
      expect(calendarMeetings[0].hasRecording).toBe(true)
      expect(calendarMeetings[0].matchedRecordingId).toBe('u1')
      // Placed at the linked meeting's start — never the 1970 epoch.
      expect(calendarMeetings[0].recordingStartTime?.toISOString()).toBe(meeting.start_time)
      expect(orphanRecordings).toHaveLength(0)
      expect(hasEpochDate(calendarMeetings)).toBe(false)
    })

    it('buildCalendarRecordings builds its block at the linked meeting time and buckets it into that day', () => {
      const { calendarRecordings, meetingOverlays } = buildCalendarRecordings(
        [makeUndatedRecording('u1', 'm1')],
        [meeting]
      )

      expect(calendarRecordings).toHaveLength(1)
      expect(calendarRecordings[0].id).toBe('u1')
      expect(calendarRecordings[0].linkedMeeting?.id).toBe('m1')
      expect(calendarRecordings[0].startTime.toISOString()).toBe(meeting.start_time)
      expect(meetingOverlays[0].hasRecording).toBe(true)
      expect(hasEpochDate(calendarRecordings)).toBe(false)

      // Bucketing: it lands in the linked meeting's day, not a 1970 bucket.
      const viewDates = [new Date(2026, 2, 2), new Date(2026, 2, 3)]
      const grouped = groupByDay(calendarRecordings, (r) => r.startTime, viewDates)
      const meetingDayKey = new Date(meeting.start_time).toISOString().split('T')[0]
      expect(grouped[meetingDayKey]).toHaveLength(1)
      expect(grouped['1970-01-01']).toBeUndefined()
    })

    it('an undated recording linked to a meeting NOT in view is still excluded (no time source)', () => {
      const elsewhere = makeUndatedRecording('u1', 'meeting-in-another-week')

      const { calendarMeetings, orphanRecordings } = matchRecordingsToMeetings([meeting], [elsewhere])
      expect(calendarMeetings[0].hasRecording).toBe(false)
      expect(orphanRecordings).toHaveLength(0)

      const { calendarRecordings } = buildCalendarRecordings([elsewhere], [meeting])
      expect(calendarRecordings).toHaveLength(0)
    })

    it('an undated recording WITHOUT a link is still excluded everywhere (control)', () => {
      const unlinked = makeUndatedRecording('u1')

      const { calendarMeetings, orphanRecordings } = matchRecordingsToMeetings([meeting], [unlinked])
      expect(calendarMeetings[0].hasRecording).toBe(false)
      expect(orphanRecordings).toHaveLength(0)

      const { calendarRecordings } = buildCalendarRecordings([unlinked], [meeting])
      expect(calendarRecordings).toHaveLength(0)
    })
  })
})
