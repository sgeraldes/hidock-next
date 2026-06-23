import type { CalendarAttendee, CalendarEvent, CalendarOrganizer } from './types.js'

/**
 * Windows timezone names to UTC offset in seconds.
 * Used as a fallback when an ICS feed uses Windows/Exchange timezone names
 * (e.g. "Eastern Standard Time") via a TZID parameter but ships no VTIMEZONE
 * component. Without this, such times would be silently treated as UTC.
 * Offsets are for standard time (not DST).
 *
 * Ported from the electron app's calendar-sync implementation so the shared
 * package does not lose timezone accuracy for Outlook/Exchange feeds.
 */
export const WINDOWS_TIMEZONE_OFFSETS: Record<string, number> = {
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
 *   - `20260329T140000`          (local, treated as UTC unless a Windows TZID applies)
 *   - `20260329`                 (date only, treated as UTC midnight)
 *   - `TZID=America/New_York:20260329T140000` (timezone prefix)
 *
 * When a TZID is present AND it is a recognized Windows/Exchange timezone name
 * (and the value carries no trailing 'Z'), the corresponding UTC offset from
 * WINDOWS_TIMEZONE_OFFSETS is applied so the resulting Date is correct UTC.
 * For all other cases (no TZID, IANA TZID, or explicit Z) the time is treated
 * as UTC — preserving the package's prior behavior.
 */
function parseICSDateTime(value: string): Date | null {
  // Strip optional TZID prefix (e.g. "TZID=America/New_York:20260329T140000")
  let dateStr = value
  let tzid: string | undefined
  const tzidColonIdx = dateStr.indexOf(':')
  if (tzidColonIdx !== -1 && dateStr.substring(0, tzidColonIdx).includes('=')) {
    const paramPart = dateStr.substring(0, tzidColonIdx)
    const tzidMatch = /TZID=([^;:]+)/i.exec(paramPart)
    if (tzidMatch) {
      tzid = tzidMatch[1].trim()
    }
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
  const hasZ = match[7] === 'Z'

  const localAsUtc = Date.UTC(y, m, d, h, min, s)

  // Windows timezone fallback: only when there's a TZID with no explicit Z and
  // the TZID is a recognized Windows/Exchange zone name. The wall-clock time is
  // local to that zone, so subtract the offset to obtain true UTC.
  if (!hasZ && tzid && Object.prototype.hasOwnProperty.call(WINDOWS_TIMEZONE_OFFSETS, tzid)) {
    const utcOffsetSeconds = WINDOWS_TIMEZONE_OFFSETS[tzid]
    return new Date(localAsUtc - utcOffsetSeconds * 1000)
  }

  // Otherwise treat as UTC (explicit Z, no TZID, or unrecognized/IANA TZID).
  return new Date(localAsUtc)
}

/**
 * Extract the email address from an ICS property value containing a mailto:.
 */
function extractMailto(fullLine: string): string | undefined {
  const mailtoIdx = fullLine.toLowerCase().indexOf('mailto:')
  if (mailtoIdx === -1) return undefined
  const email = fullLine.substring(mailtoIdx + 7).trim()
  return email || undefined
}

/**
 * Extract the CN (common name) parameter from an ICS property line.
 */
function extractCN(fullLine: string): string | undefined {
  const cnMatch = /;CN=("([^"]+)"|([^;:]+))/i.exec(fullLine)
  if (!cnMatch) return undefined
  return (cnMatch[2] ?? cnMatch[3])?.trim() || undefined
}

/**
 * Parse an ATTENDEE property value into a CalendarAttendee.
 * Format examples:
 *   `ATTENDEE;CN=John Doe:mailto:john@example.com`
 *   `ATTENDEE;CN="Jane Doe";ROLE=REQ-PARTICIPANT:mailto:jane@example.com`
 *   `ATTENDEE:mailto:anon@example.com`
 */
function parseAttendee(fullLine: string): CalendarAttendee | null {
  const email = extractMailto(fullLine)
  if (!email) return null
  const name = extractCN(fullLine)
  return name ? { name, email } : { email }
}

/**
 * Parse an ORGANIZER property value into a CalendarOrganizer.
 * Format examples:
 *   `ORGANIZER;CN=John Doe:mailto:john@example.com`
 *   `ORGANIZER;CN="Jane Doe":mailto:jane@example.com`
 *   `ORGANIZER:mailto:org@example.com`
 */
function parseOrganizer(fullLine: string): CalendarOrganizer | null {
  const email = extractMailto(fullLine)
  const name = extractCN(fullLine)
  if (!email && !name) return null
  const organizer: CalendarOrganizer = {}
  if (name) organizer.name = name
  if (email) organizer.email = email
  return organizer
}

/**
 * Pull the value (and any leading TZID param) out of a DTSTART/DTEND line so it
 * can be passed to parseICSDateTime. Preserves the leading "TZID=..." param so
 * the date parser can apply the Windows timezone fallback.
 */
function extractDateValue(trimmed: string): string {
  const colonIdx = trimmed.indexOf(':')
  if (colonIdx === -1) return ''
  const afterColon = trimmed.substring(colonIdx + 1)
  const semiIdx = trimmed.indexOf(';')
  if (semiIdx !== -1 && semiIdx < colonIdx) {
    // e.g. DTSTART;TZID=Eastern Standard Time:20260329T140000
    const params = trimmed.substring(semiIdx + 1, colonIdx)
    return params + ':' + afterColon
  }
  return afterColon
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
  let organizer: CalendarOrganizer | undefined
  let recurrence: string | undefined

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
      organizer = undefined
      recurrence = undefined
      continue
    }

    if (trimmed === 'END:VEVENT') {
      inEvent = false
      const startDate = dtstart ? parseICSDateTime(dtstart) : null
      const endDate = dtend ? parseICSDateTime(dtend) : null

      if (uid && startDate && endDate) {
        const event: CalendarEvent = {
          uid,
          title: title || '',
          startTime: startDate,
          endTime: endDate,
          attendees,
          ...(location !== undefined && { location }),
          ...(description !== undefined && { description }),
          ...(organizer !== undefined && { organizer }),
        }
        if (recurrence !== undefined) {
          event.isRecurring = true
          event.recurrence = recurrence
        }
        events.push(event)
      }
      continue
    }

    if (!inEvent) continue

    // Parse property. Properties have format NAME[;PARAM=VALUE...]:VALUE
    // but ATTENDEE/ORGANIZER lines include params before the colon-separated value.
    const upperLine = trimmed.toUpperCase()

    if (upperLine.startsWith('UID:')) {
      uid = trimmed.substring(4)
    } else if (upperLine.startsWith('SUMMARY:')) {
      title = trimmed.substring(8)
    } else if (upperLine.startsWith('LOCATION:')) {
      location = trimmed.substring(9)
    } else if (upperLine.startsWith('DESCRIPTION:')) {
      description = trimmed.substring(12)
    } else if (upperLine.startsWith('RRULE:')) {
      recurrence = trimmed.substring(6)
    } else if (upperLine.startsWith('DTSTART')) {
      // DTSTART:20260329T140000Z  or  DTSTART;TZID=...:20260329T140000
      dtstart = extractDateValue(trimmed)
    } else if (upperLine.startsWith('DTEND')) {
      dtend = extractDateValue(trimmed)
    } else if (upperLine.startsWith('ORGANIZER')) {
      const parsed = parseOrganizer(trimmed)
      if (parsed) organizer = parsed
    } else if (upperLine.startsWith('ATTENDEE')) {
      const attendee = parseAttendee(trimmed)
      if (attendee) {
        attendees.push(attendee)
      }
    }
  }

  return events
}
