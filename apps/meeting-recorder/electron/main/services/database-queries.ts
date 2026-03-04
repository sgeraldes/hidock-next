import { v4 as uuidv4 } from "uuid";
import { getDatabase, mapRows } from "./database";
import type {
  Session,
  Recording,
  TranscriptSegment,
  Speaker,
} from "./database.types";

const SESSION_COLS = [
  "id",
  "status",
  "started_at",
  "ended_at",
  "meeting_type_id",
  "title",
  "summary",
  "audio_path",
  "created_at",
];

export function createSession(meetingTypeId?: string): Session {
  const database = getDatabase();
  const id = uuidv4();
  const now = new Date().toISOString();

  // Generate default title with timestamp (TTL-001)
  const defaultTitle = `Session ${new Date().toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })}`;

  database.run(
    "INSERT INTO sessions (id, status, started_at, meeting_type_id, created_at, title) VALUES (?, ?, ?, ?, ?, ?)",
    [id, "active", now, meetingTypeId ?? null, now, defaultTitle],
  );
  return {
    id,
    status: "active",
    started_at: now,
    ended_at: null,
    meeting_type_id: meetingTypeId ?? null,
    title: defaultTitle,
    summary: null,
    audio_path: null,
    created_at: now,
  };
}

export function getSession(id: string): Session | null {
  const database = getDatabase();
  const result = database.exec(
    `SELECT ${SESSION_COLS.join(", ")} FROM sessions WHERE id = ?`,
    [id],
  );
  const rows = mapRows<Session>(result, SESSION_COLS);
  return rows[0] ?? null;
}

const ALLOWED_SESSION_UPDATE_COLS = new Set([
  "status",
  "ended_at",
  "meeting_type_id",
  "title",
  "summary",
  "audio_path",
]);

export function updateSession(
  id: string,
  updates: Partial<
    Pick<
      Session,
      "status" | "ended_at" | "meeting_type_id" | "title" | "summary" | "audio_path"
    >
  >,
): void {
  const database = getDatabase();
  const setClauses: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (!ALLOWED_SESSION_UPDATE_COLS.has(key)) {
      throw new Error(`Invalid column for session update: ${key}`);
    }
    setClauses.push(`${key} = ?`);
    values.push(value);
  }
  if (setClauses.length === 0) return;
  values.push(id);
  database.run(
    `UPDATE sessions SET ${setClauses.join(", ")} WHERE id = ?`,
    values,
  );
}

export function getAllSessions(): Session[] {
  const database = getDatabase();
  const result = database.exec(
    `SELECT ${SESSION_COLS.join(", ")} FROM sessions ORDER BY started_at DESC`,
  );
  return mapRows<Session>(result, SESSION_COLS);
}

const RECORDING_COLS = [
  "id",
  "session_id",
  "filename",
  "file_path",
  "duration_ms",
  "sample_rate",
  "created_at",
  "status",
  "last_chunk_index",
];

export function createRecording(params: {
  session_id: string;
  filename: string;
  file_path: string;
  sample_rate?: number;
}): Recording {
  const database = getDatabase();
  const id = uuidv4();
  const now = new Date().toISOString();
  const sampleRate = params.sample_rate ?? 16000;
  database.run(
    "INSERT INTO recordings (id, session_id, filename, file_path, sample_rate, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      params.session_id,
      params.filename,
      params.file_path,
      sampleRate,
      now,
      "recording",
    ],
  );
  return {
    id,
    session_id: params.session_id,
    filename: params.filename,
    file_path: params.file_path,
    duration_ms: 0,
    sample_rate: sampleRate,
    created_at: now,
    status: "recording",
    last_chunk_index: 0,
  };
}

export function getRecordingsBySession(sessionId: string): Recording[] {
  const database = getDatabase();
  const result = database.exec(
    `SELECT ${RECORDING_COLS.join(", ")} FROM recordings WHERE session_id = ? ORDER BY created_at`,
    [sessionId],
  );
  return mapRows<Recording>(result, RECORDING_COLS);
}

const ALLOWED_RECORDING_UPDATE_COLS = new Set([
  "status",
  "duration_ms",
  "last_chunk_index",
]);

export function updateRecording(
  id: string,
  updates: Partial<
    Pick<Recording, "status" | "duration_ms" | "last_chunk_index">
  >,
): void {
  const database = getDatabase();
  const setClauses: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (!ALLOWED_RECORDING_UPDATE_COLS.has(key)) {
      throw new Error(`Invalid column for recording update: ${key}`);
    }
    setClauses.push(`${key} = ?`);
    values.push(value);
  }
  if (setClauses.length === 0) return;
  values.push(id);
  database.run(
    `UPDATE recordings SET ${setClauses.join(", ")} WHERE id = ?`,
    values,
  );
}

const SEGMENT_COLS = [
  "id",
  "session_id",
  "speaker_name",
  "text",
  "start_ms",
  "end_ms",
  "sentiment",
  "confidence",
  "language",
  "chunk_index",
  "created_at",
];

