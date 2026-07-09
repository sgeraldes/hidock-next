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
  /** 1 for an all-day / calendar-DATE event (v32); authoritative over the span heuristic. */
  is_all_day?: number | boolean | null
  /** Named calendar day (YYYY-MM-DD) for all-day events; timezone-independent (v32). */
  all_day_date?: string | null
}

/** Local calendar date (`YYYY-MM-DD`) for a Date, in the viewer's timezone. */
export function localDateString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Whether an all-day meeting belongs to the given local day. Prefers the
 * timezone-independent `all_day_date` (the ICS-named day); falls back to the
 * stored start instant's local date for legacy rows written before v32.
 */
export function allDayMeetingOnLocalDate(
  m: { all_day_date?: string | null; start_time: string },
  day: Date
): boolean {
  const target = localDateString(day)
  if (m.all_day_date) return m.all_day_date === target
  return localDateString(new Date(m.start_time)) === target
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
    // The explicit v32 flag is authoritative; the span heuristic is a fallback
    // for legacy rows written before it existed.
    if (m.is_all_day || isAllDayMeeting(m.start_time, m.end_time)) {
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

// ─────────────────────────────────────────────────────────────────────────────
// Time-ribbon zones
//
// The Today ribbon compresses time with distance from NOW. Every meeting stays
// in the DOM; its zone decides how richly it renders:
//   earlier — ended more than an hour ago → collapsed into a grouped capsule
//   recent  — ended within the last hour → slim faded row
//   focus   — in progress, OR upcoming within FOCUS_AHEAD → full card
//   later   — upcoming beyond FOCUS_AHEAD → compact single-line row
// A meeting migrates zones over time (a `later` row grows into a `focus` card as
// NOW approaches it) — the caller recomputes on each clock tick.
// ─────────────────────────────────────────────────────────────────────────────

export type MeetingZone = 'earlier' | 'recent' | 'focus' | 'later'

/** Ended within this window → `recent` (else `earlier`). */
export const RECENT_WINDOW_MS = 60 * 60 * 1000
/** Upcoming within this window → `focus` (else `later`). */
export const FOCUS_AHEAD_MS = 2 * 60 * 60 * 1000
/** Earlier meetings closer together than this gap collapse into one capsule. */
export const GROUP_GAP_MS = 90 * 60 * 1000

/** Zone for a single timed meeting. All-day / cancelled are handled upstream. */
export function meetingZone(m: { start_time: string; end_time: string }, now: Date): MeetingZone {
  const start = instant(m.start_time)
  const end = instant(m.end_time)
  const nowMs = now.getTime()

  // Unparseable timestamps → keep it visible in the focus band.
  if (!Number.isFinite(start) && !Number.isFinite(end)) return 'focus'

  if (Number.isFinite(end) && end <= nowMs) {
    return nowMs - end <= RECENT_WINDOW_MS ? 'recent' : 'earlier'
  }
  // In progress (started, not yet ended) → focus.
  if (Number.isFinite(start) && start <= nowMs) return 'focus'
  // Upcoming.
  if (Number.isFinite(start)) {
    return start - nowMs <= FOCUS_AHEAD_MS ? 'focus' : 'later'
  }
  return 'focus'
}

/** Time-of-day label for a grouped block of earlier meetings. */
export function dayPartLabel(d: Date): string {
  const h = d.getHours()
  if (h < 12) return 'Morning'
  if (h < 18) return 'Afternoon'
  return 'Evening'
}

export interface EarlierGroup<T> {
  meetings: T[]
  /** "Morning" / "Afternoon" / "Evening" — from the block's first meeting. */
  label: string
  startMs: number
  endMs: number
}

/**
 * Collapse `earlier` meetings into contiguous blocks. A gap larger than
 * {@link GROUP_GAP_MS} between one meeting's end and the next's start starts a
 * new block, so the morning's cluster and a lone late-afternoon call don't merge.
 */
export function groupEarlierMeetings<T extends { start_time: string; end_time: string }>(
  meetings: T[]
): EarlierGroup<T>[] {
  const sorted = [...meetings].sort((a, b) => instant(a.start_time) - instant(b.start_time))
  const groups: EarlierGroup<T>[] = []
  for (const m of sorted) {
    const s = instant(m.start_time)
    const e = instant(m.end_time)
    const safeStart = Number.isFinite(s) ? s : 0
    const safeEnd = Number.isFinite(e) ? e : safeStart
    const last = groups[groups.length - 1]
    if (last && Number.isFinite(s) && s - last.endMs <= GROUP_GAP_MS) {
      last.meetings.push(m)
      last.endMs = Math.max(last.endMs, safeEnd)
    } else {
      groups.push({ meetings: [m], label: '', startMs: safeStart, endMs: safeEnd })
    }
  }
  for (const g of groups) g.label = dayPartLabel(new Date(g.startMs))
  return groups
}

// ─────────────────────────────────────────────────────────────────────────────
// Semantic category — a color the eye can read as a data dimension (dot + chip),
// derived heuristically from the subject and attendee count. NO thick borders.
// ─────────────────────────────────────────────────────────────────────────────

export type MeetingCategory = 'recurring' | 'one_on_one' | 'external' | 'personal' | 'general'

/** Human labels for the ribbon legend. */
export const MEETING_CATEGORY_LABELS: Record<MeetingCategory, string> = {
  recurring: 'Recurring / team',
  one_on_one: '1:1',
  external: 'Client / external',
  personal: 'Personal',
  general: 'Other'
}

/**
 * Best-effort category from a meeting's subject and attendee count. Order is
 * deliberate: a personal block wins over everything; an explicit 1:1 (or a
 * two-person meeting) beats the client/recurring heuristics; a "sync with X"
 * reads as a 1:1 while a bare "sync" reads as recurring.
 */
export function categorizeMeeting(m: { subject?: string | null; attendeeCount?: number }): MeetingCategory {
  const s = (m.subject || '').toLowerCase()
  const n = m.attendeeCount

  if (/(almuerzo|lunch|break|descanso|gym|gimnasio|personal|dentista|doctor|m[eé]dico|caf[eé]|coffee|birthday|cumplea)/.test(s)) {
    return 'personal'
  }
  if (/(1:1|1-1|one[- ]?on[- ]?one|sync with|uno a uno)/.test(s) || n === 2) {
    return 'one_on_one'
  }
  if (
    /(belcorp|ita[uú]|bol[ií]var|\baval\b|seguros|cliente|client|external|externo|kickoff|kick-off)/.test(s) ||
    (typeof n === 'number' && n >= 6)
  ) {
    return 'external'
  }
  if (/(daily|stand[- ]?up|standup|weekly|semanal|diari[oa]|sprint|retro|planning|planeaci|refinement|grooming|comit[eé]|\bsync\b|sincron)/.test(s)) {
    return 'recurring'
  }
  return 'general'
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
