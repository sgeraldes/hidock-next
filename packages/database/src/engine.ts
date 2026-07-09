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
 *
 * ── Persistence: adaptive flush policy (INTERIM relief) ──────────────────────
 * sql.js has no incremental writer: persisting means `db.export()` (a full
 * in-memory copy of the entire database) followed by writing that whole buffer
 * to disk. For a small database this is cheap; for a large one (hundreds of MB)
 * a single export blocks the Electron main thread for *seconds*. Under a
 * sustained write stream (e.g. continuous backlog transcription) the naive
 * debounce would fire an export every few seconds and starve the app.
 *
 * To bound that cost, the debounced async writer enforces a MINIMUM INTERVAL
 * between full exports that scales with the database size (see
 * {@link flushIntervalForBytes}):
 *   - < 50MB   → no extra throttle (the debounce/max-wait window governs)
 *   - 50–200MB → ≥ 60s   between full exports
 *   - > 200MB  → ≥ 300s  between full exports
 * A {@link flushNow} escape hatch bypasses the throttle for durability-critical
 * moments (app quit, post-migration, every Nth expensive artifact).
 *
 * ── Crash-safety trade-off ──────────────────────────────────────────────────
 * Every physical write goes to `${dbPath}.tmp` then atomically renames over the
 * real file, so a crash mid-write can never leave a torn/corrupt database. The
 * cost of the size-scaled interval is a wider crash-loss window: with a 300s
 * interval a crash can lose up to ~5 minutes of writes that only reached memory.
 * Callers with expensive/irreplaceable writes must call {@link flushNow} at
 * their own durability points (this engine does so on close and after init).
 * The rotating on-boot backup ({@link DatabaseEngineConfig.backupOnBoot}) is the
 * coarser safety net against a corrupting migration. The real fix — migrating to
 * a journaled store (better-sqlite3 + WAL) — is deliberately out of scope here;
 * the per-flush duration warning below is the signal that it is due.
 */

import type { Database as SqlJsDatabase } from 'sql.js'
import { existsSync, readFileSync, writeFileSync, renameSync, copyFileSync, readdirSync, rmSync, statSync } from 'fs'
import { writeFile, rename, unlink } from 'fs/promises'
import { dirname, basename, join } from 'path'

export type { SqlJsDatabase }

/**
 * Thrown by the mass-delete tripwire when a single DELETE/DROP would remove more
 * than {@link MASS_DELETE_FRACTION} of a protected table's rows (table must hold
 * more than {@link MASS_DELETE_MIN_ROWS}). Wrap the intentional bulk operation in
 * {@link DatabaseEngine.runWithMassDeleteAllowed} to bypass.
 */
export class MassDeleteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MassDeleteError'
  }
}

/** A protected table is only guarded once it holds more than this many rows. */
const MASS_DELETE_MIN_ROWS = 20
/** Refuse a single statement that would remove more than this fraction of rows. */
const MASS_DELETE_FRACTION = 0.5

// --- Adaptive flush policy (interval scales with DB size) ---
// Below the small threshold the ordinary debounce/max-wait governs — full
// backward-compatible behavior. Between small and large, and above large, a
// minimum gap between full exports is enforced to keep the multi-second
// export() off the hot path when the database is big. Sizes in MEBIBYTES.
const ADAPTIVE_SMALL_MB = 50 //   < 50MB   → no extra throttle
const ADAPTIVE_LARGE_MB = 200 //  ≥ 200MB  → large interval
const ADAPTIVE_MEDIUM_INTERVAL_MS = 60_000 //  50–200MB → ≥ 60s between exports
const ADAPTIVE_LARGE_INTERVAL_MS = 300_000 // > 200MB   → ≥ 300s between exports
/** A flush taking longer than this (ms) is logged as a warning — the signal
 *  that the better-sqlite3/WAL migration is overdue. */
const SLOW_FLUSH_WARN_MS = 3_000
const BYTES_PER_MB = 1024 * 1024

/** Resolved adaptive-flush thresholds (all overridable via config). */
export interface AdaptiveFlushConfig {
  /** Below this size (MiB) no extra throttle is applied. Default 50. */
  smallMb?: number
  /** At/above this size (MiB) the large interval applies. Default 200. */
  largeMb?: number
  /** Min ms between exports in the small–large band. Default 60000. */
  mediumIntervalMs?: number
  /** Min ms between exports at/above largeMb. Default 300000. */
  largeIntervalMs?: number
}

