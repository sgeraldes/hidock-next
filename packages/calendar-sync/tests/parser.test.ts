import { describe, it, expect } from 'vitest'
import { parseICS } from '../src/ics-parser.js'

describe('parseICS', () => {
  it('returns an empty array for empty input', () => {
    expect(parseICS('')).toEqual([])
  })

  it('returns an empty array for whitespace-only input', () => {
    expect(parseICS('   \n\n  ')).toEqual([])
  })

  it('returns an empty array for invalid ICS with no VEVENT', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'END:VCALENDAR',
    ].join('\r\n')
    expect(parseICS(ics)).toEqual([])
  })

  it('parses a single basic event with UTC dates', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:test-uid@example.com',
      'SUMMARY:Team Standup',
      'DTSTART:20260329T140000Z',
      'DTEND:20260329T150000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const events = parseICS(ics)
    expect(events).toHaveLength(1)
    expect(events[0].uid).toBe('test-uid@example.com')
    expect(events[0].title).toBe('Team Standup')
    expect(events[0].startTime).toEqual(new Date('2026-03-29T14:00:00Z'))
    expect(events[0].endTime).toEqual(new Date('2026-03-29T15:00:00Z'))
    expect(events[0].attendees).toEqual([])
    expect(events[0].location).toBeUndefined()
    expect(events[0].description).toBeUndefined()
  })

  it('parses multiple events', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:uid-1',
      'SUMMARY:Meeting 1',
      'DTSTART:20260329T090000Z',
      'DTEND:20260329T100000Z',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:uid-2',
      'SUMMARY:Meeting 2',
      'DTSTART:20260329T110000Z',
      'DTEND:20260329T120000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const events = parseICS(ics)
    expect(events).toHaveLength(2)
    expect(events[0].uid).toBe('uid-1')
    expect(events[0].title).toBe('Meeting 1')
    expect(events[1].uid).toBe('uid-2')
    expect(events[1].title).toBe('Meeting 2')
  })

  it('parses attendees with CN and mailto', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:uid-att',
      'SUMMARY:With Attendees',
      'DTSTART:20260329T090000Z',
      'DTEND:20260329T100000Z',
      'ATTENDEE;CN=Alice Smith:mailto:alice@example.com',
      'ATTENDEE;CN="Bob Jones";ROLE=REQ-PARTICIPANT:mailto:bob@example.com',
      'ATTENDEE:mailto:anon@example.com',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const events = parseICS(ics)
    expect(events).toHaveLength(1)
    expect(events[0].attendees).toHaveLength(3)
    expect(events[0].attendees[0]).toEqual({ name: 'Alice Smith', email: 'alice@example.com' })
    expect(events[0].attendees[1]).toEqual({ name: 'Bob Jones', email: 'bob@example.com' })
    expect(events[0].attendees[2]).toEqual({ email: 'anon@example.com' })
  })

  it('parses local dates (no Z suffix) as UTC', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:uid-local',
      'SUMMARY:Local Time Event',
      'DTSTART:20260115T090000',
      'DTEND:20260115T100000',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const events = parseICS(ics)
    expect(events).toHaveLength(1)
    expect(events[0].startTime).toEqual(new Date('2026-01-15T09:00:00Z'))
    expect(events[0].endTime).toEqual(new Date('2026-01-15T10:00:00Z'))
  })

  it('parses dates with TZID parameter', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:uid-tz',
      'SUMMARY:TZ Event',
      'DTSTART;TZID=America/New_York:20260329T090000',
      'DTEND;TZID=America/New_York:20260329T100000',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const events = parseICS(ics)
    expect(events).toHaveLength(1)
    expect(events[0].startTime).toEqual(new Date('2026-03-29T09:00:00Z'))
    expect(events[0].endTime).toEqual(new Date('2026-03-29T10:00:00Z'))
  })

  it('handles line folding (continuation lines)', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:uid-fold',
      'SUMMARY:This is a very long summary that has been ',
      ' folded across multiple lines',
      'DTSTART:20260329T090000Z',
      'DTEND:20260329T100000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const events = parseICS(ics)
    expect(events).toHaveLength(1)
    expect(events[0].title).toBe(
      'This is a very long summary that has been folded across multiple lines'
    )
  })

  it('handles tab-based line folding', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:uid-tab',
      'SUMMARY:Tab',
      '\tfolded',
      'DTSTART:20260329T090000Z',
      'DTEND:20260329T100000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const events = parseICS(ics)
    expect(events).toHaveLength(1)
    expect(events[0].title).toBe('Tabfolded')
  })

  it('parses LOCATION and DESCRIPTION', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:uid-loc',
      'SUMMARY:Office Meeting',
      'DTSTART:20260329T090000Z',
      'DTEND:20260329T100000Z',
      'LOCATION:Room 42',
      'DESCRIPTION:Discuss Q2 roadmap',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const events = parseICS(ics)
    expect(events).toHaveLength(1)
    expect(events[0].location).toBe('Room 42')
    expect(events[0].description).toBe('Discuss Q2 roadmap')
  })

  it('skips events missing required fields (no UID)', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'SUMMARY:No UID',
      'DTSTART:20260329T090000Z',
      'DTEND:20260329T100000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    expect(parseICS(ics)).toEqual([])
  })

  it('skips events missing DTSTART', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:uid-no-start',
      'SUMMARY:No Start',
      'DTEND:20260329T100000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    expect(parseICS(ics)).toEqual([])
  })

  it('skips events missing DTEND', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:uid-no-end',
      'SUMMARY:No End',
      'DTSTART:20260329T090000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    expect(parseICS(ics)).toEqual([])
  })

  it('handles LF line endings (not just CRLF)', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:uid-lf',
      'SUMMARY:LF Only',
      'DTSTART:20260329T090000Z',
      'DTEND:20260329T100000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n')

    const events = parseICS(ics)
    expect(events).toHaveLength(1)
    expect(events[0].title).toBe('LF Only')
  })

  it('defaults title to empty string when SUMMARY is missing', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:uid-no-summary',
      'DTSTART:20260329T090000Z',
      'DTEND:20260329T100000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n')

    const events = parseICS(ics)
    expect(events).toHaveLength(1)
    expect(events[0].title).toBe('')
  })

  describe('ORGANIZER extraction', () => {
    it('parses ORGANIZER with CN and mailto', () => {
      const ics = [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:uid-org',
        'SUMMARY:With Organizer',
        'DTSTART:20260329T090000Z',
        'DTEND:20260329T100000Z',
        'ORGANIZER;CN=Carol Manager:mailto:carol@example.com',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n')

      const events = parseICS(ics)
      expect(events).toHaveLength(1)
      expect(events[0].organizer).toEqual({ name: 'Carol Manager', email: 'carol@example.com' })
    })

    it('parses ORGANIZER with quoted CN', () => {
      const ics = [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:uid-org-q',
        'SUMMARY:Quoted Organizer',
        'DTSTART:20260329T090000Z',
        'DTEND:20260329T100000Z',
        'ORGANIZER;CN="Dave O\'Brien":mailto:dave@example.com',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n')

      const events = parseICS(ics)
      expect(events).toHaveLength(1)
      expect(events[0].organizer).toEqual({ name: "Dave O'Brien", email: 'dave@example.com' })
    })

    it('parses ORGANIZER with mailto only (no CN)', () => {
      const ics = [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:uid-org-noname',
        'SUMMARY:No Name Organizer',
        'DTSTART:20260329T090000Z',
        'DTEND:20260329T100000Z',
        'ORGANIZER:mailto:org@example.com',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n')

      const events = parseICS(ics)
      expect(events).toHaveLength(1)
      expect(events[0].organizer).toEqual({ email: 'org@example.com' })
    })

    it('leaves organizer undefined when ORGANIZER property is absent', () => {
      const ics = [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:uid-no-org',
        'SUMMARY:No Organizer',
        'DTSTART:20260329T090000Z',
        'DTEND:20260329T100000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n')

      const events = parseICS(ics)
      expect(events).toHaveLength(1)
      expect(events[0].organizer).toBeUndefined()
    })
  })

  describe('Windows timezone fallback (no VTIMEZONE)', () => {
    it('applies the Windows offset for a recognized Exchange TZID', () => {
      // Eastern Standard Time = UTC-5. A wall-clock of 09:00 local must become 14:00 UTC.
      const ics = [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:uid-est',
        'SUMMARY:Eastern Meeting',
        'DTSTART;TZID=Eastern Standard Time:20260115T090000',
        'DTEND;TZID=Eastern Standard Time:20260115T100000',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n')

      const events = parseICS(ics)
      expect(events).toHaveLength(1)
      // 09:00 EST (UTC-5) -> 14:00 UTC
      expect(events[0].startTime).toEqual(new Date('2026-01-15T14:00:00Z'))
      expect(events[0].endTime).toEqual(new Date('2026-01-15T15:00:00Z'))
    })

    it('applies a positive Windows offset (China Standard Time, UTC+8)', () => {
      const ics = [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:uid-cst',
        'SUMMARY:Beijing Meeting',
        'DTSTART;TZID=China Standard Time:20260115T090000',
        'DTEND;TZID=China Standard Time:20260115T100000',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n')

      const events = parseICS(ics)
      expect(events).toHaveLength(1)
      // 09:00 CST (UTC+8) -> 01:00 UTC
      expect(events[0].startTime).toEqual(new Date('2026-01-15T01:00:00Z'))
      expect(events[0].endTime).toEqual(new Date('2026-01-15T02:00:00Z'))
    })

    it('treats an unrecognized IANA TZID as UTC (unchanged behavior)', () => {
      const ics = [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:uid-iana',
        'SUMMARY:IANA Event',
        'DTSTART;TZID=America/New_York:20260329T090000',
        'DTEND;TZID=America/New_York:20260329T100000',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n')

      const events = parseICS(ics)
      expect(events).toHaveLength(1)
      // IANA name not in Windows map -> treated as UTC
      expect(events[0].startTime).toEqual(new Date('2026-03-29T09:00:00Z'))
      expect(events[0].endTime).toEqual(new Date('2026-03-29T10:00:00Z'))
    })

    it('does not apply offset when value already carries Z', () => {
      const ics = [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:uid-est-z',
        'SUMMARY:Already UTC',
        'DTSTART;TZID=Eastern Standard Time:20260115T090000Z',
        'DTEND;TZID=Eastern Standard Time:20260115T100000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n')

      const events = parseICS(ics)
      expect(events).toHaveLength(1)
      // Explicit Z wins -> stays 09:00 UTC
      expect(events[0].startTime).toEqual(new Date('2026-01-15T09:00:00Z'))
    })
  })

  describe('RRULE / recurrence', () => {
    it('sets isRecurring and recurrence from RRULE', () => {
      const ics = [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:uid-rrule',
        'SUMMARY:Weekly Standup',
        'DTSTART:20260329T090000Z',
        'DTEND:20260329T093000Z',
        'RRULE:FREQ=WEEKLY;BYDAY=MO',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n')

      const events = parseICS(ics)
      expect(events).toHaveLength(1)
      expect(events[0].isRecurring).toBe(true)
      expect(events[0].recurrence).toBe('FREQ=WEEKLY;BYDAY=MO')
    })

    it('leaves recurrence undefined and isRecurring unset for non-recurring events', () => {
      const ics = [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:uid-once',
        'SUMMARY:One-off',
        'DTSTART:20260329T090000Z',
        'DTEND:20260329T100000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n')

      const events = parseICS(ics)
      expect(events).toHaveLength(1)
      expect(events[0].recurrence).toBeUndefined()
      expect(events[0].isRecurring).toBeUndefined()
    })
  })
})
