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
import initSqlJs from 'sql.js'
import { DatabaseEngine, getTableColumns, type AdaptiveFlushConfig } from '../src/index.js'

function tempDbPath(name: string): string {
  // Stable per-test path (no Date.now/Math.random — keep deterministic)
  return join(tmpdir(), `hidock-db-engine-test-${name}.sqlite`)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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
      // The atomic save writes to `${path}.tmp` then renames — clean up any that
      // a disposed-skip path may have left behind.
      if (existsSync(`${p}.tmp`)) rmSync(`${p}.tmp`, { force: true })
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
    saveDebounceMs?: number
    saveMaxWaitMs?: number
    adaptiveFlush?: AdaptiveFlushConfig
  }) {
    return {
      initSqlJs,
      dbPathProvider: () => opts.path,
      schemaVersion: opts.schemaVersion ?? 1,
      schema: SCHEMA,
      migrations: opts.migrations ?? {},
      repairPhase: opts.repairPhase,
      saveDebounceMs: opts.saveDebounceMs,
      saveMaxWaitMs: opts.saveMaxWaitMs,
      adaptiveFlush: opts.adaptiveFlush,
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

  it('runInTransaction commits and is re-entrant (nested calls do not BEGIN twice)', async () => {
    const engine = makeEngine('tx-nested')
    await engine.initialize()

    // Nested runInTransaction must not throw "cannot start a transaction within
    // a transaction" / "cannot rollback - no transaction is active".
    expect(() =>
      engine.runInTransaction(() => {
        engine.run('INSERT INTO items (id, name) VALUES (?, ?)', ['a', 'Alpha'])
        engine.runInTransaction(() => {
          engine.run('INSERT INTO items (id, name) VALUES (?, ?)', ['b', 'Beta'])
        })
      })
    ).not.toThrow()

    expect(engine.queryAll('SELECT * FROM items')).toHaveLength(2)
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

    // Insert was rolled back, and a subsequent transaction still works (state clean).
    expect(engine.queryAll('SELECT * FROM items')).toHaveLength(0)
    engine.runInTransaction(() => {
      engine.run('INSERT INTO items (id, name) VALUES (?, ?)', ['c', 'Gamma'])
    })
    expect(engine.queryAll('SELECT * FROM items')).toHaveLength(1)
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
      initSqlJs,
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

  describe('debounced persistence', () => {
    it('run() does not write synchronously; rapid writes coalesce into one async save', async () => {
      const engine = makeEngine('debounce', { saveDebounceMs: 20, saveMaxWaitMs: 500 })
      await engine.initialize() // one synchronous save at init
      const base = engine.getPhysicalSaveCount()

      for (let i = 0; i < 20; i++) {
        engine.run('INSERT INTO items (id, name) VALUES (?, ?)', [`k${i}`, `v${i}`])
      }
      // The hot path did NOT perform a physical write per statement.
      expect(engine.getPhysicalSaveCount()).toBe(base)

      await sleep(80)
      // The whole burst collapsed into exactly one physical write.
      expect(engine.getPhysicalSaveCount()).toBe(base + 1)

      // Durability: reopening from disk sees all 20 rows.
      engine.closeDatabase()
      const reopened = new DatabaseEngine(makeEngineConfig({ path: tempDbPath('debounce') }))
      await reopened.initialize()
      expect(reopened.queryAll('SELECT * FROM items')).toHaveLength(20)
      reopened.closeDatabase()
    })

    it('saveDatabase() flushes synchronously and cancels the pending debounced write', async () => {
      // Long debounce: the timer would not fire on its own during the test.
      const engine = makeEngine('flush', { saveDebounceMs: 10_000 })
      await engine.initialize()
      const base = engine.getPhysicalSaveCount()

      engine.run('INSERT INTO items (id, name) VALUES (?, ?)', ['a', 'A'])
      expect(engine.getPhysicalSaveCount()).toBe(base) // still debounced

      engine.saveDatabase()
      expect(engine.getPhysicalSaveCount()).toBe(base + 1) // synchronous flush happened

      // The pending timer was cancelled — no extra write later.
      await sleep(40)
      expect(engine.getPhysicalSaveCount()).toBe(base + 1)
      engine.closeDatabase()
    })

    it('flushes within saveMaxWaitMs under a sustained write stream (no starvation)', async () => {
      const engine = makeEngine('maxwait', { saveDebounceMs: 30, saveMaxWaitMs: 80 })
      await engine.initialize()
      const base = engine.getPhysicalSaveCount()

      // Write every ~20ms (< debounce) for longer than maxWait, so the debounce
      // timer alone would keep getting pushed out and never fire.
      const stopAt = Date.now() + 160
      let i = 0
      while (Date.now() < stopAt) {
        engine.run('INSERT INTO items (id, name) VALUES (?, ?)', [`k${i}`, `v${i++}`])
        await sleep(20)
      }
      // The max-wait bound must have forced at least one flush mid-stream.
      expect(engine.getPhysicalSaveCount()).toBeGreaterThanOrEqual(base + 1)
      engine.closeDatabase()
    })

    it('closeDatabase() persists the latest state and suppresses further scheduled writes', async () => {
      const engine = makeEngine('close', { saveDebounceMs: 50 })
      await engine.initialize()

      engine.run('INSERT INTO items (id, name) VALUES (?, ?)', ['z', 'Z'])
      engine.closeDatabase() // synchronous final flush + dispose

      const reopened = new DatabaseEngine(makeEngineConfig({ path: tempDbPath('close') }))
      await reopened.initialize()
      expect(reopened.queryOne('SELECT * FROM items WHERE id = ?', ['z'])).toBeDefined()
      reopened.closeDatabase()
    })
  })

  describe('adaptive flush policy', () => {
    it('scales the minimum flush interval with DB size (default thresholds)', async () => {
      // Pure policy — no timers, no I/O. Verifies the documented 50MB / 200MB
      // boundaries map to the 0 / 60s / 300s intervals.
      const engine = makeEngine('policy')
      const MB = 1024 * 1024
      expect(engine.flushIntervalForBytes(0)).toBe(0)
      expect(engine.flushIntervalForBytes(49 * MB)).toBe(0)
      expect(engine.flushIntervalForBytes(50 * MB)).toBe(60_000)
      expect(engine.flushIntervalForBytes(199 * MB)).toBe(60_000)
      expect(engine.flushIntervalForBytes(200 * MB)).toBe(300_000)
      expect(engine.flushIntervalForBytes(600 * MB)).toBe(300_000)
    })

    it('honours overridden adaptive thresholds', async () => {
      const engine = makeEngine('policy-override', {
        adaptiveFlush: { smallMb: 10, largeMb: 20, mediumIntervalMs: 111, largeIntervalMs: 222 },
      })
      const MB = 1024 * 1024
      expect(engine.flushIntervalForBytes(9 * MB)).toBe(0)
      expect(engine.flushIntervalForBytes(10 * MB)).toBe(111)
      expect(engine.flushIntervalForBytes(20 * MB)).toBe(222)
    })

    it('throttles debounced writes to the min interval when the DB exceeds the threshold', async () => {
      // smallMb:0 forces even the tiny test DB into the throttled band, so we can
      // exercise the real deferral path with short (real-timer) intervals — the
      // engine performs real async fs writes, which fake timers do not drive.
      const engine = makeEngine('throttle', {
        saveDebounceMs: 10,
        saveMaxWaitMs: 20,
        adaptiveFlush: { smallMb: 0, mediumIntervalMs: 300 },
      })
      await engine.initialize() // one synchronous flush; sets lastFlushAt baseline
      const base = engine.getPhysicalSaveCount()

      // A burst of writes right after init. The debounce timer fires at ~10ms but
      // the throttle defers the export because <300ms elapsed since the init flush.
      for (let i = 0; i < 10; i++) {
        engine.run('INSERT INTO items (id, name) VALUES (?, ?)', [`k${i}`, `v${i}`])
      }
      await sleep(120)
      expect(engine.getPhysicalSaveCount()).toBe(base) // still throttled — no export yet

      // Once the 300ms interval elapses, exactly one coalesced export lands.
      await sleep(260)
      expect(engine.getPhysicalSaveCount()).toBe(base + 1)

      // Durability: reopening from disk sees the whole burst.
      engine.closeDatabase()
      const reopened = new DatabaseEngine(makeEngineConfig({ path: tempDbPath('throttle') }))
      await reopened.initialize()
      expect(reopened.queryAll('SELECT * FROM items')).toHaveLength(10)
      reopened.closeDatabase()
    })

    it('flushNow() bypasses the throttle and writes immediately', async () => {
      const engine = makeEngine('flushnow', {
        saveDebounceMs: 10,
        adaptiveFlush: { smallMb: 0, mediumIntervalMs: 10_000 }, // would defer ~10s
      })
      await engine.initialize()
      const base = engine.getPhysicalSaveCount()

      engine.run('INSERT INTO items (id, name) VALUES (?, ?)', ['a', 'A'])
      // The debounced path is throttled for ~10s; without the escape hatch nothing
      // would be written yet.
      await sleep(40)
      expect(engine.getPhysicalSaveCount()).toBe(base)

      engine.flushNow() // escape hatch — forced synchronous write
      expect(engine.getPhysicalSaveCount()).toBe(base + 1)

      // The forced write is durable on disk immediately.
      const reopened = new DatabaseEngine(makeEngineConfig({ path: tempDbPath('flushnow') }))
      await reopened.initialize()
      expect(reopened.queryOne('SELECT * FROM items WHERE id = ?', ['a'])).toBeDefined()
      reopened.closeDatabase()
      engine.closeDatabase()
    })

    it('closeDatabase() flushes the latest state even while the throttle would defer', async () => {
      // Simulates app quit under a large DB: the adaptive interval would otherwise
      // hold the write back, but quit must not lose it.
      const engine = makeEngine('quit-flush', {
        saveDebounceMs: 10,
        adaptiveFlush: { smallMb: 0, mediumIntervalMs: 10_000 },
      })
      await engine.initialize()

      engine.run('INSERT INTO items (id, name) VALUES (?, ?)', ['q', 'Q'])
      await sleep(40)
      // Throttled: not yet on disk via the debounced path.
      const before = new DatabaseEngine(makeEngineConfig({ path: tempDbPath('quit-flush') }))
      await before.initialize()
      expect(before.queryOne('SELECT * FROM items WHERE id = ?', ['q'])).toBeUndefined()
      before.closeDatabase()

      engine.closeDatabase() // quit path — synchronous forced flush

      const reopened = new DatabaseEngine(makeEngineConfig({ path: tempDbPath('quit-flush') }))
      await reopened.initialize()
      expect(reopened.queryOne('SELECT * FROM items WHERE id = ?', ['q'])).toBeDefined()
      reopened.closeDatabase()
    })

    it('a synchronous flush leaves no lingering .tmp file (atomic temp+rename)', async () => {
      const path = tempDbPath('atomic')
      paths.push(path)
      const engine = new DatabaseEngine(makeEngineConfig({ path, saveDebounceMs: 10_000 }))
      await engine.initialize()

      engine.run('INSERT INTO items (id, name) VALUES (?, ?)', ['a', 'A'])
      engine.flushNow() // temp file written then renamed over the db atomically

      expect(existsSync(path)).toBe(true)
      expect(existsSync(`${path}.tmp`)).toBe(false) // rename consumed the temp file
      // And the renamed file is a valid, complete database.
      const reopened = new DatabaseEngine(makeEngineConfig({ path }))
      await reopened.initialize()
      expect(reopened.queryOne('SELECT * FROM items WHERE id = ?', ['a'])).toBeDefined()
      reopened.closeDatabase()
      engine.closeDatabase()
    })
  })
})
