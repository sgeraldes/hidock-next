/**
 * @hidock/database — shared SQLite (better-sqlite3 + WAL) engine for the HiDock apps.
 *
 * Each app supplies its own SCHEMA, SCHEMA_VERSION, MIGRATIONS, and repair
 * logic via DatabaseEngineConfig (plus the better-sqlite3 constructor); the
 * engine owns the generic lifecycle, migration runner, 4-phase boot, and query
 * helpers. getDatabase() returns a sql.js-API-compatible facade so existing
 * consumers keep working unchanged.
 */

export {
  DatabaseEngine,
  getTableColumns,
  stripLeadingSqlComments,
  parseDestructiveStatement,
  MassDeleteError,
} from './engine.js'
export type {
  DatabaseEngineConfig,
  AdaptiveFlushConfig,
  SqlJsDatabase,
  SqlJsCompatDatabaseApi,
  SqlJsCompatStatementApi,
  SqlJsExecResult,
  BetterSqlite3Constructor,
  BetterSqlite3Database,
  BetterSqlite3Statement,
} from './engine.js'
