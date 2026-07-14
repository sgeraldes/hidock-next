/**
 * Schema v42 — knowledge_captures.quality_reasons + quality_source (F16/spec-001).
 *
 * ABI-independent migration contract test (same pattern as the v40/v41 tests):
 * pins the SOURCE of database.ts — version bump, fresh-schema columns, an
 * idempotent migration entry, and the every-boot repairPhase force-add (the
 * def-string trap called out in phase-1-architecture-review.md A2: the
 * knowledgeRepairs loop runs `ADD COLUMN ${col.def}`, so def must embed the
 * column name itself or the ALTER silently no-ops). The runtime BEHAVIOR
 * (never-downgrade guard, idempotent apply, standalone classifier) is covered
 * against the real engine in value-classification.test.ts.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const source = readFileSync(join(__dirname, '..', 'database.ts'), 'utf-8')

describe('schema v42: knowledge_captures.quality_reasons + quality_source (content-based value classification)', () => {
  it('bumps SCHEMA_VERSION to at least 42', () => {
    // Floor, not exact pin: later schema bumps (v43+, F16/spec-003's
    // value_backfill_state) must not break this v42 contract test. The CURRENT
    // version is pinned by the newest migration test (value-backfill-migration-v43.test.ts).
    const m = source.match(/const SCHEMA_VERSION = (\d+)\b/)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBeGreaterThanOrEqual(42)
  })

  it('fresh schema adds quality_reasons + quality_source to the knowledge_captures CREATE block', () => {
    const createBlock = source.match(/CREATE TABLE IF NOT EXISTS knowledge_captures \([\s\S]*?\);/)
    expect(createBlock).not.toBeNull()
    expect(createBlock![0]).toContain('quality_reasons TEXT')
    expect(createBlock![0]).toMatch(/quality_source TEXT CHECK\(quality_source IN \('ai', ?'user'\)\)/)
  })

  it('defines an idempotent migration 42 with guarded ALTERs for both columns', () => {
    const migration = source.match(/42: \(\) => \{[\s\S]*?\n {2}\}/)
    expect(migration).not.toBeNull()
    const body = migration![0]
    expect(body).toMatch(/getTableColumns\(database, 'knowledge_captures'\)/)
    expect(body).toMatch(/!cols\.includes\('quality_reasons'\)/)
    expect(body).toMatch(/!cols\.includes\('quality_source'\)/)
    expect(body).toContain('ALTER TABLE knowledge_captures ADD COLUMN quality_reasons TEXT')
    expect(body).toMatch(/ALTER TABLE knowledge_captures ADD COLUMN quality_source TEXT CHECK\(quality_source IN \('ai','user'\)\)/)
    expect(body).toMatch(/console\.warn\('\[Migration v42\]/)
  })

  it('repairPhase force-adds both columns with the name embedded in def (A2 trap avoided)', () => {
    const repair = source.match(/function repairPhase\(\): void \{[\s\S]*?\n\}/)
    expect(repair).not.toBeNull()
    const body = repair![0]

    // The knowledgeRepairs loop runs `ADD COLUMN ${col.def}` (def INCLUDES the
    // name) — unlike the meetings/recordings repair loops, which run
    // `ADD COLUMN ${col.name} ${col.def}`. A bare-type def here would silently
    // no-op (swallowed by try/catch), defeating the repair safety net.
    expect(body).toMatch(/ADD COLUMN \$\{col\.def\}/)
    expect(body).toMatch(/name:\s*'quality_reasons',\s*def:\s*'quality_reasons TEXT'/)
    expect(body).toMatch(/name:\s*'quality_source',\s*def:\s*"quality_source TEXT CHECK\(quality_source IN \('ai','user'\)\)"/)
  })

  it('classifyLowValueCaptures stamps quality_source=\'ai\' for consistency with the AI classifier', () => {
    const fn = source.match(/export function classifyLowValueCaptures[\s\S]*?\n\}/)
    expect(fn).not.toBeNull()
    expect(fn![0]).toContain("quality_source = 'ai'")
  })
})
