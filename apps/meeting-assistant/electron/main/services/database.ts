import initSqlJs, { Database as SqlJsDatabase } from "sql.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { app } from "electron";
import { v4 as uuidv4 } from "uuid";
import { SCHEMA, SCHEMA_VERSION, DEFAULT_NOTE_TEMPLATES } from "./database-schema";

let db: SqlJsDatabase | null = null;
let dbPath: string = "";

function getDatabaseDir(): string {
  return join(app.getPath("userData"), "data");
}

function getDatabasePath(): string {
  return join(getDatabaseDir(), "meeting-assistant.db");
}

export function getDatabase(): SqlJsDatabase {
  if (!db) {
    throw new Error(
      "Database not initialized. Call initializeDatabase() first.",
    );
  }
  return db;
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
  dbPath = getDatabasePath();
  const dir = getDatabaseDir();

  try {
    mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.warn("[Database] Failed to create directory:", e);
  }

  try {
    const SQL = await initSqlJs();

    if (existsSync(dbPath)) {
      const fileBuffer = readFileSync(dbPath);
      db = new SQL.Database(fileBuffer);
    } else {
      db = new SQL.Database();
    }

    const database = getDatabase();
    const statements = SCHEMA.split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    console.log("[Database] Phase 1: Creating core tables...");
    for (const sql of statements) {
      if (sql.toUpperCase().startsWith("CREATE TABLE")) {
        try {
          database.run(sql);
        } catch (e) {
          console.warn(
            `[Database] Table creation warning: ${(e as Error).message}`,
          );
        }
      }
    }

    console.log("[Database] Phase 2: Checking schema version...");
    const versionResult = database.exec(
      "SELECT version FROM schema_version ORDER BY version DESC LIMIT 1",
    );
    const currentVersion =
      versionResult.length > 0 && versionResult[0].values.length > 0
        ? (versionResult[0].values[0][0] as number)
        : 0;

    if (currentVersion === 0) {
      database.run("INSERT INTO schema_version (version) VALUES (?)", [
        SCHEMA_VERSION,
      ]);
    }

    console.log("[Database] Phase 3: Running migrations...");
    if (currentVersion > 0 && currentVersion < SCHEMA_VERSION) {
      console.log(
        `[Database] Schema at v${currentVersion}, target v${SCHEMA_VERSION}`,
      );

      // Migration v2: add kb_sources table
      if (currentVersion < 2) {
        console.log("[Database] Migration v2: adding kb_sources table");
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
      }

      database.run("UPDATE schema_version SET version = ?", [SCHEMA_VERSION]);
    }

    console.log("[Database] Phase 4: Seeding default note templates...");
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

    console.log("[Database] Phase 5: Creating indexes...");
    for (const sql of statements) {
      if (sql.toUpperCase().startsWith("CREATE INDEX")) {
        try {
          database.run(sql);
        } catch (e) {
          const msg = (e as Error).message;
          if (!msg.includes("already exists")) {
            console.warn(`[Database] Index warning: ${msg}`);
          }
        }
      }
    }

    saveDatabase();
    console.log(
      `[Database] Initialization complete (schema v${SCHEMA_VERSION})`,
    );
  } catch (error) {
    console.error("[Database] FATAL initialization error:", error);
    throw error;
  }
}

export function saveDatabase(): void {
  if (db && dbPath) {
    const data = db.export();
    const buffer = Buffer.from(data);
    writeFileSync(dbPath, buffer);
  }
}

export function closeDatabase(): void {
  if (db) {
    try {
      saveDatabase();
      db.close();
    } catch (e) {
      console.warn("[Database] Error closing database:", e);
    }
    db = null;
  }
}
