/**
 * HIGH-3 (Codex re-review): schema v40 — download_queue.cancel_reason.
 *
 * ABI-INDEPENDENT migration contract test. database.ts imports better-sqlite3
 * (native ABI), so importing it here would tie this test to the local Node ABI —
 * exactly what the ignored DB-ABI suite suffers from. Instead this pins the v40
 * migration contract against the SOURCE: version bump, guarded idempotent
 * migration, fresh-schema column, and the every-boot repairPhase force-add (per
 * .claude/rules/database-migrations.md). The runtime BEHAVIOR of the column
 * (durable user-cancel suppression across a restart) is covered with a mocked DB
 * in download-service.test.ts.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const source = readFileSync(join(__dirname, '..', 'database.ts'), 'utf-8')

describe('schema v40: download_queue.cancel_reason (durable user-cancel suppression)', () => {
  it('bumps SCHEMA_VERSION to 40', () => {
    expect(source).toMatch(/const SCHEMA_VERSION = 40\b/)
  })

  it('fresh schema creates download_queue with the cancel_reason column', () => {
    // The column must live inside the download_queue CREATE TABLE block.
    const createBlock = source.match(/CREATE TABLE IF NOT EXISTS download_queue \([\s\S]*?\);/)
    expect(createBlock).not.toBeNull()
    expect(createBlock![0]).toContain('cancel_reason TEXT')
  })

  it('defines an idempotent migration 40 with a guarded ALTER', () => {
    // Migration entry exists…
    const migration = source.match(/40: \(\) => \{[\s\S]*?\n {2}\}/)
    expect(migration).not.toBeNull()
    const body = migration![0]
    // …checks the column before altering (idempotent — may re-run on corrupted DBs)…
    expect(body).toMatch(/getTableColumns\(database, 'download_queue'\)/)
    expect(body).toMatch(/!cols\.includes\('cancel_reason'\)/)
    // …adds the column and warns (never throws) on failure.
    expect(body).toContain("ALTER TABLE download_queue ADD COLUMN cancel_reason TEXT")
    expect(body).toMatch(/console\.warn\('\[Migration v40\]/)
  })

  it('repairPhase force-adds cancel_reason on every boot (skipped-migration safety)', () => {
    const repair = source.match(/function repairPhase\(\): void \{[\s\S]*?\n\}/)
    expect(repair).not.toBeNull()
    const body = repair![0]
    expect(body).toMatch(/getTableColumns\(database, 'download_queue'\)/)
    expect(body).toContain("ALTER TABLE download_queue ADD COLUMN cancel_reason TEXT")
  })
})
