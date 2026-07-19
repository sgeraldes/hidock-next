/**
 * Partial-v42 recovery: journals stranded with NULL seq/loser_id must be
 * healed, and unhealable rows must be UNMERGEABLE — never silently ordered.
 *
 * Round-4 finding: an earlier FAILED v42 attempt can leave a pre-v42 DB with
 * both nullable journal columns already added but never backfilled. The
 * conditional (column-presence-gated) backfills then skip, and one malformed
 * loser_snapshot aborting a combined backfill statement stranded every row
 * with NULL seq — which the old guard silently ordered as seq 0, disabling
 * ordering between legacy journals entirely.
 *
 * Policy under test (real engine, real upgrade path):
 *  - seq is backfilled independently and unconditionally (repairPhase every
 *    boot + migration, idempotent WHERE seq IS NULL);
 *  - loser_id backfill is guarded per-row by json_valid, so a malformed
 *    snapshot never blocks the valid rows; the malformed row itself stays
 *    NULL and its journal is rejected fail-closed at unmerge time;
 *  - a journal with NULL seq is rejected with a distinct message, never
 *    treated as seq 0.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, unlinkSync, readFileSync } from 'fs'

/** Target schema version read from database.ts — see database.test.ts for why. */
const EXPECTED_SCHEMA_VERSION = Number(
  readFileSync(join(__dirname, '..', 'database.ts'), 'utf-8').match(/const SCHEMA_VERSION = (\d+)\b/)![1]
)

const dbPath = join(tmpdir(), `hidock-partial-v42-recovery-test-${Date.now()}.db`)
vi.mock('../file-storage', () => ({ getDatabasePath: () => dbPath }))

import {
  initializeDatabase,
  closeDatabase,
  run,
  queryAll,
  queryOne,
  mergeProjects,
  unmergeProjects,
  MergeOrderConflictError
} from '../database'

interface JournalRow {
  id: string
  keeper_id: string
  loser_id: string | null
  seq: number | null
}

function journalRows(): JournalRow[] {
  return queryAll<JournalRow>(
    "SELECT id, keeper_id, loser_id, seq FROM merge_journal WHERE kind = 'project' ORDER BY rowid"
  )
}

describe('partial v42: NULL journal ordering columns are healed on upgrade; unhealable rows are unmergeable', () => {
  let j1Id: string
  let j2Id: string

  beforeAll(async () => {
    await initializeDatabase()

    // Two REAL same-keeper merges so the journals carry genuine manifests.
    run("INSERT INTO projects (id, name, status) VALUES ('P', 'Prime Hub', 'active')")
    run("INSERT INTO projects (id, name, status) VALUES ('L1', 'First Spoke', 'active')")
    run("INSERT INTO projects (id, name, status) VALUES ('L2', 'Second Spoke', 'active')")
    mergeProjects('P', 'L1') // J1
    mergeProjects('P', 'L2') // J2
    const before = journalRows()
    expect(before).toHaveLength(2)
    j1Id = before[0].id
    j2Id = before[1].id

    // Simulate the partially-applied earlier v42 attempt: both columns exist
    // (so column-presence-gated ALTERs skip) but every row is NULL...
    run('UPDATE merge_journal SET seq = NULL, loser_id = NULL')
    // ...plus one journal whose snapshot is not valid JSON.
    run(
      `INSERT INTO merge_journal (id, kind, keeper_id, loser_snapshot, repointed_manifest, created_at)
       VALUES ('j-malformed', 'project', 'ghost-keeper', '{not json', '{}', '2026-01-01T00:00:00Z')`
    )

    // Roll back to schema 41 and reopen: the engine re-runs migration 42
    // against this exact partial state.
    run('DELETE FROM schema_version WHERE version >= 42')
    closeDatabase()
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

  it('completes the migration despite the malformed row and heals every valid journal', () => {
    // The rollback drops >= 42, so reopening re-runs v42 AND every later
    // migration — the boot must land on the app's current target version.
    const version = queryOne<{ v: number }>('SELECT MAX(version) AS v FROM schema_version')?.v
    expect(version).toBe(EXPECTED_SCHEMA_VERSION)

    const rows = journalRows()
    expect(rows).toHaveLength(3)
    const [j1, j2, bad] = rows

    // Valid journals: seq restored (original order preserved) and loser_id
    // recovered from the snapshots.
    expect(j1.id).toBe(j1Id)
    expect(j2.id).toBe(j2Id)
    expect(j1.seq).not.toBeNull()
    expect(j2.seq).not.toBeNull()
    expect(j2.seq!).toBeGreaterThan(j1.seq!)
    expect(j1.loser_id).toBe('L1')
    expect(j2.loser_id).toBe('L2')

    // Malformed row: sequenced (ordering is snapshot-independent) but its
    // loser stays unknown — json_valid kept it from poisoning the backfill.
    expect(bad.id).toBe('j-malformed')
    expect(bad.seq).not.toBeNull()
    expect(bad.loser_id).toBeNull()
  })

  it('ordering is ENFORCED between the recovered legacy journals (the corruption class does not return)', () => {
    let caught: unknown
    try {
      unmergeProjects(j1Id)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(MergeOrderConflictError)
    expect((caught as MergeOrderConflictError).blockingJournalId).toBe(j2Id)
  })

  it('the malformed journal is un-unmergeable with the distinct unreadable-snapshot error', () => {
    expect(() => unmergeProjects('j-malformed')).toThrow(/unreadable loser snapshot/)
    // And it was not deleted, half-applied, or marked undone by the attempt.
    expect(
      queryOne<{ undone_at: string | null }>("SELECT undone_at FROM merge_journal WHERE id = 'j-malformed'")
        ?.undone_at ?? null
    ).toBeNull()
  })

  it('a journal with NULL seq is rejected with a distinct message, never silently ordered as zero', () => {
    // Force the un-healed state back onto the NEWEST journal: under the old
    // seq-0 behavior this would have made J2 look OLDEST and let J1 pass.
    run('UPDATE merge_journal SET seq = NULL WHERE id = ?', [j2Id])
    // The row itself is rejected...
    expect(() => unmergeProjects(j2Id)).toThrow(/no merge-order sequence/)
    // ...AND its mere existence pauses undo for the kind: a NULL-seq journal
    // can never match `seq > ?`, so letting J1 proceed would silently skip
    // its blocker — exactly the corruption class this round closes.
    expect(() => unmergeProjects(j1Id)).toThrow(/no merge-order sequence/)
    // Heal it exactly as the boot repair pass would:
    run('UPDATE merge_journal SET seq = rowid WHERE seq IS NULL')

    // Full legal unwind now works: newest-first restores both spokes.
    unmergeProjects(j2Id)
    unmergeProjects(j1Id)
    expect(queryOne('SELECT 1 FROM projects WHERE id = ?', ['L1'])).toBeTruthy()
    expect(queryOne('SELECT 1 FROM projects WHERE id = ?', ['L2'])).toBeTruthy()
    expect(queryOne('SELECT 1 FROM projects WHERE id = ?', ['P'])).toBeTruthy()
  })
})
