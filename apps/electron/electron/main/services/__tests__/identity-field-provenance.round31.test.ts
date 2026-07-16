// @vitest-environment node

/**
 * MERGE-GATE round 31 — resolver no-reanimation (ADV29-1) + per-field role
 * provenance (ADV29-2). REAL temp DB, real database.ts (better-sqlite3) end to end.
 *
 * ADV29-1 — the entity resolver must not return a SUPPRESSED entity (one whose sole
 *   source recording is excluded) as an auto-link target; applyTranscriptEntities
 *   would relink it to the current eligible recording and re-expose the whole
 *   previously-suppressed entity. Instead a SEPARATE transcript-provenanced entity
 *   is created. A genuinely visible (calendar/user/eligible) entity still resolves.
 * ADV29-2 — contacts.role_source_recording_id (v46): a contact kept VISIBLE via an
 *   eligible recording B still displays a role enriched from an excluded recording A
 *   unless the role is blanked by its per-field provenance. NULL provenance
 *   (calendar/manual/legacy) is always shown.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-identity-r31-${process.pid}.sqlite`)
vi.mock('../file-storage', () => ({ getDatabasePath: () => dbPath }))
vi.mock('../../services/file-storage', () => ({ getDatabasePath: () => dbPath }))

const handlers = new Map<string, (...args: any[]) => any>()
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (...args: any[]) => any) => { handlers.set(channel, fn) } },
  shell: { openPath: vi.fn(async () => '') }
}))

import {
  initializeDatabase,
  closeDatabase,
  run,
  queryOne,
  queryAll,
  getContactById,
  getDatabase,
  filterVisibleEntityIds,
  blankIneligibleContactFields,
  updateContact,
  mergeContacts
} from '../database'
import { resolveContact, resolveProject } from '../entity-resolver'
import { applyTranscriptEntities } from '../org-reconciler'
import { registerContactsHandlers } from '../../ipc/contacts-handlers'
import { getTableColumns } from '@hidock/database'

function invoke(channel: string, ...args: any[]): Promise<any> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  return Promise.resolve(fn({} as any, ...args))
}

// --- seed helpers -----------------------------------------------------------

function meeting(id: string): void {
  run(`INSERT INTO meetings (id, subject, start_time, end_time) VALUES (?, ?, '2026-01-02T10:00:00Z', '2026-01-02T11:00:00Z')`, [id, id])
}
function recording(id: string, meetingId: string | null, opts: { personal?: boolean; deleted?: boolean } = {}): void {
  run(
    `INSERT INTO recordings (id, filename, date_recorded, personal, deleted_at, meeting_id) VALUES (?, ?, '2026-01-02T10:00:00Z', ?, ?, ?)`,
    [id, `${id}.hda`, opts.personal ? 1 : 0, opts.deleted ? '2026-07-01T00:00:00Z' : null, meetingId]
  )
}
function excludeRecording(id: string): void {
  run(`UPDATE recordings SET personal = 1 WHERE id = ?`, [id])
}
function contact(
  id: string,
  name: string,
  source: string | null,
  recId: string | null = null,
  role: string | null = null,
  roleRecId: string | null = null,
  email: string | null = null
): void {
  run(
    `INSERT INTO contacts (id, name, email, type, role, first_seen_at, last_seen_at, meeting_count, source, source_recording_id, role_source_recording_id)
     VALUES (?, ?, ?, 'unknown', ?, '2026-01-01', '2026-01-01', 0, ?, ?, ?)`,
    [id, name, email, role, source, recId, roleRecId]
  )
}
function project(id: string, name: string, source: string | null, recId: string | null = null): void {
  run(`INSERT INTO projects (id, name, status, source, source_recording_id) VALUES (?, ?, 'active', ?, ?)`, [id, name, source, recId])
}
function mc(meetingId: string, contactId: string, source: string | null, recId: string | null = null): void {
  run(`INSERT INTO meeting_contacts (meeting_id, contact_id, role, source, source_recording_id) VALUES (?, ?, 'attendee', ?, ?)`, [meetingId, contactId, source, recId])
}
function mp(meetingId: string, projectId: string, source: string | null, recId: string | null = null): void {
  run(`INSERT INTO meeting_projects (meeting_id, project_id, source, source_recording_id) VALUES (?, ?, ?, ?)`, [meetingId, projectId, source, recId])
}

beforeEach(async () => {
  handlers.clear()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
  registerContactsHandlers()
})
afterEach(() => {
  closeDatabase()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
})

// ---------------------------------------------------------------------------
// v46 migration / schema
// ---------------------------------------------------------------------------

describe('v46/v48 migration — contacts.role_source_recording_id + role_origin', () => {
  it('columns exist after init and schema version is 48', () => {
    const cols = getTableColumns(getDatabase(), 'contacts')
    expect(cols).toContain('role_source_recording_id')
    // round-51 bumped 47 -> 48 (role provenance-trust marker, ADV49-2).
    expect(cols).toContain('role_origin')
    const v = queryOne<{ v: number }>('SELECT MAX(version) AS v FROM schema_version')
    expect(v?.v).toBe(48)
  })

  // ADV49-2 (round-51) FLIP: a role with NULL provenance is NO LONGER implicitly
  // trusted. A transcript-origin entity whose role predates field-provenance (NULL
  // role_source_recording_id, no role_origin marker) is an AMBIGUOUS legacy role ⇒
  // BLANKED on non-owner surfaces (pre-v46 applyTranscriptEntities wrote transcript
  // roles with the column NULL too, so NULL is not proof of a calendar/manual role).
  it('legacy transcript role with NULL provenance is BLANKED (ADV49-2)', () => {
    contact('c-legacy', 'Legacy Role', 'transcript', null, 'CTO', null)
    const [safe] = blankIneligibleContactFields([getContactById('c-legacy')!])
    expect(safe.role).toBeNull()
  })

  // The trusted-structural side of the flip: a NULL-provenance role on a
  // calendar/user entity is genuinely structural ⇒ still SHOWN.
  it('legacy NULL-provenance role on a calendar/user entity is still shown', () => {
    contact('c-cal-legacy', 'Cal Legacy', 'calendar', null, 'Director', null)
    contact('c-user-legacy', 'User Legacy', 'user', null, 'Founder', null)
    expect(blankIneligibleContactFields([getContactById('c-cal-legacy')!])[0].role).toBe('Director')
    expect(blankIneligibleContactFields([getContactById('c-user-legacy')!])[0].role).toBe('Founder')
  })

  // An explicit role_origin='legacy' marker (what the v48 backfill stamps on
  // ambiguous rows) is blanked regardless of the entity source.
  it('an explicit role_origin=legacy marker is blanked', () => {
    contact('c-marked', 'Marked Legacy', 'calendar', null, 'VP', null)
    run(`UPDATE contacts SET role_origin = 'legacy' WHERE id = 'c-marked'`)
    expect(blankIneligibleContactFields([getContactById('c-marked')!])[0].role).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// ADV29-1 — resolver must not reanimate a suppressed entity
// ---------------------------------------------------------------------------

describe('ADV29-1 — resolver bars suppressed entities as link targets', () => {
  beforeEach(() => {
    meeting('m-old')
    recording('r-old', 'm-old', { personal: true }) // EXCLUDED source
    // Suppressed transcript contact: sole membership + entity source is the excluded recording.
    contact('c-dana', 'Dana', 'transcript', 'r-old', 'Engineer', 'r-old', 'dana@x.com')
    mc('m-old', 'c-dana', 'transcript', 'r-old')
    // Suppressed transcript project.
    project('p-old', 'OldProject', 'transcript', 'r-old')
    mp('m-old', 'p-old', 'transcript', 'r-old')
  })

  it('the suppressed contact/project are not visible', () => {
    expect(filterVisibleEntityIds('contact', ['c-dana']).visible.has('c-dana')).toBe(false)
    expect(filterVisibleEntityIds('project', ['p-old']).visible.has('p-old')).toBe(false)
  })

  it('resolveContact does NOT return a suppressed exact-name / email match', () => {
    expect(resolveContact('Dana').id).toBeNull()
    expect(resolveContact('dana@x.com').id).toBeNull()
  })

  it('resolveProject does NOT return a suppressed exact-name match', () => {
    expect(resolveProject('OldProject').id).toBeNull()
  })

  it('a genuinely VISIBLE (calendar/user) contact/project still resolves normally', () => {
    contact('c-live', 'Sam Rivera', 'calendar', null) // structural ⇒ visible
    project('p-live', 'LiveProject', 'user', null)
    expect(resolveContact('Sam Rivera').id).toBe('c-live')
    expect(resolveProject('LiveProject').id).toBe('p-live')
  })

  it('applyTranscriptEntities creates a NEW entity for an eligible recording instead of reanimating', () => {
    meeting('m-new')
    recording('r-new', 'm-new', {}) // ELIGIBLE
    applyTranscriptEntities({
      meetingId: 'm-new',
      recordingId: 'r-new',
      participants: [{ name: 'Dana', role: 'Manager' }],
      project: { name: 'OldProject' }
    })

    // The old suppressed contact stays suppressed and gains NO membership to m-new.
    expect(filterVisibleEntityIds('contact', ['c-dana']).visible.has('c-dana')).toBe(false)
    expect(queryOne('SELECT 1 FROM meeting_contacts WHERE meeting_id = ? AND contact_id = ?', ['m-new', 'c-dana'])).toBeUndefined()

    // A separate NEW transcript contact was created for the eligible recording.
    const fresh = queryAll<{ id: string; source: string | null; source_recording_id: string | null }>(
      "SELECT id, source, source_recording_id FROM contacts WHERE LOWER(name) = 'dana' AND id <> 'c-dana'"
    )
    expect(fresh).toHaveLength(1)
    expect(fresh[0].source).toBe('transcript')
    expect(fresh[0].source_recording_id).toBe('r-new')
    expect(filterVisibleEntityIds('contact', [fresh[0].id]).visible.has(fresh[0].id)).toBe(true)

    // Same for the project: the suppressed p-old is not relinked to m-new.
    expect(queryOne('SELECT 1 FROM meeting_projects WHERE meeting_id = ? AND project_id = ?', ['m-new', 'p-old'])).toBeUndefined()
    const freshP = queryAll<{ id: string }>("SELECT id FROM projects WHERE LOWER(name) = 'oldproject' AND id <> 'p-old'")
    expect(freshP).toHaveLength(1)
  })

  it('fail-closed: when eligibility cannot be determined, resolver creates new rather than linking', () => {
    // The only 'Dana' is the SUPPRESSED transcript contact from beforeEach (c-dana,
    // sourced by the excluded r-old). Simulate a lookup failure by dropping the
    // recordings table so the entity-visibility lookup fails closed ⇒ the suppressed
    // contact is barred as a link target ⇒ resolver returns no id (create-new).
    // (round-32 note: a genuinely-visible calendar/user contact is NOT recording-gated
    //  and would still resolve — that is correct, not a leak; the fail-closed invariant
    //  only bars recording-gated/suppressed candidates. See ADV30-1.)
    run('DROP TABLE recordings')
    expect(resolveContact('Dana').id).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// ADV29-2 — per-field role provenance blanking
// ---------------------------------------------------------------------------

describe('ADV29-2 — role blanked when its source recording is ineligible', () => {
  // getById validates a UUID, so the multi-recording contact uses a real UUID.
  const C1 = '11111111-1111-4111-8111-111111111111'
  const CKEEP = '22222222-2222-4222-8222-222222222222'
  beforeEach(() => {
    meeting('m-a')
    meeting('m-b')
    recording('r-a', 'm-a', {}) // supplies the role
    recording('r-b', 'm-b', {}) // keeps the entity visible
    // Multi-recording transcript contact: role enriched from r-A, visible via r-B.
    contact(C1, 'Multi Rec', 'transcript', 'r-a', 'Engineer', 'r-a')
    mc('m-a', C1, 'transcript', 'r-a')
    mc('m-b', C1, 'transcript', 'r-b')
  })

  it('both recordings eligible ⇒ contact visible AND role shown', () => {
    expect(filterVisibleEntityIds('contact', [C1]).visible.has(C1)).toBe(true)
    expect(blankIneligibleContactFields([getContactById(C1)!])[0].role).toBe('Engineer')
  })

  it('exclude A (keep B) ⇒ contact still visible but role BLANK', () => {
    excludeRecording('r-a')
    expect(filterVisibleEntityIds('contact', [C1]).visible.has(C1)).toBe(true) // B keeps it visible
    expect(blankIneligibleContactFields([getContactById(C1)!])[0].role).toBeNull()
  })

  it('contacts:getById reflects the blanked role but still returns the contact', async () => {
    excludeRecording('r-a')
    const res = await invoke('contacts:getById', C1)
    expect(res.success).toBe(true)
    expect(res.data.contact.role).toBeNull()
  })

  it('contacts:getAll blanks the role of a still-listed contact', async () => {
    excludeRecording('r-a')
    const res = await invoke('contacts:getAll', {})
    expect(res.success).toBe(true)
    const row = res.data.contacts.find((c: any) => c.id === C1)
    expect(row).toBeDefined()
    expect(row.role).toBeNull()
  })

  it('exclude BOTH ⇒ contact suppressed entirely (getById NOT_FOUND)', async () => {
    excludeRecording('r-a')
    excludeRecording('r-b')
    expect(filterVisibleEntityIds('contact', [C1]).visible.has(C1)).toBe(false)
    const res = await invoke('contacts:getById', C1)
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('NOT_FOUND')
  })

  it('a calendar-set role is always shown regardless of recording exclusion', () => {
    contact('c-cal', 'Cal Person', 'calendar', null, 'Manager', null)
    excludeRecording('r-a')
    excludeRecording('r-b')
    expect(blankIneligibleContactFields([getContactById('c-cal')!])[0].role).toBe('Manager')
  })

  it('fail-closed: an eligibility lookup failure blanks a transcript-sourced role', () => {
    run('DROP TABLE recordings')
    expect(blankIneligibleContactFields([getContactById(C1)!])[0].role).toBeNull()
  })

  it('a user edit clears field-provenance so the role is always shown afterward', () => {
    excludeRecording('r-a')
    updateContact(C1, { role: 'Owner-Set Role' })
    expect(queryOne<{ x: string | null }>('SELECT role_source_recording_id AS x FROM contacts WHERE id = ?', [C1])?.x).toBeNull()
    expect(blankIneligibleContactFields([getContactById(C1)!])[0].role).toBe('Owner-Set Role')
  })

  it('mergeContacts folds the role WITH its field-provenance (no laundering)', () => {
    // Keeper has empty role; loser carries a transcript role from r-A. After merge the
    // keeper displays the folded role, but blanks it once r-A is excluded.
    contact(CKEEP, 'Keeper', 'calendar', null, null, null)
    mc('m-b', CKEEP, 'calendar', null) // keep it visible structurally
    mergeContacts(CKEEP, C1)
    expect(getContactById(CKEEP)!.role).toBe('Engineer')
    expect(getContactById(CKEEP)!.role_source_recording_id).toBe('r-a')
    excludeRecording('r-a')
    expect(blankIneligibleContactFields([getContactById(CKEEP)!])[0].role).toBeNull()
  })
})
