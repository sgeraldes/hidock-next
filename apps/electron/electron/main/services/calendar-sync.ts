import { parseICS, correlate } from '@hidock/calendar-sync'
import type { CalendarEvent } from '@hidock/calendar-sync'
import ICAL from 'ical.js'
import { join } from 'path'
import { getCachePath } from './file-storage'
import { upsertMeetingsBatch, Meeting } from './database'
import { getConfig, updateConfig } from './config'
import { whenBootTasksSettled, areBootTasksSettled } from './boot-scheduler'

// Re-export package types and correlate for consumers (e.g. recording-watcher)
export { correlate }
export type { CalendarEvent }

// B-CAL-004: Error category for calendar sync failures
// CS-003: Added 'auth' category for 401/403 errors
// CS-003: Added 'auth' for 401/403. 'cancelled' marks a pass abandoned before it
// wrote anything (its schedule was torn down while it waited on the boot gate).
export type CalendarErrorCategory =
  | 'network'
  | 'parse'
  | 'database'
  | 'validation'
  | 'auth'
  | 'cancelled'
  | 'unknown'

export interface CalendarSyncResult {
  success: boolean
  meetingsCount: number
  error?: string
  errorCategory?: CalendarErrorCategory
  lastSync?: string
  /**
   * The sync did not run inline — boot work was still going, so it was started
   * in the background and will complete on its own (the renderer picks it up via
   * `calendar:synced`). Only a user-initiated sync can come back this way; it
   * exists so a click is answered immediately instead of parking the control for
   * the whole startup window.
   */
  queued?: boolean
}

export interface CalendarSyncOptions {
  /**
   * F15: how long to wait for the boot tasks to finish before starting. A sync
   * running alongside the boot drain put two heavy passes on the one main-process
   * event loop and froze the window. `0` starts immediately (tests, and any
   * caller that has already waited).
   */
  waitForBootMs?: number
  /** Attempts for the ICS fetch. Transient failures back off between attempts. */
  fetchAttempts?: number
  /** First backoff delay; doubles per attempt, with jitter. */
  fetchBaseDelayMs?: number
  /**
   * Force a fresh pass instead of joining an in-flight one. Used by
   * clear-and-sync, whose caller has just emptied the table and must not be
   * handed the result of a sync that started before the clear.
   */
  fresh?: boolean
  /**
   * Cancellation token. Returning false abandons the pass — checked after the
   * boot gate and before EVERY side-effecting phase.
   *
   * A scheduled sync can sit parked on the boot gate for a long time, during
   * which auto-sync may be disabled or reconfigured. Checking only after the
   * pass returned would suppress the log line and nothing else: the invalidated
   * pass would still have written the cache, upserted meetings, reconciled and
   * broadcast. Callers that join an in-flight pass each contribute a token, and
   * the pass continues while ANY of them still wants it.
   */
  isStillWanted?: () => boolean
}

/**
 * Cap on the boot wait. The F15 freeze window is the first ~30 s after start; if
 * boot work is somehow still running well past that, syncing is better than
 * never syncing.
 */
const BOOT_WAIT_MS = 45000

/** ICS fetch attempts, and the first backoff step (doubled per retry). */
const DEFAULT_FETCH_ATTEMPTS = 3
const DEFAULT_FETCH_BASE_DELAY_MS = 1000

/**
 * Transport failures that are worth retrying. The owner's crash (F15) surfaced
 * as `TypeError: fetch failed` wrapping `read ECONNRESET` — a reset mid-transfer,
 * which succeeds on a retry. Configuration failures (ECONNREFUSED, ENOTFOUND,
 * auth) are NOT here: retrying those just burns the boot window.
 */
const TRANSIENT_NETWORK_CODES = [
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'ENETRESET',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT'
]

/**
 * Failures that will keep failing until a human changes something: the host does
 * not resolve, nothing is listening, or the certificate is wrong. Retrying these
 * during boot buys nothing and delays everything behind the sync.
 */
const PERMANENT_NETWORK_CODES = [
  'ECONNREFUSED',
  'ENOTFOUND',
  'EHOSTDOWN',
  'EPROTO',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_INVALID_URL',
  'ERR_UNSUPPORTED_PROTOCOL'
]

/** Walk an error and everything it wraps, collecting a field from each level. */
function collectFromCauseChain(error: unknown, field: 'code' | 'message'): string[] {
  const found: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < 5 && current; depth++) {
    const e = current as { code?: unknown; message?: unknown; cause?: unknown }
    const value = e[field]
    if (typeof value === 'string') found.push(value)
    current = e.cause
  }
  return found
}

