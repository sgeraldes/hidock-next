import initSqlJs, { Database as SqlJsDatabase } from "sql.js";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { app } from "electron";
import { v4 as uuidv4 } from "uuid";
import {
  SCHEMA,
  SCHEMA_VERSION,
  DEFAULT_MEETING_TYPES,
} from "./database-schema";

let db: SqlJsDatabase | null = null;
let dbPath: string = "";

// FIX PLY-003: Database migrations for schema evolution
const MIGRATIONS: Record<number, () => void> = {
  2: () => {
    console.log("Running migration to schema v2: Add audio_path to sessions");
    const database = getDatabase();

    // Check if column exists before altering
    const tableInfo = database.exec("PRAGMA table_info(sessions)");
    if (tableInfo.length > 0 && tableInfo[0].values) {
      const columns = tableInfo[0].values.map((row: unknown[]) => row[1]);
      if (!columns.includes("audio_path")) {
        try {
          database.run("ALTER TABLE sessions ADD COLUMN audio_path TEXT");
        } catch (e) {
          console.warn("[Migration v2] Failed:", e);
        }
      }
    }

    console.log("Migration v2 complete");
  },
};

function getDatabaseDir(): string {
  return join(app.getPath("userData"), "data");
}

function getDatabasePath(): string {
  return join(getDatabaseDir(), "meeting-recorder.db");
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

    console.log("[Database] Phase 2.5: Structural repair...");
    // Ensure critical columns exist even if migrations were skipped (FIX: audio_path column)
    const repairColumns = [
      { table: 'sessions', column: 'audio_path', sql: 'ALTER TABLE sessions ADD COLUMN audio_path TEXT' },
    ];
    for (const repair of repairColumns) {
      const tableInfo = database.exec(`PRAGMA table_info(${repair.table})`);
      if (tableInfo.length > 0 && tableInfo[0].values) {
        const columns = tableInfo[0].values.map((row: unknown[]) => row[1]);
        if (!columns.includes(repair.column)) {
          try {
            database.run(repair.sql);
            console.log(`[Database] Repaired: ${repair.table}.${repair.column}`);
          } catch (e) {
            console.warn(`[Database] Repair warning:`, e);
          }
        }
      }
    }

    console.log("[Database] Phase 3: Running migrations...");
    // Run any pending migrations
    if (currentVersion < SCHEMA_VERSION) {
      for (let v = currentVersion + 1; v <= SCHEMA_VERSION; v++) {
        if (MIGRATIONS[v]) {
          console.log(`[Database] Applying migration ${v}...`);
          MIGRATIONS[v]();
          database.run("UPDATE schema_version SET version = ? WHERE version = ?", [v, currentVersion]);
        }
      }
    }

    console.log("[Database] Phase 4: Seeding default data...");
    const existingTypes = database.exec("SELECT COUNT(*) FROM meeting_types");
    const typeCount =
      existingTypes.length > 0 ? (existingTypes[0].values[0][0] as number) : 0;

    if (typeCount === 0) {
      for (const mt of DEFAULT_MEETING_TYPES) {
        const id = uuidv4();
        database.run(
          "INSERT INTO meeting_types (id, name, description, prompt_template, icon, is_default) VALUES (?, ?, ?, ?, ?, 1)",
          [id, mt.name, mt.description, mt.prompt, mt.icon],
        );
      }
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

    console.log("[Database] Phase 6: Crash recovery...");
    // Only run crash recovery if app didn't shut down cleanly
    const needsRecovery = checkNeedsRecovery();
    if (needsRecovery) {
      const recovered = recoverInterruptedSessions();
      console.log(`[Database] Recovered ${recovered} interrupted sessions/recordings`);
    } else {
      console.log("[Database] Clean shutdown detected, skipping crash recovery");
    }
    // Mark as unclean shutdown - will be cleared on normal exit
    markUncleanShutdown();

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
      db.close();
    } catch (e) {
      console.warn("[Database] Error closing database:", e);
    }
    db = null;
  }
}

/**
 * Check if the app needs crash recovery (unclean shutdown last time)
 */
function checkNeedsRecovery(): boolean {
  const flagPath = join(app.getPath("userData"), ".shutdown-flag");
  return existsSync(flagPath);
}

/**
 * Mark as unclean shutdown - will be cleared on normal exit
 */
function markUncleanShutdown(): void {
  const flagPath = join(app.getPath("userData"), ".shutdown-flag");
  writeFileSync(flagPath, "unclean");
}

/**
 * Mark as clean shutdown - called on normal app exit
 */
export function markCleanShutdown(): void {
  const flagPath = join(app.getPath("userData"), ".shutdown-flag");
  try {
    if (existsSync(flagPath)) {
      const fs = require("fs");
      fs.unlinkSync(flagPath);
    }
  } catch (e) {
    console.warn("[Database] Failed to mark clean shutdown:", e);
  }
}

export function recoverInterruptedSessions(): number {
  const database = getDatabase();
  let recovered = 0;

  try {
    const activeSessions = database.exec(
      "SELECT id FROM sessions WHERE status = 'active'",
    );
    if (activeSessions.length > 0 && activeSessions[0].values.length > 0) {
      for (const row of activeSessions[0].values) {
        const sessionId = row[0] as string;
        database.run(
          "UPDATE sessions SET status = 'interrupted' WHERE id = ?",
          [sessionId],
        );
        console.log(`[Database] Recovered interrupted session: ${sessionId}`);
        recovered++;
      }
    }

    const activeRecordings = database.exec(
      "SELECT id FROM recordings WHERE status = 'recording'",
    );
    if (activeRecordings.length > 0 && activeRecordings[0].values.length > 0) {
      for (const row of activeRecordings[0].values) {
        const recordingId = row[0] as string;
        database.run(
          "UPDATE recordings SET status = 'interrupted' WHERE id = ?",
          [recordingId],
        );
        console.log(
          `[Database] Recovered interrupted recording: ${recordingId}`,
        );
        recovered++;
      }
    }
  } catch (e) {
    console.warn("[Database] Crash recovery warning:", e);
  }

  return recovered;
}

export {
  createSession,
  getSession,
  updateSession,
  getAllSessions,
  deleteSession,
  deleteSessionTranscript,
  createRecording,
  getRecordingsBySession,
  updateRecording,
  insertTranscriptSegment,
  getTranscriptBySession,
  createSpeaker,
  getSpeakers,
  linkSpeakerToSession,
  getSessionSpeakers,
} from "./database-queries";

export { searchSessions, getRecentTranscriptSegments } from "./database-search";

export {
  createAttachment,
  getAttachmentsBySession,
  createActionItem,
  getActionItemsBySession,
  updateActionItem,
  createTalkingPoint,
  getTalkingPointsBySession,
  getMeetingTypes,
  createMeetingType,
  getSetting,
  setSetting,
} from "./database-extras";
