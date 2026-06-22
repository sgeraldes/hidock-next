// @vitest-environment node

/**
 * Unit tests for the shared DatabaseEngine.
 *
 * Uses a real sql.js database backed by a temp file, with a tiny app-supplied
 * schema + migrations, to exercise the generic engine behavior (4-phase boot,
 * version tracking, migration runner, query helpers) without any app coupling.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'
import { DatabaseEngine, getTableColumns } from '../src/index.js'

function tempDbPath(name: string): string {
  // Stable per-test path (no Date.now/Math.random — keep deterministic)
  return join(tmpdir(), `hidock-db-engine-test-${name}.sqlite`)
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, name TEXT);
  CREATE INDEX IF NOT EXISTS idx_items_name ON items(name);
`

describe('DatabaseEngine', () => {
  const paths: string[] = []

  afterEach(() => {
    for (const p of paths) {
      if (existsSync(p)) rmSync(p, { force: true })
    }
    paths.length = 0
  })

  function makeEngine(name: string, overrides: Partial<Parameters<typeof makeEngineConfig>[0]> = {}) {
    const path = tempDbPath(name)
    paths.push(path)
    return new DatabaseEngine(makeEngineConfig({ path, ...overrides }))
  }

  function makeEngineConfig(opts: {
    path: string
    schemaVersion?: number
    migrations?: Record<number, () => void>
    repairPhase?: () => void
  }) {
    return {
      dbPathProvider: () => opts.path,
      schemaVersion: opts.schemaVersion ?? 1,
      schema: SCHEMA,
      migrations: opts.migrations ?? {},
      repairPhase: opts.repairPhase,
    }
  }

  it('initializes, creates tables, and persists to disk', async () => {
    const path = tempDbPath('init')
    paths.push(path)
    const engine = new DatabaseEngine(makeEngineConfig({ path }))
    await engine.initialize()

    expect(getTableColumns(engine.getDatabase(), 'items')).toEqual(['id', 'name'])
    expect(existsSync(path)).toBe(true)
  })

  it('records schema version on fresh init', async () => {
    const engine = makeEngine('version', { schemaVersion: 3 })
    await engine.initialize()
    const row = engine.queryOne<{ version: number }>(
      'SELECT version FROM schema_version ORDER BY version DESC LIMIT 1'
    )
    expect(row?.version).toBe(3)
  })

  it('runs query helpers (run / queryAll / queryOne)', async () => {
    const engine = makeEngine('queries')
    await engine.initialize()
    engine.run('INSERT INTO items (id, name) VALUES (?, ?)', ['a', 'Alpha'])
    engine.run('INSERT INTO items (id, name) VALUES (?, ?)', ['b', 'Beta'])

    expect(engine.queryAll('SELECT * FROM items')).toHaveLength(2)
    expect(engine.queryOne<{ name: string }>('SELECT name FROM items WHERE id = ?', ['a'])?.name).toBe('Alpha')
  })

  it('runs migrations in ascending order up to schemaVersion', async () => {
    const calls: number[] = []
    const engine = makeEngine('migrate', {
      schemaVersion: 3,
      migrations: {
        2: () => {
          calls.push(2)
          engine.run("INSERT INTO items (id, name) VALUES ('m2', 'from-migration-2')")
        },
        3: () => {
          calls.push(3)
        },
      },
    })
    await engine.initialize()
    expect(calls).toEqual([2, 3])
    expect(engine.queryOne('SELECT * FROM items WHERE id = ?', ['m2'])).toBeDefined()
    const v = engine.queryOne<{ version: number }>(
      'SELECT version FROM schema_version ORDER BY version DESC LIMIT 1'
    )
    expect(v?.version).toBe(3)
  })

  it('does not re-run migrations already applied on a second boot', async () => {
    const path = tempDbPath('reboot')
    paths.push(path)
    let runs = 0
    const cfg = () => ({
      dbPathProvider: () => path,
      schemaVersion: 2,
      schema: SCHEMA,
      migrations: { 2: () => { runs++ } },
    })
    const e1 = new DatabaseEngine(cfg())
    await e1.initialize()
    e1.closeDatabase()
    expect(runs).toBe(1)

    const e2 = new DatabaseEngine(cfg())
    await e2.initialize()
    expect(runs).toBe(1) // already at v2 — migration not re-run
  })

  it('calls the repairPhase callback during boot', async () => {
    let repaired = false
    const engine = makeEngine('repair', { repairPhase: () => { repaired = true } })
    await engine.initialize()
    expect(repaired).toBe(true)
  })

  it('runInTransaction commits on success and rolls back on throw', async () => {
    const engine = makeEngine('txn')
    await engine.initialize()

    engine.runInTransaction(() => {
      engine.runNoSave("INSERT INTO items (id, name) VALUES ('t1', 'ok')")
    })
    expect(engine.queryOne('SELECT * FROM items WHERE id = ?', ['t1'])).toBeDefined()

    expect(() =>
      engine.runInTransaction(() => {
        engine.runNoSave("INSERT INTO items (id, name) VALUES ('t2', 'bad')")
        throw new Error('boom')
      })
    ).toThrow('boom')
    expect(engine.queryOne('SELECT * FROM items WHERE id = ?', ['t2'])).toBeUndefined()
  })

  it('getDatabase throws before initialize', () => {
    const engine = makeEngine('uninit')
    expect(() => engine.getDatabase()).toThrow('Database not initialized')
  })
})