/**
 * True when the failure looks like a transient transport hiccup worth retrying.
 *
 * Node's fetch reports EVERY transport failure — transient resets and permanent
 * DNS/connection errors alike — as a bare `TypeError: fetch failed`, with the
 * real reason hidden on `.cause`. So when a concrete error code exists anywhere
 * in the chain it is authoritative and the generic wrapper message is ignored;
 * falling back to matching "fetch failed" would retry ECONNREFUSED and ENOTFOUND
 * exactly as if they were resets.
 */
export function isTransientNetworkError(error: unknown): boolean {
  const codes = collectFromCauseChain(error, 'code')
  if (codes.length > 0) {
    return codes.some((code) => TRANSIENT_NETWORK_CODES.includes(code))
  }

  // No structured code (a plain Error, or a message-only failure) — fall back to
  // the text, but still only on a recognized signal, never on the wrapper.
  const messages = collectFromCauseChain(error, 'message').join(' | ')
  if (PERMANENT_NETWORK_CODES.some((code) => messages.includes(code))) return false
  if (TRANSIENT_NETWORK_CODES.some((code) => messages.includes(code))) return true
  return /socket hang up|network error/i.test(messages)
}

/** Sleep without blocking the event loop. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}

/**
 * Fetch the ICS feed, retrying transient transport failures and 429/5xx with
 * exponential backoff plus jitter.
 *
 * Before this, one `ECONNRESET` mid-download failed the entire sync pass — and
 * because the periodic timer just tried again on its own schedule, a flaky link
 * produced repeated whole-pass failures instead of one retried request (F15).
 */
async function fetchIcsWithRetry(
  icsUrl: string,
  attempts: number,
  baseDelayMs: number
): Promise<Response> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let transient: boolean
    try {
      const response = await fetch(icsUrl)
      if (response.ok) return response
      lastError = new Error(`Failed to fetch calendar: ${response.status} ${response.statusText}`)
      // 429 = asked to slow down; 5xx = server-side blip. Other 4xx are ours to fix.
      transient = response.status === 429 || response.status >= 500
    } catch (error) {
      lastError = error
      transient = isTransientNetworkError(error)
    }

    if (!transient || attempt === attempts) break

    // Exponential backoff with 0.5x-1.5x jitter so repeated failures across
    // restarts do not resynchronize into a thundering herd on the feed.
    const backoffMs = Math.round(baseDelayMs * 2 ** (attempt - 1) * (0.5 + Math.random()))
    console.warn(
      `[calendar-sync] ICS fetch attempt ${attempt}/${attempts} failed ` +
        `(${lastError instanceof Error ? lastError.message : String(lastError)}); ` +
        `retrying in ${backoffMs}ms`
    )
    await sleep(backoffMs)
  }
  throw lastError
}

/**
 * Categorize a calendar sync error into a user-facing error category.
 * B-CAL-004: Provides structured error information for better user messaging.
 */
export function categorizeCalendarError(error: unknown): { message: string; category: CalendarErrorCategory } {
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return { message: error.message, category: 'network' }
  }

  const message = error instanceof Error ? error.message : String(error)

  // CS-003: Auth errors (401/403) must be categorized as 'auth', not 'network'
  if (
    message.includes('401') ||
    message.includes('403') ||
    message.includes('Unauthorized') ||
    message.includes('Forbidden') ||
    message.includes('authentication') ||
    message.includes('authorization')
  ) {
    return { message, category: 'auth' }
  }

  // Network errors. Node's fetch reports transport failures as a bare
  // `TypeError: fetch failed` and hides the real code (e.g. ECONNRESET) on
  // `.cause`, so check the whole chain — otherwise a reset lands in 'unknown'.
  if (
    message.includes('fetch') ||
    message.includes('ECONNREFUSED') ||
    message.includes('ENOTFOUND') ||
    message.includes('ETIMEDOUT') ||
    message.includes('network') ||
    message.includes('Failed to fetch') ||
    message.includes('ERR_NETWORK') ||
    /^Failed to fetch calendar: \d+/.test(message) ||
    isTransientNetworkError(error)
  ) {
    return { message, category: 'network' }
  }

  // Parse errors (ICS parsing)
  if (
    message.includes('parse') ||
    message.includes('ICAL') ||
    message.includes('invalid ical') ||
    message.includes('Unexpected') ||
    message.includes('SyntaxError')
  ) {
    return { message, category: 'parse' }
  }

  // Database errors
  if (
    message.includes('database') ||
    message.includes('Database') ||
    message.includes('SQLITE') ||
    message.includes('sqlite') ||
    message.includes('constraint')
  ) {
    return { message, category: 'database' }
  }

  // Validation errors (URL validation, etc.)
  if (
    message.includes('URL') ||
    message.includes('url') ||
    message.includes('allowed') ||
    message.includes('HTTPS') ||
    message.includes('blocked') ||
    message.includes('Private IP')
  ) {
    return { message, category: 'validation' }
  }

  return { message, category: 'unknown' }
}

