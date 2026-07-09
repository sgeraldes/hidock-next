// @vitest-environment node

/**
 * Safety nets on the shared DatabaseEngine:
 *  - the mass-delete tripwire (refuse a statement that would wipe >50% of a
 *    protected table holding >20 rows, unless explicitly overridden), and
 *  - the rotating on-boot backup (a dated file copy before migrations, keeping
 *    the newest N).
 *
 * Both run against a real sql.js database backed by a temp file.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, rmSync, readdirSync, writeFileSync } from 'fs'
import initSqlJs from 'sql.js'
import { DatabaseEngine, MassDeleteError, parseDestructiveStatement } from '../src/index.js'

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE IF NOT EXISTS scratch (id TEXT PRIMARY KEY);
`

function tempDbPath(name: string): string {
  return join(tmpdir(), `hidock-db-safety-${name}.sqlite`)
}

describe('mass-delete tripwire', () => {
  const paths: string[] = []

  afterEach(() => {
    for (const p of paths) {
      if (existsSync(p)) rmSync(p, { force: true })
      if (existsSync(`${p}.tmp`)) rmSync(`${p}.tmp`, { force: true })
    }
    paths.length = 0
  })

  async function makeEngine(name: string, protectedTables: string[] = ['items']) {
    const path = tempDbPath(name)
    paths.push(path)
    const engine = new DatabaseEngine({
      initSqlJs,
      dbPathProvider: () => path,
      schemaVersion: 1,
      schema: SCHEMA,
      migrations: {},
      protectedTables
    })
    await engine.initialize()
    return engine
  }

  function seedItems(engine: DatabaseEngine, n: number): void {
    for (let i = 0; i < n; i++) engine.run('INSERT INTO items (id, name) VALUES (?, ?)', [`i${i}`, `n${i % 3}`])
  }

  it('refuses a full-table DELETE on a protected table with >20 rows', async () => {
    const engine = await makeEngine('refuse-delete')
    seedItems(engine, 25)
    expect(() => engine.run('DELETE FROM items')).toThrow(MassDeleteError)
    expect(engine.queryAll('SELECT * FROM items')).toHaveLength(25) // nothing deleted
    engine.closeDatabase()
  })

  it('refuses a DROP TABLE on a protected table with >20 rows', async () => {
    const engine = await makeEngine('refuse-drop')
    seedItems(engine, 25)
    expect(() => engine.run('DROP TABLE items')).toThrow(MassDeleteError)
    expect(() => engine.run('DROP TABLE IF EXISTS items')).toThrow(MassDeleteError)
    expect(engine.queryAll('SELECT * FROM items')).toHaveLength(25)
    engine.closeDatabase()
  })

  it('allows a DELETE that removes ≤50% of the rows', async () => {
    const engine = await makeEngine('allow-partial')
    seedItems(engine, 30) // names cycle n0,n1,n2 → ~10 each
    expect(() => engine.run('DELETE FROM items WHERE name = ?', ['n0'])).not.toThrow()
    expect(engine.queryAll('SELECT * FROM items').length).toBeLessThan(30)
    expect(engine.queryAll('SELECT * FROM items').length).toBeGreaterThan(15)
    engine.closeDatabase()
  })

  it('allows a full DELETE when the table holds ≤20 rows (nothing precious yet)', async () => {
    const engine = await makeEngine('allow-small')
    seedItems(engine, 20)
    expect(() => engine.run('DELETE FROM items')).not.toThrow()
    expect(engine.queryAll('SELECT * FROM items')).toHaveLength(0)
    engine.closeDatabase()
  })

  it('does not guard non-protected tables', async () => {
    const engine = await makeEngine('non-protected')
    for (let i = 0; i < 25; i++) engine.run('INSERT INTO scratch (id) VALUES (?)', [`s${i}`])
    expect(() => engine.run('DELETE FROM scratch')).not.toThrow()
    expect(engine.queryAll('SELECT * FROM scratch')).toHaveLength(0)
    engine.closeDatabase()
  })

  it('bypasses the tripwire inside runWithMassDeleteAllowed()', async () => {
    const engine = await makeEngine('override')
    seedItems(engine, 25)
    engine.runWithMassDeleteAllowed(() => engine.run('DELETE FROM items'))
    expect(engine.queryAll('SELECT * FROM items')).toHaveLength(0)
    // Guard is restored afterwards.
    seedItems(engine, 25)
    expect(() => engine.run('DELETE FROM items')).toThrow(MassDeleteError)
    engine.closeDatabase()
  })

  it('rolls back a whole transaction when a mass delete is refused mid-transaction', async () => {
    const engine = await makeEngine('txn-rollback')
    seedItems(engine, 25)
    expect(() =>
      engine.runInTransaction(() => {
        engine.run('INSERT INTO items (id, name) VALUES (?, ?)', ['extra', 'x'])
        engine.run('DELETE FROM items') // tripwire throws → ROLLBACK
      })
    ).toThrow(MassDeleteError)
    // The INSERT was rolled back and the DELETE never ran.
    expect(engine.queryAll('SELECT * FROM items')).toHaveLength(25)
    engine.closeDatabase()
  })

  it('parseDestructiveStatement recognizes DELETE and DROP, ignores others', () => {
    expect(parseDestructiveStatement('DELETE FROM knowledge_captures WHERE x = 1')).toEqual({
      kind: 'delete',
      table: 'knowledge_captures'
    })
    expect(parseDestructiveStatement('  drop table if exists items')).toEqual({ kind: 'drop', table: 'items' })
    expect(parseDestructiveStatement('UPDATE items SET name = 1')).toBeNull()
    expect(parseDestructiveStatement('SELECT * FROM items')).toBeNull()
  })
})

describe('rotating on-boot backup', () => {
  const paths: string[] = []

  afterEach(() => {
    for (const p of paths) {
      for (const f of siblingFiles(p)) rmSync(f, { force: true })
    }
    paths.length = 0
  })

  function siblingFiles(dbPath: string): string[] {
    const dir = tmpdir()
    const base = dbPath.split(/[\\/]/).pop() as string
    return readdirSync(dir)
      .filter((f) => f === base || f.startsWith(`${base}.`))
      .map((f) => join(dir, f))
  }

  function makeEngine(path: string, keep: number) {
    return new DatabaseEngine({
      initSqlJs,
      dbPathProvider: () => path,
      schemaVersion: 1,
      schema: SCHEMA,
      migrations: {},
      backupOnBoot: { keep }
    })
  }

  it('does not back up a fresh database (no file yet), then backs up on the next boot', async () => {
    const path = tempDbPath('backup-fresh')
    paths.push(path)

    const e1 = makeEngine(path, 3)
    await e1.initialize() // fresh — nothing to back up
    e1.closeDatabase()
    expect(siblingFiles(path).some((f) => f.includes('.bak-'))).toBe(false)

    const e2 = makeEngine(path, 3)
    await e2.initialize() // file now exists → today's backup is written
    e2.closeDatabase()
    expect(siblingFiles(path).filter((f) => f.includes('.bak-'))).toHaveLength(1)
  })

  it('prunes to the newest `keep` dated backups', async () => {
    const path = tempDbPath('backup-prune')
    paths.push(path)

    // First boot creates the db file (no backup yet).
    const e1 = makeEngine(path, 2)
    await e1.initialize()
    e1.closeDatabase()

    // Pre-existing older daily backups (dated names sort chronologically).
    for (const day of ['2020-01-01', '2020-01-02', '2020-01-03']) {
      writeFileSync(`${path}.bak-${day}`, 'old')
    }

    // Second boot adds today's backup, then prunes to keep the newest 2.
    const e2 = makeEngine(path, 2)
    await e2.initialize()
    e2.closeDatabase()

    const baks = siblingFiles(path)
      .filter((f) => f.includes('.bak-'))
      .map((f) => f.split(/[\\/]/).pop() as string)
      .sort()
    expect(baks).toHaveLength(2)
    // The two oldest were pruned; the newest pre-existing one + today's remain.
    expect(baks.some((f) => f.endsWith('.bak-2020-01-01'))).toBe(false)
    expect(baks.some((f) => f.endsWith('.bak-2020-01-02'))).toBe(false)
    expect(baks.some((f) => f.endsWith('.bak-2020-01-03'))).toBe(true)
  })
})
