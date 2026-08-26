// @vitest-environment node

/**
 * Unit tests for the shared DatabaseEngine (better-sqlite3 + WAL).
 *
 * Uses a real better-sqlite3 database backed by a temp file, with a tiny
 * app-supplied schema + migrations, to exercise the generic engine behavior
 * (4-phase boot, version tracking, migration runner, query helpers, the sql.js
 * compatibility facade) without any app coupling.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync } from 'fs'
import Database from 'better-sqlite3'
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
      for (const suffix of ['', '.tmp', '-wal', '-shm']) {
        if (existsSync(`${p}${suffix}`)) rmSync(`${p}${suffix}`, { force: true })
      }
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
    protectedTables?: string[]
    vacuumAfterMigration?: boolean
  }) {
    return {
      betterSqlite3: Database,
      dbPathProvider: () => opts.path,
      schemaVersion: opts.schemaVersion ?? 1,
      schema: SCHEMA,
      migrations: opts.migrations ?? {},
      repairPhase: opts.repairPhase,
      protectedTables: opts.protectedTables,
      vacuumAfterMigration: opts.vacuumAfterMigration,
    }
  }

  it('initializes, creates tables, and persists to disk', async () => {
    const path = tempDbPath('init')
    paths.push(path)
    const engine = new DatabaseEngine(makeEngineConfig({ path }))
    await engine.initialize()

    expect(getTableColumns(engine.getDatabase(), 'items')).toEqual(['id', 'name'])
    expect(existsSync(path)).toBe(true)
    engine.closeDatabase()
  })

  it('opens in WAL journal mode', async () => {
    const engine = makeEngine('wal-mode')
    await engine.initialize()
    // Read the journal mode through the sql.js-compatible facade.
    const res = engine.getDatabase().exec('PRAGMA journal_mode')
    expect(String(res[0].values[0][0]).toLowerCase()).toBe('wal')
    engine.closeDatabase()
  })

  it('records schema version on fresh init', async () => {
    const engine = makeEngine('version', { schemaVersion: 3 })
    await engine.initialize()
    const row = engine.queryOne<{ version: number }>(
      'SELECT version FROM schema_version ORDER BY version DESC LIMIT 1'
    )
    expect(row?.version).toBe(3)
    engine.closeDatabase()
  })

  it('runs query helpers (run / queryAll / queryOne)', async () => {
    const engine = makeEngine('queries')
    await engine.initialize()
    engine.run('INSERT INTO items (id, name) VALUES (?, ?)', ['a', 'Alpha'])
    engine.run('INSERT INTO items (id, name) VALUES (?, ?)', ['b', 'Beta'])

    expect(engine.queryAll('SELECT * FROM items')).toHaveLength(2)
    expect(engine.queryOne<{ name: string }>('SELECT name FROM items WHERE id = ?', ['a'])?.name).toBe('Alpha')
    engine.closeDatabase()
  })

  it('writes are durable immediately (WAL) — a fresh reader sees them', async () => {
    const path = tempDbPath('durable')
    paths.push(path)
    const engine = new DatabaseEngine(makeEngineConfig({ path }))
    await engine.initialize()
    for (let i = 0; i < 20; i++) {
      engine.run('INSERT INTO items (id, name) VALUES (?, ?)', [`k${i}`, `v${i}`])
    }
    // Reopen from disk (a second engine) — every row is present without any
    // explicit flush/export step.
    const reopened = new DatabaseEngine(makeEngineConfig({ path }))
    await reopened.initialize()
    expect(reopened.queryAll('SELECT * FROM items')).toHaveLength(20)
    reopened.closeDatabase()
    engine.closeDatabase()
  })

  it('sql.js facade: prepare/bind/step/getAsObject/get/getColumnNames/free', async () => {
    const engine = makeEngine('facade')
    await engine.initialize()
    engine.run('INSERT INTO items (id, name) VALUES (?, ?)', ['a', 'Alpha'])
    engine.run('INSERT INTO items (id, name) VALUES (?, ?)', ['b', 'Beta'])

    const db = engine.getDatabase()
    const stmt = db.prepare('SELECT id, name FROM items ORDER BY id')
    const objects: Record<string, unknown>[] = []
    const arrays: unknown[][] = []
    while (stmt.step()) {
      objects.push(stmt.getAsObject())
      arrays.push(stmt.get())
    }
    expect(stmt.getColumnNames()).toEqual(['id', 'name'])
    stmt.free()
    expect(objects).toEqual([
      { id: 'a', name: 'Alpha' },
      { id: 'b', name: 'Beta' },
    ])
    expect(arrays).toEqual([
      ['a', 'Alpha'],
      ['b', 'Beta'],
    ])
    engine.closeDatabase()
  })

  it('sql.js facade: exec returns [{columns,values}] for rows and [] for none', async () => {
    const engine = makeEngine('facade-exec')
    await engine.initialize()
    engine.run('INSERT INTO items (id, name) VALUES (?, ?)', ['a', 'Alpha'])

    const db = engine.getDatabase()
    const withRows = db.exec('SELECT id, name FROM items')
    expect(withRows).toEqual([{ columns: ['id', 'name'], values: [['a', 'Alpha']] }])

    const noRows = db.exec("SELECT id FROM items WHERE id = 'missing'")
    expect(noRows).toEqual([])

    // exec with a write statement performs the write and returns [].
    expect(db.exec("INSERT INTO items (id, name) VALUES ('c', 'Gamma')")).toEqual([])
    expect(engine.queryAll('SELECT * FROM items')).toHaveLength(2)
    engine.closeDatabase()
  })

  it('sql.js facade: getRowsModified reflects the last write; export returns a valid db', async () => {
    const engine = makeEngine('facade-misc')
    await engine.initialize()
    const db = engine.getDatabase()
    db.run("INSERT INTO items (id, name) VALUES ('a', 'A'), ('b', 'B'), ('c', 'C')")
    expect(db.getRowsModified()).toBe(3)
    db.run("DELETE FROM items WHERE id = 'a'")
    expect(db.getRowsModified()).toBe(1)

    const bytes = db.export()
    expect(bytes).toBeInstanceOf(Uint8Array)
    // SQLite files start with the "SQLite format 3\0" magic header.
    expect(Buffer.from(bytes.slice(0, 15)).toString()).toBe('SQLite format 3')
    engine.closeDatabase()
  })

  it('runInTransaction commits and is re-entrant (nested calls do not BEGIN twice)', async () => {
    const engine = makeEngine('tx-nested')
    await engine.initialize()

    expect(() =>
      engine.runInTransaction(() => {
        engine.run('INSERT INTO items (id, name) VALUES (?, ?)', ['a', 'Alpha'])
        engine.runInTransaction(() => {
          engine.run('INSERT INTO items (id, name) VALUES (?, ?)', ['b', 'Beta'])
        })
      })
    ).not.toThrow()

    expect(engine.queryAll('SELECT * FROM items')).toHaveLength(2)
    engine.closeDatabase()
  })

  it('runInTransaction rolls back and rethrows the ORIGINAL error (not a rollback error)', async () => {
    const engine = makeEngine('tx-rollback')
    await engine.initialize()

    const boom = new Error('boom')
    expect(() =>
      engine.runInTransaction(() => {
        engine.run('INSERT INTO items (id, name) VALUES (?, ?)', ['a', 'Alpha'])
        throw boom
      })
    ).toThrow(boom)

    expect(engine.queryAll('SELECT * FROM items')).toHaveLength(0)
    engine.runInTransaction(() => {
      engine.run('INSERT INTO items (id, name) VALUES (?, ?)', ['c', 'Gamma'])
    })
    expect(engine.queryAll('SELECT * FROM items')).toHaveLength(1)
    engine.closeDatabase()
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
    engine.closeDatabase()
  })

  it('does not re-run migrations already applied on a second boot', async () => {
    const path = tempDbPath('reboot')
    paths.push(path)
    let runs = 0
    const cfg = () => ({
      betterSqlite3: Database,
      dbPathProvider: () => path,
      schemaVersion: 2,
      schema: SCHEMA,
      migrations: {
        2: () => {
          runs++
        },
      },
    })
    const e1 = new DatabaseEngine(cfg())
    await e1.initialize()
    e1.closeDatabase()
    expect(runs).toBe(1)

    const e2 = new DatabaseEngine(cfg())
    await e2.initialize()
    expect(runs).toBe(1) // already at v2 — migration not re-run
    e2.closeDatabase()
  })

  it('runs VACUUM once after a boot that applied a migration', async () => {
    const path = tempDbPath('vacuum')
    paths.push(path)
    let migrated = false
    const engine = new DatabaseEngine({
      betterSqlite3: Database,
      dbPathProvider: () => path,
      schemaVersion: 2,
      schema: SCHEMA,
      migrations: {
        2: () => {
          migrated = true
          // Create then drop rows to leave free pages for VACUUM to reclaim.
          for (let i = 0; i < 100; i++) engine.run('INSERT INTO items (id, name) VALUES (?, ?)', [`x${i}`, 'y'])
          engine.runWithMassDeleteAllowed(() => engine.run('DELETE FROM items'))
        },
      },
    })
    await engine.initialize()
    expect(migrated).toBe(true)
    // VACUUM ran without error and the db is still usable.
    engine.run('INSERT INTO items (id, name) VALUES (?, ?)', ['a', 'A'])
    expect(engine.queryAll('SELECT * FROM items')).toHaveLength(1)
    engine.closeDatabase()
  })

  it('re-initialize closes the previous handle instead of stranding it', async () => {
    const first = tempDbPath('reinit-a')
    const second = tempDbPath('reinit-b')
    paths.push(first, second)
    const created: InstanceType<typeof Database>[] = []
    class TrackingDatabase extends Database {
      constructor(...args: ConstructorParameters<typeof Database>) {
        super(...args)
        created.push(this)
      }
    }
    let currentPath = first
    const engine = new DatabaseEngine({
      ...makeEngineConfig({ path: first }),
      betterSqlite3: TrackingDatabase,
      dbPathProvider: () => currentPath,
    })

    await engine.initialize()
    expect(created).toHaveLength(1)
    expect(created[0].open).toBe(true)

    currentPath = second
    await engine.initialize()
    expect(created).toHaveLength(2)
    // The first native handle must be closed — not stranded open until process
    // exit (better-sqlite3 handles are never GC-closed).
    expect(created[0].open).toBe(false)
    // Windows refuses to delete a file somebody still holds open — the
    // stranded-handle symptom that leaked temp DBs from tests. Closed ⇒ deletable.
    expect(() => rmSync(first, { force: true })).not.toThrow()

    // The engine stays fully usable on the new connection.
    engine.run('INSERT INTO items (id, name) VALUES (?, ?)', ['a', 'Alpha'])
    expect(engine.queryAll('SELECT * FROM items')).toHaveLength(1)
    engine.closeDatabase()
    expect(created[1].open).toBe(false)
  })

  it('re-initialize resets per-boot migration state (no repeat VACUUM when nothing migrated)', async () => {
    const path = tempDbPath('reinit-vacuum')
    paths.push(path)
    const engine = new DatabaseEngine(makeEngineConfig({ path, schemaVersion: 2, migrations: { 2: () => {} } }))

    await engine.initialize() // applies v2 — this boot ends in VACUUM, not a checkpoint
    expect(engine.getPhysicalSaveCount()).toBe(0)

    await engine.initialize() // already at v2 — nothing applied THIS boot
    // A boot that applied no migration ends in a WAL checkpoint; a stale
    // appliedMigration=true carried over from the first boot would VACUUM again
    // (and skip the checkpoint) on every subsequent re-initialize.
    expect(engine.getPhysicalSaveCount()).toBe(1)
    engine.closeDatabase()
  })

  it('calls the repairPhase callback during boot', async () => {
    let repaired = false
    const engine = makeEngine('repair', {
      repairPhase: () => {
        repaired = true
      },
    })
    await engine.initialize()
    expect(repaired).toBe(true)
    engine.closeDatabase()
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
    engine.closeDatabase()
  })

  it('runMany inserts every row', async () => {
    const engine = makeEngine('runmany')
    await engine.initialize()
    engine.runMany('INSERT INTO items (id, name) VALUES (?, ?)', [
      ['a', 'A'],
      ['b', 'B'],
      ['c', 'C'],
    ])
    expect(engine.queryAll('SELECT * FROM items')).toHaveLength(3)
    engine.closeDatabase()
  })

  it('getDatabase throws before initialize', () => {
    const engine = makeEngine('uninit')
    expect(() => engine.getDatabase()).toThrow('Database not initialized')
  })

  it('saveDatabase() and flushNow() are safe checkpoints (no export model)', async () => {
    const engine = makeEngine('checkpoint')
    await engine.initialize()
    engine.run('INSERT INTO items (id, name) VALUES (?, ?)', ['a', 'A'])
    expect(() => engine.saveDatabase()).not.toThrow()
    expect(() => engine.flushNow()).not.toThrow()
    engine.closeDatabase()
  })
})
