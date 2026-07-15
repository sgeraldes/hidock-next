// @vitest-environment node

/**
 * ADV13 (round-13) — legacy raw-transcript READ IPCs, two eligibility tiers.
 *
 * TIER 1 (gated, ASSISTANT/DISPLAY-safe): db:get-transcript,
 * db:get-transcripts-by-recording-ids, db:search-transcripts must resolve the
 * recording id(s) through the shared FAIL-CLOSED positive allowlist so a
 * soft-deleted / personal / value-excluded / garbage-without-keep / orphaned
 * transcript can NOT be fetched, batched, or discovered via full-text search.
 *
 * TIER 2 (owner-management): db:get-transcript-owner /
 * db:get-transcripts-by-recording-ids-owner are scoped to "recording ROW
 * EXISTS" so the owner can view their OWN excluded content before purge, but a
 * HARD-PURGED / nonexistent id resolves to null / is omitted.
 *
 * Runs the REAL handlers against a REAL temp DB (only `electron` and
 * `file-storage` are mocked) so the eligibility boundary is exercised end-to-end.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-adv13-transcript-ipc-${process.pid}.sqlite`)
vi.mock('../../services/file-storage', () => ({ getDatabasePath: () => dbPath }))

// Capture ipcMain.handle registrations so we can invoke them directly.
const handlers = new Map<string, (...args: any[]) => any>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: any[]) => any) => {
      handlers.set(channel, fn)
    }
  }
}))

import { initializeDatabase, closeDatabase, run, insertTranscript } from '../../services/database'
import { registerDatabaseHandlers } from '../database-handlers'

function invoke(channel: string, ...args: any[]): Promise<any> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  return Promise.resolve(fn({} as any, ...args))
}

function seedRecording(id: string, opts: { personal?: boolean; deleted?: boolean } = {}): void {
  run('INSERT INTO recordings (id, filename, date_recorded, personal, deleted_at) VALUES (?, ?, ?, ?, ?)', [
    id,
    `${id}.hda`,
    '2026-06-01',
    opts.personal ? 1 : 0,
    opts.deleted ? '2026-07-01T00:00:00.000Z' : null
  ])
}

/** Attach a garbage-rated capture (no keep) so the recording is value-excluded. */
function valueExclude(recordingId: string): void {
  run(
    'INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id, quality_rating) VALUES (?, ?, ?, ?, ?)',
    [`cap-${recordingId}`, 'Cap', '2026-06-01', recordingId, 'garbage']
  )
}

