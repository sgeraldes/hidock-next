// @vitest-environment node

/**
 * v46 (F18/round-27) — per-row membership provenance migration + backfill.
 *
 *  1. The schema exposes source + source_recording_id on meeting_contacts /
 *     meeting_projects and source_recording_ids on identity_suggestions, and the
 *     boot schema version is 50 (current).
 *  2. backfillMembershipProvenanceV44 classifies pre-v46 NULL-provenance rows
 *     conservatively: a calendar-attendee/organizer row ⇒ 'calendar'; a
 *     recording-backed row ⇒ 'transcript' + that recording id; an unassociable
 *     row (no calendar match, no recording) ⇒ stays NULL. Idempotent.
 *
 * REAL temp DB, real database.ts (better-sqlite3) end to end.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-v46-migration-${process.pid}.sqlite`)
vi.mock('../file-storage', () => ({ getDatabasePath: () => dbPath }))

import {
  initializeDatabase,
  closeDatabase,
  run,
  queryOne,
  backfillMembershipProvenanceV44
} from '../database'

interface MembershipCols {
  source: string | null
  source_recording_id: string | null
}

function meeting(id: string, calendar: boolean): void {
  if (calendar) {
    run(
      `INSERT INTO meetings (id, subject, start_time, end_time, organizer_email, attendees)
       VALUES (?, ?, '2026-01-02T10:00:00Z', '2026-01-02T11:00:00Z', 'boss@corp.com', ?)`,
      [id, id, JSON.stringify([{ name: 'Cal Attendee', email: 'cal@corp.com' }])]
    )
  } else {
    run(`INSERT INTO meetings (id, subject, start_time, end_time) VALUES (?, ?, '2026-01-02T10:00:00Z', '2026-01-02T11:00:00Z')`, [id, id])
  }
}
function contact(id: string, name: string, email: string | null): void {
  run(
    `INSERT INTO contacts (id, name, email, type, first_seen_at, last_seen_at, meeting_count)
     VALUES (?, ?, ?, 'unknown', '2026-01-01', '2026-01-01', 0)`,
    [id, name, email]
  )
}
function project(id: string, name: string): void {
  run(`INSERT INTO projects (id, name, status) VALUES (?, ?, 'active')`, [id, name])
}
function recording(id: string, meetingId: string): void {
  run(`INSERT INTO recordings (id, filename, date_recorded, meeting_id) VALUES (?, ?, '2026-01-02T10:00:00Z', ?)`, [id, `${id}.hda`, meetingId])
}
/** Legacy NULL-provenance junction rows, exactly as a pre-v46 DB holds them. */
function legacyContact(meetingId: string, contactId: string, role = 'attendee'): void {
  run(`INSERT INTO meeting_contacts (meeting_id, contact_id, role) VALUES (?, ?, ?)`, [meetingId, contactId, role])
}
function legacyProject(meetingId: string, projectId: string): void {
  run(`INSERT INTO meeting_projects (meeting_id, project_id) VALUES (?, ?)`, [meetingId, projectId])
}
function mc(meetingId: string, contactId: string): MembershipCols {
  return queryOne<MembershipCols>('SELECT source, source_recording_id FROM meeting_contacts WHERE meeting_id = ? AND contact_id = ?', [meetingId, contactId])!
}
function mp(meetingId: string, projectId: string): MembershipCols {
  return queryOne<MembershipCols>('SELECT source, source_recording_id FROM meeting_projects WHERE meeting_id = ? AND project_id = ?', [meetingId, projectId])!
}

beforeEach(async () => {
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
})
afterEach(() => {
  closeDatabase()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
})

describe('v46 schema', () => {
  it('boot schema version is 50', () => {
    // On top of beta's v42 (projects.origin) / v43 (project_discovery_observations),
    // F18's provenance chain runs 46 (membership) -> 47 (entity) -> 48 (per-field
    // role) -> 49 (node) -> 50 (role provenance-trust marker, current SCHEMA_VERSION).
    const row = queryOne<{ v: number }>('SELECT MAX(version) AS v FROM schema_version')!
    expect(row.v).toBe(50)
  })

  it('adds the per-row provenance columns (idempotent — table already has them)', () => {
    const cCols = queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM pragma_table_info('meeting_contacts') WHERE name IN ('source','source_recording_id')")!
    expect(cCols.n).toBe(2)
    const pCols = queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM pragma_table_info('meeting_projects') WHERE name IN ('source','source_recording_id')")!
    expect(pCols.n).toBe(2)
    const sCols = queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM pragma_table_info('identity_suggestions') WHERE name = 'source_recording_ids'")!
    expect(sCols.n).toBe(1)
  })
})

