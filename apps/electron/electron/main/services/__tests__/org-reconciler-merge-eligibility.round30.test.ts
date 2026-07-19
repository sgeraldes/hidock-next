// @vitest-environment node

/**
 * Round-30 org-reconciler WRITE/MERGE eligibility — the reconcile/merge tier must
 * not LAUNDER excluded-derived data onto eligible entities/recordings.
 *
 * ADV28-1 — transcript enrichment must NOT fill a STRUCTURAL (calendar/user)
 *   contact's displayed role; transcript-derived fields live only on transcript-
 *   provenanced entities (already gated by filterVisibleEntityIds).
 * ADV28-2 — auto contact dedup (mergeDuplicateContacts) partitions by the
 *   visible-identity boundary: an excluded transcript-only contact is never folded
 *   into a structurally-visible survivor.
 * ADV28-3 (CORE) — duplicate-recording reconciliation never merges across an
 *   eligibility boundary: an eligible keeper cannot absorb a personal/soft-deleted/
 *   value-excluded sibling's knowledge_captures, so a capture excluded before the
 *   merge stays excluded from filterEligibleCaptureIds (RAG/LLM/display/search).
 *
 * REAL temp DB, real database.ts (better-sqlite3) end to end.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-reconciler-r30-${process.pid}.sqlite`)
vi.mock('../file-storage', () => ({ getDatabasePath: () => dbPath }))
vi.mock('../../services/file-storage', () => ({ getDatabasePath: () => dbPath }))

import {
  initializeDatabase,
  closeDatabase,
  run,
  queryOne,
  queryAll,
  filterVisibleEntityIds
} from '../database'
import { filterEligibleCaptureIds } from '../recording-eligibility'
import {
  applyTranscriptEntities,
  mergeDuplicateContacts,
  mergeDuplicateRecordings,
  upsertContactsFromMeetings
} from '../org-reconciler'

// --- seed helpers -----------------------------------------------------------

function meeting(id: string, opts: { attendees?: Array<{ name?: string; email?: string }>; organizerEmail?: string } = {}): void {
  run(
    `INSERT INTO meetings (id, subject, start_time, end_time, attendees, organizer_email)
     VALUES (?, ?, '2026-01-02T10:00:00Z', '2026-01-02T11:00:00Z', ?, ?)`,
    [id, id, opts.attendees ? JSON.stringify(opts.attendees) : null, opts.organizerEmail ?? null]
  )
}

function recording(
  id: string,
  filename: string,
  meetingId: string | null,
  opts: { personal?: boolean; deleted?: boolean; filePath?: string | null } = {}
): void {
  run(
    `INSERT INTO recordings (id, filename, file_path, date_recorded, personal, deleted_at, meeting_id, on_local)
     VALUES (?, ?, ?, '2026-01-02T10:00:00Z', ?, ?, ?, 1)`,
    [id, filename, opts.filePath ?? `/tmp/${filename}`, opts.personal ? 1 : 0, opts.deleted ? '2026-07-01T00:00:00Z' : null, meetingId]
  )
}

function contact(
  id: string,
  name: string,
  source: string | null,
  opts: { email?: string | null; role?: string | null; company?: string | null; recId?: string | null; createdAt?: string } = {}
): void {
  run(
    `INSERT INTO contacts (id, name, email, type, role, company, first_seen_at, last_seen_at, meeting_count, created_at, source, source_recording_id)
     VALUES (?, ?, ?, 'unknown', ?, ?, '2026-01-01', '2026-01-01', 0, ?, ?, ?)`,
    [id, name, opts.email ?? null, opts.role ?? null, opts.company ?? null, opts.createdAt ?? '2026-01-01T00:00:00Z', source, opts.recId ?? null]
  )
}

function mc(meetingId: string, contactId: string, source: string | null, recId: string | null = null): void {
  run(
    `INSERT INTO meeting_contacts (meeting_id, contact_id, role, source, source_recording_id) VALUES (?, ?, 'attendee', ?, ?)`,
    [meetingId, contactId, source, recId]
  )
}

function capture(id: string, recordingId: string, rating: string): void {
  run(
    `INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id, quality_rating) VALUES (?, ?, '2026-06-01', ?, ?)`,
    [id, id, recordingId, rating]
  )
}

function transcript(recordingId: string): void {
  run(
    `INSERT INTO transcripts (id, recording_id, full_text, created_at) VALUES (?, ?, 'x', '2026-06-01')`,
    [`trans_${recordingId}`, recordingId]
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

// ---------------------------------------------------------------------------
// ADV28-1 — transcript enrichment must not launder onto a structural contact
// ---------------------------------------------------------------------------

describe('ADV28-1 — transcript enrichment respects entity provenance', () => {
  it('does NOT fill a STRUCTURAL (user) contact role from a transcript participant', () => {
    meeting('m1')
    recording('r1', 'r1.hda', 'm1') // eligible
    // A manual/structural contact with an EMPTY role.
    contact('c-user', 'Alice Cooper', 'user', { role: null })

    applyTranscriptEntities({
      meetingId: 'm1',
      recordingId: 'r1',
      participants: [{ name: 'Alice Cooper', role: 'Chief Engineer' }]
    })

    const row = queryOne<{ role: string | null }>(`SELECT role FROM contacts WHERE id = 'c-user'`)
    // The transcript-derived role must NEVER land on a structural contact.
    expect(row?.role ?? null).toBeNull()
  })

  it('does NOT fill a CALENDAR contact role from a transcript participant', () => {
    meeting('m1')
    recording('r1', 'r1.hda', 'm1')
    contact('c-cal', 'Bob Vance', 'calendar', { role: null })

    applyTranscriptEntities({
      meetingId: 'm1',
      recordingId: 'r1',
      participants: [{ name: 'Bob Vance', role: 'Refrigeration' }]
    })

    const row = queryOne<{ role: string | null }>(`SELECT role FROM contacts WHERE id = 'c-cal'`)
    expect(row?.role ?? null).toBeNull()
  })

  it('DOES fill an empty role on a TRANSCRIPT-provenanced contact (legit path preserved)', () => {
    meeting('m1')
    recording('r1', 'r1.hda', 'm1')
    contact('c-tr', 'Carol Danvers', 'transcript', { role: null, recId: 'r1' })

    applyTranscriptEntities({
      meetingId: 'm1',
      recordingId: 'r1',
      participants: [{ name: 'Carol Danvers', role: 'Captain' }]
    })

    const row = queryOne<{ role: string | null }>(`SELECT role FROM contacts WHERE id = 'c-tr'`)
    expect(row?.role).toBe('Captain')
  })

  it('after excluding the recording, the enriched transcript contact is SUPPRESSED (never displays the role)', () => {
    meeting('m1')
    recording('r1', 'r1.hda', 'm1')
    contact('c-tr', 'Diana Prince', 'transcript', { role: null, recId: 'r1' })
    mc('m1', 'c-tr', 'transcript', 'r1')

    applyTranscriptEntities({
      meetingId: 'm1',
      recordingId: 'r1',
      participants: [{ name: 'Diana Prince', role: 'Ambassador' }]
    })
    expect(queryOne<{ role: string | null }>(`SELECT role FROM contacts WHERE id = 'c-tr'`)?.role).toBe('Ambassador')

    // Exclude the source recording.
    run(`UPDATE recordings SET personal = 1 WHERE id = 'r1'`)

    // The transcript-derived role can no longer display: the entity is suppressed.
    expect(filterVisibleEntityIds('contact', ['c-tr']).visible.has('c-tr')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// ADV28-2 — auto contact dedup partitions by provenance + eligibility
// ---------------------------------------------------------------------------

describe('ADV28-2 — mergeDuplicateContacts never launders excluded fields into a visible survivor', () => {
  it('does NOT fold an excluded transcript-only contact (same email) into a structural survivor', () => {
    meeting('m1')
    recording('r-bad', 'r-bad.hda', 'm1', { personal: true }) // excluded
    // Structural survivor with NO enriched fields.
    contact('c-user', 'Dana', 'user', { email: 'dana@x.com', role: null, company: null })
    // Excluded transcript-only contact sharing the email, carrying secret fields.
    contact('c-ghost', 'Dana Ghost', 'transcript', { email: 'dana@x.com', role: 'Secret Role', company: 'GhostCorp', recId: 'r-bad' })
    mc('m1', 'c-ghost', 'transcript', 'r-bad')

    const removed = mergeDuplicateContacts()

    // Cross-visibility-boundary pair ⇒ NOT merged.
    expect(removed).toBe(0)
    expect(queryAll('SELECT id FROM contacts')).toHaveLength(2)
    // The structural contact must NOT have gained the excluded contact's fields.
    const survivor = queryOne<{ role: string | null; company: string | null }>(`SELECT role, company FROM contacts WHERE id = 'c-user'`)
    expect(survivor?.role ?? null).toBeNull()
    expect(survivor?.company ?? null).toBeNull()
  })

  it('STILL dedups two structurally-visible contacts with the same email (folds role)', () => {
    contact('c1', 'Ed', 'user', { email: 'ed@x.com', role: null, createdAt: '2026-01-01T00:00:00Z' })
    contact('c2', 'Edward', 'user', { email: 'ed@x.com', role: 'Dev', createdAt: '2026-02-01T00:00:00Z' })

    const removed = mergeDuplicateContacts()

    expect(removed).toBe(1)
    const remaining = queryAll<{ role: string | null }>('SELECT role FROM contacts')
    expect(remaining).toHaveLength(1)
    expect(remaining[0].role).toBe('Dev')
  })

  it('STILL collapses two SUPPRESSED transcript-only contacts (survivor stays suppressed)', () => {
    meeting('m1')
    recording('r-bad', 'r-bad.hda', 'm1', { personal: true })
    contact('c1', 'Frank', 'transcript', { email: 'frank@x.com', recId: 'r-bad' })
    contact('c2', 'Frank', 'transcript', { email: 'frank@x.com', recId: 'r-bad' })

    const removed = mergeDuplicateContacts()

    expect(removed).toBe(1)
    const remaining = queryAll<{ id: string }>('SELECT id FROM contacts')
    expect(remaining).toHaveLength(1)
    // Survivor is still suppressed (its source recording is excluded).
    expect(filterVisibleEntityIds('contact', [remaining[0].id]).visible.has(remaining[0].id)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// ADV28-3 (CORE) — recording reconciliation never launders captures across eligibility
// ---------------------------------------------------------------------------

describe('ADV28-3 — mergeDuplicateRecordings keeps excluded captures excluded', () => {
  it('does NOT merge an eligible keeper with personal/soft-deleted siblings; their captures stay excluded', () => {
    meeting('m1')
    // Same base "Meeting1" across extensions ⇒ one duplicate group.
    recording('r-ok', 'Meeting1.wav', 'm1') // eligible
    transcript('r-ok') // makes it the natural keeper under the OLD logic
    capture('cap-ok', 'r-ok', 'valuable')
    recording('r-personal', 'Meeting1.hda', 'm1', { personal: true }) // excluded
    capture('cap-personal', 'r-personal', 'valuable')
    recording('r-deleted', 'Meeting1.m4a', 'm1', { deleted: true }) // excluded
    capture('cap-deleted', 'r-deleted', 'valuable')

    // Baseline: only the eligible capture is eligible.
    const before = filterEligibleCaptureIds(['cap-ok', 'cap-personal', 'cap-deleted']).eligible
    expect(before.has('cap-ok')).toBe(true)
    expect(before.has('cap-personal')).toBe(false)
    expect(before.has('cap-deleted')).toBe(false)

    const merged = mergeDuplicateRecordings()
    // Only ONE eligible member ⇒ nothing to collapse.
    expect(merged).toBe(0)

    // The excluded siblings still EXIST (were not folded away) and keep their captures.
    expect(queryOne(`SELECT id FROM recordings WHERE id = 'r-personal'`)).toBeTruthy()
    expect(queryOne(`SELECT id FROM recordings WHERE id = 'r-deleted'`)).toBeTruthy()
    expect(queryOne<{ src: string }>(`SELECT source_recording_id AS src FROM knowledge_captures WHERE id = 'cap-personal'`)?.src).toBe('r-personal')
    expect(queryOne<{ src: string }>(`SELECT source_recording_id AS src FROM knowledge_captures WHERE id = 'cap-deleted'`)?.src).toBe('r-deleted')

    // THE INVARIANT: captures excluded before the merge are STILL excluded after.
    const after = filterEligibleCaptureIds(['cap-ok', 'cap-personal', 'cap-deleted']).eligible
    expect(after.has('cap-ok')).toBe(true)
    expect(after.has('cap-personal')).toBe(false)
    expect(after.has('cap-deleted')).toBe(false)
  })

  it('does NOT let a value-excluded sibling launder its capture onto an eligible keeper', () => {
    meeting('m1')
    recording('r-ok', 'Take.wav', 'm1')
    transcript('r-ok')
    capture('cap-ok', 'r-ok', 'valuable')
    // A value-excluded recording: its ONLY capture is garbage ⇒ recording value-excluded.
    recording('r-garbage', 'Take.hda', 'm1')
    capture('cap-garbage', 'r-garbage', 'garbage')

    expect(filterEligibleCaptureIds(['cap-garbage']).eligible.has('cap-garbage')).toBe(false)

    const merged = mergeDuplicateRecordings()
    expect(merged).toBe(0)

    // The garbage capture must still point at its own (value-excluded) recording.
    expect(queryOne<{ src: string }>(`SELECT source_recording_id AS src FROM knowledge_captures WHERE id = 'cap-garbage'`)?.src).toBe('r-garbage')
    expect(filterEligibleCaptureIds(['cap-garbage']).eligible.has('cap-garbage')).toBe(false)
  })

  it('STILL collapses a group of ELIGIBLE duplicates (legit dedup preserved)', () => {
    meeting('m1')
    recording('r-a', 'Dup.hda', 'm1')
    capture('cap-a', 'r-a', 'valuable')
    recording('r-b', 'Dup.wav', 'm1')

    const merged = mergeDuplicateRecordings()
    expect(merged).toBe(1)
    // Exactly one row survives for the base "Dup".
    const rows = queryAll<{ id: string }>(`SELECT id FROM recordings WHERE LOWER(filename) LIKE 'dup.%'`)
    expect(rows).toHaveLength(1)
  })

  it('collapses the ELIGIBLE subset while leaving an excluded sibling untouched', () => {
    meeting('m1')
    recording('r-ok1', 'Mix.hda', 'm1')
    recording('r-ok2', 'Mix.wav', 'm1')
    recording('r-bad', 'Mix.m4a', 'm1', { personal: true })
    capture('cap-bad', 'r-bad', 'valuable')

    const merged = mergeDuplicateRecordings()
    expect(merged).toBe(1) // the two eligible rows collapse

    // The excluded sibling is untouched and its capture stays excluded.
    expect(queryOne(`SELECT id FROM recordings WHERE id = 'r-bad'`)).toBeTruthy()
    expect(queryOne<{ src: string }>(`SELECT source_recording_id AS src FROM knowledge_captures WHERE id = 'cap-bad'`)?.src).toBe('r-bad')
    expect(filterEligibleCaptureIds(['cap-bad']).eligible.has('cap-bad')).toBe(false)
    // Exactly one eligible row survives (r-ok1 or r-ok2) plus the untouched excluded row.
    const eligibleRows = queryAll<{ id: string }>(`SELECT id FROM recordings WHERE personal = 0 AND deleted_at IS NULL AND LOWER(filename) LIKE 'mix.%'`)
    expect(eligibleRows).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Provenance-consistency fix — upsertContactsFromMeetings tags 'calendar'
// ---------------------------------------------------------------------------

describe('upsertContactsFromMeetings — calendar-authored memberships are tagged', () => {
  it('creates a visible calendar contact (membership source = calendar)', () => {
    meeting('m1', { attendees: [{ name: 'Gwen Stacy', email: 'gwen@x.com' }] })
    upsertContactsFromMeetings()

    const link = queryOne<{ source: string | null; contact_id: string }>(
      `SELECT source, contact_id FROM meeting_contacts WHERE meeting_id = 'm1'`
    )
    expect(link?.source).toBe('calendar')
    // The contact is visible on non-owner surfaces via its calendar membership.
    expect(filterVisibleEntityIds('contact', [link!.contact_id]).visible.has(link!.contact_id)).toBe(true)
  })
})
