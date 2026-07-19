/**
 * Schema v43 — project_discovery_observations (F12 discovery gate ledger).
 *
 * ABI-INDEPENDENT migration contract test, mirroring
 * download-queue-migration-v40.test.ts: database.ts imports better-sqlite3
 * (native ABI), so this pins the migration contract against the SOURCE — version
 * bump, guarded idempotent migration, and a fresh-schema CREATE TABLE that the
 * engine can actually parse. The runtime behaviour of the ledger is covered in
 * project-discovery-gate-integration.test.ts against the real engine.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const source = readFileSync(join(__dirname, '..', 'database.ts'), 'utf-8')

/** The engine splits SCHEMA on ';' — exactly how DatabaseEngine.initialize does. */
function schemaStatements(): string[] {
  const schema = source.match(/const SCHEMA = `([\s\S]*?)`\s*\n/)
  expect(schema).not.toBeNull()
  return schema![1]
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/**
 * Drop leading `--` comment lines, as the engine does before its CREATE TABLE
 * check. Returns '' for a chunk that is entirely comments — SQLite treats that
 * as a no-op, so it is not a broken statement.
 */
function stripLeadingComments(sql: string): string {
  const lines = sql.split('\n')
  const firstCode = lines.findIndex((l) => l.trim() && !l.trim().startsWith('--'))
  return firstCode < 0 ? '' : lines.slice(firstCode).join('\n').trim()
}

describe('schema v43: project_discovery_observations (F12 discovery gate)', () => {
  it('bumps SCHEMA_VERSION to at least 43', () => {
    const m = source.match(/const SCHEMA_VERSION = (\d+)\b/)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBeGreaterThanOrEqual(43)
  })

  it('fresh schema declares the ledger with its composite primary key', () => {
    const createBlock = source.match(
      /CREATE TABLE IF NOT EXISTS project_discovery_observations \([\s\S]*?\);/
    )
    expect(createBlock).not.toBeNull()
    const block = createBlock![0]
    expect(block).toContain('name_norm TEXT NOT NULL')
    expect(block).toContain('source_key TEXT NOT NULL')
    expect(block).toContain('score REAL NOT NULL')
    // Carried alongside the stable capture key so the distinct-source count can
    // collapse two recordings of one conversation.
    expect(block).toContain('meeting_id TEXT')
    // The composite PK is what makes recurrence honest — re-analysing one source
    // upserts a single row instead of inflating the distinct-source count.
    expect(block).toContain('PRIMARY KEY (name_norm, source_key)')
  })

  /**
   * Regression: a stray ';' inside the table's SCHEMA comment split the statement,
   * so the engine saw a fragment starting with prose instead of CREATE TABLE — the
   * table silently fell out of Phase 1 and only existed via the migration, and
   * Phase 4 logged a syntax error. Every SCHEMA statement must be parseable.
   */
  it('every SCHEMA statement is a real statement, not a comment fragment', () => {
    for (const stmt of schemaStatements()) {
      const code = stripLeadingComments(stmt)
      if (!code) continue
      expect(
        /^(CREATE|INSERT|PRAGMA|ALTER|DROP|UPDATE|DELETE)\b/i.test(code),
        `SCHEMA statement does not start with a SQL keyword:\n${code.slice(0, 120)}`
      ).toBe(true)
    }
  })

  /**
   * The root cause, guarded directly: SCHEMA is split on ';', so a semicolon
   * anywhere in a `--` comment tears the following statement in half. It only
   * *happens* to be survivable when the ';' lands at a line end (the remainder is
   * still a comment line) — move a word and the next statement starts with prose
   * and stops being a CREATE TABLE. Keep comments semicolon-free.
   */
  it('no SCHEMA comment contains a semicolon (it would split the next statement)', () => {
    const schema = source.match(/const SCHEMA = `([\s\S]*?)`\s*\n/)![1]
    const offenders = schema
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('--') && l.includes(';'))
    expect(offenders, `semicolon inside SCHEMA comment:\n${offenders.join('\n')}`).toEqual([])
  })

  it('the ledger survives the split as its own CREATE TABLE statement', () => {
    const owned = schemaStatements()
      .map(stripLeadingComments)
      .filter((s) => s.includes('project_discovery_observations'))
    expect(owned).toHaveLength(1)
    expect(owned[0].toUpperCase().startsWith('CREATE TABLE')).toBe(true)
  })

  it('migration 43 creates the table idempotently', () => {
    const migration = source.match(/\n {2}43: \(\) => \{[\s\S]*?\n {2}\}/)
    expect(migration).not.toBeNull()
    expect(migration![0]).toContain('CREATE TABLE IF NOT EXISTS project_discovery_observations')
  })

  /**
   * The column shipped one commit AFTER the table under the SAME schema version,
   * so a DB that reached v43 from the first build has the table without
   * meeting_id and never re-runs the migration. CREATE TABLE IF NOT EXISTS
   * cannot fix an existing table, so both the migration and the every-boot
   * repairPhase must verify-and-ALTER. (Runtime heal proven against the real
   * engine in project-discovery-observations-heal-v43.test.ts.)
   */
  it('migration 43 adds meeting_id when the table already exists without it', () => {
    const migration = source.match(/\n {2}43: \(\) => \{[\s\S]*?\n {2}\}/)![0]
    expect(migration).toContain('ALTER TABLE project_discovery_observations ADD COLUMN meeting_id TEXT')
  })

  it('migration 43 fails loudly rather than recording v43 over an unusable table', () => {
    const migration = source.match(/\n {2}43: \(\) => \{[\s\S]*?\n {2}\}/)![0]
    // No swallowing catch: the engine records a version only after the migration
    // returns, so a swallowed failure would strand the DB at 43 with a table that
    // cannot accept an insert. Same fail-loud policy as the v42 tombstone re-key.
    expect(migration).not.toMatch(/catch\s*\(/)
    expect(migration).toContain('throw new Error')
  })

  it('repairPhase force-adds meeting_id on every boot', () => {
    const repair = source.match(/function repairPhase\(\): void \{[\s\S]*?\n\}/)
    expect(repair).not.toBeNull()
    expect(repair![0]).toContain('CREATE TABLE IF NOT EXISTS project_discovery_observations')
    expect(repair![0]).toContain('ALTER TABLE project_discovery_observations ADD COLUMN meeting_id TEXT')
  })
})
