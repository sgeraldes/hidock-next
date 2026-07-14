/**
 * Helpers for editing a meeting's date / start / end in the MeetingDetail form.
 *
 * The store keeps times as ISO strings; native `<input type="date|time">` want
 * local `YYYY-MM-DD` / `HH:MM`. These convert between the two and diff the edited
 * times against the original — comparing by instant so an ISO round-trip
 * (`…:00Z` → `…:00.000Z`) is not mistaken for a real change — while validating
 * that the meeting still ends after it starts.
 */

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** ISO string → local `YYYY-MM-DD` for a date input (empty when unparseable). */
export function toDateInputValue(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** ISO string → local `HH:MM` for a time input (empty when unparseable). */
export function toTimeInputValue(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Combine a local date (`YYYY-MM-DD`) and time (`HH:MM`) into an ISO string,
 * interpreting the parts in the local timezone. Returns null if either part is
 * missing or malformed so callers can keep the previous value.
 */
export function combineDateTimeToISO(dateStr: string, timeStr: string): string | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeStr)
  if (!dateMatch || !timeMatch) return null
  const [, y, mo, d] = dateMatch
  const [, h, mi] = timeMatch
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), 0, 0)
  if (isNaN(date.getTime())) return null
  return date.toISOString()
}

export interface MeetingTimes {
  start_time: string
  end_time: string
}

export type TimeDiffResult =
  | { ok: true; updates: Partial<MeetingTimes> }
  | { ok: false; error: string }

function sameInstant(a: string, b: string): boolean {
  const ta = new Date(a).getTime()
  const tb = new Date(b).getTime()
  if (Number.isFinite(ta) && Number.isFinite(tb)) return ta === tb
  return a === b
}

/**
 * Diff edited meeting times against the original, returning only the fields that
 * changed. Errors when the edited range is inverted (end at or before start).
 */
export function diffMeetingTimes(original: MeetingTimes, edited: MeetingTimes): TimeDiffResult {
  const updates: Partial<MeetingTimes> = {}
  const startChanged = !sameInstant(original.start_time, edited.start_time)
  const endChanged = !sameInstant(original.end_time, edited.end_time)

  if (startChanged) updates.start_time = edited.start_time
  if (endChanged) updates.end_time = edited.end_time

  if (startChanged || endChanged) {
    const s = new Date(edited.start_time).getTime()
    const e = new Date(edited.end_time).getTime()
    if (Number.isFinite(s) && Number.isFinite(e) && e <= s) {
      return { ok: false, error: 'End time must be after start time.' }
    }
  }

  return { ok: true, updates }
}
