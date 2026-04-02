import { format, isValid } from 'date-fns'

export function safeFormat(
  ts: number | string | null | undefined,
  pattern: string,
  fallback = '--',
): string {
  if (ts == null || (typeof ts === 'number' && isNaN(ts))) return fallback
  const date = new Date(ts)
  if (!isValid(date)) return fallback
  try {
    return format(date, pattern)
  } catch {
    return fallback
  }
}

export function safeDateString(
  ts: number | string | null | undefined,
  options?: Intl.DateTimeFormatOptions,
  fallback = '--',
): string {
  if (ts == null) return fallback
  const date = new Date(ts)
  if (!isValid(date)) return fallback
  return date.toLocaleDateString(undefined, options)
}

export function safeTimeString(
  ts: number | string | null | undefined,
  options?: Intl.DateTimeFormatOptions,
  fallback = '--',
): string {
  if (ts == null) return fallback
  const date = new Date(ts)
  if (!isValid(date)) return fallback
  return date.toLocaleTimeString(undefined, options)
}
