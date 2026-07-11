/**
 * Calendar utility functions - pure functions for calendar data processing
 */

import type { Meeting } from '@/types'
import type { UnifiedRecording } from '@/types/unified-recording'
import { categorizeMeeting, isAllDayMeeting, type MeetingCategory } from './meeting-timing'
import { isUnknownDate } from './unknownDate'

/**
 * A meeting this long (or flagged all-day) is a low-precision "bridge" window. A
 * recording merely contained in one must NOT be picked as its best match — see
 * getRecordingMeetingMatchScore. Kept in sync with LONG_MEETING_MS in the main
 * process's recording-match-scoring.ts.
 */
const LONG_MEETING_MATCH_MS = 4 * 60 * 60 * 1000
/** Minimum symmetric fit (IoU) a bridge meeting needs to count as a display match. */
const BRIDGE_ALIGN_MIN = 0.5

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
  // Transcript-derived identity (present once analyzed) — what the recording IS,
  // so the calendar can show it instead of a machine filename.
  title?: string
  summary?: string
  // Linked meeting metadata (optional)
  linkedMeeting?: {
    id: string
    subject: string
    startTime: Date
    endTime: Date
    location: string | null
    organizer: string | null
  }
}

// Meeting overlay (SECONDARY display entity - dashed/ghost)
export interface CalendarMeetingOverlay {
  id: string
  subject: string
  startTime: Date
  endTime: Date
  location: string | null
  organizer: string | null
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
// CA-06 FIX: Expanded hour range from 7AM-9PM to 6AM-11PM to show early morning and late evening recordings
export const DEFAULT_START_HOUR = 6 // 6 AM
export const DEFAULT_END_HOUR = 23 // 11 PM
// Legacy aliases for backward compatibility
export const START_HOUR = DEFAULT_START_HOUR
export const END_HOUR = DEFAULT_END_HOUR
export const HOURS = Array.from({ length: DEFAULT_END_HOUR - DEFAULT_START_HOUR }, (_, i) => DEFAULT_START_HOUR + i)

/**
 * Visible hour range result from computeVisibleHourRange
 */
export interface VisibleHourRange {
  startHour: number
  endHour: number
  hours: number[]
}

/**
 * Compute the visible hour range for the calendar timeline based on actual event times.
 * Expands beyond defaultStart/defaultEnd when recordings or meetings fall outside those bounds.
 * Always includes at least 1 hour of padding around the earliest/latest events.
 *
 * B-CAL-003: Dynamic hour range replaces hard-coded 8-18 (or 6-23) range.
 *
 * @param recordings - Array of CalendarRecording items displayed in this view
 * @param meetings - Array of CalendarMeetingOverlay items displayed in this view
 * @param defaultStart - Default start hour (e.g. 6 for 6 AM)
 * @param defaultEnd - Default end hour (e.g. 23 for 11 PM)
 * @returns VisibleHourRange with startHour, endHour, and hours array
 */
export function computeVisibleHourRange(
  recordings: CalendarRecording[],
  meetings: CalendarMeetingOverlay[],
  defaultStart: number = DEFAULT_START_HOUR,
  defaultEnd: number = DEFAULT_END_HOUR
): VisibleHourRange {
  let minHour = defaultStart
  let maxHour = defaultEnd

  // Check recordings for earliest/latest hours
  for (const rec of recordings) {
    const startH = rec.startTime.getHours()
    const endH = rec.endTime.getHours() + (rec.endTime.getMinutes() > 0 ? 1 : 0)

    if (startH < minHour) {
      minHour = startH
    }
    if (endH > maxHour) {
      maxHour = endH
    }
  }

  // Check meetings for earliest/latest hours
  for (const meeting of meetings) {
    const startH = meeting.startTime.getHours()
    const endH = meeting.endTime.getHours() + (meeting.endTime.getMinutes() > 0 ? 1 : 0)

    if (startH < minHour) {
      minHour = startH
    }
    if (endH > maxHour) {
      maxHour = endH
    }
  }

  // Add 1 hour padding (clamped to 0-24)
  const startHour = Math.max(0, minHour - 1)
  const endHour = Math.min(24, maxHour + 1)

  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i)

