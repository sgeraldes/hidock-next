/**
 * Time-to-meeting intelligence for the Today page.
 *
 * Pure, side-effect-free helpers so the "what's next" logic is unit-testable
 * independent of React. Given the current time and today's meetings, classify
 * each meeting (past / in-progress / upcoming / cancelled) and pick the single
 * meeting to highlight — the one currently running, or the next one to start.
 */

export type MeetingTimingState = 'cancelled' | 'all_day' | 'past' | 'ran_over' | 'in_progress' | 'upcoming'

/**
 * A meeting whose scheduled end has passed but by no more than this counts as
 * "ran over" — meetings routinely run past their slot, and (especially while the
 * device is still recording) it's almost certainly still the current context. It
 * renders subtly ("ended X min ago"), stays an attribution candidate, and is not
 * dimmed like a fully-past meeting. Past this window it becomes plain `past`.
 */
export const RAN_OVER_WINDOW_MS = 20 * 60 * 1000

export interface MeetingTiming {
  state: MeetingTimingState
  /**
   * For `upcoming`: whole minutes until the meeting starts.
   * For `in_progress`: whole minutes until the meeting ends.
   * For `ran_over`: whole minutes since the meeting's scheduled end.
   * `0` for past/cancelled or when the timestamps are unparseable.
   */
  minutes: number
  /** The single meeting to visually highlight (current, else next upcoming). */
  isFocus: boolean
  /**
   * The soonest upcoming meeting to start — independent of {@link isFocus}. When
   * a meeting is in progress it takes focus, and this flags the *next* meeting so
   * the UI can give "what's next" a secondary emphasis. When nothing is running,
   * the next-up meeting is also the focus.
   */
  isNextUp: boolean
}

export interface TimeableMeeting {
  id: string
  subject: string | null
  start_time: string
  end_time: string
}

/**
 * ICS feeds mark a scrapped meeting by prefixing its subject with "Cancelado"
 * (es) / "Canceled" / "Cancelled" (en) rather than removing the event.
 */
export function isCancelledSubject(subject: string | null | undefined): boolean {
  if (!subject) return false
  const s = subject.trim().toLowerCase()
  return s.startsWith('cancelado') || s.startsWith('canceled') || s.startsWith('cancelled')
}

function instant(iso: string): number {
  return new Date(iso).getTime()
}

/**
 * A span this long or longer is treated as an all-day event rather than a timed
 * meeting. 23h (not 24h) absorbs DST shifts and feeds that trim a minute off the
 * midnight-to-midnight span.
 */
export const ALL_DAY_MS = 23 * 60 * 60 * 1000

/**
 * All-day / holiday events (ICS `DTSTART;VALUE=DATE`) must never be treated as
 * timed meetings — otherwise a "Feriado" renders as "09:00 PM–09:00 PM" and gets
 * highlighted as next-up "in 2 h 56 min". Detection is timezone-independent (works
 * off the raw span, not wall-clock midnight, since times are stored as UTC ISO):
 *   - zero/negative span — a feed that stores `DTSTART == DTEND` for the marker
 *   - a span covering essentially a whole day or more (single all-day = 24h;
 *     multi-day holidays are longer)
 */
export function isAllDayMeeting(startIso: string, endIso: string): boolean {
  const start = instant(startIso)
  const end = instant(endIso)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false
  if (end <= start) return true
  return end - start >= ALL_DAY_MS
}

