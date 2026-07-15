// @vitest-environment node

/**
 * ADV9 (round-9) — THE positive-allowlist eligibility boundary.
 *
 * The 9th adversarial pass found the boundary was a BLOCKLIST: it subtracted
 * known-excluded ids and treated a MISSING id as eligible. getExcludedRecordingIds
 * only reads LIVE `recordings` rows, so a HARD-PURGED id was in neither the table
 * nor the exclusion set → wrongly eligible, admitting a stale vector doc / graph
 * edge that survived a deferred/failed cleanup (deleteRecording commits the DB
 * purge, catches a failed in-memory vector deletion, queues a retry, returns
 * success). This suite runs the REAL boundary against a REAL DB and proves an id
 * is eligible ONLY when it resolves to an existing, non-personal, non-deleted,
 * non-value-excluded recording — a purged/unknown id is ineligible EVERYWHERE
 * (every consumer routes through this boundary).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'
import { vi } from 'vitest'

const dbPath = join(tmpdir(), `hidock-adv9-eligibility-${process.pid}.sqlite`)
vi.mock('../file-storage', () => ({ getDatabasePath: () => dbPath }))

import { initializeDatabase, closeDatabase, run, getEligibleRecordingIds } from '../database'
import { filterEligibleRecordingIds, isRecordingEligible } from '../recording-eligibility'

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

beforeEach(async () => {
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
})

afterEach(() => {
  closeDatabase()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
})

describe('getEligibleRecordingIds — positive allowlist', () => {
  it('returns ONLY ids that resolve to an existing, clean recording', () => {
    seedRecording('rec-ok')
    seedRecording('rec-personal', { personal: true })
    seedRecording('rec-deleted', { deleted: true })
    seedRecording('rec-garbage')
    valueExclude('rec-garbage')

    const { eligible, failClosed } = getEligibleRecordingIds([
      'rec-ok',
      'rec-personal',
      'rec-deleted',
      'rec-garbage',
      'ghost-never-existed'
    ])
    expect(failClosed).toBe(false)
    expect([...eligible].sort()).toEqual(['rec-ok'])
  })

  it('a value-excluded recording rescued by a keep capture is eligible again', () => {
    seedRecording('rec-mixed')
    valueExclude('rec-mixed')
    run(
      'INSERT INTO knowledge_captures (id, title, captured_at, source_recording_id, quality_rating) VALUES (?, ?, ?, ?, ?)',
      ['cap-keep', 'Keep', '2026-06-01', 'rec-mixed', 'valuable']
    )
    expect(getEligibleRecordingIds(['rec-mixed']).eligible.has('rec-mixed')).toBe(true)
  })

  it('empty input short-circuits without a DB hit', () => {
    expect(getEligibleRecordingIds([])).toEqual({ eligible: new Set(), failClosed: false })
  })

  it('fails closed (empty + failClosed) when the lookup throws', () => {
    seedRecording('rec-ok')
    run('DROP TABLE recordings')
    const res = getEligibleRecordingIds(['rec-ok'])
    expect(res.failClosed).toBe(true)
    expect(res.eligible.size).toBe(0)
  })
})

describe('ADV9 — hard-purged / unknown id is ineligible (the key regression)', () => {
  it('a recording whose row was purged (stale derivative survived) is NOT eligible', () => {
    seedRecording('rec-purge')
    // Eligible while the row exists…
    expect(isRecordingEligible('rec-purge')).toBe(true)
    expect(filterEligibleRecordingIds(['rec-purge']).eligible.has('rec-purge')).toBe(true)

    // Hard purge: the `recordings` row is gone, but a stale vector doc / graph
    // edge for it survived a deferred/failed cleanup and still carries this id.
    run('DELETE FROM recordings WHERE id = ?', ['rec-purge'])

    // The OLD blocklist boundary treated this MISSING id as eligible (it was in
    // neither the table nor the excluded set). The positive allowlist rejects it.
    expect(isRecordingEligible('rec-purge')).toBe(false)
    const { eligible, failClosed } = filterEligibleRecordingIds(['rec-purge'])
    expect(failClosed).toBe(false)
    expect(eligible.has('rec-purge')).toBe(false)
    expect(eligible.size).toBe(0)
  })

  it('a never-seen id is ineligible (unknown ⇒ not admitted)', () => {
    expect(isRecordingEligible('totally-unknown')).toBe(false)
    expect(filterEligibleRecordingIds(['totally-unknown']).eligible.size).toBe(0)
  })

  it('a purge does not affect a sibling recording that still exists', () => {
    seedRecording('rec-live')
    seedRecording('rec-gone')
    run('DELETE FROM recordings WHERE id = ?', ['rec-gone'])
    const { eligible } = filterEligibleRecordingIds(['rec-live', 'rec-gone'])
    expect([...eligible]).toEqual(['rec-live'])
  })
})
