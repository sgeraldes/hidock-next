import { describe, it, expect } from 'vitest'
import { parseICS } from '../src/ics-parser.js'

describe('parseICS (stub)', () => {
  it('returns an empty array for any input', () => {
    expect(parseICS('')).toEqual([])
  })

  it('returns an empty array for a non-empty ICS string', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:test-uid@example.com',
      'SUMMARY:Test Meeting',
      'DTSTART:20250115T090000Z',
      'DTEND:20250115T100000Z',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')
    expect(parseICS(ics)).toEqual([])
  })
})