/**
 * Validate an ICS URL to prevent SSRF attacks.
 * Only allows HTTPS URLs (or HTTP for localhost in development).
 * Blocks private IP ranges, localhost (except in dev), and non-HTTP protocols.
 */
function validateCalendarUrl(url: string): { valid: boolean; error?: string } {
  try {
    const parsed = new URL(url)

    // Only allow HTTP(S) protocols
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { valid: false, error: 'Only HTTP/HTTPS URLs are allowed for calendar sync' }
    }

    // Get hostname for further validation
    const hostname = parsed.hostname.toLowerCase()

    // Block localhost and loopback addresses (except in development)
    const isLocalhost = hostname === 'localhost' ||
                        hostname === '127.0.0.1' ||
                        hostname === '::1' ||
                        hostname === '[::1]' ||
                        hostname.endsWith('.local')

    if (isLocalhost) {
      // Allow localhost only if explicitly running in dev mode
      const isDev = process.env.NODE_ENV === 'development'
      if (!isDev) {
        return { valid: false, error: 'Localhost URLs are not allowed for calendar sync in production' }
      }
    }

    // Block private IP ranges
    const privateIPPatterns = [
      /^10\./,                    // 10.0.0.0/8
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
      /^192\.168\./,              // 192.168.0.0/16
      /^169\.254\./,              // Link-local 169.254.0.0/16
      /^0\./,                     // 0.0.0.0/8
      /^100\.(6[4-9]|[7-9][0-9]|1[0-2][0-9])\./,  // CGNAT 100.64.0.0/10
    ]

    for (const pattern of privateIPPatterns) {
      if (pattern.test(hostname)) {
        return { valid: false, error: 'Private IP addresses are not allowed for calendar sync' }
      }
    }

    // Block metadata endpoints (cloud provider SSRF targets)
    const blockedHostnames = [
      '169.254.169.254',          // AWS/GCP metadata
      'metadata.google.internal',
      'metadata.gcp.internal',
    ]

    if (blockedHostnames.includes(hostname)) {
      return { valid: false, error: 'This URL is blocked for security reasons' }
    }

    // Require HTTPS for non-localhost URLs in production
    if (parsed.protocol === 'http:' && !isLocalhost) {
      // Allow HTTP only for well-known calendar providers (some still use HTTP for ICS)
      const allowedHttpHosts = [
        'calendar.google.com',
        'outlook.office365.com',
        'outlook.live.com',
      ]
      if (!allowedHttpHosts.some(h => hostname === h || hostname.endsWith('.' + h))) {
        return { valid: false, error: 'HTTPS is required for calendar URLs (HTTP is only allowed for major calendar providers)' }
      }
    }

    return { valid: true }
  } catch {
    return { valid: false, error: 'Invalid URL format' }
  }
}

// Helper to yield to event loop and prevent UI blocking
// Uses setTimeout(0) which gives renderer process priority over setImmediate
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * URL patterns used to extract meeting links from event description/location.
 * Kept here (electron-specific) so the shared package stays provider-agnostic.
 */
const MEETING_URL_PATTERNS = [
  /https:\/\/teams\.microsoft\.com\/[^\s<>]+/i,
  /https:\/\/[\w-]+\.zoom\.us\/[^\s<>]+/i,
  /https:\/\/meet\.google\.com\/[^\s<>]+/i,
  /https:\/\/[\w-]+\.webex\.com\/[^\s<>]+/i,
]

/**
 * Adapter: convert a package CalendarEvent to the electron DB meeting row shape.
 *
 * The shared @hidock/calendar-sync package now preserves every field electron
 * relied on before the migration:
 *  - organizer: parsed from the ICS ORGANIZER property (CN + mailto)
 *  - isRecurring / recurrence: parsed from the ICS RRULE property
 *  - Windows/Exchange timezone names (e.g. "Eastern Standard Time") that ship
 *    no VTIMEZONE block are converted to correct UTC inside parseICS()
 *
 * This adapter maps those into the DB column shape:
 *  - organizer.name/email  → organizer_name / organizer_email
 *  - isRecurring/recurrence → is_recurring / recurrence_rule
 *  - attendees: CalendarAttendee[] → JSON string (DB stores attendees as text)
 *  - meeting_url: electron-specific extraction from description/location
 */
