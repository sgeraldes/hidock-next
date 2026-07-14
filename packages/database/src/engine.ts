/**
 * @hidock/database — reusable SQLite engine (better-sqlite3 + WAL).
 *
 * Encapsulates the generic database machinery shared across the HiDock Electron
 * apps: the SQLite connection lifecycle, a version-tracked idempotent migration
 * runner, the 4-phase boot sequence, and the query helpers. The per-app SCHEMA,
 * SCHEMA_VERSION, MIGRATIONS map, and structural-repair logic are supplied via
 * configuration — the engine itself is schema-agnostic.
 *
 * ── Storage: better-sqlite3 + WAL (journaled, incremental) ───────────────────
 * The engine previously used sql.js, which has no incremental writer: every
 * persist meant `db.export()` (a full in-memory copy of the ENTIRE database)
 * followed by writing that whole buffer to disk. For a large database (the P0
 * incident hit 2.0 GB) that model collapses — the export buffer allocation
 * fails against the wasm ~4 GB heap ceiling ("Array buffer allocation failed"),
 * multi-second synchronous exports freeze the main thread, and the deferred
 * async flush races open transactions ("cannot commit transaction - SQL
 * statements in progress", "database is locked").
 *
 * better-sqlite3 in WAL mode eliminates that entire class of failure:
 *   - Writes are incremental and journaled — no full-DB export, ever.
 *   - Transactions are synchronous — no async flush to collide with them.
 *   - The file stays a standard SQLite database (better-sqlite3 opens the old
 *     sql.js files directly — same on-disk format), so migration is a one-time
 *     `PRAGMA journal_mode=WAL` (+ optional VACUUM after a size-reducing
 *     migration). A timestamped on-boot backup is taken before the first WAL
 *     open via {@link DatabaseEngineConfig.backupOnBoot}.
 *
 * ── Source compatibility ─────────────────────────────────────────────────────
 * {@link DatabaseEngine.getDatabase} returns a sql.js-API-compatible facade over
 * the better-sqlite3 connection ({@link SqlJsCompatDatabaseApi}). Every consumer
 * that used the raw sql.js Database surface — `run`, `exec` (returning
 * `[{columns, values}]`), `prepare().bind()/step()/getAsObject()/get()/free()/
 * reset()`, `export()`, `getRowsModified()` — keeps working unchanged. The
 * engine's own helpers (queryAll/queryOne/run/runMany/runInTransaction) use
 * better-sqlite3 directly.
 *
 * 4-phase boot (identical semantics to the original implementation):
 *   1. Core Tables       — run every `CREATE TABLE` from the schema
 *   2. Structural Repair — app callback force-adds missing columns (idempotent)
 *   3. Migrations        — version-gated transforms via the migrations map
 *   4. Full Schema       — re-run all statements to apply indexes/constraints
 */

import { existsSync, copyFileSync, readdirSync, rmSync, statSync } from 'fs'
import { dirname, basename, join } from 'path'

/* -------------------------------------------------------------------------- */
/*  better-sqlite3 minimal structural types (kept independent of the exact    */
/*  @types/better-sqlite3 version the consumer resolves).                      */
/* -------------------------------------------------------------------------- */

/** A prepared statement as exposed by better-sqlite3 (subset used here). */
export interface BetterSqlite3Statement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
  raw(toggle?: boolean): BetterSqlite3Statement
  pluck(toggle?: boolean): BetterSqlite3Statement
  columns(): Array<{ name: string; column: string | null; table: string | null; type: string | null }>
  readonly reader: boolean
  readonly busy: boolean
}

/** A better-sqlite3 Database (subset used here). */
export interface BetterSqlite3Database {
  prepare(sql: string): BetterSqlite3Statement
  exec(sql: string): BetterSqlite3Database
  pragma(source: string, options?: { simple?: boolean }): unknown
  serialize(): Buffer
  close(): void
  readonly open: boolean
  readonly inTransaction: boolean
  readonly name: string
}

