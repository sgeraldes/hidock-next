/**
 * @hidock/database — shared SQLite (sql.js) engine for the HiDock apps.
 *
 * Each app supplies its own SCHEMA, SCHEMA_VERSION, MIGRATIONS, and repair
 * logic via DatabaseEngineConfig; the engine owns the generic lifecycle,
 * migration runner, 4-phase boot, and query helpers.
 */

export {
  DatabaseEngine,
  getTableColumns,
  stripLeadingSqlComments,
  parseDestructiveStatement,
  MassDeleteError,
} from './engine.js'
export type { DatabaseEngineConfig, AdaptiveFlushConfig, SqlJsDatabase } from './engine.js'