function calendarEventToMeetingRow(
  event: CalendarEvent
): Omit<Meeting, 'created_at' | 'updated_at'> {
  return buildMeetingRow(event, {
    id: event.uid,
    startTime: event.startTime,
    endTime: event.endTime,
    isRecurring: !!event.isRecurring,
    recurrenceRule: event.recurrence,
  })
}

/**
 * Build a DB meeting row from a CalendarEvent, allowing the identity, times and
 * recurrence flags to be overridden per occurrence. Attendee/organizer/URL/
 * subject/description all come from the source event; the expander supplies the
 * occurrence-specific id, start/end, and recurrence metadata.
 */
function buildMeetingRow(
  event: CalendarEvent,
  overrides: { id: string; startTime: Date; endTime: Date; isRecurring: boolean; recurrenceRule?: string }
): Omit<Meeting, 'created_at' | 'updated_at'> {
  // All-day handling: an all-day event names a calendar DAY, not an instant.
  // The parser stores its DTSTART as UTC midnight of that named day, so a feed
  // date like 2026-07-09 becomes 2026-07-09T00:00Z — which is the *previous*
  // local day in any negative-offset timezone, leaking a holiday onto the wrong
  // day. Re-anchor all-day rows to LOCAL midnight of the named date (derived
  // from the slot's UTC Y/M/D, which equals the named day), and record both the
  // is_all_day flag and the timezone-independent named date so the UI can match
  // by local calendar date rather than by the stored instant.
  let startIso = overrides.startTime.toISOString()
  let endIso = overrides.endTime.toISOString()
  let isAllDay = 0
  let allDayDate: string | undefined
  if (event.isAllDay) {
    const y = overrides.startTime.getUTCFullYear()
    const m = overrides.startTime.getUTCMonth()
    const d = overrides.startTime.getUTCDate()
    const spanDays = Math.max(
      1,
      Math.round((overrides.endTime.getTime() - overrides.startTime.getTime()) / DAY_MS)
    )
    startIso = new Date(y, m, d).toISOString()
    endIso = new Date(y, m, d + spanDays).toISOString()
    isAllDay = 1
    allDayDate = `${y.toString().padStart(4, '0')}-${(m + 1).toString().padStart(2, '0')}-${d
      .toString()
      .padStart(2, '0')}`
  }

  // Attendees: map CalendarAttendee[] → JSON string (DB stores as text)
  let attendeesJson: string | undefined
  if (event.attendees.length > 0) {
    attendeesJson = JSON.stringify(
      event.attendees.map((a) => ({
        ...(a.name !== undefined && { name: a.name }),
        email: a.email,
      }))
    )
  }

  // Extract meeting URL from description and location
  let meetingUrl: string | undefined
  const textToSearch = `${event.description ?? ''} ${event.location ?? ''}`
  for (const pattern of MEETING_URL_PATTERNS) {
    const match = textToSearch.match(pattern)
    if (match) {
      meetingUrl = match[0]
      break
    }
  }

  return {
    id: overrides.id,
    subject: event.title || 'Untitled Meeting',
    start_time: startIso,
    end_time: endIso,
    location: event.location ?? undefined,
    // Organizer restored from the package's parsed ORGANIZER property
    organizer_name: event.organizer?.name ?? undefined,
    organizer_email: event.organizer?.email ?? undefined,
    attendees: attendeesJson,
    description: event.description ?? undefined,
    is_recurring: overrides.isRecurring ? 1 : 0,
    recurrence_rule: overrides.recurrenceRule ?? undefined,
    meeting_url: meetingUrl,
    is_all_day: isAllDay,
    all_day_date: allDayDate,
  }
}

// Recurrence expansion window, measured from sync time.
const RECURRENCE_WINDOW_BACK_DAYS = 60
const RECURRENCE_WINDOW_FORWARD_DAYS = 90
const DAY_MS = 24 * 60 * 60 * 1000
// Cap emitted occurrences per series per window; a pathological RRULE (e.g. an
// hourly rule with no COUNT/UNTIL) is truncated with a warning rather than
// materializing unbounded rows.
const MAX_OCCURRENCES_PER_SERIES = 400
// Hard safety bound on iterator steps regardless of window, so a series anchored
// far in the past cannot spin indefinitely before reaching the window.
const MAX_ITERATOR_STEPS = 20000

/**
 * Stable per-occurrence meeting id.
 *
 * The occurrence at the series master's own DTSTART keeps the bare `uid` — this
 * is exactly what the pre-expansion code stored for a recurring master, so the
 * existing single-instance row (and any recordings / contacts / projects linked
 * to it) is UPDATEd in place rather than orphaned. Every other occurrence is
 * keyed `${uid}::${slotISO}` on its scheduled-slot instant, which is stable
 * across re-syncs (the master DTSTART does not move), so repeated syncs UPSERT
 * instead of duplicating.
 */
