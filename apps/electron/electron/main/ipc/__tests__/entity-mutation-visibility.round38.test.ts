// @vitest-environment node

/**
 * ADV36-2 / ADV36-3 (round-38) — entity-mutation IPCs must not launder or reveal a
 * SUPPRESSED entity through the visible-identity boundary.
 *
 *  • contacts:merge / projects:merge — fold the loser's fields/aliases/memberships
 *    onto the keeper. A stale/suppressed loser (or keeper) merging into a visible
 *    entity would launder excluded-derived identity. BOTH ids must be visible.
 *  • contacts:create — with BOTH a suppressed twin AND a visible same-name contact,
 *    fetch-ALL + filter must pick the VISIBLE duplicate (an unordered LIMIT-1 could
 *    pick the suppressed row and mint a duplicate). Lookup failure ⇒ RETRYABLE.
 *  • contacts:update / projects:update — a suppressed target (already hidden from
 *    getById) must not be mutable via a stale UI reference.
 *
 * REAL temp DB, real database.ts (better-sqlite3), real handlers end to end.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'
import { randomUUID } from 'crypto'

const dbPath = join(tmpdir(), `hidock-r38-entity-mut-${process.pid}.sqlite`)
vi.mock('../../services/file-storage', () => ({ getDatabasePath: () => dbPath }))

const handlers = new Map<string, (...args: any[]) => any>()
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (...args: any[]) => any) => { handlers.set(channel, fn) } },
  shell: { openPath: vi.fn(async () => '') }
}))

import { initializeDatabase, closeDatabase, run, queryOne } from '../../services/database'
import { registerContactsHandlers } from '../contacts-handlers'
import { registerProjectsHandlers } from '../projects-handlers'

function invoke(channel: string, ...args: any[]): Promise<any> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  return Promise.resolve(fn({} as any, ...args))
}

// --- seed helpers -----------------------------------------------------------

function seedContact(
  id: string,
  name: string,
  source: string | null,
  recId: string | null = null,
  createdAt = '2026-01-01T00:00:00Z'
): void {
  run(
    `INSERT INTO contacts (id, name, type, first_seen_at, last_seen_at, meeting_count, source, source_recording_id, created_at)
     VALUES (?, ?, 'unknown', '2026-01-01', '2026-01-01', 0, ?, ?, ?)`,
    [id, name, source, recId, createdAt]
  )
}
function seedProject(id: string, name: string, source: string | null, recId: string | null = null): void {
  run(`INSERT INTO projects (id, name, source, source_recording_id) VALUES (?, ?, ?, ?)`, [id, name, source, recId])
}
function seedRecording(id: string, opts: { personal?: boolean; deleted?: boolean } = {}): void {
  run(
    `INSERT INTO recordings (id, filename, date_recorded, personal, deleted_at) VALUES (?, ?, '2026-01-02T10:00:00Z', ?, ?)`,
    [id, `${id}.hda`, opts.personal ? 1 : 0, opts.deleted ? '2026-07-01T00:00:00Z' : null]
  )
}

beforeEach(async () => {
  handlers.clear()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
  registerContactsHandlers()
  registerProjectsHandlers()
})
afterEach(() => {
  closeDatabase()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
})

// ---------------------------------------------------------------------------
// contacts:merge — gate BOTH ids (ADV36-2)
// ---------------------------------------------------------------------------

describe('contacts:merge — gates both keeper and loser through the visible-identity boundary', () => {
  it('visible keeper + SUPPRESSED loser ⇒ refused (no merge, no field fold)', async () => {
    const keeper = randomUUID()
    const loser = randomUUID()
    seedRecording('r-del', { deleted: true })
    seedContact(keeper, 'Alice', 'user')
    seedContact(loser, 'Alicia', 'transcript', 'r-del') // suppressed
    const res = await invoke('contacts:merge', { keeperId: keeper, loserId: loser })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('MERGE_NOT_ALLOWED')
    // Loser row survives (no merge happened).
    expect(queryOne('SELECT id FROM contacts WHERE id = ?', [loser])).toBeTruthy()
  })

  it('SUPPRESSED keeper + visible loser ⇒ refused', async () => {
    const keeper = randomUUID()
    const loser = randomUUID()
    seedRecording('r-personal', { personal: true })
    seedContact(keeper, 'Alice', 'transcript', 'r-personal') // suppressed
    seedContact(loser, 'Alicia', 'user')
    const res = await invoke('contacts:merge', { keeperId: keeper, loserId: loser })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('MERGE_NOT_ALLOWED')
  })

  it('hard-purged loser provenance (recording row gone) ⇒ refused', async () => {
    const keeper = randomUUID()
    const loser = randomUUID()
    seedContact(keeper, 'Alice', 'user')
    seedContact(loser, 'Alicia', 'transcript', 'r-gone') // no recordings row ⇒ suppressed
    const res = await invoke('contacts:merge', { keeperId: keeper, loserId: loser })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('MERGE_NOT_ALLOWED')
  })

  it('visibility lookup failure ⇒ refused (fail-closed)', async () => {
    const keeper = randomUUID()
    const loser = randomUUID()
    seedContact(keeper, 'Alice', 'user')
    seedContact(loser, 'Alicia', 'user')
    run('DROP TABLE meeting_contacts') // filterVisibleEntityIds throws ⇒ failClosed
    const res = await invoke('contacts:merge', { keeperId: keeper, loserId: loser })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('MERGE_NOT_ALLOWED')
  })

  it('BOTH visible ⇒ merges', async () => {
    const keeper = randomUUID()
    const loser = randomUUID()
    seedContact(keeper, 'Alice', 'user')
    seedContact(loser, 'Alicia', 'user')
    const res = await invoke('contacts:merge', { keeperId: keeper, loserId: loser })
    expect(res.success).toBe(true)
    expect(res.data.id).toBe(keeper)
    expect(queryOne('SELECT id FROM contacts WHERE id = ?', [loser])).toBeFalsy()
  })
})

// ---------------------------------------------------------------------------
// projects:merge — MANUAL analogue of contacts:merge (sweep)
// ---------------------------------------------------------------------------

describe('projects:merge — gates both keeper and loser', () => {
  it('visible keeper + SUPPRESSED loser ⇒ refused', async () => {
    const keeper = randomUUID()
    const loser = randomUUID()
    seedRecording('r-del', { deleted: true })
    seedProject(keeper, 'Platform', 'user')
    seedProject(loser, 'Platform Rewrite', 'transcript', 'r-del') // suppressed
    const res = await invoke('projects:merge', { keeperId: keeper, loserId: loser })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('MERGE_NOT_ALLOWED')
    expect(queryOne('SELECT id FROM projects WHERE id = ?', [loser])).toBeTruthy()
  })

  it('BOTH visible ⇒ merges', async () => {
    const keeper = randomUUID()
    const loser = randomUUID()
    seedProject(keeper, 'Platform', 'user')
    seedProject(loser, 'Platform Rewrite', 'user')
    const res = await invoke('projects:merge', { keeperId: keeper, loserId: loser })
    expect(res.success).toBe(true)
    expect(res.data.id).toBe(keeper)
  })
})

// ---------------------------------------------------------------------------
// contacts:create — fetch-ALL + filter picks the VISIBLE duplicate (ADV36-3)
// ---------------------------------------------------------------------------

describe('contacts:create — fetch-all + filter across same-name candidates', () => {
  it('BOTH suppressed(first) + visible same-name ⇒ DUPLICATE_ENTRY on the VISIBLE one (no new mint)', async () => {
    seedRecording('r-del', { deleted: true })
    // Suppressed twin created FIRST (an unordered LIMIT-1 could pick this one).
    seedContact('c-hidden', 'Sam', 'transcript', 'r-del', '2026-01-01T00:00:00Z')
    // Visible manual contact created LATER.
    seedContact('c-visible', 'Sam', 'user', null, '2026-02-01T00:00:00Z')
    const res = await invoke('contacts:create', { name: 'sam' })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('DUPLICATE_ENTRY')
    expect(res.error.details.existingId).toBe('c-visible')
    expect(res.error.details.existingName).toBe('Sam')
  })

  it('only SUPPRESSED same-name candidates ⇒ fresh manual create (no hidden id revealed)', async () => {
    seedRecording('r-del', { deleted: true })
    seedContact('c-hidden', 'Sam', 'transcript', 'r-del')
    const res = await invoke('contacts:create', { name: 'sam' })
    expect(res.success).toBe(true)
    expect(res.data.id).not.toBe('c-hidden')
    expect(res.data.name).toBe('sam')
  })
})

// ---------------------------------------------------------------------------
// contacts:update / projects:update — gate the target (sweep)
// ---------------------------------------------------------------------------

describe('entity update — suppressed target is not mutable', () => {
  it('contacts:update on a SUPPRESSED contact ⇒ NOT_FOUND', async () => {
    const id = randomUUID()
    seedRecording('r-del', { deleted: true })
    seedContact(id, 'Ghost', 'transcript', 'r-del')
    const res = await invoke('contacts:update', { id, role: 'Engineer' })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('NOT_FOUND')
    // Field NOT mutated.
    const row = queryOne<{ role: string | null }>('SELECT role FROM contacts WHERE id = ?', [id])
    expect(row?.role ?? null).toBeNull()
  })

  it('contacts:update on a VISIBLE contact ⇒ succeeds', async () => {
    const id = randomUUID()
    seedContact(id, 'RealPerson', 'user')
    const res = await invoke('contacts:update', { id, role: 'Engineer' })
    expect(res.success).toBe(true)
    expect(res.data.role).toBe('Engineer')
  })

  it('projects:update on a SUPPRESSED project ⇒ NOT_FOUND', async () => {
    const id = randomUUID()
    seedRecording('r-del', { deleted: true })
    seedProject(id, 'GhostProject', 'transcript', 'r-del')
    const res = await invoke('projects:update', { id, name: 'Renamed' })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('NOT_FOUND')
    const row = queryOne<{ name: string }>('SELECT name FROM projects WHERE id = ?', [id])
    expect(row?.name).toBe('GhostProject')
  })

  it('projects:update on a VISIBLE project ⇒ succeeds', async () => {
    const id = randomUUID()
    seedProject(id, 'RealProject', 'user')
    const res = await invoke('projects:update', { id, name: 'Renamed' })
    expect(res.success).toBe(true)
    expect(res.data.name).toBe('Renamed')
  })
})
