// @vitest-environment node

/**
 * ADV25-4 (round-26) — db:get-recording is a NON-OWNER point read (sole preload
 * consumer: ActionableDetail's `recordings.getById`). It GATES through the shared
 * FAIL-CLOSED positive allowlist so a recording that became personal / soft-deleted
 * / value-excluded / hard-purged between the (gated) actionable list and the expand
 * point read returns null — closing the list→expand TOCTOU. REAL handler, REAL DB.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-adv25-get-recording-ipc-${process.pid}.sqlite`)
vi.mock('../../services/file-storage', () => ({ getDatabasePath: () => dbPath }))
vi.mock('../../services/org-reconciler', () => ({ autoLinkRecordingsToMeetings: () => {} }))

const handlers = new Map<string, (...args: any[]) => any>()
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (...args: any[]) => any) => { handlers.set(channel, fn) } }
}))

import { initializeDatabase, closeDatabase, run } from '../../services/database'
import { registerDatabaseHandlers } from '../database-handlers'

function invoke(channel: string, ...args: any[]): Promise<any> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  return Promise.resolve(fn({} as any, ...args))
}

function seedRecording(id: string, opts: { personal?: boolean; deleted?: boolean } = {}): void {
  run('INSERT INTO recordings (id, filename, date_recorded, personal, deleted_at) VALUES (?, ?, ?, ?, ?)', [
    id, `${id}.hda`, '2026-06-01', opts.personal ? 1 : 0, opts.deleted ? '2026-07-01T00:00:00.000Z' : null
  ])
}
function valueExclude(recordingId: string): void {
  run('INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id, quality_rating) VALUES (?, ?, ?, ?, ?)', [
    `cap-${recordingId}`, 'Cap', '2026-06-01', recordingId, 'garbage'
  ])
}

beforeEach(async () => {
  handlers.clear()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
  registerDatabaseHandlers()
})

afterEach(() => {
  closeDatabase()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
})

describe('ADV25-4 — db:get-recording fail-closed gate', () => {
  it('returns the row for an eligible recording', async () => {
    seedRecording('rec-ok')
    const rec = await invoke('db:get-recording', 'rec-ok')
    expect(rec?.id).toBe('rec-ok')
  })

  it('returns null for a soft-deleted / personal / value-excluded recording', async () => {
    seedRecording('rec-del', { deleted: true })
    seedRecording('rec-personal', { personal: true })
    seedRecording('rec-garbage')
    valueExclude('rec-garbage')
    expect(await invoke('db:get-recording', 'rec-del')).toBeNull()
    expect(await invoke('db:get-recording', 'rec-personal')).toBeNull()
    expect(await invoke('db:get-recording', 'rec-garbage')).toBeNull()
  })

  it('returns null for a hard-purged / unknown id', async () => {
    expect(await invoke('db:get-recording', 'nope')).toBeNull()
  })

  it('list→expand race: an id eligible when listed but excluded before the point read ⇒ null', async () => {
    seedRecording('rec-race')
    expect((await invoke('db:get-recording', 'rec-race'))?.id).toBe('rec-race')
    // Now the recording is trashed (soft-deleted) before the ActionableDetail expand.
    run(`UPDATE recordings SET deleted_at = '2026-07-02T00:00:00.000Z' WHERE id = 'rec-race'`)
    expect(await invoke('db:get-recording', 'rec-race')).toBeNull()
  })

  it('fails closed — null when the eligibility lookup throws', async () => {
    seedRecording('rec-ok')
    run('PRAGMA foreign_keys = OFF')
    run('DROP TABLE knowledge_captures')
    expect(await invoke('db:get-recording', 'rec-ok')).toBeNull()
  })
})