function occurrenceId(uid: string, slotMs: number, masterStartMs: number): string {
  return slotMs === masterStartMs ? uid : `${uid}::${new Date(slotMs).toISOString()}`
}

/**
 * Expand a recurring master (plus its RECURRENCE-ID overrides and EXDATE
 * exclusions) into per-occurrence meeting rows within the sync window.
 *
 * `materializedInstances` are same-UID VEVENTs that carry neither an RRULE nor a
 * RECURRENCE-ID — some Outlook-published ICS feeds emit a standalone VEVENT for a
 * near-term occurrence *in addition* to the master's RRULE. They are folded into
 * the per-slot map keyed on their DTSTART so a slot the RRULE already covers
 * yields ONE row (preferring the materialized data), never a bare-uid twin.
 */
function expandMaster(
  master: CalendarEvent,
  overrides: CalendarEvent[],
  windowStartMs: number,
  windowEndMs: number,
  materializedInstances: CalendarEvent[] = []
): Omit<Meeting, 'created_at' | 'updated_at'>[] {
  const rows: Omit<Meeting, 'created_at' | 'updated_at'>[] = []
  const uid = master.uid
  const masterStartMs = master.startTime.getTime()
  const durationMs = master.endTime.getTime() - master.startTime.getTime()
  const recurrenceRule = master.recurrence

  const exdateSet = new Set((master.exdates ?? []).map((d) => d.getTime()))
  const overrideBySlot = new Map<number, CalendarEvent>()
  for (const o of overrides) {
    if (o.recurrenceId) overrideBySlot.set(o.recurrenceId.getTime(), o)
  }
  // Materialized instances are keyed on their DTSTART. A RECURRENCE-ID override
  // for the same slot always wins over a bare materialized instance.
  const materializedBySlot = new Map<number, CalendarEvent>()
  for (const mi of materializedInstances) {
    const slot = mi.startTime.getTime()
    if (!overrideBySlot.has(slot)) materializedBySlot.set(slot, mi)
  }

  // Returns the next occurrence instant, or null when the rule is exhausted.
  // ical.js types iterator.next() as always returning a Time, but at runtime it
  // yields a falsy value once COUNT/UNTIL (or the internal limit) is reached.
  let nextOccurrence: () => Date | null
  try {
    const recur = ICAL.Recur.fromString(master.recurrence as string)
    const icalStart = ICAL.Time.fromJSDate(master.startTime, true)
    const iter = recur.iterator(icalStart)
    nextOccurrence = () => {
      const t = iter.next() as unknown as { toJSDate(): Date } | null | undefined
      return t ? t.toJSDate() : null
    }
  } catch (e) {
    // RRULE we can't parse: fall back to the pre-expansion behavior (emit the
    // master once) so the series never disappears, then still apply overrides.
    console.warn(`[calendar-sync] Failed to expand RRULE for ${uid}; emitting master only:`, e)
    rows.push(calendarEventToMeetingRow(master))
    for (const o of overrides) {
      if (!o.recurrenceId) continue
      rows.push(
        buildMeetingRow(o, {
          id: occurrenceId(uid, o.recurrenceId.getTime(), masterStartMs),
          startTime: o.startTime,
          endTime: o.endTime,
          isRecurring: true,
          recurrenceRule,
        })
      )
    }
    for (const [slot, mi] of materializedBySlot) {
      rows.push(
        buildMeetingRow(mi, {
          id: occurrenceId(uid, slot, masterStartMs),
          startTime: mi.startTime,
          endTime: mi.endTime,
          isRecurring: true,
          recurrenceRule,
        })
      )
    }
    return rows
  }

  const emittedSlots = new Set<number>()
  let inWindowCount = 0
  let steps = 0
  let capped = false

  let occurrence = nextOccurrence()
  while (occurrence) {
    if (++steps > MAX_ITERATOR_STEPS) {
      capped = true
      break
    }
    const slotMs = occurrence.getTime()
    if (slotMs > windowEndMs) break

    if (slotMs >= windowStartMs && !exdateSet.has(slotMs)) {
      if (inWindowCount >= MAX_OCCURRENCES_PER_SERIES) {
        capped = true
        break
      }
      // Prefer a RECURRENCE-ID override, then a bare materialized instance, then
      // the plain RRULE projection — so a slot described by several VEVENTs still
      // yields exactly one row (the most specific data wins).
      const override = overrideBySlot.get(slotMs)
      const materialized = materializedBySlot.get(slotMs)
      if (override) {
        rows.push(
          buildMeetingRow(override, {
            id: occurrenceId(uid, slotMs, masterStartMs),
            startTime: override.startTime,
            endTime: override.endTime,
            isRecurring: true,
            recurrenceRule,
          })
        )
      } else if (materialized) {
        rows.push(
          buildMeetingRow(materialized, {
            id: occurrenceId(uid, slotMs, masterStartMs),
            startTime: materialized.startTime,
            endTime: materialized.endTime,
            isRecurring: true,
            recurrenceRule,
          })
        )
      } else {
        rows.push(
          buildMeetingRow(master, {
            id: occurrenceId(uid, slotMs, masterStartMs),
            startTime: new Date(slotMs),
            endTime: new Date(slotMs + durationMs),
            isRecurring: true,
            recurrenceRule,
          })
        )
      }
      emittedSlots.add(slotMs)
      inWindowCount++
    }
    occurrence = nextOccurrence()
  }

  // Overrides whose original slot the iterator never produced (e.g. a moved
  // instance, or a slot outside the stepped range) still need a row when their
  // actual time lands inside the window — otherwise a rescheduled occurrence
  // would vanish.
  for (const o of overrides) {
    if (!o.recurrenceId) continue
    const slotMs = o.recurrenceId.getTime()
    if (emittedSlots.has(slotMs)) continue
    const oStartMs = o.startTime.getTime()
    if (oStartMs >= windowStartMs && oStartMs <= windowEndMs) {
      rows.push(
        buildMeetingRow(o, {
          id: occurrenceId(uid, slotMs, masterStartMs),
          startTime: o.startTime,
          endTime: o.endTime,
          isRecurring: true,
          recurrenceRule,
        })
      )
      emittedSlots.add(slotMs)
    }
  }

  // Materialized instances the iterator never landed on (their DTSTART is not on
  // the RRULE cadence, or lies past the stepped range) still need a row when in
  // window — keyed on their DTSTART so they dedupe with any RRULE slot.
  for (const [slotMs, mi] of materializedBySlot) {
    if (emittedSlots.has(slotMs)) continue
    if (slotMs >= windowStartMs && slotMs <= windowEndMs && !exdateSet.has(slotMs)) {
      rows.push(
        buildMeetingRow(mi, {
          id: occurrenceId(uid, slotMs, masterStartMs),
          startTime: mi.startTime,
          endTime: mi.endTime,
          isRecurring: true,
          recurrenceRule,
        })
      )
      emittedSlots.add(slotMs)
    }
  }

  if (capped) {
    console.warn(
      `[calendar-sync] Recurring series ${uid} hit the occurrence cap ` +
        `(${MAX_OCCURRENCES_PER_SERIES}/window); remaining occurrences were truncated.`
    )
  }

  return rows
}

