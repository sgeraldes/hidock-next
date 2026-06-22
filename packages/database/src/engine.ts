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

import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js'
import { existsSync, readFileSync, writeFileSync } from 'fs'

export type { SqlJsDatabase }

export interface DatabaseEngineConfig {
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

  constructor(private readonly config: DatabaseEngineConfig) {}

  /**
   * Safe database initialization — the 4-phase boot sequence. Idempotent:
   * running on an already-migrated database is a no-op beyond re-applying the
   * (idempotent) schema and repair statements.
   */
  async initialize(): Promise<void> {
    this.dbPath = this.config.dbPathProvider()

    try {
      const SQL = await initSqlJs()
      if (existsSync(this.dbPath)) {
        this.db = new SQL.Database(readFileSync(this.dbPath))
      } else {
        this.db = new SQL.Database()
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

  saveDatabase(): void {
    if (this.db && this.dbPath) {
      const data = this.db.export()
      writeFileSync(this.dbPath, Buffer.from(data))
    }
  }

  getDatabase(): SqlJsDatabase {
    if (!this.db) {
      throw new Error('Database not initialized')
    }
    return this.db
  }

  closeDatabase(): void {
    if (this.db) {
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
    this.saveDatabase()
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
    database.run('BEGIN TRANSACTION')
    try {
      const result = fn()
      database.run('COMMIT')
      this.saveDatabase()
      return result
    } catch (error) {
      database.run('ROLLBACK')
      throw error
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
    this.saveDatabase()
  }
}
