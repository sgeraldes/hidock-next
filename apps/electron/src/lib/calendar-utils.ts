/**
 * Calendar utility functions - pure functions for calendar data processing
 */

import type { Meeting } from '@/types'
import type { UnifiedRecording } from '@/types/unified-recording'

// Calendar view types
export type CalendarViewType = 'day' | 'workweek' | 'week' | 'month'

// Duration match status
export type DurationMatch = 'shorter' | 'longer' | 'matched' | 'no_recording'

// Recording-centric calendar entry (PRIMARY display entity)
export interface CalendarRecording {
  id: string
  filename: string
  startTime: Date
  endTime: Date
  durationSeconds: number
  location: 'device-only' | 'local-only' | 'both'
  transcriptionStatus: 'none' | 'pending' | 'processing' | 'complete' | 'error'
  // Linked meeting metadata (optional)
  linkedMeeting?: {
    id: string
    subject: string
    startTime: Date
    endTime: Date
    location?: string | null
    organizer?: string | null
  }
}

// Meeting overlay (SECONDARY display entity - dashed/ghost)
export interface CalendarMeetingOverlay {
  id: string
  subject: string
  startTime: Date
  endTime: Date
  location?: string | null
  organizer?: string | null
  hasRecording: boolean
}

// Extended meeting type that includes recording match info
export interface CalendarMeeting extends Meeting {
  hasRecording: boolean
  isPlaceholder: boolean
  matchedRecordingId?: string
  recordingDurationSeconds?: number
  recordingStartTime?: Date
  recordingEndTime?: Date
  durationMatch?: DurationMatch
  durationDifferenceMinutes?: number
  hasConflicts?: boolean
  recordingLocation?: 'device-only' | 'local-only' | 'both'
}

// Calendar constants
export const HOUR_HEIGHT = 60 // pixels per hour
export const START_HOUR = 7 // 7 AM
export const END_HOUR = 21 // 9 PM
export const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i)

/**
 * Add days to a date in a DST-safe manner
 * Uses date components instead of millisecond arithmetic to avoid DST issues
 */
function addDaysDSTSafe(date: Date, days: number): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
  result.setHours(0, 0, 0, 0)
  return result
}

/**
 * Get dates for a week (Monday-based)
 */
export function getWeekDates(date: Date): Date[] {
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day // Monday is 1
  const monday = addDaysDSTSafe(date, diff)

  return Array.from({ length: 7 }, (_, i) => addDaysDSTSafe(monday, i))
}

/**
 * Get dates for workweek (Mon-Fri)
 */
export function getWorkweekDates(date: Date): Date[] {
  return getWeekDates(date).slice(0, 5)
}

/**
 * Get single day as array
 */
export function getDayDates(date: Date): Date[] {
  return [new Date(date)]
}

/**
 * Get all dates for month view (including padding from prev/next months)
 */
export function getMonthDates(date: Date): Date[] {
  const year = date.getFullYear()
  const month = date.getMonth()

  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)

  // Start from Sunday before (or on) the first day (DST-safe)
  const startDate = addDaysDSTSafe(firstDay, -firstDay.getDay())

  // End on Saturday after (or on) the last day (DST-safe)
  const daysToSaturday = lastDay.getDay() === 6 ? 0 : 6 - lastDay.getDay()
  const endDate = addDaysDSTSafe(lastDay, daysToSaturday)

  const dates: Date[] = []
  let current = startDate
  while (current <= endDate) {
    dates.push(current)
    current = addDaysDSTSafe(current, 1)
  }

  return dates
}

/**
 * Calculate overlapping positions for meetings in a day
 */
export function calculateMeetingColumns(
  meetings: CalendarMeeting[]
): Array<CalendarMeeting & { column: number; totalColumns: number }> {
  if (meetings.length === 0) return []

  const sorted = [...meetings].sort((a, b) => {
    const startDiff = new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
    if (startDiff !== 0) return startDiff
    return new Date(a.end_time).getTime() - new Date(b.end_time).getTime()
  })

  const result: Array<CalendarMeeting & { column: number; totalColumns: number }> = []

  for (const meeting of sorted) {
    const meetingStart = new Date(meeting.start_time).getTime()
    const meetingEnd = new Date(meeting.end_time).getTime()

    const overlapping = result.filter((placed) => {
      const placedStart = new Date(placed.start_time).getTime()
      const placedEnd = new Date(placed.end_time).getTime()
      return meetingStart < placedEnd && meetingEnd > placedStart
    })

    const usedColumns = new Set(overlapping.map((m) => m.column))
    let column = 0
    while (usedColumns.has(column)) column++

    const groupSize = overlapping.length + 1

    result.push({
      ...meeting,
      column,
      totalColumns: groupSize,
    })

    for (const m of overlapping) {
      m.totalColumns = Math.max(m.totalColumns, groupSize)
    }
  }

  return result
}

