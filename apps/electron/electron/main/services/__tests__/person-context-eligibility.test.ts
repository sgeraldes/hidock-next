// @vitest-environment node

/**
 * ADV25-1 (round-26) — the getPersonContext meeting_projects FALLBACK (the
 * Identity merge card's topic list, a NON-OWNER discovery surface) must only
 * surface a project label backed by an ELIGIBLE meeting. meeting_contacts /
 * meeting_projects rows are TRANSCRIPT-derived (applyTranscriptEntities) with no
 * per-row provenance, so a label whose only meeting is backed solely by an
 * excluded recording (personal / soft-deleted / value-excluded / hard-purged)
 * must be suppressed; a label backed by an eligible recording OR by independent
 * calendar provenance must survive; a hard eligibility failure fails closed.
 *
 * REAL temp DB, real database.ts (sql.js) end to end.
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
function attend(meetingId: string, contactId: string): void {
  run(`INSERT INTO meeting_contacts (meeting_id, contact_id, role) VALUES (?, ?, 'attendee')`, [meetingId, contactId])
}
function project(id: string, name: string): void {
  run(`INSERT INTO projects (id, name, status) VALUES (?, ?, 'active')`, [id, name])
}
function tagProject(meetingId: string, projectId: string): void {
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

describe('getPersonContext — meeting_projects fallback eligibility (ADV25-1)', () => {
  it('suppresses a label whose only meeting is backed solely by an EXCLUDED recording', () => {
    contact('c-x', 'Xavier')
    bareMeeting('m-ex') // no calendar provenance
    attend('m-ex', 'c-x')
    project('p-ex', 'SecretProject')
    tagProject('m-ex', 'p-ex')
    recording('rec-ex', 'm-ex')
    valueExclude('rec-ex') // recording value-excluded ⇒ meeting ineligible

    expect(getPersonContext('c-x').topics).not.toContain('SecretProject')
  })

  it('keeps a label backed by an ELIGIBLE recording', () => {
    contact('c-y', 'Yolanda')
    bareMeeting('m-ok')
    attend('m-ok', 'c-y')
    project('p-ok', 'OpenProject')
    tagProject('m-ok', 'p-ok')
    recording('rec-ok', 'm-ok') // live, non-excluded recording ⇒ meeting eligible

    expect(getPersonContext('c-y').topics).toContain('OpenProject')
  })

  it('keeps a label backed by INDEPENDENT calendar provenance (no recording)', () => {
    contact('c-z', 'Zoe')
    calendarMeeting('m-cal') // organizer_email set ⇒ structural, always allowed
    attend('m-cal', 'c-z')
    project('p-cal', 'CalendarProject')
    tagProject('m-cal', 'p-cal')

    expect(getPersonContext('c-z').topics).toContain('CalendarProject')
  })

  it('fails closed: a recording-backed label is suppressed when the eligibility lookup throws', () => {
    contact('c-y', 'Yolanda')
    bareMeeting('m-ok')
    attend('m-ok', 'c-y')
    project('p-ok', 'OpenProject')
    tagProject('m-ok', 'p-ok')
    recording('rec-ok', 'm-ok')
    // Break the positive allowlist (knowledge_captures NOT-EXISTS subquery) so the
    // recording sub-lookup fails ⇒ the recording-backed meeting is dropped.
    run('PRAGMA foreign_keys = OFF')
    run('DROP TABLE knowledge_captures')

    expect(getPersonContext('c-y').topics).not.toContain('OpenProject')
  })
})