/** The better-sqlite3 default export (the Database constructor). */
export type BetterSqlite3Constructor = new (
  filename: string,
  options?: { readonly?: boolean; fileMustExist?: boolean; timeout?: number }
) => BetterSqlite3Database

/* -------------------------------------------------------------------------- */
/*  sql.js-compatible facade types (the public getDatabase() surface).        */
/* -------------------------------------------------------------------------- */

/** One result group in the sql.js `exec()` return shape. */
export interface SqlJsExecResult {
  columns: string[]
  values: unknown[][]
}

/** The sql.js Statement surface consumers rely on. */
export interface SqlJsCompatStatementApi {
  bind(params?: unknown): boolean
  step(): boolean
  get(params?: unknown): unknown[]
  getAsObject(params?: unknown): Record<string, unknown>
  getColumnNames(): string[]
  reset(): void
  free(): boolean
  run(params?: unknown): void
}

/** The sql.js Database surface consumers rely on (returned by getDatabase()). */
export interface SqlJsCompatDatabaseApi {
  run(sql: string, params?: unknown): void
  exec(sql: string, params?: unknown): SqlJsExecResult[]
  prepare(sql: string, params?: unknown): SqlJsCompatStatementApi
  getRowsModified(): number
  export(): Uint8Array
  close(): void
}

/**
 * Back-compat alias. Consumers import `type SqlJsDatabase` and pass it around;
 * it now denotes the sql.js-compatible facade over better-sqlite3.
 */
export type SqlJsDatabase = SqlJsCompatDatabaseApi

/* -------------------------------------------------------------------------- */
/*  Errors + destructive-statement guarding (unchanged behavior).             */
/* -------------------------------------------------------------------------- */

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