/**
 * Get recording-meeting match score (0 = no match, higher = better match)
 */
export function getRecordingMeetingMatchScore(recording: UnifiedRecording, meeting: Meeting): number {
  const recStart = recording.dateRecorded.getTime()
  const recDurationMs = (recording.duration || 0) * 1000
  const recEnd = recStart + recDurationMs
  const meetingStart = new Date(meeting.start_time).getTime()
  const meetingEnd = new Date(meeting.end_time).getTime()

  // Manual link = highest priority
  if (recording.meetingId === meeting.id) return 1000

  // Calculate time overlap
  const overlapStart = Math.max(recStart, meetingStart)
  const overlapEnd = Math.min(recEnd, meetingEnd)
  const overlapMs = Math.max(0, overlapEnd - overlapStart)

  if (overlapMs === 0) {
    const bufferMs = 5 * 60 * 1000
    if (recStart >= meetingStart - bufferMs && recStart <= meetingStart) {
      return 10
    }
    if (recDurationMs === 0 && recStart >= meetingStart && recStart <= meetingEnd) {
      return 50
    }
    return 0
  }

  const recDuration = recDurationMs || 1
  const meetingDuration = meetingEnd - meetingStart
  const recOverlapPercent = (overlapMs / recDuration) * 100
  const meetingOverlapPercent = (overlapMs / meetingDuration) * 100

  return Math.min(recOverlapPercent, meetingOverlapPercent)
}

/**
 * Match recordings to meetings by time overlap
 */
export function matchRecordingsToMeetings(
  meetings: Meeting[],
  recordings: UnifiedRecording[]
): { calendarMeetings: CalendarMeeting[]; orphanRecordings: UnifiedRecording[] } {
  const recordingToBestMeeting = new Map<string, { meeting: Meeting; score: number }>()

  for (const recording of recordings) {
    let bestMatch: { meeting: Meeting; score: number } | null = null

    for (const meeting of meetings) {
      const score = getRecordingMeetingMatchScore(recording, meeting)
      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { meeting, score }
      }
    }

    if (bestMatch) {
      recordingToBestMeeting.set(recording.id, bestMatch)
    }
  }

  const calendarMeetings: CalendarMeeting[] = []
  const matchedRecordingIds = new Set<string>()

  for (const meeting of meetings) {
    const meetingStart = new Date(meeting.start_time).getTime()
    const meetingEnd = new Date(meeting.end_time).getTime()
    const meetingDurationSeconds = (meetingEnd - meetingStart) / 1000

    let matchingRecording: UnifiedRecording | null = null
    for (const recording of recordings) {
      const bestMatch = recordingToBestMeeting.get(recording.id)
      if (bestMatch && bestMatch.meeting.id === meeting.id) {
        matchingRecording = recording
        break
      }
    }

    if (matchingRecording) {
      matchedRecordingIds.add(matchingRecording.id)

      const recordingStartTime = matchingRecording.dateRecorded
      const recordingDurationMs = (matchingRecording.duration || 0) * 1000
      const recordingEndTime = new Date(recordingStartTime.getTime() + recordingDurationMs)

      let durationMatch: DurationMatch = 'no_recording'
      let durationDifferenceMinutes = 0

      if (matchingRecording.duration) {
        const recordingDuration = matchingRecording.duration
        const diffSeconds = recordingDuration - meetingDurationSeconds
        durationDifferenceMinutes = Math.round(diffSeconds / 60)

        if (Math.abs(diffSeconds) < 300) {
          durationMatch = 'matched'
        } else if (diffSeconds < 0) {
          durationMatch = 'shorter'
        } else {
          durationMatch = 'longer'
        }
      }

      calendarMeetings.push({
        ...meeting,
        hasRecording: true,
        isPlaceholder: false,
        matchedRecordingId: matchingRecording.id,
        recordingDurationSeconds: matchingRecording.duration,
        recordingStartTime,
        recordingEndTime: recordingDurationMs > 0 ? recordingEndTime : undefined,
        durationMatch,
        durationDifferenceMinutes,
        hasConflicts: false,
        recordingLocation: matchingRecording.location,
      })
    } else {
      calendarMeetings.push({
        ...meeting,
        hasRecording: false,
        isPlaceholder: false,
        durationMatch: 'no_recording',
      })
    }
  }

  const orphanRecordings = recordings.filter((rec) => !matchedRecordingIds.has(rec.id))

  return { calendarMeetings, orphanRecordings }
}

