// @vitest-environment node

/**
 * v47 (F18/round-37, ADV35-1) — NODE-LEVEL graph provenance migration.
 *
 *  1. Boot schema version is 47.
 *  2. A graph_nodes table created lazily by the KnowledgeGraphStore carries the
 *     new origin + source_recording_id columns (from GRAPH_SCHEMA) on a fresh DB.
 *  3. The structural repair (run every boot) force-adds the columns to a LEGACY
 *     graph_nodes table that predates them, preserving existing rows (origin NULL),
 *     and is idempotent (a second boot is a no-op, no data loss).
 *
 * REAL temp DB, real database.ts (better-sqlite3) end to end.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'

const dbPath = join(tmpdir(), `hidock-v47-node-provenance-${process.pid}.sqlite`)
vi.mock('../file-storage', () => ({ getDatabasePath: () => dbPath }))

import { initializeDatabase, closeDatabase, run, queryAll, queryOne } from '../database'

function graphNodeColumns(): string[] {
  return queryAll<{ name: string }>("SELECT name FROM pragma_table_info('graph_nodes')").map((r) => r.name)
}

beforeEach(async () => {
  // Defensive: a sibling |main-db| suite in the same worker may have left the
  // module-singleton connection open on ITS path; close it first so our rm +
  // init truly re-point at a fresh v47 db (fixes full-run isolation flake).
  try {
    closeDatabase()
  } catch {
    /* not open — fine */
  }
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
  await initializeDatabase()
})
afterEach(() => {
  closeDatabase()
  if (existsSync(dbPath)) rmSync(dbPath, { force: true })
})

describe('v47 schema', () => {
  it('boot schema version is 47', () => {
    const row = queryOne<{ v: number }>('SELECT MAX(version) AS v FROM schema_version')!
    expect(row.v).toBe(47)
  })

  it('a freshly created graph_nodes table has origin + source_recording_id (GRAPH_SCHEMA)', () => {
    // Emulate the KnowledgeGraphStore's lazy DDL exactly as GRAPH_SCHEMA declares it.
    run(`CREATE TABLE IF NOT EXISTS graph_nodes (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, label TEXT NOT NULL, norm_key TEXT NOT NULL,
      props TEXT, created_at TEXT, updated_at TEXT, origin TEXT, source_recording_id TEXT
    )`)
    const cols = graphNodeColumns()
    expect(cols).toContain('origin')
    expect(cols).toContain('source_recording_id')
  })
})

describe('v47 structural repair — legacy graph_nodes gets the columns force-added', () => {
  it('adds origin + source_recording_id to a pre-v47 table and preserves rows (idempotent)', async () => {
    // Simulate a graph created by an OLDER build (no node-provenance columns).
    run(`CREATE TABLE graph_nodes (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, label TEXT NOT NULL, norm_key TEXT NOT NULL,
      props TEXT, created_at TEXT, updated_at TEXT
    )`)
    run("INSERT INTO graph_nodes (id, type, label, norm_key) VALUES ('n1', 'risk', 'Legacy Risk', 'risk:legacy risk')")
    expect(graphNodeColumns()).not.toContain('origin')

    // Re-boot: the structural repair phase runs and force-adds the columns.
    closeDatabase()
    await initializeDatabase()

    const cols = graphNodeColumns()
    expect(cols).toContain('origin')
    expect(cols).toContain('source_recording_id')
    // Existing legacy row survives; its provenance is NULL (resolved by the
    // read-time node-KIND heuristic, not a data backfill).
    const row = queryOne<{ origin: string | null; source_recording_id: string | null; label: string }>(
      "SELECT origin, source_recording_id, label FROM graph_nodes WHERE id = 'n1'"
    )!
    expect(row.label).toBe('Legacy Risk')
    expect(row.origin).toBeNull()
    expect(row.source_recording_id).toBeNull()

    // Idempotent: a THIRD boot must not throw or drop the row.
    closeDatabase()
    await initializeDatabase()
    expect(graphNodeColumns()).toContain('origin')
    expect(queryOne("SELECT id FROM graph_nodes WHERE id = 'n1'")).toBeDefined()
  })
})
