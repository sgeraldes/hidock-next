/**
 * @hidock/database — reusable SQLite (sql.js) engine.
 *
 * Encapsulates the generic database machinery that was previously duplicated
 * across the HiDock Electron apps: sql.js lifecycle (load / persist / close),
 * a version-tracked idempotent migration runner, the 4-phase boot sequence, and
 * the query helpers. The per-app SCHEMA, SCHEMA_VERSION, MIGRATIONS map, and
 * structural-repair logic are supplied via configuration — the engine itself is
 * schema-agnostic.
 *
 * 4-phase boot (identical semantics to the original electron implementation):
 *   1. Core Tables       — run every `CREATE TABLE` from the schema
 *   2. Structural Repair — app callback force-adds missing columns (idempotent)
 *   3. Migrations        — version-gated transforms via the migrations map
 *   4. Full Schema       — re-run all statements to apply indexes/constraints
 */

import type { Database as SqlJsDatabase } from 'sql.js'
import { existsSync, readFileSync, writeFileSync, renameSync } from 'fs'
import { writeFile, rename, unlink } from 'fs/promises'

export type { SqlJsDatabase }

/**
 * Minimal shape of the sql.js module returned by initSqlJs().
 *
 * The Database constructor's return is intentionally `unknown` (cast to
 * SqlJsDatabase internally) so this contract is independent of the consumer's
 * exact `@types/sql.js` version — any compatible sql.js loader is accepted.
 */
export interface SqlJsStatic {
  Database: new (data?: ArrayLike<number> | Buffer | null) => unknown
}

/** The sql.js loader (its default export). Injected so the consumer owns the
 *  single sql.js instance — keeps the engine free of a bundled sql.js and lets
 *  consumers mock it in tests. */
export type InitSqlJs = () => Promise<SqlJsStatic>

export interface DatabaseEngineConfig {
  /** sql.js loader (the `initSqlJs` default export from the consuming app). */
  initSqlJs: InitSqlJs
  /** Returns the absolute path to the .sqlite file (resolved at init time). */
  dbPathProvider: () => string
  /** Target schema version the app expects. */
  schemaVersion: number
  /** Full DDL: CREATE TABLE … and CREATE INDEX … statements separated by `;`. */
  schema: string
  /** Version-keyed migration functions. Each is run once, in ascending order. */
  migrations: Record<number, () => void>
  /**
   * Phase-2 structural repair. Runs on every boot, after core tables and before
   * migrations. The app force-adds any columns the code requires (idempotent).
   */
  repairPhase?: () => void
  /**
   * Debounce window (ms) for the async persistence triggered by run()/runMany()/
   * transaction commits. Rapid writes within this window coalesce into a single
   * physical write instead of one full-DB export+write per statement. Default 1000.
   */
  saveDebounceMs?: number
  /**
   * Upper bound (ms) on how long a pending write may be deferred while writes
   * keep arriving. Guarantees a flush even under a sustained write stream (e.g. a
   * bulk download). Default 5000.
   */
  saveMaxWaitMs?: number
}

/** Column names for a table (empty if the table does not exist). */
export function getTableColumns(database: SqlJsDatabase, tableName: string): string[] {
  const tableInfo = database.exec(`PRAGMA table_info(${tableName})`)
  if (tableInfo.length === 0 || !tableInfo[0].values) {
    return []
  }
  return tableInfo[0].values.map((row) => String(row[1]))
}

/** Strip leading `--` comment lines so a statement's leading keyword can be read. */
export function stripLeadingSqlComments(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .trim()
}

export class DatabaseEngine {
  private db: SqlJsDatabase | null = null
  private dbPath = ''
  // Tracks an active runInTransaction so nested calls don't issue a second
  // BEGIN (sql.js has no nested transactions). Without this, a nested call's
  // BEGIN fails and the catch's ROLLBACK throws "cannot rollback - no
  // transaction is active", masking the real error.
  private inTransaction = false

  // --- Debounced async persistence state ---
  // Persisting a large sql.js database means export() (a full in-memory copy)
  // followed by a write of the whole file. Doing that synchronously on every
  // run() blocks the Electron main thread and, under a burst of writes (bulk
  // download + transcription), freezes the app. Instead, run() marks the DB
  // dirty and schedules a single coalesced async write.
  private readonly saveDebounceMs: number
  private readonly saveMaxWaitMs: number
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private dirty = false
  private firstDirtyAt = 0
  // In-flight async write (null when idle). A new schedule waits for it to
  // settle rather than overlapping two writes to the same file.
  private saving: Promise<void> | null = null
  // Set once closeDatabase() runs: blocks any further scheduled writes and lets
  // an in-flight async write skip its rename (the synchronous close write is
  // authoritative).
  private disposed = false
  // Instrumentation for tests: counts physical writes actually performed.
  private physicalSaveCount = 0
  // Monotonic ordering guard: each physical write is tagged with a sequence
  // number captured when its snapshot is taken. A write only commits (renames
  // into place) if its snapshot is newer than the last committed one, so a
  // slow in-flight async write can never clobber a newer synchronous flush
  // (e.g. the transcript-completion flush) that raced ahead of it.
  private saveSeq = 0
  private committedSeq = 0

