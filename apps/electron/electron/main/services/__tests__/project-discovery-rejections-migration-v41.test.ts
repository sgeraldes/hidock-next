/**
 * Schema v41 — project_discovery_rejections (durable dismissed-discovery tombstones).
 *
 * ABI-independent migration contract test (same pattern as the v40 test): pins
 * the SOURCE of database.ts — version bump, fresh-schema table, and an
 * idempotent migration entry. The runtime BEHAVIOR (dismiss → re-analysis does
 * not re-create; manual create clears the tombstone) is covered against the
 * real engine in project-discovery-rejection.test.ts.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const source = readFileSync(join(__dirname, '..', 'database.ts'), 'utf-8')

describe('schema v41: project_discovery_rejections (durable discovered-project dismissal)', () => {
  it('bumps SCHEMA_VERSION to at least 41', () => {
    // Floor, not exact pin (same convention as the v40 test): later schema
    // bumps (v42+) must not break the v41 contract test. The CURRENT version
    // is pinned by the newest migration test.
    const m = source.match(/const SCHEMA_VERSION = (\d+)\b/)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBeGreaterThanOrEqual(41)
  })

  it('fresh schema creates the project_discovery_rejections table keyed by normalized name', () => {
    const createBlock = source.match(/CREATE TABLE IF NOT EXISTS project_discovery_rejections \([\s\S]*?\);/)
    expect(createBlock).not.toBeNull()
    expect(createBlock![0]).toContain('name_norm TEXT PRIMARY KEY')
    expect(createBlock![0]).toContain('original_name TEXT NOT NULL')
    expect(createBlock![0]).toContain('source_meeting_id TEXT')
  })

  it('defines an idempotent migration 41 (CREATE IF NOT EXISTS, warns on failure)', () => {
    const migration = source.match(/41: \(\) => \{[\s\S]*?\n {2}\}/)
    expect(migration).not.toBeNull()
    const body = migration![0]
    expect(body).toContain('CREATE TABLE IF NOT EXISTS project_discovery_rejections')
    expect(body).toMatch(/console\.warn\('\[Migration v41\]/)
  })

  it('manual create clears the tombstone (manual beats rejection)', () => {
    // createProject must call clearProjectDiscoveryRejection so an explicit
    // user create re-enables auto-linking for that name.
    const createFn = source.match(/export function createProject[\s\S]*?\n\}/)
    expect(createFn).not.toBeNull()
    expect(createFn![0]).toContain('clearProjectDiscoveryRejection(project.name)')
  })
})
