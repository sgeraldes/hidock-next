import ICAL from 'ical.js'
import { writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { getCachePath } from './file-storage'
import { upsertMeetingsBatch, Meeting } from './database'
import { getConfig } from './config'

/**
 * Windows timezone names to UTC offset in seconds.
 * Used as fallback when VTIMEZONE component is missing from ICS.
 * Offsets are for standard time (not DST).
 */
const WINDOWS_TIMEZONE_OFFSETS: Record<string, number> = {
  // Americas
  'Pacific Standard Time': -8 * 3600,
  'Mountain Standard Time': -7 * 3600,
  'Central Standard Time': -6 * 3600,
  'Central Standard Time (Mexico)': -6 * 3600,
  'Central America Standard Time': -6 * 3600, // Guatemala, Costa Rica, etc.
  'Eastern Standard Time': -5 * 3600,
  'SA Pacific Standard Time': -5 * 3600, // Colombia, Peru, Ecuador
  'Venezuela Standard Time': -4 * 3600,
  'SA Western Standard Time': -4 * 3600, // Bolivia, Guyana
  'Atlantic Standard Time': -4 * 3600,
  'Paraguay Standard Time': -4 * 3600,
  'Pacific SA Standard Time': -3 * 3600, // Chile (Santiago)
  'SA Eastern Standard Time': -3 * 3600, // Brazil (Brasilia), French Guiana
  'Argentina Standard Time': -3 * 3600,
  'E. South America Standard Time': -3 * 3600, // Brazil (Brasilia)
  'Greenland Standard Time': -3 * 3600,
  'Montevideo Standard Time': -3 * 3600, // Uruguay
  'Newfoundland Standard Time': -3.5 * 3600,

  // Europe & Africa
  'GMT Standard Time': 0,
  'Greenwich Standard Time': 0,
  'UTC': 0,
  'W. Europe Standard Time': 1 * 3600,
  'Central Europe Standard Time': 1 * 3600,
  'Central European Standard Time': 1 * 3600,
  'Romance Standard Time': 1 * 3600, // France, Belgium, Spain
  'W. Central Africa Standard Time': 1 * 3600,
  'E. Europe Standard Time': 2 * 3600,
  'GTB Standard Time': 2 * 3600, // Greece, Turkey, Bulgaria
  'FLE Standard Time': 2 * 3600, // Finland, Lithuania, Estonia
  'South Africa Standard Time': 2 * 3600,
  'Israel Standard Time': 2 * 3600,
  'Egypt Standard Time': 2 * 3600,
  'Jordan Standard Time': 3 * 3600,
  'Arabic Standard Time': 3 * 3600, // Iraq
  'Arab Standard Time': 3 * 3600, // Kuwait, Riyadh
  'E. Africa Standard Time': 3 * 3600,
  'Russian Standard Time': 3 * 3600,
  'Iran Standard Time': 3.5 * 3600,

  // Asia & Pacific
  'Arabian Standard Time': 4 * 3600, // Abu Dhabi, Dubai
  'Azerbaijan Standard Time': 4 * 3600,
  'Georgian Standard Time': 4 * 3600,
  'Afghanistan Standard Time': 4.5 * 3600,
  'West Asia Standard Time': 5 * 3600, // Pakistan
  'Pakistan Standard Time': 5 * 3600,
  'India Standard Time': 5.5 * 3600,
  'Sri Lanka Standard Time': 5.5 * 3600,
  'Nepal Standard Time': 5.75 * 3600,
  'Central Asia Standard Time': 6 * 3600, // Kazakhstan
  'Bangladesh Standard Time': 6 * 3600,
  'Myanmar Standard Time': 6.5 * 3600,
  'SE Asia Standard Time': 7 * 3600, // Thailand, Vietnam
  'North Asia Standard Time': 7 * 3600,
  'China Standard Time': 8 * 3600,
  'Singapore Standard Time': 8 * 3600,
  'W. Australia Standard Time': 8 * 3600,
  'Taipei Standard Time': 8 * 3600,
  'Korea Standard Time': 9 * 3600,
  'Tokyo Standard Time': 9 * 3600,
  'AUS Central Standard Time': 9.5 * 3600,
  'Cen. Australia Standard Time': 9.5 * 3600,
  'AUS Eastern Standard Time': 10 * 3600,
  'E. Australia Standard Time': 10 * 3600,
  'West Pacific Standard Time': 10 * 3600,
  'Tasmania Standard Time': 10 * 3600,
  'Central Pacific Standard Time': 11 * 3600,
  'New Zealand Standard Time': 12 * 3600,
  'Fiji Standard Time': 12 * 3600,
  'Tonga Standard Time': 13 * 3600,

  // Additional common names
  'Customized Time Zone': -5 * 3600, // Default to something reasonable
}

export interface CalendarSyncResult {
  success: boolean
  meetingsCount: number
  error?: string
  lastSync?: string
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

    // Block file:// and other protocols
    if (parsed.protocol === 'file:') {
      return { valid: false, error: 'File URLs are not allowed for calendar sync' }
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
 * Register all VTIMEZONE components from a calendar with ICAL.TimezoneService.
 * This is critical for proper timezone conversion - without registration,
 * toJSDate() ignores TZID parameters and returns incorrect times.
 */
function registerTimezones(vcalendar: ICAL.Component): void {
  const vtimezones = vcalendar.getAllSubcomponents('vtimezone')

  for (const vtimezone of vtimezones) {
    try {
      const tzid = vtimezone.getFirstPropertyValue('tzid')
      if (tzid && typeof tzid === 'string') {
        // Check if already registered to avoid redundant work
        const existing = ICAL.TimezoneService.get(tzid)
        if (!existing) {
          const tz = new ICAL.Timezone(vtimezone)
          ICAL.TimezoneService.register(tzid, tz)
          console.log(`[Calendar] Registered timezone: ${tzid}`)
        }
      }
    } catch (e) {
      console.warn('[Calendar] Failed to register timezone:', e)
    }
  }
}

/**
 * Safely convert ICAL.Time to JavaScript Date with proper timezone handling.
 *
 * ICAL.js's toJSDate() has known issues with some timezones, even when registered.
 * This function uses toUnixTime() which is more reliable as it directly calculates
 * the UTC offset using the registered timezone's rules.
 *
 * For floating times (no timezone), we check if there's a TZID parameter that
 * wasn't recognized and use our Windows timezone fallback map.
 *
 * @param icalTime - The ICAL.Time object to convert
 * @param tzidHint - Optional TZID hint from the property (for fallback when zone is floating)
 */
function safeToJSDate(icalTime: ICAL.Time | null | undefined, tzidHint?: string): Date | null {
  if (!icalTime) return null

  try {
    // Check if this is a date-only value (all-day event)
    if (icalTime.isDate) {
      // For all-day events, use local date at midnight
      return new Date(icalTime.year, icalTime.month - 1, icalTime.day, 0, 0, 0, 0)
    }

    // Get the timezone
    const zone = icalTime.zone

    // For floating time (no timezone specified), check for fallback
    if (!zone || zone.tzid === 'floating' || zone === ICAL.Timezone.localTimezone) {
      // Try to use the tzidHint if we have one and it's in our fallback map
      if (tzidHint && WINDOWS_TIMEZONE_OFFSETS[tzidHint] !== undefined) {
        const utcOffset = WINDOWS_TIMEZONE_OFFSETS[tzidHint]

        // Build the local time as if it were UTC
        const localTimeAsUtc = Date.UTC(
          icalTime.year,
          icalTime.month - 1,
          icalTime.day,
          icalTime.hour,
          icalTime.minute,
          icalTime.second
        )

        // Subtract the UTC offset to get actual UTC time
        const utcTime = localTimeAsUtc - (utcOffset * 1000)
        const jsDate = new Date(utcTime)

        console.log(`[Calendar] Fallback timezone conversion: ${icalTime.year}-${icalTime.month}-${icalTime.day} ${icalTime.hour}:${icalTime.minute} (${tzidHint}, offset=${utcOffset}s) -> UTC: ${jsDate.toISOString()} (local: ${jsDate.toLocaleTimeString()})`)

        return jsDate
      }

      // No fallback available, use local time
      return new Date(
        icalTime.year,
        icalTime.month - 1,
        icalTime.day,
        icalTime.hour,
        icalTime.minute,
        icalTime.second
      )
    }

    // For UTC timezone, construct UTC date directly
    if (zone === ICAL.Timezone.utcTimezone || zone.tzid === 'UTC') {
      return new Date(Date.UTC(
        icalTime.year,
        icalTime.month - 1,
        icalTime.day,
        icalTime.hour,
        icalTime.minute,
        icalTime.second
      ))
    }

    // For named timezones, get the UTC offset from the timezone definition
    // Then construct the proper UTC time
    try {
      // Get the UTC offset for this specific time in this timezone
      // The offset is in seconds (negative = west of UTC)
      const utcOffset = zone.utcOffset(icalTime)

      // Build the local time as a Date (treating it as UTC first)
      const localTimeAsUtc = Date.UTC(
        icalTime.year,
        icalTime.month - 1,
        icalTime.day,
        icalTime.hour,
        icalTime.minute,
        icalTime.second
      )

      // Subtract the UTC offset to get actual UTC time
      // If Lima is UTC-5, offset is -18000 seconds
      // Local 12:00 - (-18000s) = Local 12:00 + 18000s = UTC 17:00 ✓
      const utcTime = localTimeAsUtc - (utcOffset * 1000)
      const jsDate = new Date(utcTime)

      console.debug(`[Calendar] Time conversion: ${icalTime.year}-${icalTime.month}-${icalTime.day} ${icalTime.hour}:${icalTime.minute} (${zone.tzid}, offset=${utcOffset}s) -> UTC: ${jsDate.toISOString()} (local: ${jsDate.toLocaleTimeString()})`)

      return jsDate
    } catch (offsetError) {
      console.warn(`[Calendar] Failed to get UTC offset for ${zone.tzid}, falling back to toUnixTime:`, offsetError)

      // Fallback to toUnixTime() which may or may not work correctly
      const unixTime = icalTime.toUnixTime()
      const jsDate = new Date(unixTime * 1000)

      // Sanity check: year should match
      const yearDiff = Math.abs(jsDate.getFullYear() - icalTime.year)
      if (yearDiff > 1) {
        console.warn(`[Calendar] toUnixTime() conversion failed for ${zone.tzid} (year off by ${yearDiff}), using local time interpretation`)
        return new Date(
          icalTime.year,
          icalTime.month - 1,
          icalTime.day,
          icalTime.hour,
          icalTime.minute,
          icalTime.second
        )
      }

      return jsDate
    }
  } catch (e) {
    console.warn('[Calendar] Error converting time, using local:', e)
    // Fallback to local time interpretation
    return new Date(
      icalTime.year,
      icalTime.month - 1,
      icalTime.day,
      icalTime.hour || 0,
      icalTime.minute || 0,
      icalTime.second || 0
    )
  }
}

export async function syncCalendar(icsUrl: string): Promise<CalendarSyncResult> {
  console.log('Starting calendar sync...')

  try {
    // Validate URL to prevent SSRF attacks
    const validation = validateCalendarUrl(icsUrl)
    if (!validation.valid) {
      return {
        success: false,
        meetingsCount: 0,
        error: validation.error
      }
    }

    // Fetch ICS file
    const response = await fetch(icsUrl)

    if (!response.ok) {
      throw new Error(`Failed to fetch calendar: ${response.status} ${response.statusText}`)
    }

    const icsData = await response.text()

    // Cache the ICS file locally
    const cachePath = join(getCachePath(), 'calendar.ics')
    writeFileSync(cachePath, icsData, 'utf-8')

    // Yield before heavy parsing
    await yieldToEventLoop()

    // Parse ICS (yields internally for large calendars)
    const meetings = await parseICSAsync(icsData)

    // Yield before heavy database work
    await yieldToEventLoop()

    // Upsert all meetings atomically in a single transaction
    // This ensures all-or-nothing behavior - if any meeting fails, all are rolled back
    try {
      upsertMeetingsBatch(meetings)
    } catch (dbError) {
      console.error('Failed to save meetings to database:', dbError)
      throw new Error(`Database error: ${dbError instanceof Error ? dbError.message : 'Unknown error'}`)
    }

    // Update last sync time in config
    const now = new Date().toISOString()

    console.log(`Calendar sync complete: ${meetings.length} meetings`)

    return {
      success: true,
      meetingsCount: meetings.length,
      lastSync: now
    }
  } catch (error) {
    console.error('Calendar sync failed:', error)
    return {
      success: false,
      meetingsCount: 0,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

export function parseICS(icsData: string): Omit<Meeting, 'created_at' | 'updated_at'>[] {
  const jcalData = ICAL.parse(icsData)
  const vcalendar = new ICAL.Component(jcalData)

  // Register timezones BEFORE processing events (critical for correct time conversion)
  registerTimezones(vcalendar)

  const vevents = vcalendar.getAllSubcomponents('vevent')

  const meetings: Omit<Meeting, 'created_at' | 'updated_at'>[] = []

  for (const vevent of vevents) {
    const event = new ICAL.Event(vevent)

    // Skip cancelled events
    if (event.status === 'CANCELLED') {
      continue
    }

    // Get basic properties
    const uid = event.uid
    const summary = event.summary || 'Untitled Meeting'

    // Get TZID hints from DTSTART/DTEND properties for fallback timezone handling
    // when VTIMEZONE component is missing from ICS
    const dtStartProp = vevent.getFirstProperty('dtstart')
    const dtEndProp = vevent.getFirstProperty('dtend')
    const startTzid = dtStartProp?.getParameter('tzid') as string | undefined
    const endTzid = dtEndProp?.getParameter('tzid') as string | undefined

    const startDate = safeToJSDate(event.startDate, startTzid)
    const endDate = safeToJSDate(event.endDate, endTzid)

    if (!uid || !startDate || !endDate) {
      continue
    }

    // Get optional properties
    const location = event.location || undefined
    const description = event.description || undefined

    // Get organizer
    const organizerProp = vevent.getFirstProperty('organizer')
    let organizerName: string | undefined
    let organizerEmail: string | undefined

    if (organizerProp) {
      organizerName = organizerProp.getParameter('cn') as string | undefined
      const mailto = organizerProp.getFirstValue()
      if (typeof mailto === 'string' && mailto.startsWith('mailto:')) {
        organizerEmail = mailto.substring(7)
      }
    }

    // Get attendees
    const attendeeProps = vevent.getAllProperties('attendee')
    const attendees: { name?: string; email?: string; status?: string }[] = []

    for (const attendee of attendeeProps) {
      const name = attendee.getParameter('cn') as string | undefined
      const mailto = attendee.getFirstValue()
      const partstat = attendee.getParameter('partstat') as string | undefined

      let email: string | undefined
      if (typeof mailto === 'string' && mailto.startsWith('mailto:')) {
        email = mailto.substring(7)
      }

      if (name || email) {
        attendees.push({
          name,
          email,
          status: partstat
        })
      }
    }

    // Check for recurring event
    const rrule = vevent.getFirstPropertyValue('rrule')
    const isRecurring = !!rrule
    let recurrenceRule: string | undefined

    if (rrule && typeof rrule.toString === 'function') {
      recurrenceRule = rrule.toString()
    }

    // Extract meeting URL from description or location
    let meetingUrl: string | undefined
    const urlPatterns = [
      /https:\/\/teams\.microsoft\.com\/[^\s<>]+/i,
      /https:\/\/[\w-]+\.zoom\.us\/[^\s<>]+/i,
      /https:\/\/meet\.google\.com\/[^\s<>]+/i,
      /https:\/\/[\w-]+\.webex\.com\/[^\s<>]+/i
    ]

    const textToSearch = `${description || ''} ${location || ''}`
    for (const pattern of urlPatterns) {
      const match = textToSearch.match(pattern)
      if (match) {
        meetingUrl = match[0]
        break
      }
    }

    // Handle recurring events - expand occurrences
    if (isRecurring && event.isRecurrenceException !== true) {
      try {
        const iterator = event.iterator()
        const maxOccurrences = 100 // Limit to prevent infinite expansion
        const now = new Date()
        const futureLimit = new Date()
        futureLimit.setMonth(futureLimit.getMonth() + 6) // 6 months ahead

        let count = 0
        let next = iterator.next()

        while (next && count < maxOccurrences) {
          const occurrenceDate = safeToJSDate(next, startTzid)

          // Only include future occurrences (and recent past)
          const pastLimit = new Date()
          pastLimit.setMonth(pastLimit.getMonth() - 1)

          if (occurrenceDate && occurrenceDate >= pastLimit && occurrenceDate <= futureLimit) {
            const duration = endDate.getTime() - startDate.getTime()
            const occurrenceEnd = new Date(occurrenceDate.getTime() + duration)

            meetings.push({
              id: `${uid}_${occurrenceDate.toISOString()}`,
              subject: summary,
              start_time: occurrenceDate.toISOString(),
              end_time: occurrenceEnd.toISOString(),
              location,
              organizer_name: organizerName,
              organizer_email: organizerEmail,
              attendees: attendees.length > 0 ? JSON.stringify(attendees) : undefined,
              description,
              is_recurring: 1,
              recurrence_rule: recurrenceRule,
              meeting_url: meetingUrl
            })
          }

          next = iterator.next()
          count++
        }
      } catch (e) {
        // If recurrence expansion fails, just add the base event
        console.warn('Failed to expand recurring event:', e)
        meetings.push({
          id: uid,
          subject: summary,
          start_time: startDate.toISOString(),
          end_time: endDate.toISOString(),
          location,
          organizer_name: organizerName,
          organizer_email: organizerEmail,
          attendees: attendees.length > 0 ? JSON.stringify(attendees) : undefined,
          description,
          is_recurring: 1,
          recurrence_rule: recurrenceRule,
          meeting_url: meetingUrl
        })
      }
    } else {
      // Non-recurring event
      meetings.push({
        id: uid,
        subject: summary,
        start_time: startDate.toISOString(),
        end_time: endDate.toISOString(),
        location,
        organizer_name: organizerName,
        organizer_email: organizerEmail,
        attendees: attendees.length > 0 ? JSON.stringify(attendees) : undefined,
        description,
        is_recurring: 0,
        recurrence_rule: undefined,
        meeting_url: meetingUrl
      })
    }
  }

  return meetings
}

// Async version that yields to event loop periodically to prevent UI blocking
export async function parseICSAsync(icsData: string): Promise<Omit<Meeting, 'created_at' | 'updated_at'>[]> {
  const jcalData = ICAL.parse(icsData)
  const vcalendar = new ICAL.Component(jcalData)

  // Register timezones BEFORE processing events (critical for correct time conversion)
  registerTimezones(vcalendar)

  const vevents = vcalendar.getAllSubcomponents('vevent')

  const meetings: Omit<Meeting, 'created_at' | 'updated_at'>[] = []
  const YIELD_INTERVAL = 5 // Yield every N events to keep UI responsive

  for (let eventIndex = 0; eventIndex < vevents.length; eventIndex++) {
    // Yield periodically to keep UI responsive
    if (eventIndex > 0 && eventIndex % YIELD_INTERVAL === 0) {
      await yieldToEventLoop()
    }

    const vevent = vevents[eventIndex]
    const event = new ICAL.Event(vevent)

    // Skip cancelled events
    if (event.status === 'CANCELLED') {
      continue
    }

    // Get basic properties
    const uid = event.uid
    const summary = event.summary || 'Untitled Meeting'

    // Get TZID hints from DTSTART/DTEND properties for fallback timezone handling
    // when VTIMEZONE component is missing from ICS
    const dtStartProp = vevent.getFirstProperty('dtstart')
    const dtEndProp = vevent.getFirstProperty('dtend')
    const startTzid = dtStartProp?.getParameter('tzid') as string | undefined
    const endTzid = dtEndProp?.getParameter('tzid') as string | undefined

    const startDate = safeToJSDate(event.startDate, startTzid)
    const endDate = safeToJSDate(event.endDate, endTzid)

    if (!uid || !startDate || !endDate) {
      continue
    }

    // Get optional properties
    const location = event.location || undefined
    const description = event.description || undefined

    // Get organizer
    const organizerProp = vevent.getFirstProperty('organizer')
    let organizerName: string | undefined
    let organizerEmail: string | undefined

    if (organizerProp) {
      organizerName = organizerProp.getParameter('cn') as string | undefined
      const mailto = organizerProp.getFirstValue()
      if (typeof mailto === 'string' && mailto.startsWith('mailto:')) {
        organizerEmail = mailto.substring(7)
      }
    }

    // Get attendees
    const attendeeProps = vevent.getAllProperties('attendee')
    const attendees: { name?: string; email?: string; status?: string }[] = []

    for (const attendee of attendeeProps) {
      const name = attendee.getParameter('cn') as string | undefined
      const mailto = attendee.getFirstValue()
      const partstat = attendee.getParameter('partstat') as string | undefined

      let email: string | undefined
      if (typeof mailto === 'string' && mailto.startsWith('mailto:')) {
        email = mailto.substring(7)
      }

      if (name || email) {
        attendees.push({ name, email, status: partstat })
      }
    }

    // Check for recurring event
    const rrule = vevent.getFirstPropertyValue('rrule')
    const isRecurring = !!rrule
    let recurrenceRule: string | undefined

    if (rrule && typeof rrule.toString === 'function') {
      recurrenceRule = rrule.toString()
    }

    // Extract meeting URL from description or location
    let meetingUrl: string | undefined
    const urlPatterns = [
      /https:\/\/teams\.microsoft\.com\/[^\s<>]+/i,
      /https:\/\/[\w-]+\.zoom\.us\/[^\s<>]+/i,
      /https:\/\/meet\.google\.com\/[^\s<>]+/i,
      /https:\/\/[\w-]+\.webex\.com\/[^\s<>]+/i
    ]

    const textToSearch = `${description || ''} ${location || ''}`
    for (const pattern of urlPatterns) {
      const match = textToSearch.match(pattern)
      if (match) {
        meetingUrl = match[0]
        break
      }
    }

    // Handle recurring events - expand occurrences
    if (isRecurring && event.isRecurrenceException !== true) {
      try {
        const iterator = event.iterator()
        const maxOccurrences = 100
        const futureLimit = new Date()
        futureLimit.setMonth(futureLimit.getMonth() + 6)

        let count = 0
        let next = iterator.next()

        while (next && count < maxOccurrences) {
          const occurrenceDate = safeToJSDate(next, startTzid)
          const pastLimit = new Date()
          pastLimit.setMonth(pastLimit.getMonth() - 1)

          if (occurrenceDate && occurrenceDate >= pastLimit && occurrenceDate <= futureLimit) {
            const duration = endDate.getTime() - startDate.getTime()
            const occurrenceEnd = new Date(occurrenceDate.getTime() + duration)

            meetings.push({
              id: `${uid}_${occurrenceDate.toISOString()}`,
              subject: summary,
              start_time: occurrenceDate.toISOString(),
              end_time: occurrenceEnd.toISOString(),
              location,
              organizer_name: organizerName,
              organizer_email: organizerEmail,
              attendees: attendees.length > 0 ? JSON.stringify(attendees) : undefined,
              description,
              is_recurring: 1,
              recurrence_rule: recurrenceRule,
              meeting_url: meetingUrl
            })
          }

          next = iterator.next()
          count++
        }
      } catch (e) {
        console.warn('Failed to expand recurring event:', e)
        meetings.push({
          id: uid,
          subject: summary,
          start_time: startDate.toISOString(),
          end_time: endDate.toISOString(),
          location,
          organizer_name: organizerName,
          organizer_email: organizerEmail,
          attendees: attendees.length > 0 ? JSON.stringify(attendees) : undefined,
          description,
          is_recurring: 1,
          recurrence_rule: recurrenceRule,
          meeting_url: meetingUrl
        })
      }
    } else {
      meetings.push({
        id: uid,
        subject: summary,
        start_time: startDate.toISOString(),
        end_time: endDate.toISOString(),
        location,
        organizer_name: organizerName,
        organizer_email: organizerEmail,
        attendees: attendees.length > 0 ? JSON.stringify(attendees) : undefined,
        description,
        is_recurring: 0,
        recurrence_rule: undefined,
        meeting_url: meetingUrl
      })
    }
  }

  return meetings
}

export function getLastSyncTime(): string | null {
  const config = getConfig()
  return config.calendar.lastSyncAt
}

export function loadCachedCalendar(): Omit<Meeting, 'created_at' | 'updated_at'>[] | null {
  const cachePath = join(getCachePath(), 'calendar.ics')

  if (!existsSync(cachePath)) {
    return null
  }

  try {
    const icsData = readFileSync(cachePath, 'utf-8')
    return parseICS(icsData)
  } catch (e) {
    console.error('Failed to load cached calendar:', e)
    return null
  }
}
