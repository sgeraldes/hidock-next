// @vitest-environment node

/**
 * ADV26-2/-3 (round-27) — getPersonContext must gate the NON-OWNER identity merge
 * card at the membership ROW, not the parent meeting. meeting_contacts /
 * meeting_projects rows are written by BOTH calendar sync AND applyTranscriptEntities
 * for the SAME meeting, so a coarse meeting-level check LAUNDERS a transcript-derived
 * row onto a calendar meeting. Per-row provenance (source + source_recording_id):
 *   • 'transcript' row  ⇒ surfaces only while its source recording is eligible.
 *   • 'calendar' row     ⇒ structural (calendar/user) ⇒ always allowed.
 *   • NULL-provenance row ⇒ legacy ⇒ fail-closed ineligible — EVEN when the meeting
 *                            carries calendar metadata.
 *
 * Covers BOTH the project-label fallback (topics, ADV26-2) and the co-attendee
 * people list (ADV26-3). REAL temp DB, real database.ts end to end.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-person-context-elig-${process.pid}.sqlite`)
vi.mock('../file-storage', () => ({ getDatabasePath: () => dbPath }))

import { initializeDatabase, closeDatabase, run, getPersonContext } from '../database'

// --- seed helpers -----------------------------------------------------------

function contact(id: string, name: string): void {
  run(
    `INSERT INTO contacts (id, name, type, first_seen_at, last_seen_at, meeting_count)
     VALUES (?, ?, 'unknown', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 0)`,
    [id, name]
  )
}
/** A meeting with NO calendar provenance (transcript-derived membership only). */
function bareMeeting(id: string): void {
  run(`INSERT INTO meetings (id, subject, start_time, end_time) VALUES (?, ?, '2026-01-02T10:00:00Z', '2026-01-02T11:00:00Z')`, [id, id])
}
/** A meeting with INDEPENDENT calendar provenance (organizer from ICS/M365 sync). */
function calendarMeeting(id: string): void {
  run(
    `INSERT INTO meetings (id, subject, start_time, end_time, organizer_email) VALUES (?, ?, '2026-01-02T10:00:00Z', '2026-01-02T11:00:00Z', 'boss@corp.com')`,
    [id, id]
  )
}
/** A transcript-derived attendance row backed by a specific source recording. */
function attendTranscript(meetingId: string, contactId: string, recId: string): void {
  run(
    `INSERT INTO meeting_contacts (meeting_id, contact_id, role, source, source_recording_id) VALUES (?, ?, 'attendee', 'transcript', ?)`,
    [meetingId, contactId, recId]
  )
}
/** A structural (calendar/user-authored) attendance row. */
function attendCalendar(meetingId: string, contactId: string): void {
  run(`INSERT INTO meeting_contacts (meeting_id, contact_id, role, source) VALUES (?, ?, 'attendee', 'calendar')`, [meetingId, contactId])
}
/** A legacy NULL-provenance attendance row (pre-v44, un-backfilled). */
function attendLegacy(meetingId: string, contactId: string): void {
  run(`INSERT INTO meeting_contacts (meeting_id, contact_id, role) VALUES (?, ?, 'attendee')`, [meetingId, contactId])
}
function project(id: string, name: string): void {
  run(`INSERT INTO projects (id, name, status) VALUES (?, ?, 'active')`, [id, name])
}
function tagProjectTranscript(meetingId: string, projectId: string, recId: string): void {
  run(`INSERT INTO meeting_projects (meeting_id, project_id, source, source_recording_id) VALUES (?, ?, 'transcript', ?)`, [meetingId, projectId, recId])
}
function tagProjectCalendar(meetingId: string, projectId: string): void {
  run(`INSERT INTO meeting_projects (meeting_id, project_id, source) VALUES (?, ?, 'calendar')`, [meetingId, projectId])
}
function tagProjectLegacy(meetingId: string, projectId: string): void {
  run(`INSERT INTO meeting_projects (meeting_id, project_id) VALUES (?, ?)`, [meetingId, projectId])
}
function recording(id: string, meetingId: string): void {
  run(`INSERT INTO recordings (id, filename, date_recorded, meeting_id) VALUES (?, ?, '2026-01-02T10:00:00Z', ?)`, [
    id,
    `${id}.hda`,
    meetingId
  ])
}
function valueExclude(recordingId: string): void {
  run(
    `INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id, quality_rating) VALUES (?, 'Cap', '2026-06-01', ?, 'garbage')`,
    [`cap-${recordingId}`, recordingId]
  )
}

beforeEach(async () => {
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
})
afterEach(() => {
  closeDatabase()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
})

