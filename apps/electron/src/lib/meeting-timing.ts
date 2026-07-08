/**
 * Time-to-meeting intelligence for the Today page.
 *
 * Pure, side-effect-free helpers so the "what's next" logic is unit-testable
 * independent of React. Given the current time and today's meetings, classify
 * each meeting (past / in-progress / upcoming / cancelled) and pick the single
 * meeting to highlight — the one currently running, or the next one to start.
 */

export type MeetingTimingState = 'cancelled' | 'past' | 'in_progress' | 'upcoming'

export interface MeetingTiming {
  state: MeetingTimingState
  /**
   * For `upcoming`: whole minutes until the meeting starts.
   * For `in_progress`: whole minutes until the meeting ends.
   * `0` for past/cancelled or when the timestamps are unparseable.
   */
  minutes: number
  /** The single meeting to visually highlight (current, else next upcoming). */
  isFocus: boolean
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
      result.set(m.id, { state: 'cancelled', minutes: 0, isFocus: false })
      continue
    }

    const start = instant(m.start_time)
    const end = instant(m.end_time)
    const validStart = Number.isFinite(start)
    const validEnd = Number.isFinite(end)

    if (validEnd && end <= nowMs) {
      result.set(m.id, { state: 'past', minutes: 0, isFocus: false })
    } else if (validStart && start <= nowMs && (!validEnd || nowMs < end)) {
      const minutes = validEnd ? Math.max(0, Math.ceil((end - nowMs) / 60000)) : 0
      result.set(m.id, { state: 'in_progress', minutes, isFocus: false })
      if (validEnd) running.push({ id: m.id, end })
    } else if (validStart && start > nowMs) {
      const minutes = Math.max(0, Math.ceil((start - nowMs) / 60000))
      result.set(m.id, { state: 'upcoming', minutes, isFocus: false })
      upcoming.push({ id: m.id, start })
    } else {
      // Unparseable timestamps — treat as upcoming-unknown so the row still shows.
      result.set(m.id, { state: 'upcoming', minutes: 0, isFocus: false })
    }
  }

  // Focus: the running meeting finishing soonest, else the next to start.
  let focusId: string | undefined
  if (running.length > 0) {
    focusId = running.sort((a, b) => a.end - b.end)[0].id
  } else if (upcoming.length > 0) {
    focusId = upcoming.sort((a, b) => a.start - b.start)[0].id
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

/** "Now · 12 min left" label for a meeting in progress. */
export function formatMinutesLeft(minutes: number): string {
  if (minutes <= 0) return 'Now · wrapping up'
  if (minutes < 60) return `Now · ${minutes} min left`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `Now · ${h} h left` : `Now · ${h} h ${m} min left`
}