/**
 * Expand parsed calendar events into DB meeting rows, materializing recurring
 * series into individual occurrences. Non-recurring events pass through
 * unchanged (id === uid). Exported for unit testing.
 */
export function expandMeetingOccurrences(
  events: CalendarEvent[],
  now: Date = new Date()
): Omit<Meeting, 'created_at' | 'updated_at'>[] {
  const windowStartMs = now.getTime() - RECURRENCE_WINDOW_BACK_DAYS * DAY_MS
  const windowEndMs = now.getTime() + RECURRENCE_WINDOW_FORWARD_DAYS * DAY_MS

  // Group VEVENTs sharing a UID: a recurring series is one master (has RRULE,
  // no RECURRENCE-ID) plus zero or more overrides (each has RECURRENCE-ID).
  const groups = new Map<string, CalendarEvent[]>()
  for (const event of events) {
    const arr = groups.get(event.uid)
    if (arr) arr.push(event)
    else groups.set(event.uid, [event])
  }

  const rows: Omit<Meeting, 'created_at' | 'updated_at'>[] = []
  for (const group of groups.values()) {
    const master = group.find((e) => e.recurrence && !e.recurrenceId)
    if (!master) {
      // No recurring master in this group → emit every event unchanged, exactly
      // as before expansion existed. Preserves non-recurring behavior.
      for (const e of group) rows.push(calendarEventToMeetingRow(e))
      continue
    }

    const overrides = group.filter((e) => e.recurrenceId)
    // Same-uid VEVENTs that are neither the master nor RECURRENCE-ID overrides
    // are materialized single-instance occurrences the feed emitted alongside the
    // RRULE. Fold them into the expansion (keyed by slot) so they never produce a
    // bare-uid twin of an occurrence the RRULE already covers.
    const materializedInstances = group.filter((e) => e !== master && !e.recurrenceId)
    rows.push(...expandMaster(master, overrides, windowStartMs, windowEndMs, materializedInstances))
  }

  return rows
}

