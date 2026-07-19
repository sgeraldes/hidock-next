// @vitest-environment node

/**
 * ADV45-3 (round-47) — self-identification merge-suspected markers persist
 * extracted SPEAKER NAMES keyed by recording id
 * (`self_id:merge_suspected:${recordingId}:${label}`). Exclusion (soft-delete /
 * personal / value-exclusion) never removes these markers, so
 * getMergeSuspectedMarkers + getSelfIdStatus previously leaked names from
 * excluded recordings. The reads now filter every marker's recording id through
 * the shared FAIL-CLOSED recording allowlist.
 *
 * REAL temp DB (better-sqlite3); chat-llm / entity-resolver mocked (never called
 * by the read paths under test).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-r47-selfid-markers-${process.pid}.sqlite`)
vi.mock('../file-storage', () => ({ getDatabasePath: () => dbPath }))
vi.mock('../chat-llm', () => ({ getChatLLMService: () => ({ generate: vi.fn(async () => '[]') }) }))
vi.mock('../entity-resolver', () => ({ resolveContact: vi.fn() }))

import { initializeDatabase, closeDatabase, run } from '../database'
import { getMergeSuspectedMarkers, getSelfIdStatus } from '../self-identification'

const PREFIX = 'self_id:merge_suspected:'

function seedRecording(id: string, opts: { personal?: boolean; deleted?: boolean } = {}): void {
  run(
    `INSERT INTO recordings (id, filename, date_recorded, personal, deleted_at) VALUES (?, ?, '2026-01-02T10:00:00Z', ?, ?)`,
    [id, `${id}.hda`, opts.personal ? 1 : 0, opts.deleted ? '2026-07-01T00:00:00Z' : null]
  )
}
function seedValueExcluded(id: string): void {
  seedRecording(id)
  run(
    `INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id, quality_rating) VALUES (?, 'C', '2026-06-01', ?, 'garbage')`,
    [`cap-${id}`, id]
  )
}
function seedMarker(recId: string, label: string, names: string[]): void {
  run('INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, ?)', [
    `${PREFIX}${recId}:${label}`,
    JSON.stringify({ recordingId: recId, label, names }),
    '2026-07-16T00:00:00Z'
  ])
}

beforeEach(async () => {
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
})
afterEach(() => {
  closeDatabase()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
})

describe('getMergeSuspectedMarkers — recording-eligibility filter', () => {
  it('returns markers only for ELIGIBLE recordings; excluded ones are hidden + uncounted', () => {
    seedRecording('rec-ok')
    seedRecording('rec-del', { deleted: true })
    seedRecording('rec-pers', { personal: true })
    seedValueExcluded('rec-val')
    // rec-gone: NO recordings row (hard-purged) — marker left behind.

    seedMarker('rec-ok', 'Speaker 3', ['Santiago', 'Óscar'])
    seedMarker('rec-del', 'Speaker 2', ['Deleted Person'])
    seedMarker('rec-pers', 'Speaker 4', ['Personal Person'])
    seedMarker('rec-val', 'Speaker 5', ['Garbage Person'])
    seedMarker('rec-gone', 'Speaker 6', ['Purged Person'])

    const markers = getMergeSuspectedMarkers()
    expect(markers).toEqual([{ label: 'Speaker 3', names: ['Santiago', 'Óscar'] }])

    // The excluded names never appear.
    const allNames = markers.flatMap((m) => m.names)
    for (const leaked of ['Deleted Person', 'Personal Person', 'Garbage Person', 'Purged Person']) {
      expect(allNames).not.toContain(leaked)
    }

    // getSelfIdStatus derives its count from the SAME filtered set.
    expect(getSelfIdStatus().mergeSuspectedTotal).toBe(1)
  })

  it('fails closed (empty + zero count) when the eligibility lookup cannot complete', () => {
    seedRecording('rec-ok')
    seedMarker('rec-ok', 'Speaker 3', ['Santiago'])
    // Force the recording-eligibility lookup to throw.
    run('DROP TABLE recordings')

    expect(getMergeSuspectedMarkers()).toEqual([])
    expect(getSelfIdStatus().mergeSuspectedTotal).toBe(0)
  })
})
