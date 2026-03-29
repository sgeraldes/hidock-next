import type { CalendarAttendee, CalendarEvent } from './types.js'

/**
 * Unfold lines per RFC 5545 §3.1: continuation lines begin with a single
 * space or tab character and should be joined to the previous line.
 */
function unfoldLines(raw: string): string[] {
  // Normalize line endings to \n
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  // Join continuation lines (lines starting with space or tab)
  const unfolded = normalized.replace(/\n[ \t]/g, '')
  return unfolded.split('\n')
}

/**
 * Parse an ICS date/time string into a Date object.
 * Supported formats:
 *   - `20260329T140000Z`         (UTC)
 *   - `20260329T140000`          (local, treated as UTC)
 *   - `20260329`                 (date only, treated as UTC midnight)
 *   - `TZID=America/New_York:20260329T140000` (timezone prefix — parsed as local/UTC for simplicity)
 */
function parseICSDateTime(value: string): Date | null {
  // Strip optional TZID prefix (e.g. "TZID=America/New_York:20260329T140000")
  let dateStr = value
  const tzidColonIdx = dateStr.indexOf(':')
  if (tzidColonIdx !== -1 && dateStr.substring(0, tzidColonIdx).includes('=')) {
    dateStr = dateStr.substring(tzidColonIdx + 1)
  }

  // Date-only: YYYYMMDD
  if (/^\d{8}$/.test(dateStr)) {
    const y = parseInt(dateStr.substring(0, 4), 10)
    const m = parseInt(dateStr.substring(4, 6), 10) - 1
    const d = parseInt(dateStr.substring(6, 8), 10)
    return new Date(Date.UTC(y, m, d))
  }

  // Date-time: YYYYMMDDTHHmmss[Z]
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(dateStr)
  if (!match) return null

  const y = parseInt(match[1], 10)
  const m = parseInt(match[2], 10) - 1
  const d = parseInt(match[3], 10)
  const h = parseInt(match[4], 10)
  const min = parseInt(match[5], 10)
  const s = parseInt(match[6], 10)

  // Always use UTC — either explicitly (Z) or treat local as UTC for consistency
  return new Date(Date.UTC(y, m, d, h, min, s))
}

/**
 * Parse an ATTENDEE property value into a CalendarAttendee.
 * Format examples:
 *   `ATTENDEE;CN=John Doe:mailto:john@example.com`
 *   `ATTENDEE;CN="Jane Doe";ROLE=REQ-PARTICIPANT:mailto:jane@example.com`
 *   `ATTENDEE:mailto:anon@example.com`
 */
function parseAttendee(fullLine: string): CalendarAttendee | null {
  // Extract email from mailto:
  const mailtoIdx = fullLine.toLowerCase().indexOf('mailto:')
  if (mailtoIdx === -1) return null
  const email = fullLine.substring(mailtoIdx + 7).trim()
  if (!email) return null

  // Extract CN parameter
  let name: string | undefined
  const cnMatch = /;CN=("([^"]+)"|([^;:]+))/i.exec(fullLine)
  if (cnMatch) {
    name = (cnMatch[2] ?? cnMatch[3])?.trim()
  }

  return name ? { name, email } : { email }
}

/**
 * Parse an ICS string and return calendar events.
 */
export function parseICS(icsContent: string): CalendarEvent[] {
  if (!icsContent || !icsContent.trim()) return []

  const lines = unfoldLines(icsContent)
  const events: CalendarEvent[] = []

  let inEvent = false
  let uid = ''
  let title = ''
  let dtstart = ''
  let dtend = ''
  let location: string | undefined
  let description: string | undefined
  let attendees: CalendarAttendee[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (trimmed === 'BEGIN:VEVENT') {
      inEvent = true
      uid = ''
      title = ''
      dtstart = ''
      dtend = ''
      location = undefined
      description = undefined
      attendees = []
      continue
    }

    if (trimmed === 'END:VEVENT') {
      inEvent = false
      const startDate = dtstart ? parseICSDateTime(dtstart) : null
      const endDate = dtend ? parseICSDateTime(dtend) : null

      if (uid && startDate && endDate) {
        events.push({
          uid,
          title: title || '',
          startTime: startDate,
          endTime: endDate,
          attendees,
          ...(location !== undefined && { location }),
          ...(description !== undefined && { description }),
        })
      }
      continue
    }

    if (!inEvent) continue

    // Parse property. Properties have format NAME[;PARAM=VALUE...]:VALUE
    // but ATTENDEE lines include params before the colon-separated value.
    const upperLine = trimmed.toUpperCase()

    if (upperLine.startsWith('UID:')) {
      uid = trimmed.substring(4)
    } else if (upperLine.startsWith('SUMMARY:')) {
      title = trimmed.substring(8)
    } else if (upperLine.startsWith('LOCATION:')) {
      location = trimmed.substring(9)
    } else if (upperLine.startsWith('DESCRIPTION:')) {
      description = trimmed.substring(12)
    } else if (upperLine.startsWith('DTSTART')) {
      // DTSTART:20260329T140000Z  or  DTSTART;TZID=...:20260329T140000
      const colonIdx = trimmed.indexOf(':')
      if (colonIdx !== -1) {
        const afterColon = trimmed.substring(colonIdx + 1)
        // If there was a TZID param, include it for parseICSDateTime
        const semiIdx = trimmed.indexOf(';')
        if (semiIdx !== -1 && semiIdx < colonIdx) {
          // e.g. DTSTART;TZID=America/New_York:20260329T140000
          const params = trimmed.substring(semiIdx + 1, colonIdx)
          dtstart = params + ':' + afterColon
        } else {
          dtstart = afterColon
        }
      }
    } else if (upperLine.startsWith('DTEND')) {
      const colonIdx = trimmed.indexOf(':')
      if (colonIdx !== -1) {
        const afterColon = trimmed.substring(colonIdx + 1)
        const semiIdx = trimmed.indexOf(';')
        if (semiIdx !== -1 && semiIdx < colonIdx) {
          const params = trimmed.substring(semiIdx + 1, colonIdx)
          dtend = params + ':' + afterColon
        } else {
          dtend = afterColon
        }
      }
    } else if (upperLine.startsWith('ATTENDEE')) {
      const attendee = parseAttendee(trimmed)
      if (attendee) {
        attendees.push(attendee)
      }
    }
  }

  return events
}
