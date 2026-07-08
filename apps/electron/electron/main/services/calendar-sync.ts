import { parseICS, correlate } from '@hidock/calendar-sync'
import type { CalendarEvent } from '@hidock/calendar-sync'
import ICAL from 'ical.js'
import { join } from 'path'
import { getCachePath } from './file-storage'
import { upsertMeetingsBatch, Meeting } from './database'
import { getConfig, updateConfig } from './config'

// Re-export package types and correlate for consumers (e.g. recording-watcher)
export { correlate }
export type { CalendarEvent }

// B-CAL-004: Error category for calendar sync failures
// CS-003: Added 'auth' category for 401/403 errors
export type CalendarErrorCategory = 'network' | 'parse' | 'database' | 'validation' | 'auth' | 'unknown'

export interface CalendarSyncResult {
  success: boolean
  meetingsCount: number
  error?: string
  errorCategory?: CalendarErrorCategory
  lastSync?: string
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

  // Network errors
  if (
    message.includes('fetch') ||
    message.includes('ECONNREFUSED') ||
    message.includes('ENOTFOUND') ||
    message.includes('ETIMEDOUT') ||
    message.includes('network') ||
    message.includes('Failed to fetch') ||
    message.includes('ERR_NETWORK') ||
    /^Failed to fetch calendar: \d+/.test(message)
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
    start_time: overrides.startTime.toISOString(),
    end_time: overrides.endTime.toISOString(),
    location: event.location ?? undefined,
    // Organizer restored from the package's parsed ORGANIZER property
    organizer_name: event.organizer?.name ?? undefined,
    organizer_email: event.organizer?.email ?? undefined,
    attendees: attendeesJson,
    description: event.description ?? undefined,
    is_recurring: overrides.isRecurring ? 1 : 0,
    recurrence_rule: overrides.recurrenceRule ?? undefined,
    meeting_url: meetingUrl,
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
 */
function expandMaster(
  master: CalendarEvent,
  overrides: CalendarEvent[],
  windowStartMs: number,
  windowEndMs: number
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
      const override = overrideBySlot.get(slotMs)
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
    rows.push(...expandMaster(master, overrides, windowStartMs, windowEndMs))

    // Any stray same-uid events that are neither the master nor overrides are
    // emitted unchanged so nothing is silently dropped.
    for (const e of group) {
      if (e === master || e.recurrenceId) continue
      rows.push(calendarEventToMeetingRow(e))
    }
  }

  return rows
}

export async function syncCalendar(icsUrl: string): Promise<CalendarSyncResult> {
  console.log('Starting calendar sync...')
  const { emitActivityLog } = await import('./activity-log')
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

    // Fetch ICS file
    const response = await fetch(icsUrl)

    if (!response.ok) {
      throw new Error(`Failed to fetch calendar: ${response.status} ${response.statusText}`)
    }

    const icsData = await response.text()

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

    // Upsert all meetings atomically in a single transaction
    // This ensures all-or-nothing behavior - if any meeting fails, all are rolled back
    try {
      upsertMeetingsBatch(meetings)
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
