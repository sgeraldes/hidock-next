import { describe, it, expect } from 'vitest'
import {
  computeVisibleHourRange,
  matchRecordingsToMeetings,
  buildCalendarRecordings,
  createPlaceholderMeetings,
  groupByDay,
  formatDurationStr,
  type CalendarRecording,
  type CalendarMeetingOverlay,
} from '../calendar-utils'
import type { Meeting } from '@/types'
import type { UnifiedRecording } from '@/types/unified-recording'

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
