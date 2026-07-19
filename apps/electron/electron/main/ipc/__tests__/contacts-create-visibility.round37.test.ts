// @vitest-environment node

/**
 * ADV35-2 (round-37) — contacts:create must not disclose a HIDDEN duplicate.
 *
 * The duplicate-name guard used to call raw getContactByName and return the
 * matched contact's id + name unconditionally. A transcript-origin contact whose
 * sole source recording is personal / soft-deleted / value-excluded / hard-purged
 * (or a legacy NULL-provenance row with no eligible membership) is SUPPRESSED on
 * non-owner surfaces — so surfacing its id/name here (and blocking the create)
 * leaked identity the rest of the app hides. The guard now routes the candidate
 * through filterVisibleEntityIds:
 *   • VISIBLE duplicate  ⇒ DUPLICATE_ENTRY with the id/name (unchanged UX).
 *   • SUPPRESSED         ⇒ treat as unavailable — mint a fresh manual contact,
 *                          never revealing the hidden id/name.
 *   • lookup FAILS       ⇒ fail closed WITHOUT identity details (allow the create).
 *
 * REAL temp DB, real database.ts (better-sqlite3), real handler end to end.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-r37-contacts-create-${process.pid}.sqlite`)
vi.mock('../../services/file-storage', () => ({ getDatabasePath: () => dbPath }))

const handlers = new Map<string, (...args: any[]) => any>()
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (...args: any[]) => any) => { handlers.set(channel, fn) } },
  shell: { openPath: vi.fn(async () => '') }
}))

import { initializeDatabase, closeDatabase, run } from '../../services/database'
import { registerContactsHandlers } from '../contacts-handlers'

function invoke(channel: string, ...args: any[]): Promise<any> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  return Promise.resolve(fn({} as any, ...args))
}

// --- seed helpers -----------------------------------------------------------

function seedContact(id: string, name: string, source: string | null, recId: string | null = null): void {
  run(
    `INSERT INTO contacts (id, name, type, first_seen_at, last_seen_at, meeting_count, source, source_recording_id)
     VALUES (?, ?, 'unknown', '2026-01-01', '2026-01-01', 0, ?, ?)`,
    [id, name, source, recId]
  )
}
function seedRecording(id: string, opts: { personal?: boolean; deleted?: boolean } = {}): void {
  run(
    `INSERT INTO recordings (id, filename, date_recorded, personal, deleted_at) VALUES (?, ?, '2026-01-02T10:00:00Z', ?, ?)`,
    [id, `${id}.hda`, opts.personal ? 1 : 0, opts.deleted ? '2026-07-01T00:00:00Z' : null]
  )
}
function valueExclude(recordingId: string): void {
  run(
    `INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id, quality_rating) VALUES (?, 'Cap', '2026-06-01', ?, 'garbage')`,
    [`cap-${recordingId}`, recordingId]
  )
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
// VISIBLE duplicate — unchanged behaviour.
// ---------------------------------------------------------------------------

describe('contacts:create — VISIBLE duplicate is surfaced', () => {
  it('returns DUPLICATE_ENTRY with the existing id/name for a manual contact', async () => {
    seedContact('c-user', 'Jane Doe', 'user')
    const res = await invoke('contacts:create', { name: 'jane doe' })
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('DUPLICATE_ENTRY')
    expect(res.error.details.existingId).toBe('c-user')
    expect(res.error.details.existingName).toBe('Jane Doe')
  })
})

// ---------------------------------------------------------------------------
// SUPPRESSED duplicate — never disclosed; a fresh manual contact is created.
// ---------------------------------------------------------------------------

describe('contacts:create — SUPPRESSED duplicate is not disclosed; fresh create allowed', () => {
  const HIDDEN = 'c-ghost'

  async function expectFreshCreate(): Promise<void> {
    const res = await invoke('contacts:create', { name: 'ghost' })
    expect(res.success).toBe(true)
    // A NEW manual contact — never the hidden id, never its name leaked in an error.
    expect(res.data.id).not.toBe(HIDDEN)
    expect(res.data.name).toBe('ghost')
  }

  it('PERSONAL source recording ⇒ suppressed ⇒ fresh create', async () => {
    seedRecording('r-personal', { personal: true })
    seedContact(HIDDEN, 'Ghost', 'transcript', 'r-personal')
    await expectFreshCreate()
  })

  it('SOFT-DELETED source recording ⇒ suppressed ⇒ fresh create', async () => {
    seedRecording('r-del', { deleted: true })
    seedContact(HIDDEN, 'Ghost', 'transcript', 'r-del')
    await expectFreshCreate()
  })

  it('VALUE-EXCLUDED source recording ⇒ suppressed ⇒ fresh create', async () => {
    seedRecording('r-val')
    valueExclude('r-val')
    seedContact(HIDDEN, 'Ghost', 'transcript', 'r-val')
    await expectFreshCreate()
  })

  it('HARD-PURGED source recording (row gone) ⇒ suppressed ⇒ fresh create', async () => {
    // No recordings row for 'r-gone' — a hard purge removed it. The positive
    // allowlist can't resolve it ⇒ ineligible ⇒ suppressed.
    seedContact(HIDDEN, 'Ghost', 'transcript', 'r-gone')
    await expectFreshCreate()
  })

  it('LEGACY NULL-provenance contact with no eligible membership ⇒ suppressed ⇒ fresh create', async () => {
    seedContact(HIDDEN, 'Ghost', null, null)
    await expectFreshCreate()
  })
})

// ---------------------------------------------------------------------------
// Visibility lookup FAILURE — RETRYABLE, do NOT create (ADV36-3, round-38).
// A same-name candidate EXISTS but its visibility can't be evaluated; creating a
// fresh row would persist a duplicate from a transient failure. Refuse retryably
// WITHOUT leaking identity details.
// ---------------------------------------------------------------------------

describe('contacts:create — visibility lookup failure is RETRYABLE (no create)', () => {
  it('returns RETRYABLE_ERROR and creates nothing when filterVisibleEntityIds throws', async () => {
    seedContact('c-ghost', 'Ghost', 'transcript', 'r-any')
    // Break the visibility query's junction read so filterVisibleEntityIds throws
    // (fail-closed) while getContactsByName (contacts only) still resolves the dup.
    run('DROP TABLE meeting_contacts')
    const res = await invoke('contacts:create', { name: 'ghost' })
    // RETRYABLE (not success): no fresh row is minted (create returns success),
    // and no identity details are leaked.
    expect(res.success).toBe(false)
    expect(res.error.code).toBe('RETRYABLE_ERROR')
    expect(res.error.details?.existingId).toBeUndefined()
  })
})
