/**
 * Schema v42 — projects.origin (durable provenance for the dismiss path).
 *
 * ABI-independent migration contract test (same pattern as v40/v41): pins the
 * SOURCE of database.ts — version bump, fresh-schema column, idempotent
 * migration, every-boot repairPhase force-add, and the two writers stamping the
 * column ('manual' in createProject, 'discovered' in the reconciler). The
 * runtime BEHAVIOR (a manual project cannot be dismissed even via direct IPC)
 * is covered against the real engine in project-discovery-rejection.test.ts.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const source = readFileSync(join(__dirname, '..', 'database.ts'), 'utf-8')
const reconciler = readFileSync(join(__dirname, '..', 'org-reconciler.ts'), 'utf-8')

describe('schema v42: projects.origin (provenance-enforced discovered-project dismissal)', () => {
  it('bumps SCHEMA_VERSION to 42 (current)', () => {
    expect(source).toMatch(/const SCHEMA_VERSION = 42\b/)
  })

  it('fresh schema creates projects with the origin column (manual | discovered)', () => {
    const createBlock = source.match(/CREATE TABLE IF NOT EXISTS projects \([\s\S]*?\);/)
    expect(createBlock).not.toBeNull()
    expect(createBlock![0]).toMatch(/origin TEXT CHECK\(origin IN \('manual', 'discovered'\)\)/)
  })

  it('defines an idempotent migration 42 with a guarded ALTER', () => {
    const migration = source.match(/42: \(\) => \{[\s\S]*?\n {2}\}/)
    expect(migration).not.toBeNull()
    const body = migration![0]
    expect(body).toMatch(/getTableColumns\(database, 'projects'\)/)
    expect(body).toMatch(/!cols\.includes\('origin'\)/)
    expect(body).toContain('ALTER TABLE projects ADD COLUMN origin TEXT')
    expect(body).toMatch(/console\.warn\('\[Migration v42\]/)
  })

  it('repairPhase force-adds origin on every boot (skipped-migration safety)', () => {
    const repair = source.match(/function repairPhase\(\): void \{[\s\S]*?\n\}/)
    expect(repair).not.toBeNull()
    const body = repair![0]
    expect(body).toMatch(/getTableColumns\(database, 'projects'\)/)
    expect(body).toContain('ALTER TABLE projects ADD COLUMN origin TEXT')
  })

  it("createProject stamps origin='manual'; the reconciler auto-create stamps 'discovered'", () => {
    const createFn = source.match(/export function createProject[\s\S]*?\n\}/)
    expect(createFn).not.toBeNull()
    expect(createFn![0]).toMatch(/INSERT INTO projects \(id, name, description, status, origin\) VALUES \(\?, \?, \?, \?, 'manual'\)/)
    expect(reconciler).toMatch(/INSERT INTO projects \(id, name, status, origin\) VALUES \(\?, \?, 'active', 'discovered'\)/)
  })

  it('dismissDiscoveredProject enforces provenance transactionally in the DB layer', () => {
    const fn = source.match(/export function dismissDiscoveredProject[\s\S]*?\n\}/)
    expect(fn).not.toBeNull()
    const body = fn![0]
    // One transaction wrapping check + tombstone + delete…
    expect(body).toContain('runInTransaction(')
    // …fail-closed provenance check (rejects 'manual' AND NULL/legacy)…
    expect(body).toMatch(/origin !== 'discovered'/)
    // …tombstone before delete.
    expect(body.indexOf('addProjectDiscoveryRejection')).toBeLessThan(body.indexOf('DELETE FROM projects'))
  })

  it('v42 also adds queryable merge_journal ordering columns (loser_id + explicit seq, backfilled)', () => {
    // Fresh schema carries both columns…
    const createBlock = source.match(/CREATE TABLE IF NOT EXISTS merge_journal \([\s\S]*?\);/)
    expect(createBlock).not.toBeNull()
    expect(createBlock![0]).toMatch(/loser_id TEXT/)
    expect(createBlock![0]).toMatch(/seq INTEGER/)
    // …the migration ALTER-adds and backfills them (loser_id from the snapshot,
    // seq from rowid — after which ordering NEVER keys on rowid again)…
    const migration = source.match(/42: \(\) => \{[\s\S]*?\n {2}\}/)
    expect(migration).not.toBeNull()
    expect(migration![0]).toContain('ALTER TABLE merge_journal ADD COLUMN loser_id TEXT')
    expect(migration![0]).toContain('ALTER TABLE merge_journal ADD COLUMN seq INTEGER')
    expect(migration![0]).toContain("json_extract(loser_snapshot, '$.id')")
    expect(migration![0]).toContain('SET seq = rowid WHERE seq IS NULL')
    // …and the shared unmerge guard orders strictly by seq, never rowid.
    const guard = source.match(/function assertNewestFirstUnmerge[\s\S]*?\n\}/)
    expect(guard).not.toBeNull()
    expect(guard![0]).toMatch(/seq > \?/)
    expect(guard![0]).not.toMatch(/rowid/)
  })
})
