import { parseICS, correlate } from '@hidock/calendar-sync'
import type { CalendarEvent } from '@hidock/calendar-sync'
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
  } catch (e) {
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
    id: event.uid,
    subject: event.title || 'Untitled Meeting',
    start_time: event.startTime.toISOString(),
    end_time: event.endTime.toISOString(),
    location: event.location ?? undefined,
    // Organizer restored from the package's parsed ORGANIZER property
    organizer_name: event.organizer?.name ?? undefined,
    organizer_email: event.organizer?.email ?? undefined,
    attendees: attendeesJson,
    description: event.description ?? undefined,
    // Recurrence restored from the package's parsed RRULE
    is_recurring: event.isRecurring ? 1 : 0,
    recurrence_rule: event.recurrence ?? undefined,
    meeting_url: meetingUrl,
  }
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

  const meetings: Omit<Meeting, 'created_at' | 'updated_at'>[] = []
  const YIELD_INTERVAL = 5 // Yield every N events to keep UI responsive

  for (let i = 0; i < events.length; i++) {
    // Yield periodically to keep UI responsive
    if (i > 0 && i % YIELD_INTERVAL === 0) {
      await yieldToEventLoop()
    }

    meetings.push(calendarEventToMeetingRow(events[i]))
  }

  return meetings
}

export function getLastSyncTime(): string | null {
  const config = getConfig()
  return config.calendar.lastSyncAt
}
