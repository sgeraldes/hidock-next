import { parentPort, workerData } from 'worker_threads'
import ICAL from 'ical.js'

interface MeetingData {
  id: string
  subject: string
  start_time: string
  end_time: string
  location?: string
  organizer_name?: string
  organizer_email?: string
  attendees?: string
  description?: string
  is_recurring: number
  recurrence_rule?: string
  meeting_url?: string
}

function parseICSInWorker(icsData: string): MeetingData[] {
  const jcalData = ICAL.parse(icsData)
  const vcalendar = new ICAL.Component(jcalData)
  const vevents = vcalendar.getAllSubcomponents('vevent')

  const meetings: MeetingData[] = []

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
        // If recurrence expansion fails, just add the base event
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

// Worker entry point
if (parentPort) {
  try {
    const icsData = workerData as string
    const meetings = parseICSInWorker(icsData)
    parentPort.postMessage({ success: true, meetings })
  } catch (error) {
    parentPort.postMessage({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown parsing error'
    })
  }
}
