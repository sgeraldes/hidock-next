/**
 * Shared "we genuinely don't know this date" sentinel + predicate.
 *
 * Undated recordings (unparseable filename AND no valid device/db date) are
 * stamped with UNKNOWN_DATE (the Unix epoch) instead of render-time `new Date()`.
 * That keeps them sorting to the BOTTOM of newest-first lists and lets shared
 * date formatting render an honest "Unknown date" (never a fake today, never
 * "Jan 1, 1970" / "Dec 31, 1969"). See the #58 "months-apart bundling" fix.
 *
 * Lives in a dependency-free lib module (NOT the useUnifiedRecordings hook) so
 * pure consumers like calendar-utils can import the predicate without pulling in
 * React/store/device code or risking an import cycle. `useUnifiedRecordings`
 * re-exports both for its existing importers.
 *
 * Consumers that do TIME ARITHMETIC on a recording's date (calendar matching,
 * day bucketing, placeholder-meeting creation, date search aliases) MUST gate on
 * `isUnknownDate` so the epoch never leaks into the Calendar as a real 1970 event.
 */
export const UNKNOWN_DATE = new Date(0)

/**
 * True when `d` is missing, invalid, or the UNKNOWN_DATE sentinel — i.e. any time
 * at or before the Unix epoch. Mirrors smartDate's epoch handling (`ms <= 0`), so
 * "no real date" is decided identically wherever it matters.
 */
export function isUnknownDate(d: Date | null | undefined): boolean {
  if (!d) return true
  const t = d.getTime()
  return Number.isNaN(t) || t <= 0
}