  constructor(private readonly config: DatabaseEngineConfig) {
    this.saveDebounceMs = config.saveDebounceMs ?? 1000
    this.saveMaxWaitMs = config.saveMaxWaitMs ?? 5000
  }

  /**
   * Safe database initialization — the 4-phase boot sequence. Idempotent:
   * running on an already-migrated database is a no-op beyond re-applying the
   * (idempotent) schema and repair statements.
   */
  async initialize(): Promise<void> {
    this.dbPath = this.config.dbPathProvider()

    try {
      const SQL = await this.config.initSqlJs()
      // Cast the loosely-typed (version-independent) Database handle back to the
      // sql.js Database type the engine and consumers operate on.
      if (existsSync(this.dbPath)) {
        this.db = new SQL.Database(readFileSync(this.dbPath)) as SqlJsDatabase
      } else {
        this.db = new SQL.Database() as SqlJsDatabase
      }

      const database = this.getDatabase()
      const statements = this.config.schema
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)

      // --- PHASE 1: CORE TABLES ---
      console.log('[Database] Phase 1: Ensuring core tables exist...')
      for (const sql of statements) {
        if (stripLeadingSqlComments(sql).toUpperCase().startsWith('CREATE TABLE')) {
          try {
            database.run(sql)
          } catch (e) {
            console.warn(`[Database] Table creation warning: ${(e as Error).message}`)
          }
        }
      }

      // --- PHASE 2: MANDATORY STRUCTURAL REPAIR ---
      // Runs on EVERY boot to ensure parity between code and disk.
      if (this.config.repairPhase) {
        console.log('[Database] Phase 2: Aligning table structures...')
        this.config.repairPhase()
      }

      // --- PHASE 3: VERSIONED MIGRATIONS ---
      const versionResult = database.exec(
        'SELECT version FROM schema_version ORDER BY version DESC LIMIT 1'
      )
      const currentVersion =
        versionResult.length > 0 && versionResult[0].values.length > 0
          ? (versionResult[0].values[0][0] as number)
          : 0

      if (currentVersion < this.config.schemaVersion) {
        console.log(
          `[Database] Phase 3: Migrating v${currentVersion} -> v${this.config.schemaVersion}`
        )
        this.runMigrations(currentVersion)
      } else if (currentVersion === 0) {
        database.run('INSERT INTO schema_version (version) VALUES (?)', [this.config.schemaVersion])
      }

      // --- PHASE 4: FULL SCHEMA (INDEXES & CONSTRAINTS) ---
      console.log('[Database] Phase 4: Finalizing schema and indexes...')
      for (const sql of statements) {
        try {
          database.run(sql)
        } catch (e) {
          const msg = (e as Error).message
          if (!msg.includes('already exists') && !msg.includes('duplicate column name')) {
            console.warn(`[Database] Schema statement warning: ${msg}`)
          }
        }
      }

      this.saveDatabase()
      console.log(`[Database] Initialization complete (schema v${this.config.schemaVersion})`)
    } catch (error) {
      console.error('[Database] FATAL initialization error:', error)
      throw error
    }
  }

  private runMigrations(currentVersion: number): void {
    for (let v = currentVersion + 1; v <= this.config.schemaVersion; v++) {
      const migration = this.config.migrations[v]
      if (migration) {
        console.log(`Running migration to v${v}...`)
        migration()
      }
      // Record the migration
      this.getDatabase().run('INSERT OR REPLACE INTO schema_version (version) VALUES (?)', [v])
    }
  }

  /**
   * Persist the database to disk NOW, synchronously. Cancels any pending
   * debounced write and clears the dirty flag. Use at durability-critical
   * points (initialize, close, after saving an expensive artifact) — the
   * high-frequency run() path uses scheduleSave() instead.
   *
   * Writes to a temp file then renames, so a crash mid-write cannot leave a
   * torn/corrupt database file in place.
   */
  saveDatabase(): void {
    if (!this.db || !this.dbPath) return
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    this.dirty = false
    this.firstDirtyAt = 0
    const seq = ++this.saveSeq
    const data = this.db.export()
    const tmp = `${this.dbPath}.tmp`
    writeFileSync(tmp, Buffer.from(data))
    renameSync(tmp, this.dbPath)
    this.committedSeq = Math.max(this.committedSeq, seq)
    this.physicalSaveCount++
  }

  /**
   * Mark the DB dirty and schedule a coalesced async write. Multiple calls
   * within saveDebounceMs collapse into one write; a sustained stream is still
   * flushed at least every saveMaxWaitMs. Never blocks the caller.
   */
  private scheduleSave(): void {
    if (this.disposed || !this.db || !this.dbPath) return
    this.dirty = true
    const now = Date.now()
    if (this.firstDirtyAt === 0) this.firstDirtyAt = now

    // Past the max-wait budget: let the already-scheduled timer fire (don't keep
    // pushing it out). If none is scheduled, fall through and schedule now.
    if (this.saveTimer && now - this.firstDirtyAt >= this.saveMaxWaitMs) return

    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      void this.persistDirty()
    }, this.saveDebounceMs)
    // Don't let a pending save keep the process alive on its own; quit paths
    // flush synchronously via saveDatabase()/closeDatabase().
    if (typeof this.saveTimer.unref === 'function') this.saveTimer.unref()
  }

  /** Timer callback: perform the debounced async write (temp file + rename). */
  private async persistDirty(): Promise<void> {
    this.saveTimer = null
    // A write is already in flight; it will reschedule if still dirty on finish.
    if (this.saving) return
    if (this.disposed || !this.dirty || !this.db || !this.dbPath) return

    // Snapshot the current DB state synchronously, then clear dirty. Writes that
    // arrive during the async write re-set dirty and get their own flush.
    const seq = ++this.saveSeq
    const data = this.db.export()
    this.dirty = false
    this.firstDirtyAt = 0
    const dbPath = this.dbPath
    const tmp = `${dbPath}.tmp`

    this.saving = (async () => {
      try {
        await writeFile(tmp, Buffer.from(data))
        if (this.disposed || seq < this.committedSeq) {
          // A newer write (a synchronous flush/close, or a later async save)
          // already committed; drop this now-stale snapshot rather than
          // reverting the file to older state.
          await unlink(tmp).catch(() => {})
          return
        }
        await rename(tmp, dbPath)
        this.committedSeq = Math.max(this.committedSeq, seq)
        this.physicalSaveCount++
      } catch (e) {
        // Keep the DB marked dirty so the next scheduleSave() retries.
        this.dirty = true
        console.error('[Database] Async save failed:', (e as Error).message)
        await unlink(tmp).catch(() => {})
      } finally {
        this.saving = null
        if (this.dirty && !this.disposed) this.scheduleSave()
      }
    })()
    await this.saving
  }

  getDatabase(): SqlJsDatabase {
    if (!this.db) {
      throw new Error('Database not initialized')
    }
    return this.db
  }

  closeDatabase(): void {
    if (this.db) {
      // Block/neutralize any pending or in-flight async write, then flush the
      // authoritative final state synchronously before closing the handle.
      this.disposed = true
      this.saveDatabase()
      this.db.close()
      this.db = null
    }
  }

  // --- Generic query helpers ---

  queryAll<T>(sql: string, params: unknown[] = []): T[] {
    const stmt = this.getDatabase().prepare(sql)
    stmt.bind(params as never)
    const results: T[] = []
    while (stmt.step()) {
      results.push(stmt.getAsObject() as T)
    }
    stmt.free()
    return results
  }

  queryOne<T>(sql: string, params: unknown[] = []): T | undefined {
    return this.queryAll<T>(sql, params)[0]
  }

  run(sql: string, params: unknown[] = []): void {
    this.getDatabase().run(sql, params as never)
    // Persisting (db.export) mid-transaction ends the active transaction in
    // sql.js, which then breaks the enclosing COMMIT/ROLLBACK. Inside a
    // transaction, defer the save to the single COMMIT.
    if (!this.inTransaction) this.scheduleSave()
  }

  /** run() variant that does not persist — for use inside a transaction. */
  runNoSave(sql: string, params: unknown[] = []): void {
    this.getDatabase().run(sql, params as never)
  }

  /**
   * Execute fn inside BEGIN/COMMIT/ROLLBACK; persists once on success.
   */
  runInTransaction<T>(fn: () => T): T {
    const database = this.getDatabase()
    // Re-entrant: if we're already inside a transaction, just run inline so we
    // don't issue a nested BEGIN (unsupported by sql.js).
    if (this.inTransaction) {
      return fn()
    }
    this.inTransaction = true
    database.run('BEGIN TRANSACTION')
    try {
      const result = fn()
      database.run('COMMIT')
      this.scheduleSave()
      return result
    } catch (error) {
      // Defensive: never let a failed ROLLBACK mask the original error.
      try {
        database.run('ROLLBACK')
      } catch {
        /* no active transaction to roll back */
      }
      throw error
    } finally {
      this.inTransaction = false
    }
  }

  runMany(sql: string, items: unknown[][]): void {
    const stmt = this.getDatabase().prepare(sql)
    for (const item of items) {
      stmt.bind(item as never)
      stmt.step()
      stmt.reset()
    }
    stmt.free()
    if (!this.inTransaction) this.scheduleSave()
  }

  /** Test-only: number of physical writes to disk performed so far. */
  getPhysicalSaveCount(): number {
    return this.physicalSaveCount
  }
}
