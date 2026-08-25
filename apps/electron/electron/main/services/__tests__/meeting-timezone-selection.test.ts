/**
 * Regression for the Aug 21 selection incident: the filename says 15:03
 * Argentina, and the three Exchange TZIDs represent three distinct instants.
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { parseICS } from '@hidock/calendar-sync'
import { scoreMeetingCandidates } from '../recording-match-scoring'

describe('meeting selection across Exchange timezones', () => {
  it('selects SEMU for the 15:03 Argentina recording', () => {
    const events = parseICS([
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:ai-sdlc',
      'SUMMARY:Revisamos lo de AI SDLC',
      'DTSTART;TZID=Pacific Standard Time:20260821T100000',
      'DTEND;TZID=Pacific Standard Time:20260821T110000',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:semu',
      'SUMMARY:SEMU - WhatsApp Modernization S2D',
      'DTSTART;TZID=Eastern Standard Time:20260821T140000',
      'DTEND;TZID=Eastern Standard Time:20260821T150000',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:resource',
      'SUMMARY:Resource Management',
      'DTSTART;TZID=SA Pacific Standard Time:20260821T140000',
      'DTEND;TZID=SA Pacific Standard Time:20260821T150000',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n'))

    const scored = scoreMeetingCandidates(
      {
        dateRecorded: '2026-08-21T18:03:00.000Z', // 15:03 America/Argentina/Buenos_Aires
        durationSeconds: 3094,
        contentText: null,
      },
      events.map((event) => ({
        meetingId: event.uid,
        subject: event.title,
        startTime: event.startTime.toISOString(),
        endTime: event.endTime.toISOString(),
        isAllDay: false,
      }))
    )

    expect(scored[0]).toMatchObject({ meetingId: 'semu', isBestMatch: true, hasOverlap: true })

    const ifItWereFourPm = scoreMeetingCandidates(
      { dateRecorded: '2026-08-21T19:03:00.000Z', durationSeconds: 3094, contentText: null },
      events.map((event) => ({
        meetingId: event.uid,
        subject: event.title,
        startTime: event.startTime.toISOString(),
        endTime: event.endTime.toISOString(),
        isAllDay: false,
      }))
    )
    expect(ifItWereFourPm[0]).toMatchObject({ meetingId: 'resource', isBestMatch: true, hasOverlap: true })
  })
})
