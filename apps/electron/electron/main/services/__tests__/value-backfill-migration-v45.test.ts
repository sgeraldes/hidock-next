/**
 * Schema v45 — value_backfill_state (resumable F16/spec-003 value backfill cursor).
 *
 * ABI-independent migration contract test (same pattern as the v40/v41/v44
 * tests): pins the SOURCE of database.ts — version bump (this IS the current
 * newest migration, so the exact value is pinned rather than a floor),
 * fresh-schema table, and an idempotent migration entry. A brand-new TABLE
 * (unlike v44's columns) has no repairPhase entry — repairPhase only
 * force-adds missing COLUMNS to existing tables — so the belt-and-suspenders
 * safety net for this table is the lazy `CREATE TABLE IF NOT EXISTS` at
 * runner start (value-backfill.ts), covered in value-backfill.test.ts. The
 * runtime BEHAVIOR (reserve/call/finalize, attempts, resumability) is covered
 * against the real engine in value-backfill.test.ts.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const source = readFileSync(join(__dirname, '..', 'database.ts'), 'utf-8')

describe('schema v45: value_backfill_state (resumable value-classification backfill cursor)', () => {
  it('SCHEMA_VERSION is at least 45 and the v45 migration is registered', () => {
    // v45 shipped value_backfill_state. The GLOBAL "current version" pin now lives
    // in membership-provenance-migration-v46.test.ts (F18/round-27 bumped 45 -> 46);
    // here we only assert v43's migration still exists and the version never
    // regressed below it. A future bump updates the v46 test, not this one.
    const m = source.match(/const SCHEMA_VERSION = (\d+)\b/)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBeGreaterThanOrEqual(45)
    expect(source).toMatch(/^\s*45:\s*\(\)\s*=>/m) // MIGRATIONS[45] still registered
  })

  it('fresh schema creates the value_backfill_state table with the resumability columns', () => {
    const createBlock = source.match(/CREATE TABLE IF NOT EXISTS value_backfill_state \([\s\S]*?\);/)
    expect(createBlock).not.toBeNull()
    const body = createBlock![0]
    expect(body).toContain('capture_id TEXT PRIMARY KEY')
    expect(body).toContain('status TEXT NOT NULL')
    expect(body).toContain('result_rating TEXT')
    expect(body).toContain('attempts INTEGER NOT NULL DEFAULT 0')
    expect(body).toContain('run_id TEXT')
    expect(body).toContain('last_error TEXT')
  })

  it('defines an idempotent migration 45 (CREATE IF NOT EXISTS, warns on failure)', () => {
    const migration = source.match(/45: \(\) => \{[\s\S]*?\n {2}\}/)
    expect(migration).not.toBeNull()
    const body = migration![0]
    expect(body).toContain('CREATE TABLE IF NOT EXISTS value_backfill_state')
    expect(body).toMatch(/console\.warn\('\[Migration v45\]/)
  })

  it('migration 45 is appended AFTER migration 44 in the MIGRATIONS object (append-only discipline)', () => {
    const idx44 = source.indexOf('44: () => {')
    const idx45 = source.indexOf('45: () => {')
    expect(idx44).toBeGreaterThan(-1)
    expect(idx45).toBeGreaterThan(idx44)
  })
})