describe('backfillMembershipProvenanceV44', () => {
  it("classifies a calendar-attendee row as 'calendar' (structural)", () => {
    meeting('m-cal', true)
    contact('c-cal', 'Cal Attendee', 'cal@corp.com') // email matches the calendar attendee list
    recording('rec-cal', 'm-cal') // even WITH a recording, the calendar match wins
    legacyContact('m-cal', 'c-cal')

    backfillMembershipProvenanceV44()

    expect(mc('m-cal', 'c-cal')).toEqual({ source: 'calendar', source_recording_id: null })
  })

  it("classifies an organizer-role row as 'calendar' regardless of email", () => {
    meeting('m-org', true)
    contact('c-org', 'Organizer', 'boss@corp.com')
    legacyContact('m-org', 'c-org', 'organizer')

    backfillMembershipProvenanceV44()

    expect(mc('m-org', 'c-org')).toEqual({ source: 'calendar', source_recording_id: null })
  })

  it("classifies a recording-backed non-calendar row as 'transcript' + the source recording", () => {
    meeting('m-bare', false)
    contact('c-t', 'Transcript Person', null) // no calendar email match
    recording('rec-bare', 'm-bare')
    legacyContact('m-bare', 'c-t')
    project('p-t', 'TranscriptProject')
    legacyProject('m-bare', 'p-t')

    backfillMembershipProvenanceV44()

    expect(mc('m-bare', 'c-t')).toEqual({ source: 'transcript', source_recording_id: 'rec-bare' })
    expect(mp('m-bare', 'p-t')).toEqual({ source: 'transcript', source_recording_id: 'rec-bare' })
  })

  it('leaves an unassociable row (no calendar match, no recording) NULL', () => {
    meeting('m-orphan', false)
    contact('c-o', 'Orphan', null)
    legacyContact('m-orphan', 'c-o')
    project('p-o', 'OrphanProject')
    legacyProject('m-orphan', 'p-o')

    backfillMembershipProvenanceV44()

    expect(mc('m-orphan', 'c-o')).toEqual({ source: null, source_recording_id: null })
    expect(mp('m-orphan', 'p-o')).toEqual({ source: null, source_recording_id: null })
  })

  it('ADV27-2: leaves a MULTI-recording meeting membership NULL (no arbitrary-recording laundering)', () => {
    // A non-calendar meeting with TWO recordings has no uniquely attributable
    // transcript source; attributing the membership to the FIRST recording would
    // launder a row that may derive from the OTHER (excluded) recording.
    meeting('m-multi', false)
    contact('c-multi', 'Multi Person', null)
    recording('rec-a', 'm-multi')
    recording('rec-b', 'm-multi')
    legacyContact('m-multi', 'c-multi')
    project('p-multi', 'MultiProject')
    legacyProject('m-multi', 'p-multi')

    backfillMembershipProvenanceV44()

    // Ambiguous ⇒ NULL (fail-closed ineligible on non-owner surfaces), NOT rec-a.
    expect(mc('m-multi', 'c-multi')).toEqual({ source: null, source_recording_id: null })
    expect(mp('m-multi', 'p-multi')).toEqual({ source: null, source_recording_id: null })
  })

  it('is idempotent — a second run does not reclassify already-provenanced rows', () => {
    meeting('m-bare', false)
    contact('c-t', 'Transcript Person', null)
    recording('rec-bare', 'm-bare')
    legacyContact('m-bare', 'c-t')

    backfillMembershipProvenanceV44()
    const first = mc('m-bare', 'c-t')
    // Seed a NEW live recording; a second run must NOT re-point the already-classified row.
    recording('rec-newer', 'm-bare')
    backfillMembershipProvenanceV44()

    expect(mc('m-bare', 'c-t')).toEqual(first)
  })
})