/** Classify every meeting and flag the one to highlight. */
export function classifyMeetingTimings<T extends TimeableMeeting>(
  meetings: T[],
  now: Date
): Map<string, MeetingTiming> {
  const nowMs = now.getTime()
  const result = new Map<string, MeetingTiming>()

  // First pass: raw state + minutes, without focus.
  const upcoming: Array<{ id: string; start: number }> = []
  const running: Array<{ id: string; end: number }> = []

  for (const m of meetings) {
    if (isCancelledSubject(m.subject)) {
      result.set(m.id, { state: 'cancelled', minutes: 0, isFocus: false, isNextUp: false })
      continue
    }

    // All-day events are never timed context: excluded from focus/next-up and the
    // upcoming/running pools, so they can't become the highlighted "what's next".
    if (isAllDayMeeting(m.start_time, m.end_time)) {
      result.set(m.id, { state: 'all_day', minutes: 0, isFocus: false, isNextUp: false })
      continue
    }

    const start = instant(m.start_time)
    const end = instant(m.end_time)
    const validStart = Number.isFinite(start)
    const validEnd = Number.isFinite(end)

    if (validEnd && end <= nowMs) {
      // Recently ended → "ran over" (subtle, still current); older → fully past.
      const sinceEnd = nowMs - end
      if (sinceEnd <= RAN_OVER_WINDOW_MS) {
        const minutes = Math.max(0, Math.ceil(sinceEnd / 60000))
        result.set(m.id, { state: 'ran_over', minutes, isFocus: false, isNextUp: false })
      } else {
        result.set(m.id, { state: 'past', minutes: 0, isFocus: false, isNextUp: false })
      }
    } else if (validStart && start <= nowMs && (!validEnd || nowMs < end)) {
      const minutes = validEnd ? Math.max(0, Math.ceil((end - nowMs) / 60000)) : 0
      result.set(m.id, { state: 'in_progress', minutes, isFocus: false, isNextUp: false })
      if (validEnd) running.push({ id: m.id, end })
    } else if (validStart && start > nowMs) {
      const minutes = Math.max(0, Math.ceil((start - nowMs) / 60000))
      result.set(m.id, { state: 'upcoming', minutes, isFocus: false, isNextUp: false })
      upcoming.push({ id: m.id, start })
    } else {
      // Unparseable timestamps — treat as upcoming-unknown so the row still shows.
      result.set(m.id, { state: 'upcoming', minutes: 0, isFocus: false, isNextUp: false })
    }
  }

  // Next-up: the soonest upcoming meeting, flagged regardless of focus so the UI
  // can emphasize "what's next" even while another meeting is in progress.
  const nextUpId = upcoming.length > 0 ? upcoming.sort((a, b) => a.start - b.start)[0].id : undefined
  if (nextUpId) {
    const t = result.get(nextUpId)
    if (t) result.set(nextUpId, { ...t, isNextUp: true })
  }

  // Focus: the running meeting finishing soonest, else the next to start.
  let focusId: string | undefined
  if (running.length > 0) {
    focusId = running.sort((a, b) => a.end - b.end)[0].id
  } else {
    focusId = nextUpId
  }
  if (focusId) {
    const t = result.get(focusId)
    if (t) result.set(focusId, { ...t, isFocus: true })
  }

  return result
}

/** Compact "in 4 min" / "in 1 h 20 min" label for an upcoming meeting. */
export function formatMinutesUntil(minutes: number): string {
  if (minutes <= 0) return 'starting now'
  if (minutes < 60) return `in ${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `in ${h} h` : `in ${h} h ${m} min`
}

/** "ended 6 min ago" label for a meeting that just ran over. */
export function formatMinutesSinceEnd(minutes: number): string {
  if (minutes <= 0) return 'just ended'
  if (minutes < 60) return `ended ${minutes} min ago`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `ended ${h} h ago` : `ended ${h} h ${m} min ago`
}

/** "Now · 12 min left" label for a meeting in progress. */
export function formatMinutesLeft(minutes: number): string {
  if (minutes <= 0) return 'Now · wrapping up'
  if (minutes < 60) return `Now · ${minutes} min left`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `Now · ${h} h left` : `Now · ${h} h ${m} min left`
}

/** Fraction of a meeting a recording must cover (by time overlap) to count as its capture. */
export const RECORDING_OVERLAP_THRESHOLD = 0.25

/** A device recording placed on the timeline: start instant + span (ms). */
export interface RecordingSpan {
  startMs: number
  endMs: number
}

/**
 * Whether a device recording plausibly captured a meeting. True when the recording
 * *started inside* the meeting window (the common case — you hit record as the
 * meeting begins), OR its span overlaps at least {@link RECORDING_OVERLAP_THRESHOLD}
 * of the meeting (catches a recording started early / running long). Used to show a
 * "recorded · on device" hint on today's rows before the file is downloaded.
 */
export function recordingOverlapsMeeting(rec: RecordingSpan, meeting: TimeableMeeting): boolean {
  const mStart = instant(meeting.start_time)
  const mEnd = instant(meeting.end_time)
  if (!Number.isFinite(mStart) || !Number.isFinite(mEnd) || mEnd <= mStart) return false
  if (!Number.isFinite(rec.startMs)) return false
  if (rec.startMs >= mStart && rec.startMs <= mEnd) return true
  const spanEnd = Number.isFinite(rec.endMs) && rec.endMs > rec.startMs ? rec.endMs : rec.startMs
  const overlap = Math.min(spanEnd, mEnd) - Math.max(rec.startMs, mStart)
  if (overlap <= 0) return false
  return overlap / (mEnd - mStart) >= RECORDING_OVERLAP_THRESHOLD
}
