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
  countProjectDiscoverySources
} from '../database'
import { applyTranscriptEntities } from '../org-reconciler'

function observationColumns(): string[] {
  return queryAll<{ name: string }>('PRAGMA table_info(project_discovery_observations)').map((c) => c.name)
}

describe('v43 heal: a database stranded with the pre-meeting_id table shape', () => {
  beforeAll(async () => {
    await initializeDatabase()

    // Rebuild the EXACT first-cut state: drop the healed table and recreate it
    // without meeting_id, leaving schema_version at 43 so migration 43 is skipped.
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

  it('is still recorded at v43 — the migration is genuinely skipped, not re-run', () => {
    expect(queryOne<{ v: number }>('SELECT MAX(version) AS v FROM schema_version')?.v).toBe(43)
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
    expect(recordProjectDiscoveryObservation('Healed Beacon', 'r:h1', 'h1', 0.7)).toBe(1)
    expect(countProjectDiscoverySources('Healed Beacon')).toBe(1)
  })

  /**
   * Fail-closed proof. For an already-v43 DB migration 43 is SKIPPED, so
   * repairPhase is the ONLY heal path — if its ALTER fails and the failure is
   * swallowed, the boot continues with a table that cannot accept an observation
   * write, recreating the stranded condition for the whole session and, under a
   * persistent failure, indefinitely.
   *
   * Injection: replace the table with a VIEW of the same name. `CREATE TABLE IF
   * NOT EXISTS` then fails (object exists), PRAGMA table_info still reports
   * columns (so the repair sees a shape missing meeting_id), and ALTER TABLE on a
   * view fails — exactly the persistent-failure case. Boot must throw.
   */
  it('fails the boot loudly when the repair cannot add the column', async () => {
    const backup = queryAll<{ name_norm: string; source_key: string; original_name: string; score: number }>(
      'SELECT name_norm, source_key, original_name, score FROM project_discovery_observations'
    )
    run('DROP TABLE project_discovery_observations')
    run(`
      CREATE VIEW project_discovery_observations AS
        SELECT 'x' AS name_norm, 'x' AS source_key, 'x' AS original_name, 0 AS score,
               '' AS first_seen_at, '' AS last_seen_at
    `)
    closeDatabase()

    await expect(initializeDatabase()).rejects.toThrow(/missing meeting_id and could not be repaired/)

    // Clear the injected failure: a later boot heals and starts normally.
    run('DROP VIEW project_discovery_observations')
    closeDatabase()
    await initializeDatabase()

    expect(observationColumns()).toContain('meeting_id')
    for (const row of backup) {
      run(
        `INSERT INTO project_discovery_observations
           (name_norm, source_key, original_name, score, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`,
        [row.name_norm, row.source_key, row.original_name, row.score]
      )
    }
  })

  it('discovery reconciliation works end to end on the healed database', () => {
    const name = 'Restored Compass'
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
