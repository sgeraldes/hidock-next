// @vitest-environment node

/**
 * Round-28 identity-subsystem sweep — entity/resolver/bucket/mention gating.
 *
 * ADV27-1 — the visible-identity boundary (filterVisibleEntityIds) + the gated
 *   contacts:getAll/getById + projects:getAll/getById handlers: a transcript-created
 *   ENTITY whose sole source recording is excluded (personal/soft-deleted/
 *   value-excluded/hard-purged) is suppressed on the NON-OWNER surface; a
 *   manual('user')/calendar entity is always visible.
 * ADV27-3 — the resolver co-occurrence context is membership-eligibility gated: an
 *   EXCLUDED recording's membership must NOT flip an eligible transcript mention
 *   from ambiguous into an auto-link.
 * ADV27-4 — buckets/auto-split operate only on eligible recordings, and
 *   identity:resolveMention refuses a stale-click on a now-ineligible recording.
 *
 * REAL temp DB, real database.ts (better-sqlite3) end to end.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-identity-r28-${process.pid}.sqlite`)
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
  filterVisibleEntityIds,
  getAmbiguousBuckets,
  getBucketResolution
} from '../database'
import { resolveContact } from '../entity-resolver'
import { autoSplitAmbiguousBuckets } from '../org-reconciler'
import { registerContactsHandlers } from '../../ipc/contacts-handlers'
import { registerProjectsHandlers } from '../../ipc/projects-handlers'
import { registerIdentityHandlers } from '../../ipc/identity-handlers'

function invoke(channel: string, ...args: any[]): Promise<any> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  return Promise.resolve(fn({} as any, ...args))
}

// --- seed helpers -----------------------------------------------------------

function contact(id: string, name: string, source: string | null, recId: string | null = null): void {
  run(
    `INSERT INTO contacts (id, name, type, first_seen_at, last_seen_at, meeting_count, source, source_recording_id)
     VALUES (?, ?, 'unknown', '2026-01-01', '2026-01-01', 0, ?, ?)`,
    [id, name, source, recId]
  )
}
function project(id: string, name: string, source: string | null, recId: string | null = null): void {
  run(`INSERT INTO projects (id, name, status, source, source_recording_id) VALUES (?, ?, 'active', ?, ?)`, [id, name, source, recId])
}
function meeting(id: string): void {
  run(`INSERT INTO meetings (id, subject, start_time, end_time) VALUES (?, ?, '2026-01-02T10:00:00Z', '2026-01-02T11:00:00Z')`, [id, id])
}
function recording(id: string, meetingId: string | null, opts: { personal?: boolean; deleted?: boolean } = {}): void {
  run(
    `INSERT INTO recordings (id, filename, date_recorded, personal, deleted_at, meeting_id) VALUES (?, ?, '2026-01-02T10:00:00Z', ?, ?, ?)`,
    [id, `${id}.hda`, opts.personal ? 1 : 0, opts.deleted ? '2026-07-01T00:00:00Z' : null, meetingId]
  )
}
function valueExclude(recordingId: string): void {
  run(
    `INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id, quality_rating) VALUES (?, 'Cap', '2026-06-01', ?, 'garbage')`,
    [`cap-${recordingId}`, recordingId]
  )
}
function mc(meetingId: string, contactId: string, source: string | null, recId: string | null = null): void {
  run(
    `INSERT INTO meeting_contacts (meeting_id, contact_id, role, source, source_recording_id) VALUES (?, ?, 'attendee', ?, ?)`,
    [meetingId, contactId, source, recId]
  )
}
function mp(meetingId: string, projectId: string, source: string | null, recId: string | null = null): void {
  run(`INSERT INTO meeting_projects (meeting_id, project_id, source, source_recording_id) VALUES (?, ?, ?, ?)`, [meetingId, projectId, source, recId])
}

beforeEach(async () => {
  handlers.clear()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
  registerContactsHandlers()
  registerProjectsHandlers()
  registerIdentityHandlers()
})
afterEach(() => {
  closeDatabase()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
})

// ---------------------------------------------------------------------------
// ADV27-1 — entity-visibility boundary
// ---------------------------------------------------------------------------

describe('ADV27-1 — filterVisibleEntityIds (contacts)', () => {
  it('suppresses a transcript ENTITY whose sole source recording is personal', () => {
    meeting('m1')
    recording('r1', 'm1', { personal: true })
    contact('c1', 'Ghost', 'transcript', 'r1')
    mc('m1', 'c1', 'transcript', 'r1')
    const { visible } = filterVisibleEntityIds('contact', ['c1'])
    expect(visible.has('c1')).toBe(false)
  })

  it('suppresses a transcript ENTITY whose sole source recording is soft-deleted', () => {
    meeting('m1'); recording('r1', 'm1', { deleted: true })
    contact('c1', 'Ghost', 'transcript', 'r1'); mc('m1', 'c1', 'transcript', 'r1')
    expect(filterVisibleEntityIds('contact', ['c1']).visible.has('c1')).toBe(false)
  })

  it('suppresses a transcript ENTITY whose sole source recording is value-excluded', () => {
    meeting('m1'); recording('r1', 'm1'); valueExclude('r1')
    contact('c1', 'Ghost', 'transcript', 'r1'); mc('m1', 'c1', 'transcript', 'r1')
    expect(filterVisibleEntityIds('contact', ['c1']).visible.has('c1')).toBe(false)
  })

  it('suppresses a transcript ENTITY whose source recording is HARD-PURGED (no recording row)', () => {
    // No recordings row for r-gone, and no membership → zero-membership transcript entity.
    contact('c1', 'Ghost', 'transcript', 'r-gone')
    expect(filterVisibleEntityIds('contact', ['c1']).visible.has('c1')).toBe(false)
  })

  it('keeps a transcript ENTITY whose source recording is ELIGIBLE', () => {
    meeting('m1'); recording('r1', 'm1')
    contact('c1', 'Real', 'transcript', 'r1'); mc('m1', 'c1', 'transcript', 'r1')
    expect(filterVisibleEntityIds('contact', ['c1']).visible.has('c1')).toBe(true)
  })

  it('keeps a transcript ENTITY with NO membership but an eligible source_recording_id', () => {
    meeting('m1'); recording('r1', 'm1')
    contact('c1', 'Orphan', 'transcript', 'r1') // no meeting_contacts row
    expect(filterVisibleEntityIds('contact', ['c1']).visible.has('c1')).toBe(true)
  })

  it('always keeps a manual (user) contact', () => {
    contact('c1', 'Manual', 'user')
    expect(filterVisibleEntityIds('contact', ['c1']).visible.has('c1')).toBe(true)
  })

  it('always keeps a calendar contact even with an excluded transcript membership', () => {
    meeting('m1'); recording('r1', 'm1', { personal: true })
    contact('c1', 'CalPerson', 'calendar')
    mc('m1', 'c1', 'transcript', 'r1')
    expect(filterVisibleEntityIds('contact', ['c1']).visible.has('c1')).toBe(true)
  })

  it('suppresses a legacy NULL-source entity with only NULL-provenance memberships', () => {
    meeting('m1'); recording('r1', 'm1')
    contact('c1', 'Legacy', null)
    mc('m1', 'c1', null, null) // legacy membership
    expect(filterVisibleEntityIds('contact', ['c1']).visible.has('c1')).toBe(false)
  })

  it('keeps a legacy NULL-source entity that still has a CALENDAR membership', () => {
    meeting('m1')
    contact('c1', 'LegacyCal', null)
    mc('m1', 'c1', 'calendar', null)
    expect(filterVisibleEntityIds('contact', ['c1']).visible.has('c1')).toBe(true)
  })

  it('does not resolve a non-existent entity id (positive allowlist)', () => {
    expect(filterVisibleEntityIds('contact', ['nope']).visible.has('nope')).toBe(false)
  })
})

describe('ADV27-1 — filterVisibleEntityIds (projects)', () => {
  it('suppresses a transcript project whose sole source recording is value-excluded', () => {
    meeting('m1'); recording('r1', 'm1'); valueExclude('r1')
    project('p1', 'GhostProj', 'transcript', 'r1'); mp('m1', 'p1', 'transcript', 'r1')
    expect(filterVisibleEntityIds('project', ['p1']).visible.has('p1')).toBe(false)
  })
  it('keeps a manual (user) project', () => {
    project('p1', 'ManualProj', 'user')
    expect(filterVisibleEntityIds('project', ['p1']).visible.has('p1')).toBe(true)
  })
  it('keeps a transcript project whose recording is eligible', () => {
    meeting('m1'); recording('r1', 'm1')
    project('p1', 'RealProj', 'transcript', 'r1'); mp('m1', 'p1', 'transcript', 'r1')
    expect(filterVisibleEntityIds('project', ['p1']).visible.has('p1')).toBe(true)
  })
})

describe('ADV27-1 — gated handlers', () => {
  it('contacts:getAll omits a suppressed transcript entity, keeps manual + eligible', async () => {
    meeting('m1'); recording('r-bad', 'm1', { personal: true }); recording('r-ok', 'm1')
    contact('c-ghost', 'Ghost', 'transcript', 'r-bad'); mc('m1', 'c-ghost', 'transcript', 'r-bad')
    contact('c-real', 'Real', 'transcript', 'r-ok'); mc('m1', 'c-real', 'transcript', 'r-ok')
    contact('c-manual', 'Manual', 'user')
    const res = await invoke('contacts:getAll', {})
    expect(res.success).toBe(true)
    const ids = res.data.contacts.map((c: any) => c.id).sort()
    expect(ids).toEqual(['c-manual', 'c-real'])
  })

  it('contacts:getById returns NOT_FOUND for a suppressed transcript entity', async () => {
    const GHOST = '550e8400-e29b-41d4-a716-446655440099' // getById requires a UUID id
    meeting('m1'); recording('r-bad', 'm1', { deleted: true })
    contact(GHOST, 'Ghost', 'transcript', 'r-bad'); mc('m1', GHOST, 'transcript', 'r-bad')
    const res = await invoke('contacts:getById', GHOST)
    expect(res.success).toBe(false)
    expect(res.error?.code).toBe('NOT_FOUND')
  })

  it('projects:getAll omits a suppressed transcript project', async () => {
    meeting('m1'); recording('r-bad', 'm1', { personal: true })
    project('p-ghost', 'Ghost', 'transcript', 'r-bad'); mp('m1', 'p-ghost', 'transcript', 'r-bad')
    project('p-manual', 'Manual', 'user')
    const res = await invoke('projects:getAll', {})
    expect(res.success).toBe(true)
    const ids = res.data.projects.map((p: any) => p.id).sort()
    expect(ids).toEqual(['p-manual'])
  })
})

// ---------------------------------------------------------------------------
// ADV27-3 — resolver co-occurrence eligibility
// ---------------------------------------------------------------------------

describe('ADV27-3 — resolver does not auto-link off an EXCLUDED membership', () => {
  it('an excluded recording membership must NOT flip an ambiguous mention into an attendee-context auto-link', () => {
    // "Sergio" is ambiguous: it matches TWO surname-bearers (Hurtado + Gomez).
    meeting('m1')
    recording('r-excluded', 'm1', { personal: true })
    contact('c-hurtado', 'Sergio Hurtado', 'transcript', 'r-excluded')
    contact('c-gomez', 'Sergio Gomez', 'user')
    // The ONLY membership placing a surname-bearer in the meeting is from the EXCLUDED recording.
    mc('m1', 'c-hurtado', 'transcript', 'r-excluded')

    const res = resolveContact('Sergio', { meetingId: 'm1' })
    // Fixed: the excluded membership is filtered out of the co-occurrence set, so no
    // sole attendee is present and the bucket stays ambiguous (no auto-link).
    expect(res.ambiguous).toBe(true)
    expect(res.method).not.toBe('attendee-context')
  })

  it('an ELIGIBLE recording membership still resolves the ambiguous mention by attendee context', () => {
    meeting('m1')
    recording('r-ok', 'm1')
    contact('c-hurtado', 'Sergio Hurtado', 'transcript', 'r-ok')
    contact('c-gomez', 'Sergio Gomez', 'user')
    mc('m1', 'c-hurtado', 'transcript', 'r-ok')

    const res = resolveContact('Sergio', { meetingId: 'm1' })
    expect(res.method).toBe('attendee-context')
    expect(res.id).toBe('c-hurtado')
  })
})

// ---------------------------------------------------------------------------
// ADV27-4 — buckets / auto-split / resolveMention eligibility
// ---------------------------------------------------------------------------

describe('ADV27-4 — buckets exclude ineligible recordings', () => {
  function seedBucket(recOpts: { personal?: boolean; deleted?: boolean; valueExcluded?: boolean; hardPurged?: boolean }): void {
    // Bucket "Sergio" + surname bearers so detectAmbiguousName flags it ambiguous.
    contact('c-bucket', 'Sergio', 'user')
    contact('c-sh', 'Sergio Hurtado', 'user')
    contact('c-sg', 'Sergio Gomez', 'user')
    meeting('m1')
    if (!recOpts.hardPurged) {
      recording('r1', 'm1', { personal: recOpts.personal, deleted: recOpts.deleted })
      if (recOpts.valueExcluded) valueExclude('r1')
    }
    // The bucket contact attends the meeting (so buildBucketResolution finds the meeting's recording).
    mc('m1', 'c-bucket', 'calendar')
    mc('m1', 'c-sh', 'calendar')
  }

  it('a value-excluded recording is absent from the bucket resolution', () => {
    seedBucket({ valueExcluded: true })
    const res = getBucketResolution('c-bucket')
    expect(res).not.toBeNull()
    expect(res!.recordings.map((r) => r.recordingId)).not.toContain('r1')
  })

  it('a personal recording is absent from the bucket resolution', () => {
    seedBucket({ personal: true })
    const res = getBucketResolution('c-bucket')
    expect(res!.recordings.map((r) => r.recordingId)).not.toContain('r1')
  })

  it('autoSplitAmbiguousBuckets does not resolve mentions for an excluded recording', () => {
    seedBucket({ valueExcluded: true })
    // r1 has a sole attendee (c-sh) so it WOULD auto-split if it were eligible.
    autoSplitAmbiguousBuckets()
    const buckets = getAmbiguousBuckets()
    const bucket = buckets.find((b) => b.contactId === 'c-bucket')
    // The excluded recording is not counted, so there is nothing pending to resolve for it.
    expect(bucket?.recordingCount ?? 0).toBe(0)
  })
})

describe('ADV27-4 — identity:resolveMention accept-time recheck', () => {
  it('refuses a stale-click when the recording became ineligible (value-excluded)', async () => {
    meeting('m1'); recording('r1', 'm1'); valueExclude('r1')
    contact('c-sh', 'Sergio Hurtado', 'user')
    const res = await invoke('identity:resolveMention', {
      recordingId: 'r1',
      sourceName: 'Sergio',
      contactId: 'c-sh',
      method: 'manual'
    })
    expect(res.success).toBe(false)
    expect(res.error?.code).toBe('RECORDING_INELIGIBLE')
  })

  it('allows resolveMention on an eligible recording', async () => {
    meeting('m1'); recording('r1', 'm1')
    contact('c-sh', 'Sergio Hurtado', 'user')
    const res = await invoke('identity:resolveMention', {
      recordingId: 'r1',
      sourceName: 'Sergio',
      contactId: 'c-sh',
      method: 'manual'
    })
    expect(res.success).toBe(true)
  })
})