describe('getPersonContext — meeting_projects fallback per-row eligibility (ADV26-2)', () => {
  it('suppresses a transcript-derived label whose source recording is EXCLUDED', () => {
    contact('c-x', 'Xavier')
    bareMeeting('m-ex')
    recording('rec-ex', 'm-ex')
    valueExclude('rec-ex') // recording value-excluded ⇒ transcript row ineligible
    attendTranscript('m-ex', 'c-x', 'rec-ex')
    project('p-ex', 'SecretProject')
    tagProjectTranscript('m-ex', 'p-ex', 'rec-ex')

    expect(getPersonContext('c-x').topics).not.toContain('SecretProject')
  })

  it('keeps a transcript-derived label whose source recording is ELIGIBLE', () => {
    contact('c-y', 'Yolanda')
    bareMeeting('m-ok')
    recording('rec-ok', 'm-ok') // live, non-excluded ⇒ transcript row eligible
    attendTranscript('m-ok', 'c-y', 'rec-ok')
    project('p-ok', 'OpenProject')
    tagProjectTranscript('m-ok', 'p-ok', 'rec-ok')

    expect(getPersonContext('c-y').topics).toContain('OpenProject')
  })

  it('keeps a CALENDAR (structural/manual) project label with no recording', () => {
    contact('c-z', 'Zoe')
    calendarMeeting('m-cal')
    attendCalendar('m-cal', 'c-z')
    project('p-cal', 'CalendarProject')
    tagProjectCalendar('m-cal', 'p-cal') // structural project tag ⇒ always allowed

    expect(getPersonContext('c-z').topics).toContain('CalendarProject')
  })

  it('suppresses a LEGACY NULL-provenance project label (fail-closed)', () => {
    contact('c-l', 'Leo')
    bareMeeting('m-legacy')
    attendLegacy('m-legacy', 'c-l')
    project('p-legacy', 'LegacyProject')
    tagProjectLegacy('m-legacy', 'p-legacy') // NULL provenance ⇒ ineligible

    expect(getPersonContext('c-l').topics).not.toContain('LegacyProject')
  })

  it('CALENDAR metadata does NOT launder a transcript-derived project row from an excluded recording', () => {
    // The meeting has calendar provenance AND carries a transcript-derived project
    // row from an excluded recording plus a genuine calendar (manual) project row.
    // Only the calendar row must show; the transcript row stays suppressed.
    contact('c-m', 'Mara')
    calendarMeeting('m-mix')
    recording('rec-bad', 'm-mix')
    valueExclude('rec-bad')
    attendCalendar('m-mix', 'c-m')
    project('p-trans', 'TranscriptOnlyProject')
    project('p-cal2', 'ManualProject')
    tagProjectTranscript('m-mix', 'p-trans', 'rec-bad') // laundering attempt
    tagProjectCalendar('m-mix', 'p-cal2')

    const topics = getPersonContext('c-m').topics
    expect(topics).not.toContain('TranscriptOnlyProject')
    expect(topics).toContain('ManualProject')
  })

  it('fails closed: a transcript-derived label is suppressed when the eligibility lookup throws', () => {
    contact('c-y', 'Yolanda')
    bareMeeting('m-ok')
    recording('rec-ok', 'm-ok')
    attendTranscript('m-ok', 'c-y', 'rec-ok')
    project('p-ok', 'OpenProject')
    tagProjectTranscript('m-ok', 'p-ok', 'rec-ok')
    // Break the positive allowlist (knowledge_captures NOT-EXISTS subquery).
    run('PRAGMA foreign_keys = OFF')
    run('DROP TABLE knowledge_captures')

    expect(getPersonContext('c-y').topics).not.toContain('OpenProject')
  })
})

describe('getPersonContext — co-attendee people list per-row eligibility (ADV26-3)', () => {
  it('suppresses two participants learned SOLELY from an excluded recording', () => {
    contact('c-a', 'Ana')
    contact('c-b', 'Beto')
    bareMeeting('m-ex')
    recording('rec-ex', 'm-ex')
    valueExclude('rec-ex')
    attendTranscript('m-ex', 'c-a', 'rec-ex')
    attendTranscript('m-ex', 'c-b', 'rec-ex')

    expect(getPersonContext('c-a').people).not.toContain('Beto')
  })

  it('keeps a co-attendee learned from an ELIGIBLE recording', () => {
    contact('c-a', 'Ana')
    contact('c-b', 'Beto')
    bareMeeting('m-ok')
    recording('rec-ok', 'm-ok')
    attendTranscript('m-ok', 'c-a', 'rec-ok')
    attendTranscript('m-ok', 'c-b', 'rec-ok')

    expect(getPersonContext('c-a').people).toContain('Beto')
  })

  it('keeps a CALENDAR co-attendee even when the meeting recording is excluded', () => {
    contact('c-a', 'Ana')
    contact('c-b', 'Beto')
    calendarMeeting('m-cal')
    recording('rec-bad', 'm-cal')
    valueExclude('rec-bad')
    attendCalendar('m-cal', 'c-a')
    attendCalendar('m-cal', 'c-b')

    expect(getPersonContext('c-a').people).toContain('Beto')
  })

  it('suppresses a LEGACY NULL-provenance co-attendee (fail-closed)', () => {
    contact('c-a', 'Ana')
    contact('c-b', 'Beto')
    bareMeeting('m-legacy')
    attendLegacy('m-legacy', 'c-a')
    attendLegacy('m-legacy', 'c-b')

    expect(getPersonContext('c-a').people).not.toContain('Beto')
  })
})