/**
 * One sync pass, plus the cancellation tokens of every caller attached to it.
 * The pass runs while ANY attached caller still wants it, so a joined manual
 * sync is not cancelled just because the scheduled sync it joined was.
 */
interface SyncPass {
  promise: Promise<CalendarSyncResult>
  waiters: Array<() => boolean>
}

/** The sync currently running (or queued); null when idle. */
let currentPass: SyncPass | null = null

/** True while a sync is running or queued. */
export function isCalendarSyncActive(): boolean {
  return currentPass !== null
}

/**
 * Sync the calendar from an ICS feed.
 *
 * ## Serialization (F15)
 *
 * Concurrent syncs were real, not theoretical: the main process starts one at
 * boot (`initializeCalendarAutoSync`) while the renderer fires another from
 * `Layout`'s mount effect, and the periodic `setInterval` could stack a third on
 * top of a slow pass. Each runs a full fetch → parse → recurrence expansion →
 * chunked DB write → `reconcileOrganization()` on the same main-process event
 * loop. Overlapping passes are pure duplicated load on the thread that also has
 * to answer every renderer IPC.
 *
 * Callers now JOIN an in-flight sync instead of starting a second one; they all
 * wanted "the calendar, current", and one pass gives everyone that. `fresh: true`
 * opts out for clear-and-sync, which must not be handed a result produced before
 * its clear.
 *
 * Syncs also wait for the boot drain (`waitForBootMs`) so a startup or periodic
 * sync cannot land on top of the boot tasks.
 */
export async function syncCalendar(
  icsUrl: string,
  options: CalendarSyncOptions = {}
): Promise<CalendarSyncResult> {
  const wanted = options.isStillWanted ?? (() => true)
  const previous = currentPass

  // Join the pass already under way, contributing this caller's token to it.
  if (previous && !options.fresh) {
    previous.waiters.push(wanted)
    return previous.promise
  }

  const waiters: Array<() => boolean> = [wanted]
  const pass = { waiters } as SyncPass
  pass.promise = (async () => {
    // A `fresh` pass still must not overlap the sync it displaces.
    if (previous) {
      try {
        await previous.promise
      } catch {
        /* the previous pass failing must not cancel this one */
      }
    }
    return runSyncCalendar(icsUrl, options, () => waiters.some((isWanted) => isWanted()))
  })()

  currentPass = pass
  try {
    return await pass.promise
  } finally {
    if (currentPass === pass) currentPass = null
  }
}

/** Result for a pass abandoned before it wrote anything. */
function cancelledResult(): CalendarSyncResult {
  return {
    success: false,
    meetingsCount: 0,
    error: 'Calendar sync cancelled before it made any changes',
    errorCategory: 'cancelled'
  }
}