/**
 * Create placeholder meetings from orphan recordings
 */
export function createPlaceholderMeetings(orphanRecordings: UnifiedRecording[]): CalendarMeeting[] {
  return orphanRecordings.map((rec) => {
    const recDate = rec.dateRecorded
    const durationMs = (rec.duration || 30 * 60) * 1000
    const endDate = new Date(recDate.getTime() + durationMs)

    return {
      id: `placeholder_${rec.id}`,
      subject: rec.filename || 'Recording',
      start_time: recDate.toISOString(),
      end_time: endDate.toISOString(),
      is_recurring: 0,
      created_at: recDate.toISOString(),
      updated_at: recDate.toISOString(),
      hasRecording: true,
      isPlaceholder: true,
      matchedRecordingId: rec.id,
      recordingLocation: rec.location,
    }
  })
}

/**
 * Build recording-centric calendar data
 */
export function buildCalendarRecordings(
  recordings: UnifiedRecording[],
  meetings: Meeting[]
): { calendarRecordings: CalendarRecording[]; meetingOverlays: CalendarMeetingOverlay[] } {
  const calendarRecordings: CalendarRecording[] = []
  const meetingsWithRecordings = new Set<string>()

  const recordingToBestMeeting = new Map<string, Meeting>()

  for (const recording of recordings) {
    let bestMatch: { meeting: Meeting; score: number } | null = null

    for (const meeting of meetings) {
      const score = getRecordingMeetingMatchScore(recording, meeting)
      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { meeting, score }
      }
    }

    if (bestMatch) {
      recordingToBestMeeting.set(recording.id, bestMatch.meeting)
      meetingsWithRecordings.add(bestMatch.meeting.id)
    }
  }

  for (const recording of recordings) {
    const startTime = recording.dateRecorded
    const durationMs = (recording.duration || 0) * 1000
    const endTime = new Date(startTime.getTime() + (durationMs || 30 * 60 * 1000))

    const linkedMeetingData = recordingToBestMeeting.get(recording.id)

    calendarRecordings.push({
      id: recording.id,
      filename: recording.filename,
      startTime,
      endTime,
      durationSeconds: recording.duration || 0,
      location: recording.location,
      transcriptionStatus: recording.transcriptionStatus,
      linkedMeeting: linkedMeetingData
        ? {
            id: linkedMeetingData.id,
            subject: linkedMeetingData.subject || 'Untitled Meeting',
            startTime: new Date(linkedMeetingData.start_time),
            endTime: new Date(linkedMeetingData.end_time),
            location: linkedMeetingData.location,
            organizer: linkedMeetingData.organizer_name,
          }
        : undefined,
    })
  }

  const meetingOverlays: CalendarMeetingOverlay[] = meetings.map((meeting) => ({
    id: meeting.id,
    subject: meeting.subject || 'Untitled Meeting',
    startTime: new Date(meeting.start_time),
    endTime: new Date(meeting.end_time),
    location: meeting.location,
    organizer: meeting.organizer_name,
    hasRecording: meetingsWithRecordings.has(meeting.id),
  }))

  return { calendarRecordings, meetingOverlays }
}

/**
 * Format duration as string (e.g., "1h 30m" or "45m")
 */
export function formatDurationStr(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const mins = Math.round((seconds % 3600) / 60)
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
}

/**
 * Group items by day key (YYYY-MM-DD)
 */
export function groupByDay<T>(
  items: T[],
  getDate: (item: T) => Date,
  viewDates: Date[]
): Record<string, T[]> {
  const grouped: Record<string, T[]> = {}

  for (const date of viewDates) {
    const key = date.toISOString().split('T')[0]
    grouped[key] = []
  }

  for (const item of items) {
    const key = getDate(item).toISOString().split('T')[0]
    if (grouped[key]) {
      grouped[key].push(item)
    }
  }

  return grouped
}