/** Parse a leading DELETE/DROP TABLE statement's target table (null otherwise). */
export function parseDestructiveStatement(sql: string): { kind: 'delete' | 'drop'; table: string } | null {
  const del = /^\s*DELETE\s+FROM\s+["'`[]?([A-Za-z_][A-Za-z0-9_]*)["'`\]]?/i.exec(sql)
  if (del) return { kind: 'delete', table: del[1] }
  const drop = /^\s*DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?["'`[]?([A-Za-z_][A-Za-z0-9_]*)["'`\]]?/i.exec(sql)
  if (drop) return { kind: 'drop', table: drop[1] }
  return null
}

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
  /**
   * Tables guarded by the mass-delete tripwire. A DELETE/DROP that would remove
   * >50% of one of these tables' rows (when it holds >20 rows) is refused with a
   * {@link MassDeleteError} unless wrapped in runWithMassDeleteAllowed(). Guards
   * against a broken join/reconciler silently wiping a whole entity table. Empty
   * (default) disables the tripwire — fully backward-compatible.
   */
  protectedTables?: string[]
  /**
   * When set, initialize() copies the on-disk database to
   * `<dbPath>.bak-<YYYY-MM-DD>` before any migration/repair runs, keeping the
   * newest `keep` daily backups. A cheap file copy (no export) — the safety net
   * for a corrupting migration. Omit to disable.
   */
  backupOnBoot?: { keep: number }
  /**
   * Overrides for the adaptive flush policy — the minimum interval between full
   * exports as a function of DB size. Omit to use the documented defaults
   * (50MB / 200MB thresholds → 60s / 300s intervals). Chiefly a test seam and
   * an escape valve for unusual deployments.
   */
  adaptiveFlush?: AdaptiveFlushConfig
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

  // --- Adaptive flush policy state ---
  // Wall-clock time of the last physical write (any path). The debounced writer
  // uses this to enforce a size-scaled minimum gap between full exports.
  private lastFlushAt = 0
  // Byte length of the most recently exported buffer — a free proxy for DB size
  // (avoids a stat() syscall on the hot path). Falls back to the on-disk size
  // before the first write.
  private lastFlushBytes = 0
  private readonly adaptiveSmallBytes: number
  private readonly adaptiveLargeBytes: number
  private readonly adaptiveMediumIntervalMs: number
  private readonly adaptiveLargeIntervalMs: number

  // --- Mass-delete tripwire state ---
  private readonly protectedTables: Set<string>
  // When true, the tripwire is bypassed (an intentional bulk operation).
  private massDeleteAllowed = false

  constructor(private readonly config: DatabaseEngineConfig) {
    this.saveDebounceMs = config.saveDebounceMs ?? 1000
    this.saveMaxWaitMs = config.saveMaxWaitMs ?? 5000
    this.protectedTables = new Set((config.protectedTables ?? []).map((t) => t.toLowerCase()))
    const af = config.adaptiveFlush ?? {}
    this.adaptiveSmallBytes = (af.smallMb ?? ADAPTIVE_SMALL_MB) * BYTES_PER_MB
    this.adaptiveLargeBytes = (af.largeMb ?? ADAPTIVE_LARGE_MB) * BYTES_PER_MB
    this.adaptiveMediumIntervalMs = af.mediumIntervalMs ?? ADAPTIVE_MEDIUM_INTERVAL_MS
    this.adaptiveLargeIntervalMs = af.largeIntervalMs ?? ADAPTIVE_LARGE_INTERVAL_MS
  }

  /**
   * The minimum interval (ms) that must elapse between full `db.export()` flushes
   * for a database of `sizeBytes`. Returns 0 below the small threshold (no extra
   * throttle). Pure function of the configured thresholds — exposed for testing
   * the policy without materializing a large database.
   */
  flushIntervalForBytes(sizeBytes: number): number {
    if (sizeBytes < this.adaptiveSmallBytes) return 0
    if (sizeBytes < this.adaptiveLargeBytes) return this.adaptiveMediumIntervalMs
    return this.adaptiveLargeIntervalMs
  }

  /** Best-effort current DB size in bytes: the last exported buffer length, or
   *  the on-disk file size before the first write (0 if neither is available). */
  private currentDbSizeBytes(): number {
    if (this.lastFlushBytes > 0) return this.lastFlushBytes
    try {
      return existsSync(this.dbPath) ? statSync(this.dbPath).size : 0
    } catch {
      return 0
    }
  }

  /** Format a byte count as a compact MB string for flush instrumentation. */
  private static formatBytes(n: number): string {
    return `${(n / BYTES_PER_MB).toFixed(1)}MB`
  }

  /** Emit the per-flush cost log; warn (with migration hint) when it is slow. */
  private logFlush(bytes: number, durationMs: number): void {
    const line = `[Database] Flushed ${DatabaseEngine.formatBytes(bytes)} in ${(durationMs / 1000).toFixed(1)}s`
    if (durationMs > SLOW_FLUSH_WARN_MS) {
      console.warn(
        `${line} — slow flush (>${(SLOW_FLUSH_WARN_MS / 1000).toFixed(0)}s); ` +
          `consider migrating to better-sqlite3 + WAL for incremental writes.`
      )
    } else {
      console.log(line)
    }
  }

  /**
   * Run `fn` with the mass-delete tripwire suspended — for legitimate bulk
   * operations (migrations, explicit purges). Re-entrant and restores the prior
   * state on exit, even if `fn` throws.
   */
  runWithMassDeleteAllowed<T>(fn: () => T): T {
    const prev = this.massDeleteAllowed
    this.massDeleteAllowed = true
    try {
      return fn()
    } finally {
      this.massDeleteAllowed = prev
    }
  }

  /**
   * Tripwire: before executing a DELETE/DROP against a protected table, measure
   * how many rows it would remove and refuse the catastrophic case. Runs on every
   * run()/runNoSave() (including inside a transaction, so the throw triggers the
   * enclosing ROLLBACK). No-op when no protected tables are configured.
   */
  private guardDestructive(sql: string, params: unknown[]): void {
    if (this.massDeleteAllowed || this.protectedTables.size === 0) return
    const parsed = parseDestructiveStatement(sql)
    if (!parsed || !this.protectedTables.has(parsed.table.toLowerCase())) return

    const database = this.getDatabase()
    const countRows = (countSql: string, countParams: unknown[] = []): number => {
      const stmt = database.prepare(countSql)
      try {
        stmt.bind(countParams as never)
        stmt.step()
        return Number((stmt.getAsObject() as { c?: number }).c ?? 0)
      } finally {
        stmt.free()
      }
    }

    let total: number
    try {
      total = countRows(`SELECT COUNT(*) AS c FROM ${parsed.table}`)
    } catch {
      return // table unreadable/absent — let the statement itself surface the error
    }
    if (total <= MASS_DELETE_MIN_ROWS) return // nothing precious to protect yet

    let would = total // DROP removes everything; DELETE measured below
    if (parsed.kind === 'delete') {
      // Swap the leading `DELETE FROM <table>` for a COUNT, preserving the WHERE
      // clause and its bound params, to learn the blast radius without executing.
      const countSql = sql.replace(
        /^\s*DELETE\s+FROM\s+["'`[]?[A-Za-z_][A-Za-z0-9_]*["'`\]]?/i,
        `SELECT COUNT(*) AS c FROM ${parsed.table}`
      )
      try {
        would = countRows(countSql, params)
      } catch {
        would = total // can't measure the predicate — treat as full-table (conservative)
      }
    }

    if (would > total * MASS_DELETE_FRACTION) {
      const pct = Math.round(MASS_DELETE_FRACTION * 100)
      const msg =
        `[Database] MASS-DELETE TRIPWIRE: refused ${parsed.kind.toUpperCase()} on protected table ` +
        `"${parsed.table}" — would remove ${would}/${total} rows (>${pct}%). ` +
        `Wrap the intended bulk operation in runWithMassDeleteAllowed() to override.`
      console.error(msg)
      console.error(new Error('mass-delete tripwire — call site').stack)
      throw new MassDeleteError(msg)
    }
  }

  /**
   * Copy the current on-disk database to a dated backup before any migration or
   * repair mutates it, retaining the newest `keep` daily backups. A plain file
   * copy (no export) — never blocks boot on failure.
   */
  private backupOnBoot(): void {
    const cfg = this.config.backupOnBoot
    if (!cfg || cfg.keep <= 0) return
    try {
      if (!existsSync(this.dbPath)) return // fresh database — nothing to back up
      const dir = dirname(this.dbPath)
      const base = basename(this.dbPath)
      const prefix = `${base}.bak-`
      const day = new Date().toISOString().slice(0, 10)
      const bak = join(dir, `${prefix}${day}`)
      if (!existsSync(bak)) {
        copyFileSync(this.dbPath, bak)
        console.log(`[Database] Boot backup written: ${bak}`)
      }
      // Retain the newest `keep`; dated suffix sorts chronologically by name.
      const existing = readdirSync(dir)
        .filter((f) => f.startsWith(prefix))
        .sort()
      for (const stale of existing.slice(0, Math.max(0, existing.length - cfg.keep))) {
        try {
          rmSync(join(dir, stale), { force: true })
        } catch {
          /* best-effort prune */
        }
      }
    } catch (e) {
      console.warn('[Database] Boot backup failed (non-fatal):', (e as Error).message)
    }
  }

  /**
   * Safe database initialization — the 4-phase boot sequence. Idempotent:
   * running on an already-migrated database is a no-op beyond re-applying the
   * (idempotent) schema and repair statements.
   */
  async initialize(): Promise<void> {
    this.dbPath = this.config.dbPathProvider()

    // Safety net: snapshot the existing file BEFORE any migration/repair touches it.
    this.backupOnBoot()

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
   * Persist the database to disk NOW, synchronously — bypassing the adaptive
   * flush throttle. Cancels any pending debounced write and clears the dirty
   * flag. Use at durability-critical points (initialize, close, after saving an
   * expensive artifact) — the high-frequency run() path uses scheduleSave().
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
    const t0 = Date.now()
    const data = this.db.export()
    const tmp = `${this.dbPath}.tmp`
    writeFileSync(tmp, Buffer.from(data))
    renameSync(tmp, this.dbPath)
    this.committedSeq = Math.max(this.committedSeq, seq)
    this.physicalSaveCount++
    this.lastFlushBytes = data.length
    this.lastFlushAt = Date.now()
    this.logFlush(data.length, this.lastFlushAt - t0)
  }

  /**
   * Durability escape hatch: force an immediate synchronous flush regardless of
   * the adaptive throttle. Alias for {@link saveDatabase} with an intent-revealing
   * name — call it at the app's own durability points (app quit, post-migration,
   * every Nth expensive artifact) where losing the write is unacceptable.
   */
  flushNow(): void {
    this.saveDatabase()
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

    // Adaptive throttle: for a large database, enforce a minimum gap between
    // full exports so the multi-second export()+write does not run every
    // debounce window. If we flushed too recently, defer this write until the
    // interval elapses (staying dirty) instead of exporting now. This overrides
    // the max-wait bound by design — the whole point is to flush LESS often as
    // the DB grows (see the crash-safety trade-off in the file header).
    const minInterval = this.flushIntervalForBytes(this.currentDbSizeBytes())
    if (minInterval > 0) {
      const sinceLast = Date.now() - this.lastFlushAt
      if (sinceLast < minInterval) {
        const wait = minInterval - sinceLast
        this.saveTimer = setTimeout(() => {
          void this.persistDirty()
        }, wait)
        if (typeof this.saveTimer.unref === 'function') this.saveTimer.unref()
        return
      }
    }

    // Snapshot the current DB state synchronously, then clear dirty. Writes that
    // arrive during the async write re-set dirty and get their own flush.
    const seq = ++this.saveSeq
    const t0 = Date.now()
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
        this.lastFlushBytes = data.length
        this.lastFlushAt = Date.now()
        this.logFlush(data.length, this.lastFlushAt - t0)
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
    this.guardDestructive(sql, params)
    this.getDatabase().run(sql, params as never)
    // Persisting (db.export) mid-transaction ends the active transaction in
    // sql.js, which then breaks the enclosing COMMIT/ROLLBACK. Inside a
    // transaction, defer the save to the single COMMIT.
    if (!this.inTransaction) this.scheduleSave()
  }

  /** run() variant that does not persist — for use inside a transaction. */
  runNoSave(sql: string, params: unknown[] = []): void {
    this.guardDestructive(sql, params)
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