async function runSyncCalendar(
  icsUrl: string,
  options: CalendarSyncOptions,
  stillWanted: () => boolean
): Promise<CalendarSyncResult> {
  const { emitActivityLog } = await import('./activity-log')

  // F15: never compete with the boot tasks for the main-process event loop.
  const waitForBootMs = options.waitForBootMs ?? BOOT_WAIT_MS
  if (waitForBootMs > 0 && !areBootTasksSettled()) {
    // Tell the user why nothing is happening yet. This covers the whole wait,
    // including the window before the scheduler has started draining — which is
    // exactly when the boot-time syncs arrive.
    emitActivityLog('info', 'Calendar sync queued', 'Waiting for startup tasks to finish')
    await whenBootTasksSettled(waitForBootMs)
  }

  // The wait above can be long, and auto-sync may have been disabled or
  // reconfigured during it. Nothing has been written yet, so bail cleanly.
  if (!stillWanted()) {
    console.log('Calendar sync abandoned: its schedule was stopped while it waited')
    return cancelledResult()
  }

  console.log('Starting calendar sync...')
  emitActivityLog('info', 'Syncing calendar...', 'Fetching calendar events')

  try {
    // Validate URL to prevent SSRF attacks
    const validation = validateCalendarUrl(icsUrl)
    if (!validation.valid) {
      emitActivityLog('error', 'Calendar sync failed', validation.error ?? 'Invalid URL')
      return {
        success: false,
        meetingsCount: 0,
        error: validation.error,
        errorCategory: 'validation'
      }
    }

    // Fetch ICS file, retrying transient resets/timeouts with backoff (F15).
    const response = await fetchIcsWithRetry(
      icsUrl,
      Math.max(1, options.fetchAttempts ?? DEFAULT_FETCH_ATTEMPTS),
      options.fetchBaseDelayMs ?? DEFAULT_FETCH_BASE_DELAY_MS
    )

    const icsData = await response.text()

    // First side effect of the pass — nothing has touched disk before this.
    if (!stillWanted()) return cancelledResult()

    // CS-009: Use async writeFile to avoid blocking the event loop
    const cachePath = join(getCachePath(), 'calendar.ics')
    const { writeFile } = await import('fs/promises')
    await writeFile(cachePath, icsData, 'utf-8')

    // Yield before heavy parsing
    await yieldToEventLoop()

    // Parse ICS using shared package, then adapt to DB meeting shape
    const meetings = await parseICSAsync(icsData)

    // Yield before heavy database work
    await yieldToEventLoop()

    // Last checkpoint before the DB is touched. Past this the pass has committed
    // rows, so it runs to completion rather than leaving a half-applied sync.
    if (!stillWanted()) return cancelledResult()

    // CS/H7 FIX: Write meetings in chunks, yielding to the event loop between
    // chunks, so the sync never blocks the main process for a long stretch.
    // A single transaction over ~1800 meetings held the main thread long enough
    // that ALL IPC (recordings list, meeting lookups, refresh) stalled — the
    // renderer appeared frozen, row chrome vanished and Refresh spun. Chunking
    // keeps each transaction short and lets pending IPC run in between.
    // Trade-off: per-chunk transactions instead of one all-or-nothing transaction;
    // a mid-sync failure can leave earlier chunks committed, which is acceptable
    // because the next sync re-upserts every meeting idempotently.
    const DB_CHUNK_SIZE = 200
    try {
      for (let i = 0; i < meetings.length; i += DB_CHUNK_SIZE) {
        upsertMeetingsBatch(meetings.slice(i, i + DB_CHUNK_SIZE))
        if (i + DB_CHUNK_SIZE < meetings.length) {
          await yieldToEventLoop()
        }
      }
    } catch (dbError) {
      console.error('Failed to save meetings to database:', dbError)
      throw new Error(`Database error: ${dbError instanceof Error ? dbError.message : 'Unknown database error'}`)
    }

    // Tie the new meetings into the rest of the app: auto-link overlapping
    // recordings and create People from attendees. Non-fatal.
    try {
      const { reconcileOrganization } = await import('./org-reconciler')
      reconcileOrganization()
    } catch (reconcileError) {
      console.error('Post-sync reconciliation failed:', reconcileError)
    }

    // Update last sync time in config and persist it
    const now = new Date().toISOString()
    try {
      await updateConfig('calendar', { lastSyncAt: now })
    } catch (configError) {
      console.error('Failed to persist sync timestamp:', configError)
      // Meetings already saved - timestamp will catch up on next sync
    }

    console.log(`Calendar sync complete: ${meetings.length} meetings`)
    emitActivityLog('success', 'Calendar sync complete', `Loaded ${meetings.length} meetings`)

    // Signal the renderer that meetings changed so surfaces that loaded their
    // meeting list once (Today briefing, Calendar view) can refetch. Without
    // this, a boot/background sync silently leaves those views showing the
    // pre-sync list. Non-fatal — a failed emit must never fail the sync.
    try {
      const { getEventBus } = await import('./event-bus')
      getEventBus().emitDomainEvent({
        type: 'calendar:synced',
        timestamp: now,
        payload: { meetingsCount: meetings.length }
      })
    } catch (emitError) {
      console.error('Failed to emit calendar:synced event:', emitError)
    }

    return {
      success: true,
      meetingsCount: meetings.length,
      lastSync: now
    }
  } catch (error) {
    console.error('Calendar sync failed:', error)
    const categorized = categorizeCalendarError(error)
    emitActivityLog('error', 'Calendar sync failed', categorized.message)
    return {
      success: false,
      meetingsCount: 0,
      error: categorized.message,
      errorCategory: categorized.category
    }
  }
}

/**
 * Parse ICS content using the shared @hidock/calendar-sync package, yielding to
 * the event loop periodically to keep the UI responsive for large calendars.
 *
 * Returns DB meeting rows (Omit<Meeting, 'created_at' | 'updated_at'>).
 */
export async function parseICSAsync(icsData: string): Promise<Omit<Meeting, 'created_at' | 'updated_at'>[]> {
  // Parse using shared package (synchronous, but fast for typical feeds)
  const events = parseICS(icsData)

  // Yield before expansion so a large feed doesn't block the parse→expand gap.
  await yieldToEventLoop()

  // Expand recurring series into individual occurrences within the sync window.
  // Non-recurring events pass through unchanged.
  return expandMeetingOccurrences(events)
}

export function getLastSyncTime(): string | null {
  const config = getConfig()
  return config.calendar.lastSyncAt
}
