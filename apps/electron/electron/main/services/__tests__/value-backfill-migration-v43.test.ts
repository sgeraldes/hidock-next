/**
 * Schema v43 — value_backfill_state (resumable F16/spec-003 value backfill cursor).
 *
 * ABI-independent migration contract test (same pattern as the v40/v41/v42
 * tests): pins the SOURCE of database.ts — version bump (this IS the current
 * newest migration, so the exact value is pinned rather than a floor),
 * fresh-schema table, and an idempotent migration entry. A brand-new TABLE
 * (unlike v42's columns) has no repairPhase entry — repairPhase only
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

describe('schema v43: value_backfill_state (resumable value-classification backfill cursor)', () => {
  it('bumps SCHEMA_VERSION to exactly 43 (current)', () => {
    // This IS the newest migration in the worktree at time of writing — pin the
    // exact value (same convention as value-classification-migration-v42.test.ts
    // did before this migration existed). A future migration bump must update
    // this test, not silently pass it.
    expect(source).toMatch(/const SCHEMA_VERSION = 43\b/)
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

  it('defines an idempotent migration 43 (CREATE IF NOT EXISTS, warns on failure)', () => {
    const migration = source.match(/43: \(\) => \{[\s\S]*?\n {2}\}/)
    expect(migration).not.toBeNull()
    const body = migration![0]
    expect(body).toContain('CREATE TABLE IF NOT EXISTS value_backfill_state')
    expect(body).toMatch(/console\.warn\('\[Migration v43\]/)
  })

  it('migration 43 is appended AFTER migration 42 in the MIGRATIONS object (append-only discipline)', () => {
    const idx42 = source.indexOf('42: () => {')
    const idx43 = source.indexOf('43: () => {')
    expect(idx42).toBeGreaterThan(-1)
    expect(idx43).toBeGreaterThan(idx42)
  })
})
