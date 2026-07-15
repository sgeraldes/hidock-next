/**
 * v42 re-key failure injection: a failed tombstone rewrite must NOT record v42.
 *
 * Adversarial re-review (HIGH): the transactional re-key rolled back on
 * failure but the catch swallowed the exception, so schema_version still
 * advanced to 42 and the rewrite never retried — a transient failure stranded
 * v41 keys permanently. Migration 42 now rethrows after logging; the engine
 * records a version only AFTER its migration returns, so a failed rewrite
 * leaves the DB at v41 and the next boot retries.
 *
 * Injection: a BEFORE DELETE trigger on project_discovery_rejections that
 * RAISE(ABORT)s — it makes the re-key's rewrite DELETE fail exactly like a
 * transient engine error, is persisted in the DB file across reopen, and can
 * be dropped to prove the retry then succeeds. Runs against the REAL engine.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, unlinkSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-rekey-failure-test-${Date.now()}.db`)
vi.mock('../file-storage', () => ({ getDatabasePath: () => dbPath }))

import { initializeDatabase, closeDatabase, run, queryOne, isProjectDiscoveryRejected } from '../database'

const COMPOSED = 'Frappé Motor' // e-acute U+00E9 (NFC)
const DECOMPOSED = 'Frappé Motor' // e + U+0301 combining acute (NFD)

/** The v41 normalization: lowercase/trim/collapse, NO Unicode normalization. */
const v41Norm = (s: string): string => s.toLowerCase().trim().replace(/s+/g, ' ')

function maxVersion(): number {
  return queryOne<{ v: number }>('SELECT MAX(version) AS v FROM schema_version')?.v ?? 0
}

describe('migration v42: failed tombstone re-key does not advance schema_version', () => {
  beforeAll(async () => {
    await initializeDatabase()
  })

  afterAll(() => {
    try {
      closeDatabase()
    } catch {
      /* ignore */
    }
    const day = new Date().toISOString().slice(0, 10)
    for (const p of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}.bak-${day}`]) {
      if (existsSync(p)) {
        try {
          unlinkSync(p)
        } catch {
          /* ignore */
        }
      }
    }
  })

  it('rolls back, leaves the DB at v41, and a reopen retries the migration successfully', async () => {
    expect(maxVersion()).toBe(42)

    // Seed a stranded v41-style tombstone (old non-NFKC key) so the re-key has
    // a rewrite to perform, roll the version back to 41, and plant the poison.
    run(
      `INSERT INTO project_discovery_rejections (name_norm, original_name, source_meeting_id, rejected_at) VALUES (?, ?, NULL, ?)`,
      [v41Norm(DECOMPOSED), DECOMPOSED, '2026-01-01T00:00:00Z']
    )
    run('DELETE FROM schema_version WHERE version >= 42')
    run(
      "CREATE TRIGGER poison_rekey BEFORE DELETE ON project_discovery_rejections BEGIN SELECT RAISE(ABORT, 'injected re-key failure'); END"
    )
    closeDatabase()

    // Reopen: migration 42's rewrite DELETE hits the trigger and must FAIL the
    // whole initialization — not be swallowed.
    await expect(initializeDatabase()).rejects.toThrow(/injected re-key failure/)

    // The transaction rolled back and v42 was never recorded: still at 41,
    // and the tombstone still carries its OLD (stranded) key, untouched.
    expect(maxVersion()).toBe(41)
    const row = queryOne<{ name_norm: string }>(
      'SELECT name_norm FROM project_discovery_rejections WHERE original_name = ?',
      [DECOMPOSED]
    )
    expect(row?.name_norm).toBe(v41Norm(DECOMPOSED))

    // Clear the transient failure and reopen: the migration RETRIES and succeeds.
    run('DROP TRIGGER poison_rekey')
    closeDatabase()
    await initializeDatabase()

    expect(maxVersion()).toBe(42)
    const rekeyed = queryOne<{ name_norm: string }>(
      'SELECT name_norm FROM project_discovery_rejections WHERE original_name = ?',
      [DECOMPOSED]
    )
    expect(rekeyed?.name_norm).toBe(COMPOSED.normalize('NFKC').toLowerCase())
    expect(isProjectDiscoveryRejected(COMPOSED)).toBe(true)
    expect(isProjectDiscoveryRejected(DECOMPOSED)).toBe(true)
  })
})