function seedTranscript(recordingId: string, text: string): void {
  insertTranscript({
    id: `t-${recordingId}`,
    recording_id: recordingId,
    full_text: text,
    language: 'en'
  })
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

describe('ADV13 TIER-1 — db:get-transcript (gated)', () => {
  it('returns the transcript for an eligible recording', async () => {
    seedRecording('rec-ok')
    seedTranscript('rec-ok', 'quarterly planning notes')
    const t = await invoke('db:get-transcript', 'rec-ok')
    expect(t?.recording_id).toBe('rec-ok')
  })

  it.each([
    ['soft-deleted', () => seedRecording('rec-x', { deleted: true })],
    ['personal', () => seedRecording('rec-x', { personal: true })],
    ['value-excluded (garbage without keep)', () => { seedRecording('rec-x'); valueExclude('rec-x') }]
  ])('returns null for a %s recording', async (_label, setup) => {
    setup()
    seedTranscript('rec-x', 'secret content')
    expect(await invoke('db:get-transcript', 'rec-x')).toBeNull()
  })

  it('returns null for a nonexistent / hard-purged recording id', async () => {
    // No recording row (a hard purge removes the transcript too — the FK forbids an
    // orphan transcript — so the surviving hazard is a stale id resolving to nothing).
    expect(await invoke('db:get-transcript', 'ghost-never-existed')).toBeNull()
  })

  it('fails closed (null) when the eligibility lookup throws', async () => {
    seedRecording('rec-ok')
    seedTranscript('rec-ok', 'text')
    run('PRAGMA foreign_keys = OFF')
    run('DROP TABLE recordings')
    expect(await invoke('db:get-transcript', 'rec-ok')).toBeNull()
  })
})

describe('ADV13 TIER-1 — db:get-transcripts-by-recording-ids (gated batch)', () => {
  it('omits ineligible ids from the returned map', async () => {
    seedRecording('rec-ok')
    seedTranscript('rec-ok', 'ok text')
    seedRecording('rec-del', { deleted: true })
    seedTranscript('rec-del', 'deleted text')
    seedRecording('rec-personal', { personal: true })
    seedTranscript('rec-personal', 'personal text')
    seedRecording('rec-garbage')
    valueExclude('rec-garbage')
    seedTranscript('rec-garbage', 'garbage text')

    const map = await invoke('db:get-transcripts-by-recording-ids', [
      'rec-ok',
      'rec-del',
      'rec-personal',
      'rec-garbage',
      'ghost-nonexistent'
    ])
    expect(Object.keys(map)).toEqual(['rec-ok'])
  })

  it('fails closed (empty object) when the eligibility lookup throws', async () => {
    seedRecording('rec-ok')
    seedTranscript('rec-ok', 'text')
    run('PRAGMA foreign_keys = OFF')
    run('DROP TABLE recordings')
    expect(await invoke('db:get-transcripts-by-recording-ids', ['rec-ok'])).toEqual({})
  })
})

describe('ADV13 TIER-1 — db:search-transcripts (gated full-text)', () => {
  it('drops rows whose recording is ineligible', async () => {
    seedRecording('rec-ok')
    seedTranscript('rec-ok', 'the widget roadmap discussion')
    seedRecording('rec-del', { deleted: true })
    seedTranscript('rec-del', 'the widget secret discussion')

    const rows = await invoke('db:search-transcripts', 'widget')
    expect(rows.map((r: any) => r.recording_id)).toEqual(['rec-ok'])
  })

  it('returns an eligible match even when excluded matches rank ahead (no truncation-before-filter)', async () => {
    // Many excluded transcripts all match, plus ONE eligible match. searchTranscripts
    // applies no LIMIT, so eligibility filtering must still surface the eligible row.
    for (let i = 0; i < 30; i++) {
      seedRecording(`rec-bad-${i}`, { deleted: true })
      seedTranscript(`rec-bad-${i}`, 'quantum widget alignment')
    }
    seedRecording('rec-good')
    seedTranscript('rec-good', 'quantum widget alignment')

    const rows = await invoke('db:search-transcripts', 'quantum widget')
    expect(rows.map((r: any) => r.recording_id)).toEqual(['rec-good'])
  })

  it('fails closed (empty array) when the eligibility lookup throws', async () => {
    seedRecording('rec-ok')
    seedTranscript('rec-ok', 'searchable phrase')
    // Search must run before the recordings table is gone (FTS reads transcripts),
    // but the eligibility resolution reads recordings. Drop recordings only.
    run('PRAGMA foreign_keys = OFF')
    run('DROP TABLE recordings')
    expect(await invoke('db:search-transcripts', 'searchable')).toEqual([])
  })
})

describe('ADV13 TIER-2 — owner-management accessors', () => {
  it('db:get-transcript-owner returns an EXISTING but excluded recording (owner may view)', async () => {
    seedRecording('rec-del', { deleted: true })
    seedTranscript('rec-del', 'my trashed content')
    const t = await invoke('db:get-transcript-owner', 'rec-del')
    expect(t?.recording_id).toBe('rec-del')

    seedRecording('rec-personal', { personal: true })
    seedTranscript('rec-personal', 'my private content')
    expect((await invoke('db:get-transcript-owner', 'rec-personal'))?.recording_id).toBe('rec-personal')

    seedRecording('rec-garbage')
    valueExclude('rec-garbage')
    seedTranscript('rec-garbage', 'my low-value content')
    expect((await invoke('db:get-transcript-owner', 'rec-garbage'))?.recording_id).toBe('rec-garbage')
  })

  it('db:get-transcript-owner returns null for a hard-purged / nonexistent id', async () => {
    // A hard purge removes the recording row (and its transcript via the delete
    // flow); the owner accessor keys off recording-ROW existence, so a purged /
    // never-seen id resolves to null.
    expect(await invoke('db:get-transcript-owner', 'rec-purged')).toBeNull()
    expect(await invoke('db:get-transcript-owner', 'never-existed')).toBeNull()
  })

  it('db:get-transcripts-by-recording-ids-owner returns existing (incl. excluded), omits purged', async () => {
    seedRecording('rec-del', { deleted: true })
    seedTranscript('rec-del', 'trashed')
    seedRecording('rec-live')
    seedTranscript('rec-live', 'live')
    // 'rec-purged' has no recording row (hard-purged / nonexistent) → omitted.

    const map = await invoke('db:get-transcripts-by-recording-ids-owner', [
      'rec-del',
      'rec-live',
      'rec-purged'
    ])
    expect(Object.keys(map).sort()).toEqual(['rec-del', 'rec-live'])
  })
})
