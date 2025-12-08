import ICAL from 'ical.js'
import { writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { getCachePath } from './file-storage'
import { upsertMeeting, Meeting, updateConfig } from './database'
import { getConfig } from './config'

export interface CalendarSyncResult {
  success: boolean
  meetingsCount: number
  error?: string
  lastSync?: string
}

// Helper to yield to event loop and prevent UI blocking
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

export async function syncCalendar(icsUrl: string): Promise<CalendarSyncResult> {
  console.log('Starting calendar sync...')

  try {
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

    // Upsert meetings to database in batches
    const BATCH_SIZE = 50
    for (let i = 0; i < meetings.length; i += BATCH_SIZE) {
      const batch = meetings.slice(i, i + BATCH_SIZE)
      for (const meeting of batch) {
        upsertMeeting(meeting)
      }
      // Yield between batches to prevent blocking
      if (i + BATCH_SIZE < meetings.length) {
        await yieldToEventLoop()
      }
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
    const startDate = event.startDate?.toJSDate()
    const endDate = event.endDate?.toJSDate()

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
          const occurrenceDate = next.toJSDate()

          // Only include future occurrences (and recent past)
          const pastLimit = new Date()
          pastLimit.setMonth(pastLimit.getMonth() - 1)

          if (occurrenceDate >= pastLimit && occurrenceDate <= futureLimit) {
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
  const vevents = vcalendar.getAllSubcomponents('vevent')

  const meetings: Omit<Meeting, 'created_at' | 'updated_at'>[] = []
  const YIELD_INTERVAL = 20 // Yield every N events to prevent blocking

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
    const startDate = event.startDate?.toJSDate()
    const endDate = event.endDate?.toJSDate()

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
          const occurrenceDate = next.toJSDate()
          const pastLimit = new Date()
          pastLimit.setMonth(pastLimit.getMonth() - 1)

          if (occurrenceDate >= pastLimit && occurrenceDate <= futureLimit) {
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