export function insertTranscriptSegment(params: {
  session_id: string;
  speaker_name?: string;
  text: string;
  start_ms: number;
  end_ms: number;
  sentiment?: string;
  confidence?: number;
  language?: string;
  chunk_index: number;
}): TranscriptSegment {
  const database = getDatabase();
  const id = uuidv4();
  const now = new Date().toISOString();
  database.run(
    "INSERT INTO transcript_segments (id, session_id, speaker_name, text, start_ms, end_ms, sentiment, confidence, language, chunk_index, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      params.session_id,
      params.speaker_name ?? null,
      params.text,
      params.start_ms,
      params.end_ms,
      params.sentiment ?? null,
      params.confidence ?? null,
      params.language ?? null,
      params.chunk_index,
      now,
    ],
  );
  return {
    id,
    session_id: params.session_id,
    speaker_name: params.speaker_name ?? null,
    text: params.text,
    start_ms: params.start_ms,
    end_ms: params.end_ms,
    sentiment: params.sentiment ?? null,
    confidence: params.confidence ?? null,
    language: params.language ?? null,
    chunk_index: params.chunk_index,
    created_at: now,
  };
}

export function getTranscriptBySession(sessionId: string): TranscriptSegment[] {
  const database = getDatabase();
  const result = database.exec(
    `SELECT ${SEGMENT_COLS.join(", ")} FROM transcript_segments WHERE session_id = ? ORDER BY start_ms`,
    [sessionId],
  );
  return mapRows<TranscriptSegment>(result, SEGMENT_COLS);
}

const SPEAKER_COLS = ["id", "name", "display_name", "created_at"];

export function createSpeaker(name: string, displayName?: string): Speaker {
  const database = getDatabase();
  const id = uuidv4();
  const now = new Date().toISOString();
  database.run(
    "INSERT INTO speakers (id, name, display_name, created_at) VALUES (?, ?, ?, ?)",
    [id, name, displayName ?? null, now],
  );
  return { id, name, display_name: displayName ?? null, created_at: now };
}

export function getSpeakers(): Speaker[] {
  const database = getDatabase();
  const result = database.exec(
    `SELECT ${SPEAKER_COLS.join(", ")} FROM speakers ORDER BY name`,
  );
  return mapRows<Speaker>(result, SPEAKER_COLS);
}

export function linkSpeakerToSession(
  sessionId: string,
  speakerId: string,
): void {
  const database = getDatabase();
  database.run(
    "INSERT OR IGNORE INTO session_speakers (session_id, speaker_id) VALUES (?, ?)",
    [sessionId, speakerId],
  );
}

export function deleteSession(sessionId: string): void {
  const database = getDatabase();
  database.run("DELETE FROM transcript_segments WHERE session_id = ?", [
    sessionId,
  ]);
  database.run("DELETE FROM recordings WHERE session_id = ?", [sessionId]);
  database.run("DELETE FROM session_speakers WHERE session_id = ?", [
    sessionId,
  ]);
  database.run("DELETE FROM attachments WHERE session_id = ?", [sessionId]);
  database.run("DELETE FROM action_items WHERE session_id = ?", [sessionId]);
  database.run("DELETE FROM talking_points WHERE session_id = ?", [sessionId]);
  database.run("DELETE FROM meetings WHERE session_id = ?", [sessionId]);
  database.run("DELETE FROM sessions WHERE id = ?", [sessionId]);
}

export function deleteSessionTranscript(sessionId: string): void {
  const database = getDatabase();
  database.run("DELETE FROM transcript_segments WHERE session_id = ?", [sessionId]);
  database.run("DELETE FROM action_items WHERE session_id = ?", [sessionId]);
  database.run("DELETE FROM talking_points WHERE session_id = ?", [sessionId]);
}

export function getSessionSpeakers(sessionId: string): Speaker[] {
  const database = getDatabase();
  const result = database.exec(
    `SELECT s.${SPEAKER_COLS.join(", s.")} FROM speakers s JOIN session_speakers ss ON s.id = ss.speaker_id WHERE ss.session_id = ?`,
    [sessionId],
  );
  return mapRows<Speaker>(result, SPEAKER_COLS);
}

/**
 * SPEC-003 REQ-4: Rename a speaker in all transcript segments for a session.
 * Updates the inline speaker_name column in transcript_segments.
 * Returns the number of segments updated.
 */
export function renameSpeakerInSession(
  sessionId: string,
  oldName: string,
  newName: string,
): number {
  const database = getDatabase();
  database.run(
    "UPDATE transcript_segments SET speaker_name = ? WHERE session_id = ? AND speaker_name = ?",
    [newName, sessionId, oldName],
  );
  // sql.js doesn't return affected rows directly, count manually
  const result = database.exec(
    "SELECT COUNT(*) as cnt FROM transcript_segments WHERE session_id = ? AND speaker_name = ?",
    [sessionId, newName],
  );
  return result.length > 0 && result[0].values.length > 0
    ? (result[0].values[0][0] as number)
    : 0;
}