  return { startHour, endHour, hours }
}

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

// ===== F6: Overlap cascade layout =====
// Owner constraint (2026-07-08): do NOT shrink overlapping events into Outlook-style
// side-by-side columns. Blocks stay full-width and "hang" over each other; the lane
// index below only drives a SMALL cascading indent + stacking order so a later,
// overlapping event's header does not fully cover the earlier one's title.

/** Horizontal indent (px) applied per cascade lane for overlapping events. */
export const OVERLAP_INDENT_STEP = 10
/** Cap on indent lanes so deeply-stacked events never shrink to nothing. */
export const OVERLAP_MAX_INDENT_LANES = 6

/** Per-item cascade layout produced by {@link assignOverlapLanes}. */
export interface OverlapLayout {
  /** Cascade depth: 0 = base (no earlier overlap), higher = indented + on top. */
  lane: number
}

/**
 * Assign cascade lanes to time-ordered blocks so overlapping events remain readable.
 *
 * Items MUST already be sorted by start time (the calendar groups sort per day).
 * Each item receives the lowest lane index not held by an earlier item whose time
 * range still overlaps it (classic greedy interval colouring). Non-overlapping
 * items all stay in lane 0, so days without collisions render exactly as before
 * (no regression). Later-starting overlapping items land in deeper lanes, which the
 * caller turns into a few px of left indent + a higher z-index — the earlier event's
 * left edge (icon + title) peeks out and stays legible.
 *
 * This is intentionally NOT Outlook-style column splitting (see owner constraint above):
 * blocks keep (almost) full width and simply cascade.
 */
export function assignOverlapLanes<T extends { startTime: Date; endTime: Date }>(
  items: T[]
): Array<T & OverlapLayout> {
  // active[laneIndex] = end time (ms) of the item currently occupying that lane,
  // or undefined when the lane is free.
  const active: Array<number | undefined> = []

  return items.map((item) => {
    const startMs = item.startTime.getTime()
    const endMs = item.endTime.getTime()

    // Free any lane whose occupant ends at or before this item's start
    // (touching edges do not count as an overlap).
    for (let i = 0; i < active.length; i++) {
      if (active[i] !== undefined && (active[i] as number) <= startMs) {
        active[i] = undefined
      }
    }

    // Lowest free lane (append a new one if all are busy).
    let lane = active.findIndex((end) => end === undefined)
    if (lane === -1) {
      lane = active.length
      active.push(endMs)
    } else {
      active[lane] = endMs
    }

    return { ...item, lane }
  })
}

/**
 * Build an accessible label for a calendar event block (F7 a11y).
 * Combines the visible subject with a human time range, e.g.
 * "Team Standup, 9:00 AM to 10:00 AM".
 */
export function buildEventAriaLabel(subject: string, start: Date, end: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const name = subject && subject.trim().length > 0 ? subject.trim() : 'Untitled event'
  return `${name}, ${fmt(start)} to ${fmt(end)}`
}

/**
 * Get recording-meeting match score (0 = no match, higher = better match)
 */
