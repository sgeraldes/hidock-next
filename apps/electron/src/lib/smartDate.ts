/**
 * Shared, human date formatting used across Library, the reader, Actionables,
 * and meeting views. Every surface must show the YEAR (a year-old recording must
 * not read like this week's) and, where useful, a relative "x days ago" hint.
 */

function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value == null) return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Absolute date with the year, e.g. "Aug 21, 2025 · 11:14 AM".
 * Returns `fallback` (default "Unknown date") for missing/invalid input.
 */
export function formatSmartDate(
  value: Date | string | number | null | undefined,
  opts: { time?: boolean; fallback?: string } = {}
): string {
  const d = toDate(value)
  if (!d) return opts.fallback ?? 'Unknown date'
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  if (opts.time === false) return date
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `${date} · ${time}`
}

/**
 * Relative hint: "just now", "5 min ago", "3 h ago", "2 days ago", "3 wks ago",
 * "5 mo ago", "2 yr ago". Returns null for missing/invalid input.
 */
export function formatRelativeDate(
  value: Date | string | number | null | undefined,
  now: Date = new Date()
): string | null {
  const d = toDate(value)
  if (!d) return null
  const diffMs = now.getTime() - d.getTime()
  const future = diffMs < 0
  const abs = Math.abs(diffMs)
  const sec = Math.round(abs / 1000)
  const min = Math.round(sec / 60)
  const hr = Math.round(min / 60)
  const day = Math.round(hr / 24)
  const wk = Math.round(day / 7)
  const mo = Math.round(day / 30)
  const yr = Math.round(day / 365)

  let core: string
  if (sec < 45) core = 'just now'
  else if (min < 60) core = `${min} min`
  else if (hr < 24) core = `${hr} h`
  else if (day < 7) core = `${day} day${day === 1 ? '' : 's'}`
  else if (day < 30) core = `${wk} wk${wk === 1 ? '' : 's'}`
  else if (day < 365) core = `${mo} mo`
  else core = `${yr} yr`

  if (core === 'just now') return core
  return future ? `in ${core}` : `${core} ago`
}

/** Absolute date + relative hint together, e.g. "Aug 21, 2025 · 11:14 AM (2 days ago)". */
export function formatSmartDateWithRelative(
  value: Date | string | number | null | undefined,
  opts: { time?: boolean; fallback?: string } = {}
): string {
  const absolute = formatSmartDate(value, opts)
  const rel = formatRelativeDate(value)
  return rel && absolute !== (opts.fallback ?? 'Unknown date') ? `${absolute} (${rel})` : absolute
}
