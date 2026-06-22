import initSqlJs from "sql.js";
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { app } from "electron";
import { v4 as uuidv4 } from "uuid";
import {
  SCHEMA,
  SCHEMA_VERSION,
  DEFAULT_MEETING_TYPES,
} from "./database-schema";
import { DatabaseEngine, type SqlJsDatabase } from "@hidock/database";

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

/**
 * Phase-2 structural repair. Invoked by the engine on every boot,
 * after core tables and before migrations: force-adds any columns the current
 * code requires but an older on-disk schema may lack. Idempotent.
 */
function repairPhase(): void {
  const database = getDatabase();
  // Ensure critical columns exist even if migrations were skipped (FIX: audio_path column)
  const repairColumns = [
    { table: "sessions", column: "audio_path", sql: "ALTER TABLE sessions ADD COLUMN audio_path TEXT" },
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
}

/**
 * Shared SQLite engine, configured with this app's schema, version, migrations,
 * and structural-repair callback. Owns the sql.js lifecycle and the 4-phase boot.
 */
const engine = new DatabaseEngine({
  initSqlJs,
  dbPathProvider: getDatabasePath,
  schemaVersion: SCHEMA_VERSION,
  schema: SCHEMA,
  migrations: MIGRATIONS,
  repairPhase,
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
  const { mkdirSync } = await import("fs");
  const dir = getDatabaseDir();
  try {
    mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.warn("[Database] Failed to create directory:", e);
  }

  // 4-phase boot: core tables → structural repair → migrations → full schema/indexes
  await engine.initialize();

  // Post-initialize: seed default meeting types (app-specific, not part of engine)
  const database = getDatabase();
  console.log("[Database] Seeding default data...");
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

  // Post-initialize: crash recovery (app-specific, not part of engine)
  console.log("[Database] Crash recovery check...");
  const needsRecovery = checkNeedsRecovery();
  if (needsRecovery) {
    const recovered = recoverInterruptedSessions();
    console.log(`[Database] Recovered ${recovered} interrupted sessions/recordings`);
  } else {
    console.log("[Database] Clean shutdown detected, skipping crash recovery");
  }
  // Mark as unclean shutdown - will be cleared on normal exit
  markUncleanShutdown();

  engine.saveDatabase();
  console.log(`[Database] Initialization complete (schema v${SCHEMA_VERSION})`);
}

export function saveDatabase(): void {
  engine.saveDatabase();
}

export function closeDatabase(): void {
  engine.closeDatabase();
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
  renameSpeakerInSession,
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
