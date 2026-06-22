import initSqlJs from "sql.js";
import { mkdirSync } from "fs";
import { join } from "path";
import { app } from "electron";
import { v4 as uuidv4 } from "uuid";
import { SCHEMA, SCHEMA_VERSION, DEFAULT_NOTE_TEMPLATES } from "./database-schema";
import { DatabaseEngine, type SqlJsDatabase } from "@hidock/database";

const MIGRATIONS: Record<number, () => void> = {
  2: () => {
    // Migration v2: add kb_sources table
    console.log("[Database] Migration v2: adding kb_sources table");
    const database = getDatabase();
    try {
      database.run(`CREATE TABLE IF NOT EXISTS kb_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending',
        chunk_count INTEGER NOT NULL DEFAULT 0,
        added_at INTEGER NOT NULL,
        indexed_at INTEGER
      )`);
      console.log("[Database] Migration v2 complete");
    } catch (e) {
      console.warn("[Database] Migration v2 warning:", e);
    }
  },
  3: () => {
    // Migration v3: add 'interrupted' to sessions status CHECK constraint
    console.log("[Database] Migration v3: adding 'interrupted' to sessions status CHECK");
    const database = getDatabase();
    try {
      database.run(`CREATE TABLE IF NOT EXISTS sessions_new (
        id TEXT PRIMARY KEY,
        title TEXT,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        status TEXT NOT NULL DEFAULT 'recording' CHECK(status IN ('recording', 'processing', 'completed', 'interrupted')),
        meeting_id TEXT,
        audio_path TEXT,
        transcript_path TEXT
      )`);
      database.run(`INSERT OR IGNORE INTO sessions_new SELECT * FROM sessions`);
      database.run(`DROP TABLE IF EXISTS sessions`);
      database.run(`ALTER TABLE sessions_new RENAME TO sessions`);
      database.run(`CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)`);
      database.run(`CREATE INDEX IF NOT EXISTS idx_sessions_meeting ON sessions(meeting_id)`);
      database.run(`CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at)`);
      console.log("[Database] Migration v3 complete");
    } catch (e) {
      console.warn("[Database] Migration v3 warning:", e);
    }
  },
};

function getDatabaseDir(): string {
  return join(app.getPath("userData"), "data");
}

function getDatabasePath(): string {
  return join(getDatabaseDir(), "meeting-assistant.db");
}

/**
 * Shared SQLite engine, configured with this app's schema, version, migrations.
 * Owns the sql.js lifecycle and the 4-phase boot.
 */
const engine = new DatabaseEngine({
  initSqlJs,
  dbPathProvider: getDatabasePath,
  schemaVersion: SCHEMA_VERSION,
  schema: SCHEMA,
  migrations: MIGRATIONS,
});

export function getDatabase(): SqlJsDatabase {
  return engine.getDatabase();
}

export function mapRows<T>(
  result: ReturnType<SqlJsDatabase["exec"]>,
  columns: string[],
): T[] {
  if (result.length === 0 || result[0].values.length === 0) return [];
  return result[0].values.map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj as T;
  });
}

export async function initializeDatabase(): Promise<void> {
  const dir = getDatabaseDir();
  try {
    mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.warn("[Database] Failed to create directory:", e);
  }

  // 4-phase boot: core tables → structural repair → migrations → full schema/indexes
  await engine.initialize();

  // Post-initialize: seed default note templates (app-specific, not part of engine)
  const database = getDatabase();
  console.log("[Database] Seeding default note templates...");
  const existingTemplates = database.exec(
    "SELECT COUNT(*) FROM note_templates WHERE is_default = 1",
  );
  const templateCount =
    existingTemplates.length > 0
      ? (existingTemplates[0].values[0][0] as number)
      : 0;

  if (templateCount === 0) {
    for (const tmpl of DEFAULT_NOTE_TEMPLATES) {
      const id = uuidv4();
      database.run(
        "INSERT INTO note_templates (id, name, prompt, structure, is_default) VALUES (?, ?, ?, ?, ?)",
        [id, tmpl.name, tmpl.prompt, tmpl.structure, tmpl.is_default],
      );
    }
    console.log(
      `[Database] Seeded ${DEFAULT_NOTE_TEMPLATES.length} default note templates`,
    );
  }

  engine.saveDatabase();
  console.log(
    `[Database] Initialization complete (schema v${SCHEMA_VERSION})`,
  );
}

export function saveDatabase(): void {
  engine.saveDatabase();
}

export function closeDatabase(): void {
  engine.closeDatabase();
}