export function getRecordingMeetingMatchScore(recording: UnifiedRecording, meeting: Meeting): number {
  // Manual link = highest priority — AUTHORITATIVE even for an undated recording:
  // the user's explicit link is a stronger signal than any timestamp, and the
  // linked meeting supplies the placement time the recording lacks.
  if (recording.meetingId === meeting.id) return 1000

  // Otherwise an undated recording (UNKNOWN_DATE epoch sentinel) has no real time,
  // so it can overlap no meeting — scoring it would only mis-fire against 1970. It
  // matches nothing and stays in the Library as "Unknown date", never on the
  // Calendar (#58).
  if (isUnknownDate(recording.dateRecorded)) return 0
  const recStart = recording.dateRecorded.getTime()
  const recDurationMs = (recording.duration || 0) * 1000
  const recEnd = recStart + recDurationMs
  const meetingStart = new Date(meeting.start_time).getTime()
  const meetingEnd = new Date(meeting.end_time).getTime()

  // Calculate time overlap
  const overlapStart = Math.max(recStart, meetingStart)
  const overlapEnd = Math.min(recEnd, meetingEnd)
  const overlapMs = Math.max(0, overlapEnd - overlapStart)

  // All-day / multi-hour "bridge" events are a WEAK signal: a recording fully
  // contained in a 9h window scores ~100% by naive coverage, wrongly beating the
  // real meeting. Require GENUINE alignment (symmetric IoU fit) — containment alone
  // is not enough, so a recording with no tighter match is left unlinked, not
  // attributed to an all-day event.
  const meetingDurationMs = meetingEnd - meetingStart
  const isBridge =
    meeting.is_all_day === 1 ||
    isAllDayMeeting(meeting.start_time, meeting.end_time) ||
    (Number.isFinite(meetingDurationMs) && meetingDurationMs >= LONG_MEETING_MATCH_MS)
  if (isBridge) {
    if (overlapMs <= 0 || recDurationMs <= 0) return 0
    const unionMs = Math.max(recEnd, meetingEnd) - Math.min(recStart, meetingStart)
    const iou = unionMs > 0 ? overlapMs / unionMs : 0
    return iou >= BRIDGE_ALIGN_MIN ? iou * 100 : 0
  }

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
  // Exclude undated recordings (UNKNOWN_DATE sentinel) up front: they can't be
  // matched to a meeting by time overlap, and — critically — they must NOT fall
  // through to orphanRecordings, or createPlaceholderMeetings would stamp a 1970
  // placeholder onto the Calendar. They remain fully visible in the Library as
  // "Unknown date"; the Calendar simply doesn't place them (#58).
  // EXCEPTION: an undated recording with an explicit manual link (meetingId) to a
  // meeting in this view IS kept — the link is authoritative and the linked meeting
  // supplies its placement time. (An undated recording whose linked meeting is not
  // in `meetings` still has no time source, so it stays excluded.)
  const datedRecordings = recordings.filter(
    (rec) =>
      !isUnknownDate(rec.dateRecorded) ||
      (rec.meetingId != null && meetings.some((m) => m.id === rec.meetingId))
  )
  const recordingToBestMeeting = new Map<string, { meeting: Meeting; score: number }>()

  for (const recording of datedRecordings) {
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
    for (const recording of datedRecordings) {
      const bestMatch = recordingToBestMeeting.get(recording.id)
      if (bestMatch && bestMatch.meeting.id === meeting.id) {
        matchingRecording = recording
        break
      }
    }

    if (matchingRecording) {
      matchedRecordingIds.add(matchingRecording.id)

      // An explicitly-linked undated recording is placed at its LINKED MEETING's
      // start — the manual link is authoritative and supplies the timestamp the
      // recording lacks (never the raw 1970 epoch sentinel).
      const recordingStartTime = isUnknownDate(matchingRecording.dateRecorded)
        ? new Date(meeting.start_time)
        : matchingRecording.dateRecorded
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

  // Orphans feed createPlaceholderMeetings, which needs a real timestamp — so an
  // undated recording must never land here (its explicit link, when present and in
  // view, always matches above with score 1000; this also covers any edge fallout).
  const orphanRecordings = datedRecordings.filter(
    (rec) => !matchedRecordingIds.has(rec.id) && !isUnknownDate(rec.dateRecorded)
  )

  return { calendarMeetings, orphanRecordings }
}

/**
 * Create placeholder meetings from orphan recordings
 */
export function createPlaceholderMeetings(orphanRecordings: UnifiedRecording[]): CalendarMeeting[] {
  return orphanRecordings
    // Never synthesize a placeholder for an undated recording — its epoch date would
    // render a "Jan 1, 1970" ghost meeting. matchRecordingsToMeetings already keeps
    // these out of orphanRecordings; this guard also protects direct callers (#58).
    .filter((rec) => !isUnknownDate(rec.dateRecorded))
    .map((rec) => {
    const recDate = rec.dateRecorded
    const durationMs = (rec.duration || 30 * 60) * 1000
    const endDate = new Date(recDate.getTime() + durationMs)

    return {
      id: `placeholder_${rec.id}`,
      subject: rec.filename || 'Recording',
      start_time: recDate.toISOString(),
      end_time: endDate.toISOString(),
      location: null,
      organizer_name: null,
      organizer_email: null,
      attendees: null,
      description: null,
      is_recurring: 0,
      recurrence_rule: null,
      meeting_url: null,
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

  // Undated recordings (UNKNOWN_DATE sentinel) have no real time to place on the
  // timeline — a raw epoch would render a recording block at midnight 1970. Drop
  // them from the recording-centric view; they stay in the Library as "Unknown
  // date". (#58)
  // EXCEPTION: an explicit manual link (meetingId) to a meeting in this view keeps
  // the recording — it is placed at the linked meeting's time (link = authoritative).
  const datedRecordings = recordings.filter(
    (rec) =>
      !isUnknownDate(rec.dateRecorded) ||
      (rec.meetingId != null && meetings.some((m) => m.id === rec.meetingId))
  )

  const recordingToBestMeeting = new Map<string, Meeting>()

  for (const recording of datedRecordings) {
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

  for (const recording of datedRecordings) {
    const linkedMeetingData = recordingToBestMeeting.get(recording.id)

    // An explicitly-linked undated recording renders at its LINKED MEETING's start
    // (the link supplies the missing timestamp — never the 1970 epoch sentinel).
    // The filter above guarantees an undated recording here always has its linked
    // meeting present, so linkedMeetingData is set for it (manual link scores 1000).
    const startTime =
      isUnknownDate(recording.dateRecorded) && linkedMeetingData
        ? new Date(linkedMeetingData.start_time)
        : recording.dateRecorded
    const durationMs = (recording.duration || 0) * 1000
    const endTime = new Date(startTime.getTime() + (durationMs || 30 * 60 * 1000))

    calendarRecordings.push({
      id: recording.id,
      filename: recording.filename,
      startTime,
      endTime,
      durationSeconds: recording.duration || 0,
      location: recording.location,
      transcriptionStatus: recording.transcriptionStatus,
      title: recording.title,
      summary: recording.summary,
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
 * Category color key for a recording block, derived from its linked meeting's
 * subject. A recording that matched no meeting has no category — it renders in
 * the distinct "unmatched" style instead — so this falls back to 'general'.
 */
export function recordingCategory(recording: CalendarRecording): MeetingCategory {
  if (!recording.linkedMeeting) return 'general'
  return categorizeMeeting({ subject: recording.linkedMeeting.subject })
}

/** The honest, specific state name for a recording with no linked meeting. */
export const UNLINKED_STATE_LABEL = 'Not linked to a meeting'

/**
 * Primary block label. A linked recording shows its meeting's subject; an unlinked
 * one shows what it IS — its transcript-derived title — falling back to
 * "Recording · <start time>" when it has no title yet. The raw device filename
 * (e.g. "2026Jul08-140719-Rec46.hda") is NEVER surfaced as the label.
 */
export function recordingBlockTitle(recording: CalendarRecording): string {
  if (recording.linkedMeeting) return recording.linkedMeeting.subject
  const title = recording.title?.trim()
  if (title) return title
  const time = recording.startTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `Recording · ${time}`
}

/**
 * Sub-label for an unlinked recording block: "<duration> · <start time>", e.g.
 * "12m · 2:07 PM".
 */
export function formatUnmatchedRecordingMeta(recording: CalendarRecording): string {
  const duration = formatDurationStr(recording.durationSeconds)
  const time = recording.startTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `${duration} · ${time}`
}

/**
 * Rank candidate meetings for assignment by how close their start is to a
 * recording's time — the nearest meeting first. Pure and side-effect-free so the
 * assignment dialog's fallback list is decidably ordered (content-based ranking,
 * e.g. speaker/attendee overlap, is a separate future step).
 */
export function sortMeetingsByProximity<T extends { start_time: string }>(meetings: T[], refIso: string): T[] {
  const ref = new Date(refIso).getTime()
  const distance = (m: T) => {
    const t = new Date(m.start_time).getTime()
    return Number.isFinite(t) && Number.isFinite(ref) ? Math.abs(t - ref) : Number.POSITIVE_INFINITY
  }
  return [...meetings].sort((a, b) => distance(a) - distance(b))
}

/**
 * Format duration as string (e.g., "1h 30m" or "45m")
 * Handles zero, negative, and NaN gracefully.
 */
export function formatDurationStr(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0m'
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
