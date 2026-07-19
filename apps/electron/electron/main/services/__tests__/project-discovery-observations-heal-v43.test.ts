/**
 * v43 same-version shape hazard: healing a database stranded by the FIRST cut.
 *
 * `project_discovery_observations` shipped in one commit and gained its
 * meeting_id column in the next — both under schema version 43. A database that
 * reached v43 from the earlier build therefore has the table WITHOUT meeting_id
 * and will never run migration 43 again (the engine only runs migrations above
 * the recorded version), while `CREATE TABLE IF NOT EXISTS` is a no-op against an
 * existing table of the wrong shape. Every observation insert would fail and
 * discovery reconciliation would be silently dead for all new candidates.
 *
 * repairPhase runs on EVERY boot before migrations and force-adds the column, so
 * such a database heals in place. This test builds that exact state and proves
 * it, against the REAL engine.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'

const dbPath = join(tmpdir(), `hidock-obs-heal-v43-test-${Date.now()}.db`)
vi.mock('../file-storage', () => ({ getDatabasePath: () => dbPath }))

import {
  initializeDatabase,
  closeDatabase,
  run,
  queryAll,
  queryOne,
  recordProjectDiscoveryObservation,
  countProjectDiscoverySources,
  verifyObservationsSchema,
  runInTransaction
} from '../database'
import { applyTranscriptEntities } from '../org-reconciler'

function observationColumns(): string[] {
  return queryAll<{ name: string }>('PRAGMA table_info(project_discovery_observations)').map((c) => c.name)
}

describe('v43 heal: a database stranded with the pre-meeting_id table shape', () => {
  beforeAll(async () => {
    await initializeDatabase()

    // Rebuild the EXACT first-cut state: drop the healed table and recreate it
    // without meeting_id. Migration 43 already ran on the first boot (recorded
    // below the current version), so it is not re-run — repairPhase must heal the
    // shape in place.
    run('DROP TABLE IF EXISTS project_discovery_observations')
    run(`
      CREATE TABLE project_discovery_observations (
        name_norm TEXT NOT NULL,
        source_key TEXT NOT NULL,
        original_name TEXT NOT NULL,
        score REAL NOT NULL DEFAULT 0,
        first_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (name_norm, source_key)
      )
    `)
    // A sighting written by the first-cut build, so the heal is proven to
    // preserve existing rows rather than recreate the table.
    run(
      `INSERT INTO project_discovery_observations
         (name_norm, source_key, original_name, score, first_seen_at, last_seen_at)
       VALUES ('legacy sighting', 'r:old', 'Legacy Sighting', 0.7,
               '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    )
    expect(observationColumns()).not.toContain('meeting_id')

    run(`INSERT INTO meetings (id, subject, start_time, end_time) VALUES ('h1', 'One', '2026-04-01T10:00:00Z', '2026-04-01T11:00:00Z')`)
    run(`INSERT INTO meetings (id, subject, start_time, end_time) VALUES ('h2', 'Two', '2026-04-02T10:00:00Z', '2026-04-02T11:00:00Z')`)

    closeDatabase()
    await initializeDatabase() // repairPhase runs here
  })

  afterAll(() => {
    // Temp DB files are swept by src/test/setup-db.ts's tracker — just close.
    closeDatabase()
  })

  it('reaches the current schema version; migration 43 is not re-run (repairPhase heals the shape)', () => {
    expect(queryOne<{ v: number }>('SELECT MAX(version) AS v FROM schema_version')?.v).toBe(50)
  })

  it('repairPhase force-added meeting_id to the existing table', () => {
    expect(observationColumns()).toContain('meeting_id')
  })

  it('preserved the rows the first-cut build had already written', () => {
    const row = queryOne<{ original_name: string; meeting_id: string | null }>(
      `SELECT original_name, meeting_id FROM project_discovery_observations WHERE name_norm = 'legacy sighting'`
    )
    expect(row?.original_name).toBe('Legacy Sighting')
    expect(row?.meeting_id).toBeNull() // back-filled as NULL, not lost
  })

  it('observation inserts referencing meeting_id now succeed', () => {
    expect(recordProjectDiscoveryObservation('HealedBeacon', 'r:h1', 'h1', 0.7)).toBe(1)
    expect(countProjectDiscoverySources('HealedBeacon')).toBe(1)
  })

  /**
   * Fail-closed proof. For an already-v43 DB migration 43 is SKIPPED, so
   * repairPhase is the ONLY heal path — if its repair fails and the failure is
   * swallowed, the boot continues with a schema that cannot accept an observation
   * write, recreating the stranded condition for the whole session and, under a
   * persistent failure, indefinitely.
   *
   * Four injections, each exercising a DIFFERENT way the schema can be unusable.
   * `CREATE TABLE IF NOT EXISTS` is a no-op against any existing object, so none
   * of these self-heal:
   *
   *   VIEW            — PRAGMA table_info still reports columns, so the repair
   *                     sees a shape missing meeting_id and attempts the ALTER.
   *   INDEX           — SQLite shares a namespace across tables, views and
   *                     indexes, so CREATE TABLE fails with "there is already an
   *                     index named …" while PRAGMA table_info returns []. An
   *                     earlier cut gated its verification on PRAGMA returning
   *                     rows, so an EMPTY column list skipped the check entirely.
   *   MEETING_ID-ONLY — a real table carrying only the column the old check
   *                     looked for. ALTER can add score and the timestamps, but
   *                     name_norm/source_key/original_name are NOT NULL without a
   *                     constant default and cannot be added at all.
   *   NO COMPOSITE KEY— the subtlest: every column present, so column checks pass,
   *                     but ON CONFLICT(name_norm, source_key) has no constraint
   *                     to resolve against and every observation write throws at
   *                     runtime.
   *
   * All four must throw, and a later boot with the injection cleared must heal.
   */
  it.each([
    [
      'a same-named VIEW',
      `CREATE VIEW project_discovery_observations AS
         SELECT 'x' AS name_norm, 'x' AS source_key, 'x' AS original_name, 0 AS score,
                '' AS first_seen_at, '' AS last_seen_at`,
      'DROP VIEW project_discovery_observations',
      /exists as a view, not a table/,
      null
    ],
    [
      'a same-named INDEX (empty-PRAGMA path)',
      `CREATE TABLE decoy_for_index (col TEXT);
       CREATE INDEX project_discovery_observations ON decoy_for_index(col)`,
      'DROP INDEX project_discovery_observations',
      /exists as a index, not a table/,
      null
    ],
    [
      'a meeting_id-only table (unrepairable NOT NULL columns)',
      'CREATE TABLE project_discovery_observations (meeting_id TEXT)',
      'DROP TABLE project_discovery_observations',
      /missing required column\(s\).*name_norm.*cannot be added by ALTER/,
      // Preflight refuses BEFORE any ALTER, so the table must be untouched —
      // no score/first_seen_at/last_seen_at quietly added by a failed boot.
      ['meeting_id']
    ],
    [
      'a full-column table WITHOUT the composite key (ON CONFLICT has no target)',
      `CREATE TABLE project_discovery_observations (
         name_norm TEXT NOT NULL, source_key TEXT NOT NULL, meeting_id TEXT,
         original_name TEXT NOT NULL, score REAL NOT NULL DEFAULT 0,
         first_seen_at TEXT, last_seen_at TEXT
       )`,
      'DROP TABLE project_discovery_observations',
      /no UNIQUE constraint on \(name_norm, source_key\)/,
      null
    ],
    [
      // The shape no metadata check can catch: every required column present, a
      // matching composite key — and an extra NOT NULL column with no default
      // that the insert never mentions. Only running the real write finds it.
      'an extra NOT NULL column the write omits (metadata-invisible)',
      `CREATE TABLE project_discovery_observations (
         name_norm TEXT NOT NULL, source_key TEXT NOT NULL, meeting_id TEXT,
         original_name TEXT NOT NULL, score REAL NOT NULL DEFAULT 0,
         first_seen_at TEXT, last_seen_at TEXT, blocker TEXT NOT NULL,
         PRIMARY KEY (name_norm, source_key)
       )`,
      'DROP TABLE project_discovery_observations',
      /rejects the write it must accept.*blocker/,
      null
    ]
  ])('fails the boot loudly when %s blocks the repair', async (_label, inject, cleanup, expected, expectedColumns) => {
    const backup = queryAll<{ name_norm: string; source_key: string; original_name: string; score: number }>(
      'SELECT name_norm, source_key, original_name, score FROM project_discovery_observations'
    )
    run('DROP TABLE project_discovery_observations')
    for (const stmt of inject.split(';').map((s) => s.trim()).filter(Boolean)) run(stmt)
    closeDatabase()

    try {
      await expect(initializeDatabase()).rejects.toThrow(expected)
      if (expectedColumns) {
        // A refused boot must leave the schema byte-identical. The savepoint
        // rolls back any repair, and preflight refuses before touching anything.
        expect(observationColumns()).toEqual(expectedColumns)
      }
    } finally {
      // Always clear the injection, so a failed assertion cannot strand the DB
      // for the remaining cases in this file.
      run(cleanup)
      closeDatabase()
      await initializeDatabase()
    }

    // A later boot with the injection gone heals and starts normally.
    expect(observationColumns()).toContain('meeting_id')
    for (const row of backup) {
      run(
        `INSERT OR IGNORE INTO project_discovery_observations
           (name_norm, source_key, original_name, score, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        [row.name_norm, row.source_key, row.original_name, row.score]
      )
    }
  })

  /**
   * The probe's first UPSERT must genuinely take the INSERT path. With a FIXED
   * sentinel a real row carrying that key turned both statements into ON CONFLICT
   * updates, so an INSERT-only failure passed unnoticed. The key is now generated
   * fresh per probe and confirmed absent, so the trigger below always fires.
   */
  it('exercises the INSERT path even when a legacy row occupies a sentinel-shaped key', async () => {
    // The row that used to shadow the sentinel — inserted before the trigger so
    // it is itself allowed in.
    run(
      `INSERT INTO project_discovery_observations
         (name_norm, source_key, meeting_id, original_name, score, first_seen_at, last_seen_at)
       VALUES ('hidock-schema-probe-', 'hidock-schema-probe-', NULL, 'legacy collision', 0,
               '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
    )
    // Fails NEW rows only; an ON CONFLICT update would sail straight past it.
    run(
      `CREATE TRIGGER block_new_observations AFTER INSERT ON project_discovery_observations
       BEGIN SELECT RAISE(ABORT, 'insert blocked'); END`
    )
    closeDatabase()

    try {
      await expect(initializeDatabase()).rejects.toThrow(/rejects the write it must accept.*insert blocked/)
    } finally {
      run('DROP TRIGGER block_new_observations')
      run(`DELETE FROM project_discovery_observations WHERE name_norm = 'hidock-schema-probe-'`)
      closeDatabase()
      await initializeDatabase()
    }
  })

  /**
   * Fail-closed cleanup. RAISE(ROLLBACK) unwinds the WHOLE transaction, so the
   * probe's savepoint is gone by the time the undo runs and ROLLBACK TO fails.
   * The boot must surface that rather than continue as though the state is clean.
   */
  it('refuses when the savepoint cleanup itself fails', async () => {
    run(
      `CREATE TRIGGER nuke_transaction AFTER INSERT ON project_discovery_observations
       BEGIN SELECT RAISE(ROLLBACK, 'transaction nuked'); END`
    )
    closeDatabase()

    try {
      await expect(initializeDatabase()).rejects.toThrow(
        /rejects the write it must accept|could not be restored to a known state/
      )
    } finally {
      run('DROP TRIGGER nuke_transaction')
      closeDatabase()
      await initializeDatabase()
    }
  })

  /**
   * A valid table whose UNIQUE index NAME requires SQL quoting must boot fine.
   * The pragma reader used to interpolate the name straight into the statement.
   */
  it('accepts a table whose unique index name requires quoting', async () => {
    run(`CREATE UNIQUE INDEX "weird ""name"" idx" ON project_discovery_observations(name_norm, source_key)`)
    closeDatabase()

    try {
      await expect(initializeDatabase()).resolves.toBeUndefined()
      expect(recordProjectDiscoveryObservation('QuotedIndexProbe', 'r:q1', 'h1', 0.7)).toBe(1)
    } finally {
      run(`DROP INDEX "weird ""name"" idx"`)
      run(`DELETE FROM project_discovery_observations WHERE name_norm = 'quotedindexprobe'`)
    }
  })

  /**
   * Savepoints must compose when the check runs inside an already-open
   * transaction — repairPhase and initializeDatabase may hold one, and a botched
   * nesting would corrupt the enclosing state instead of just failing.
   */
  it('composes with an already-open outer transaction', () => {
    const before = queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM project_discovery_observations')?.n

    runInTransaction(() => {
      verifyObservationsSchema('[test] nested')
      // The enclosing transaction is still usable afterwards…
      run(
        `INSERT INTO project_discovery_observations
           (name_norm, source_key, meeting_id, original_name, score, first_seen_at, last_seen_at)
         VALUES ('nestedwrite', 'r:nested', NULL, 'NestedWrite', 0.7,
                 '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
      )
    })

    // …and its work committed, with no probe residue alongside it.
    expect(queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM project_discovery_observations')?.n).toBe(
      (before ?? 0) + 1
    )
    expect(
      queryOne<{ n: number }>(
        `SELECT COUNT(*) AS n FROM project_discovery_observations WHERE name_norm LIKE 'hidock-schema-probe-%'`
      )?.n
    ).toBe(0)
    run(`DELETE FROM project_discovery_observations WHERE name_norm = 'nestedwrite'`)
  })

  /**
   * The probe runs on every boot of a HEALTHY database too, so it must be
   * invisible: its sentinel rows are rolled back inside their own savepoint and
   * must never reach disk, and it must not disturb existing rows.
   */
  it('a healthy boot leaves no probe residue', async () => {
    const before = queryAll<{ name_norm: string; source_key: string }>(
      'SELECT name_norm, source_key FROM project_discovery_observations ORDER BY name_norm, source_key'
    )
    expect(before.length).toBeGreaterThan(0) // the ledger is not trivially empty

    closeDatabase()
    await initializeDatabase()

    const after = queryAll<{ name_norm: string; source_key: string }>(
      'SELECT name_norm, source_key FROM project_discovery_observations ORDER BY name_norm, source_key'
    )
    expect(after).toEqual(before)
    // No sentinel row survived, under any spelling.
    expect(
      queryOne<{ n: number }>(
        `SELECT COUNT(*) AS n FROM project_discovery_observations WHERE name_norm LIKE '%hidock-schema-probe%'`
      )?.n
    ).toBe(0)
  })

  it('discovery reconciliation works end to end on the healed database', () => {
    const name = 'RestoredCompass'
    expect(applyTranscriptEntities({ meetingId: 'h1', project: { name } }).projectLinked).toBe(false)
    expect(applyTranscriptEntities({ meetingId: 'h2', project: { name } }).projectLinked).toBe(true)

    const rows = queryAll<{ id: string; origin: string | null }>(
      'SELECT id, origin FROM projects WHERE LOWER(name) = LOWER(?)',
      [name]
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].origin).toBe('discovered')
    // And the corroborating meetings are linked (the F12 backfill).
    const linked = queryAll<{ meeting_id: string }>(
      'SELECT meeting_id FROM meeting_projects WHERE project_id = ?',
      [rows[0].id]
    ).map((r) => r.meeting_id)
    expect(linked.sort()).toEqual(['h1', 'h2'])
  })
})