/** Parse a leading DELETE/DROP TABLE statement's target table (null otherwise). */
export function parseDestructiveStatement(sql: string): { kind: 'delete' | 'drop'; table: string } | null {
  const del = /^\s*DELETE\s+FROM\s+["'`[]?([A-Za-z_][A-Za-z0-9_]*)["'`\]]?/i.exec(sql)
  if (del) return { kind: 'delete', table: del[1] }
  const drop = /^\s*DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?["'`[]?([A-Za-z_][A-Za-z0-9_]*)["'`\]]?/i.exec(sql)
  if (drop) return { kind: 'drop', table: drop[1] }
  return null
}

/** Strip leading `--` comment lines so a statement's leading keyword can be read. */
export function stripLeadingSqlComments(sql: string): string {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .trim()
}

/* -------------------------------------------------------------------------- */
/*  Parameter normalization (sql.js accepted looser inputs than               */
/*  better-sqlite3; normalize so consumer call sites are unchanged).          */
/* -------------------------------------------------------------------------- */

/** A single bind value acceptable to better-sqlite3 after normalization. */
type BoundValue = number | string | bigint | Buffer | null

function normalizeValue(v: unknown): BoundValue {
  if (v === undefined || v === null) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'bigint') return v
  if (Buffer.isBuffer(v)) return v
  if (v instanceof Uint8Array) return Buffer.from(v.buffer, v.byteOffset, v.byteLength)
  if (v instanceof ArrayBuffer) return Buffer.from(v)
  // Fall back to JSON for accidental objects/arrays (sql.js would have thrown
  // too; keep the failure local and legible rather than passing an opaque type).
  return JSON.stringify(v)
}

/**
 * Normalize the sql.js-style params argument into the variadic form
 * better-sqlite3 expects. Accepts: undefined, a positional array, or a named
 * object. Named-parameter object keys may carry a sql.js prefix (`$`, `:`, `@`),
 * which is stripped for better-sqlite3.
 */
function normalizeParams(params: unknown): BoundValue[] {
  if (params === undefined || params === null) return []
  if (Array.isArray(params)) return params.map(normalizeValue)
  if (typeof params === 'object' && !Buffer.isBuffer(params) && !(params instanceof Uint8Array)) {
    const out: Record<string, BoundValue> = {}
    for (const [k, val] of Object.entries(params as Record<string, unknown>)) {
      out[k.replace(/^[$:@]/, '')] = normalizeValue(val)
    }
    return [out as unknown as BoundValue]
  }
  return [normalizeValue(params)]
}

/** True when a prepare() failure is because the SQL holds multiple statements. */
function isMultiStatementError(e: unknown): boolean {
  const m = (e as Error)?.message ?? ''
  return /more than one statement|multiple statements/i.test(m)
}

/* -------------------------------------------------------------------------- */
/*  Statement facade: sql.js Statement API over a better-sqlite3 Statement.    */
/* -------------------------------------------------------------------------- */

class SqlJsCompatStatement implements SqlJsCompatStatementApi {
  private boundParams: BoundValue[] = []
  private rows: unknown[][] | null = null
  private cols: string[] | null = null
  private idx = 0
  private readonly reader: boolean

  constructor(
    private readonly stmt: BetterSqlite3Statement,
    private readonly onWrite: (changes: number) => void
  ) {
    this.reader = stmt.reader
  }

  bind(params?: unknown): boolean {
    this.boundParams = normalizeParams(params)
    this.rows = null
    this.cols = null
    this.idx = 0
    return true
  }

  private ensureExecuted(): void {
    if (this.rows !== null) return
    if (this.reader) {
      this.cols = this.stmt.columns().map((c) => c.name)
      this.rows = this.stmt.raw(true).all(...this.boundParams) as unknown[][]
    } else {
      const info = this.stmt.run(...this.boundParams)
      this.onWrite(info.changes)
      this.rows = []
      this.cols = []
    }
    this.idx = 0
  }

  step(): boolean {
    this.ensureExecuted()
    if (this.idx < (this.rows as unknown[][]).length) {
      this.idx++
      return true
    }
    return false
  }

  private currentRow(): unknown[] | undefined {
    if (this.rows === null) return undefined
    if (this.idx > 0 && this.idx <= this.rows.length) return this.rows[this.idx - 1]
    if (this.idx === 0 && this.rows.length > 0) return this.rows[0]
    return undefined
  }

  get(params?: unknown): unknown[] {
    if (params !== undefined) this.bind(params)
    this.ensureExecuted()
    return (this.currentRow() as unknown[]) ?? []
  }

  getAsObject(params?: unknown): Record<string, unknown> {
    if (params !== undefined) this.bind(params)
    this.ensureExecuted()
    const row = this.currentRow()
    const cols = this.cols ?? []
    const obj: Record<string, unknown> = {}
    if (row) for (let i = 0; i < cols.length; i++) obj[cols[i]] = row[i]
    return obj
  }

  getColumnNames(): string[] {
    if (this.cols === null && this.reader) this.cols = this.stmt.columns().map((c) => c.name)
    return this.cols ?? []
  }

  reset(): void {
    this.rows = null
    this.idx = 0
  }

  free(): boolean {
    this.rows = null
    this.cols = null
    this.idx = 0
    return true
  }

  run(params?: unknown): void {
    const p = params !== undefined ? normalizeParams(params) : this.boundParams
    const info = this.stmt.run(...p)
    this.onWrite(info.changes)
  }
}

/* -------------------------------------------------------------------------- */
/*  Database facade: sql.js Database API over a better-sqlite3 Database.        */
/* -------------------------------------------------------------------------- */

class SqlJsCompatDatabase implements SqlJsCompatDatabaseApi {
  constructor(
    private readonly bdb: BetterSqlite3Database,
    private readonly onWrite: (changes: number) => void,
    private readonly rowsModified: () => number
  ) {}

  run(sql: string, params?: unknown): void {
    const norm = normalizeParams(params)
    try {
      const info = this.bdb.prepare(sql).run(...norm)
      this.onWrite(info.changes)
    } catch (e) {
      if (norm.length === 0 && isMultiStatementError(e)) {
        this.bdb.exec(sql)
        this.onWrite(0)
        return
      }
      throw e
    }
  }

  exec(sql: string, params?: unknown): SqlJsExecResult[] {
    const norm = normalizeParams(params)
    let stmt: BetterSqlite3Statement
    try {
      stmt = this.bdb.prepare(sql)
    } catch (e) {
      if (norm.length === 0 && isMultiStatementError(e)) {
        this.bdb.exec(sql)
        this.onWrite(0)
        return []
      }
      throw e
    }
    if (stmt.reader) {
      const columns = stmt.columns().map((c) => c.name)
      const values = stmt.raw(true).all(...norm) as unknown[][]
      return values.length > 0 ? [{ columns, values }] : []
    }
    const info = stmt.run(...norm)
    this.onWrite(info.changes)
    return []
  }

  prepare(sql: string, params?: unknown): SqlJsCompatStatementApi {
    const stmt = new SqlJsCompatStatement(this.bdb.prepare(sql), this.onWrite)
    if (params !== undefined) stmt.bind(params)
    return stmt
  }

  getRowsModified(): number {
    return this.rowsModified()
  }

  export(): Uint8Array {
    try {
      this.bdb.pragma('wal_checkpoint(PASSIVE)')
    } catch {
      /* best-effort checkpoint before serialize */
    }
    return new Uint8Array(this.bdb.serialize())
  }

  close(): void {
    /* Lifecycle is owned by the engine; consumers closing the facade is a no-op. */
  }
}

/** Column names for a table (empty if the table does not exist). */
export function getTableColumns(database: SqlJsCompatDatabaseApi, tableName: string): string[] {
  const tableInfo = database.exec(`PRAGMA table_info(${tableName})`)
  if (tableInfo.length === 0 || !tableInfo[0].values) return []
  return tableInfo[0].values.map((row) => String(row[1]))
}

/* -------------------------------------------------------------------------- */
/*  Engine configuration.                                                      */
/* -------------------------------------------------------------------------- */

/** @deprecated retained only so old imports keep type-checking; unused. */
export interface AdaptiveFlushConfig {
  smallMb?: number
  largeMb?: number
  mediumIntervalMs?: number
  largeIntervalMs?: number
}

export interface DatabaseEngineConfig {
  /**
   * The better-sqlite3 default export (the Database constructor). Injected so
   * the consuming app owns the single native-module instance (and so it can be
   * rebuilt for Electron independently). Consumers pass `Database` from
   * `import Database from 'better-sqlite3'`.
   */
  betterSqlite3: BetterSqlite3Constructor
  /** @deprecated ignored — retained for source-compat with the sql.js engine. */
  initSqlJs?: unknown
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
   * Tables guarded by the mass-delete tripwire. A DELETE/DROP that would remove
   * >50% of one of these tables' rows (when it holds >20 rows) is refused with a
   * {@link MassDeleteError} unless wrapped in runWithMassDeleteAllowed().
   */
  protectedTables?: string[]
  /**
   * When set, initialize() copies the on-disk database to
   * `<dbPath>.bak-<YYYY-MM-DD>` before the first WAL open / any migration runs,
   * keeping the newest `keep` daily backups. A cheap file copy — the safety net
   * for a corrupting migration. Omit to disable.
   */
  backupOnBoot?: { keep: number }
  /**
   * When true (default), the engine runs VACUUM once after any boot that applied
   * a new migration — reclaiming free pages left by a size-reducing migration
   * (e.g. the embeddings JSON→BLOB conversion). Set false to skip.
   */
  vacuumAfterMigration?: boolean
  /** @deprecated no-op — better-sqlite3 writes incrementally (WAL). */
  saveDebounceMs?: number
  /** @deprecated no-op — better-sqlite3 writes incrementally (WAL). */
  saveMaxWaitMs?: number
  /** @deprecated no-op — the sql.js adaptive-flush policy no longer exists. */
  adaptiveFlush?: AdaptiveFlushConfig
}

const BYTES_PER_MB = 1024 * 1024

/* -------------------------------------------------------------------------- */
/*  Engine.                                                                     */
/* -------------------------------------------------------------------------- */

export class DatabaseEngine {
  private bdb: BetterSqlite3Database | null = null
  private shim: SqlJsCompatDatabase | null = null
  private dbPath = ''
  private inTransaction = false
  private lastChanges = 0
  private appliedMigration = false
  private checkpointCount = 0

  private readonly protectedTables: Set<string>
  private massDeleteAllowed = false

  constructor(private readonly config: DatabaseEngineConfig) {
    this.protectedTables = new Set((config.protectedTables ?? []).map((t) => t.toLowerCase()))
  }

  /** Record the rows-changed count of the most recent write (sql.js parity). */
  private recordChanges = (changes: number): void => {
    this.lastChanges = changes
  }

  /* --- Backup + destructive guard (unchanged semantics) ------------------- */

  private backupOnBoot(): void {
    const cfg = this.config.backupOnBoot
    if (!cfg || cfg.keep <= 0) return
    try {
      if (!existsSync(this.dbPath)) return
      const dir = dirname(this.dbPath)
      const base = basename(this.dbPath)
      const prefix = `${base}.bak-`
      const day = new Date().toISOString().slice(0, 10)
      const bak = join(dir, `${prefix}${day}`)
      if (!existsSync(bak)) {
        copyFileSync(this.dbPath, bak)
        console.log(`[Database] Boot backup written: ${bak}`)
      }
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

  runWithMassDeleteAllowed<T>(fn: () => T): T {
    const prev = this.massDeleteAllowed
    this.massDeleteAllowed = true
    try {
      return fn()
    } finally {
      this.massDeleteAllowed = prev
    }
  }

  private guardDestructive(sql: string, params: unknown[]): void {
    if (this.massDeleteAllowed || this.protectedTables.size === 0) return
    const parsed = parseDestructiveStatement(sql)
    if (!parsed || !this.protectedTables.has(parsed.table.toLowerCase())) return

    const bdb = this.getBdb()
    const countRows = (countSql: string, countParams: BoundValue[] = []): number => {
      try {
        const row = bdb.prepare(countSql).get(...countParams) as { c?: number } | undefined
        return Number(row?.c ?? 0)
      } catch {
        return -1
      }
    }

    const total = countRows(`SELECT COUNT(*) AS c FROM ${parsed.table}`)
    if (total < 0) return // table unreadable/absent — let the statement surface the error
    if (total <= MASS_DELETE_MIN_ROWS) return

    let would = total
    if (parsed.kind === 'delete') {
      const countSql = sql.replace(
        /^\s*DELETE\s+FROM\s+["'`[]?[A-Za-z_][A-Za-z0-9_]*["'`\]]?/i,
        `SELECT COUNT(*) AS c FROM ${parsed.table}`
      )
      const measured = countRows(countSql, normalizeParams(params))
      would = measured < 0 ? total : measured
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

  /* --- Initialization / 4-phase boot -------------------------------------- */

  async initialize(): Promise<void> {
    this.dbPath = this.config.dbPathProvider()

    // Safety net: snapshot the existing file BEFORE the first WAL open / migration.
    this.backupOnBoot()

    const hadExistingFile = existsSync(this.dbPath)
    const sizeBefore = hadExistingFile ? this.fileSize(this.dbPath) : 0

    try {
      const Ctor = this.config.betterSqlite3
      if (typeof Ctor !== 'function') {
        throw new Error(
          'DatabaseEngineConfig.betterSqlite3 is required (pass the default export of better-sqlite3).'
        )
      }
      this.bdb = new Ctor(this.dbPath)
      // One-time conversion from a legacy sql.js (rollback-journal) file is just
      // switching the journaling mode — the on-disk format is identical.
      this.bdb.pragma('journal_mode = WAL')
      this.bdb.pragma('synchronous = NORMAL')
      this.bdb.pragma('busy_timeout = 5000')
      // Deliberately leave foreign_keys at SQLite's default (OFF) to match the
      // previous sql.js engine. Enabling enforcement would activate dormant
      // ON DELETE CASCADE clauses and reject writes the app historically allowed
      // — a behavior change out of scope for this stability fix.

      this.shim = new SqlJsCompatDatabase(this.bdb, this.recordChanges, () => this.lastChanges)

      const statements = this.config.schema
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)

      // --- PHASE 1: CORE TABLES ---
      console.log('[Database] Phase 1: Ensuring core tables exist...')
      for (const sql of statements) {
        if (stripLeadingSqlComments(sql).toUpperCase().startsWith('CREATE TABLE')) {
          try {
            this.bdb.exec(sql)
          } catch (e) {
            console.warn(`[Database] Table creation warning: ${(e as Error).message}`)
          }
        }
      }

      // --- PHASE 2: MANDATORY STRUCTURAL REPAIR ---
      if (this.config.repairPhase) {
        console.log('[Database] Phase 2: Aligning table structures...')
        this.config.repairPhase()
      }

      // --- PHASE 3: VERSIONED MIGRATIONS ---
      const currentVersion = this.readSchemaVersion()
      if (currentVersion < this.config.schemaVersion) {
        console.log(`[Database] Phase 3: Migrating v${currentVersion} -> v${this.config.schemaVersion}`)
        this.runMigrations(currentVersion)
      } else if (currentVersion === 0) {
        this.bdb.prepare('INSERT INTO schema_version (version) VALUES (?)').run(this.config.schemaVersion)
      }

      // --- PHASE 4: FULL SCHEMA (INDEXES & CONSTRAINTS) ---
      console.log('[Database] Phase 4: Finalizing schema and indexes...')
      for (const sql of statements) {
        try {
          this.bdb.exec(sql)
        } catch (e) {
          const msg = (e as Error).message
          if (!msg.includes('already exists') && !msg.includes('duplicate column name')) {
            console.warn(`[Database] Schema statement warning: ${msg}`)
          }
        }
      }

      // One-time space reclamation after a size-reducing migration (VACUUM must
      // run outside any transaction). Reports before/after size.
      if (this.appliedMigration && this.config.vacuumAfterMigration !== false) {
        this.vacuum(sizeBefore)
      } else {
        this.checkpoint()
      }

      console.log(`[Database] Initialization complete (schema v${this.config.schemaVersion})`)
    } catch (error) {
      console.error('[Database] FATAL initialization error:', error)
      throw error
    }
  }

  private fileSize(p: string): number {
    try {
      return existsSync(p) ? statSync(p).size : 0
    } catch {
      return 0
    }
  }

  private readSchemaVersion(): number {
    try {
      const row = this.getBdb()
        .prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1')
        .get() as { version?: number } | undefined
      return row?.version ?? 0
    } catch {
      return 0
    }
  }

  private runMigrations(currentVersion: number): void {
    const bdb = this.getBdb()
    for (let v = currentVersion + 1; v <= this.config.schemaVersion; v++) {
      const migration = this.config.migrations[v]
      if (migration) {
        console.log(`Running migration to v${v}...`)
        migration()
        this.appliedMigration = true
      }
      bdb.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)').run(v)
    }
  }

  /** Run VACUUM to reclaim free pages; logs before/after on-disk size. */
  vacuum(sizeBefore = this.fileSize(this.dbPath)): void {
    const bdb = this.getBdb()
    const t0 = Date.now()
    try {
      bdb.pragma('wal_checkpoint(TRUNCATE)')
      bdb.exec('VACUUM')
      bdb.pragma('wal_checkpoint(TRUNCATE)')
      const after = this.fileSize(this.dbPath)
      const fmt = (n: number) => `${(n / BYTES_PER_MB).toFixed(1)}MB`
      console.log(
        `[Database] VACUUM complete in ${((Date.now() - t0) / 1000).toFixed(1)}s: ` +
          `${fmt(sizeBefore)} -> ${fmt(after)}`
      )
    } catch (e) {
      console.warn('[Database] VACUUM failed (non-fatal):', (e as Error).message)
    }
  }

  /* --- Persistence (WAL — no export/flush model) -------------------------- */

  /** Checkpoint the WAL into the main database file (best-effort). */
  private checkpoint(): void {
    try {
      this.getBdb().pragma('wal_checkpoint(PASSIVE)')
      this.checkpointCount++
    } catch {
      /* best-effort */
    }
  }

  /**
   * Durability is automatic under WAL (every write is journaled synchronously).
   * saveDatabase()/flushNow() remain for API compatibility and simply checkpoint
   * the WAL — there is no full-DB export to perform.
   */
  saveDatabase(): void {
    this.checkpoint()
  }

  flushNow(): void {
    this.checkpoint()
  }

  getDatabase(): SqlJsCompatDatabaseApi {
    if (!this.shim) throw new Error('Database not initialized')
    return this.shim
  }

  private getBdb(): BetterSqlite3Database {
    if (!this.bdb) throw new Error('Database not initialized')
    return this.bdb
  }

  closeDatabase(): void {
    if (this.bdb) {
      try {
        this.bdb.pragma('wal_checkpoint(TRUNCATE)')
      } catch {
        /* best-effort */
      }
      this.bdb.close()
      this.bdb = null
      this.shim = null
    }
  }

  /* --- Generic query helpers (better-sqlite3 directly) -------------------- */

  queryAll<T>(sql: string, params: unknown[] = []): T[] {
    return this.getBdb().prepare(sql).all(...normalizeParams(params)) as T[]
  }

  queryOne<T>(sql: string, params: unknown[] = []): T | undefined {
    return this.getBdb().prepare(sql).get(...normalizeParams(params)) as T | undefined
  }

  private execWrite(sql: string, params: unknown[]): void {
    const norm = normalizeParams(params)
    try {
      const info = this.getBdb().prepare(sql).run(...norm)
      this.lastChanges = info.changes
    } catch (e) {
      if (norm.length === 0 && isMultiStatementError(e)) {
        this.getBdb().exec(sql)
        this.lastChanges = 0
        return
      }
      throw e
    }
  }

  run(sql: string, params: unknown[] = []): void {
    this.guardDestructive(sql, params)
    this.execWrite(sql, params)
  }

  /** run() variant kept for API parity; identical under WAL (no deferred save). */
  runNoSave(sql: string, params: unknown[] = []): void {
    this.guardDestructive(sql, params)
    this.execWrite(sql, params)
  }

  runInTransaction<T>(fn: () => T): T {
    const bdb = this.getBdb()
    if (this.inTransaction) {
      return fn()
    }
    this.inTransaction = true
    bdb.exec('BEGIN')
    try {
      const result = fn()
      bdb.exec('COMMIT')
      return result
    } catch (error) {
      try {
        bdb.exec('ROLLBACK')
      } catch {
        /* no active transaction to roll back */
      }
      throw error
    } finally {
      this.inTransaction = false
    }
  }

  runMany(sql: string, items: unknown[][]): void {
    const stmt = this.getBdb().prepare(sql)
    for (const item of items) {
      const info = stmt.run(...normalizeParams(item))
      this.lastChanges = info.changes
    }
  }

  /** Rows modified by the most recent write (sql.js `getRowsModified` parity). */
  getRowsModified(): number {
    return this.lastChanges
  }

  /** Test/diagnostic: number of WAL checkpoints performed so far. */
  getPhysicalSaveCount(): number {
    return this.checkpointCount
  }
}
