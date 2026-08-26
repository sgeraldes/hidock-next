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

  it('migration 43 creates the table from the shared DDL', () => {
    const migration = source.match(/\n {2}43: \(\) => \{[\s\S]*?\n {2}\}/)
    expect(migration).not.toBeNull()
    expect(migration![0]).toContain('OBSERVATIONS_TABLE_DDL')
    // One DDL constant, so the two heal paths cannot drift apart.
    const ddl = source.match(/const OBSERVATIONS_TABLE_DDL = `[\s\S]*?`/)
    expect(ddl).not.toBeNull()
    expect(ddl![0]).toContain('CREATE TABLE IF NOT EXISTS project_discovery_observations')
    expect(ddl![0]).toContain('meeting_id TEXT')
  })

  /**
   * The column shipped one commit AFTER the table under the SAME schema version,
   * so a DB that reached v43 from the first build has the table without
   * meeting_id and never re-runs the migration. CREATE TABLE IF NOT EXISTS
   * cannot fix an existing table, so both the migration and the every-boot
   * repairPhase must verify-and-ALTER. (Runtime heal proven against the real
   * engine in project-discovery-observations-heal-v43.test.ts.)
   */
  /**
   * The verification must be UNCONDITIONAL and validate the FULL write contract.
   * Two earlier cuts leaked: one only verified when PRAGMA returned at least one
   * column (so an absent table blocked by a same-named index sailed through), and
   * one checked only "is a table and has meeting_id" (so a malformed table — or
   * one lacking the composite key ON CONFLICT needs — booted with writes broken).
   */
  it('both heal paths end in the shared unconditional check', () => {
    const migration = source.match(/\n {2}43: \(\) => \{[\s\S]*?\n {2}\}/)![0]
    const repair = source.match(/function repairPhase\(\): void \{[\s\S]*?\n\}/)![0]
    for (const block of [migration, repair]) {
      expect(block).toContain('ensureObservationsTableUsable(database')
    }
  })

  it('declares the complete write contract every insert depends on', () => {
    const required = source.match(/const OBSERVATIONS_REQUIRED_COLUMNS = \[[\s\S]*?\]/)![0]
    for (const column of [
      'name_norm',
      'source_key',
      'meeting_id',
      'original_name',
      'score',
      'first_seen_at',
      'last_seen_at'
    ]) {
      expect(required).toContain(`'${column}'`)
    }
    // The ON CONFLICT target must be declared, not implied.
    const key = source.match(/const OBSERVATIONS_CONFLICT_KEY = \[[\s\S]*?\]/)![0]
    expect(key).toContain("'name_norm'")
    expect(key).toContain("'source_key'")
  })

  it('separates repairable columns from ones ALTER cannot add', () => {
    const repairable = source.match(/const OBSERVATIONS_REPAIRABLE_COLUMNS[\s\S]*?\n\}/)![0]
    // Nullable / constant-default columns can be added to an existing table…
    for (const column of ['meeting_id', 'score', 'first_seen_at', 'last_seen_at']) {
      expect(repairable).toContain(`${column}:`)
    }
    // …NOT NULL columns without a constant default cannot, so they must NOT be
    // listed as repairable or the ALTER would fail and the table stay broken.
    for (const column of ['name_norm', 'source_key', 'original_name']) {
      expect(repairable).not.toContain(`${column}:`)
    }
  })

  it('resolves the ON CONFLICT target from real constraints, not the DDL text', () => {
    const fn = source.match(/function hasConflictTarget\([\s\S]*?\n\}/)
    expect(fn).not.toBeNull()
    const body = fn![0]
    // Declared PRIMARY KEY via table_info's pk ordinal, plus UNIQUE indexes.
    expect(body).toContain('table_info(')
    expect(body).toContain('index_list(')
    expect(body).toContain('index_info(')
    // A partial index cannot serve as an ON CONFLICT target.
    expect(body).toContain('partial')
  })

  it('the check asks sqlite_master for the object type, not just PRAGMA columns', () => {
    const fn = source.match(/function ensureObservationsTableUsable\([\s\S]*?\n\}/)
    expect(fn).not.toBeNull()
    const body = fn![0]
    expect(body).toContain('SELECT type FROM sqlite_master WHERE name =')
    expect(body).toContain("type !== 'table'")
    expect(body).toContain('hasConflictTarget(')
  })

  /**
   * Metadata can only catch the ways a schema is wrong that we thought to model,
   * and that space is open-ended (extra NOT NULL columns, CHECKs, triggers,
   * generated columns). The authority is a real write, and it must be THE write —
   * one shared statement, so the probe cannot drift from production.
   */
  it('the probe executes the same upsert statement production uses', () => {
    const upsert = source.match(/const OBSERVATIONS_UPSERT_SQL = `[\s\S]*?`/)
    expect(upsert).not.toBeNull()
    expect(upsert![0]).toContain('ON CONFLICT(name_norm, source_key) DO UPDATE SET')

    const probe = source.match(/function probeObservationsWrite\([\s\S]*?\n\}/)![0]
    // Both the INSERT path and the ON CONFLICT path are exercised.
    expect((probe.match(/database\.run\(OBSERVATIONS_UPSERT_SQL/g) ?? []).length).toBe(2)

    // And production runs the same constant, not a copy.
    const record = source.match(/export function recordProjectDiscoveryObservation\([\s\S]*?\n\}/)![0]
    expect(record).toContain('run(OBSERVATIONS_UPSERT_SQL')
  })

  it('the probe always rolls back, so a healthy boot leaves no rows', () => {
    const probe = source.match(/function probeObservationsWrite\([\s\S]*?\n\}/)![0]
    expect(probe).toContain('SAVEPOINT ${savepoint}')
    // The undo sits in a finally — it must run on success AND on failure.
    expect(probe).toMatch(/finally \{[\s\S]*ROLLBACK TO \$\{savepoint\}/)
  })

  /**
   * A refused boot must leave the database byte-identical. Repairing first and
   * refusing after left half-ALTERed tables behind, because repairPhase is not
   * itself transactional.
   */
  it('generates a FRESH probe key and confirms it is absent before writing', () => {
    const probe = source.match(/function probeObservationsWrite\([\s\S]*?\n\}/)![0]
    // Fresh per probe — a fixed sentinel could be shadowed by a real row, turning
    // the INSERT path into a second ON CONFLICT update.
    expect(probe).toContain('randomUUID()')
    expect(probe).toContain('OBSERVATIONS_PROBE_PREFIX')
    // …and proven absent, so the first upsert really does INSERT.
    expect(probe).toMatch(/SELECT 1 FROM \$\{table\} WHERE name_norm = \? AND source_key = \?/)
  })

  /**
   * Metadata is diagnostics ONLY. It can misjudge a valid table (an index name
   * needing SQL quoting, a constraint form the reader does not model), and a
   * false refusal would block boot on a healthy database.
   */
  it('never refuses on metadata alone — only the probe and cleanup can refuse', () => {
    const body = source.match(/function ensureObservationsTableUsable\([\s\S]*?\n\}/)![0]
    // The metadata findings are collected, not acted on.
    expect(body).toContain('diagnostics.push(')
    expect(body).not.toMatch(/failure =\s*$\s*`is missing required column/m)
    // Exactly two refusal sites, both downstream of the probe.
    const refusals = [...body.matchAll(/\n {2}if \((cleanupError|failure)\)/g)].map((m) => m[1])
    expect(refusals).toEqual(['cleanupError', 'failure'])
  })

  it('binds pragma arguments instead of interpolating identifiers', () => {
    const reader = source.match(/function hasConflictTarget\([\s\S]*?\n\}/)![0]
    for (const call of ['pragma_table_info(?)', 'pragma_index_list(?)', 'pragma_index_info(?)']) {
      expect(reader).toContain(call)
    }
    // No index name spliced into SQL — that broke on names requiring quoting.
    expect(reader).not.toMatch(/index_info\('\$\{/)
  })

  it('treats a failed savepoint cleanup as fail-closed', () => {
    const body = source.match(/function ensureObservationsTableUsable\([\s\S]*?\n\}/)![0]
    const probe = source.match(/function probeObservationsWrite\([\s\S]*?\n\}/)![0]
    // Both levels record the cleanup failure rather than swallowing it…
    expect(probe).toContain('probe rollback failed')
    expect(body).toContain('rollback failed')
    expect(body).toContain('release failed')
    // …and an indeterminate state refuses the boot.
    expect(body).toContain('could not be restored to a known state')
  })

  it('preflights before mutating and wraps the whole repair in a savepoint', () => {
    const body = source.match(/function ensureObservationsTableUsable\([\s\S]*?\n\}/)![0]
    expect(body).toContain('SAVEPOINT ${savepoint}')
    expect(body).toContain('ROLLBACK TO ${savepoint}')
    expect(body).toContain('RELEASE ${savepoint}')
    // The unrepairable-column and conflict-key checks must come BEFORE the ALTER.
    const preflight = body.indexOf('const unrepairable')
    const conflictCheck = body.indexOf('hasConflictTarget(')
    const alter = body.indexOf('ADD COLUMN')
    expect(preflight).toBeGreaterThan(-1)
    expect(preflight).toBeLessThan(alter)
    expect(conflictCheck).toBeLessThan(alter)
  })

  it('migration 43 fails loudly rather than recording v43 over an unusable schema', () => {
    const migration = source.match(/\n {2}43: \(\) => \{[\s\S]*?\n {2}\}/)![0]
    // No swallowing catch: the engine records a version only after the migration
    // returns, so a swallowed failure would strand the DB at 43 with a table that
    // cannot accept an insert. Same fail-loud policy as the v42 tombstone re-key.
    expect(migration).not.toMatch(/catch\s*\(/)
  })
})
