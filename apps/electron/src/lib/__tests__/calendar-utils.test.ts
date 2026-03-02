import { describe, it, expect } from 'vitest'
import {
  computeVisibleHourRange,
  type CalendarRecording,
  type CalendarMeetingOverlay,
} from '../calendar-utils'

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
