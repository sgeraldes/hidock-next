import { v4 as uuidv4 } from "uuid";
import type { SqlValue } from "sql.js";
import { getDatabase, mapRows } from "./database";
import type {
  Session,
  Meeting,
  TranscriptSegment,
  KnowledgeChunk,
  Screenshot,
  Note,
  NoteTemplate,
} from "./database-types";

const SESSION_COLS = [
  "id",
  "title",
  "started_at",
  "ended_at",
  "status",
  "meeting_id",
  "audio_path",
  "transcript_path",
];

export function createSession(params: {
  title?: string;
  meeting_id?: string;
  audio_path?: string;
}): Session {
  const database = getDatabase();
  const id = uuidv4();
  const now = Date.now();
  const title = params.title ?? null;
  database.run(
    "INSERT INTO sessions (id, title, started_at, status, meeting_id, audio_path) VALUES (?, ?, ?, ?, ?, ?)",
    [id, title, now, "recording", params.meeting_id ?? null, params.audio_path ?? null],
  );
  return {
    id,
    title,
    started_at: now,
    ended_at: null,
    status: "recording",
    meeting_id: params.meeting_id ?? null,
    audio_path: params.audio_path ?? null,
    transcript_path: null,
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
  "title",
  "ended_at",
  "status",
  "meeting_id",
  "audio_path",
  "transcript_path",
]);

export function updateSession(
  id: string,
  updates: Partial<
    Pick<Session, "title" | "ended_at" | "status" | "meeting_id" | "audio_path" | "transcript_path">
  >,
): void {
  const database = getDatabase();
  const setClauses: string[] = [];
  const values: SqlValue[] = [];
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

export function deleteSession(sessionId: string): void {
  const database = getDatabase();
  database.run("DELETE FROM transcript_segments WHERE session_id = ?", [sessionId]);
  database.run("DELETE FROM screenshots WHERE session_id = ?", [sessionId]);
  database.run("DELETE FROM notes WHERE session_id = ?", [sessionId]);
  database.run("DELETE FROM sessions WHERE id = ?", [sessionId]);
}

const MEETING_COLS = [
  "id",
  "title",
  "start_time",
  "end_time",
  "attendees",
  "location",
  "agenda",
  "calendar_source",
];

export function createMeeting(params: {
  title?: string;
  start_time: number;
  end_time?: number;
  attendees?: string;
  location?: string;
  agenda?: string;
  calendar_source?: string;
}): Meeting {
  const database = getDatabase();
  const id = uuidv4();
  database.run(
    "INSERT INTO meetings (id, title, start_time, end_time, attendees, location, agenda, calendar_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      params.title ?? null,
      params.start_time,
      params.end_time ?? null,
      params.attendees ?? null,
      params.location ?? null,
      params.agenda ?? null,
      params.calendar_source ?? null,
    ],
  );
  return {
    id,
    title: params.title ?? null,
    start_time: params.start_time,
    end_time: params.end_time ?? null,
    attendees: params.attendees ?? null,
    location: params.location ?? null,
    agenda: params.agenda ?? null,
    calendar_source: params.calendar_source ?? null,
  };
}

export function getMeeting(id: string): Meeting | null {
  const database = getDatabase();
  const result = database.exec(
    `SELECT ${MEETING_COLS.join(", ")} FROM meetings WHERE id = ?`,
    [id],
  );
  const rows = mapRows<Meeting>(result, MEETING_COLS);
  return rows[0] ?? null;
}

export function getMeetingsInRange(startMs: number, endMs: number): Meeting[] {
  const database = getDatabase();
  const result = database.exec(
    `SELECT ${MEETING_COLS.join(", ")} FROM meetings WHERE start_time >= ? AND start_time <= ? ORDER BY start_time`,
    [startMs, endMs],
  );
  return mapRows<Meeting>(result, MEETING_COLS);
}

const ALLOWED_MEETING_UPDATE_COLS = new Set([
  "title",
  "end_time",
  "attendees",
  "location",
  "agenda",
  "calendar_source",
]);

export function updateMeeting(
  id: string,
  updates: Partial<Pick<Meeting, "title" | "end_time" | "attendees" | "location" | "agenda" | "calendar_source">>,
): void {
  const database = getDatabase();
  const setClauses: string[] = [];
  const values: SqlValue[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (!ALLOWED_MEETING_UPDATE_COLS.has(key)) {
      throw new Error(`Invalid column for meeting update: ${key}`);
    }
    setClauses.push(`${key} = ?`);
    values.push(value);
  }
  if (setClauses.length === 0) return;
  values.push(id);
  database.run(
    `UPDATE meetings SET ${setClauses.join(", ")} WHERE id = ?`,
    values,
  );
}

const SEGMENT_COLS = [
  "id",
  "session_id",
  "speaker",
  "text",
  "start_time",
  "end_time",
  "confidence",
  "source",
];

export function insertTranscriptSegment(params: {
  session_id: string;
  speaker?: string;
  text: string;
  start_time: number;
  end_time: number;
  confidence?: number;
  source?: "mic" | "system";
}): TranscriptSegment {
  const database = getDatabase();
  database.run(
    "INSERT INTO transcript_segments (session_id, speaker, text, start_time, end_time, confidence, source) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      params.session_id,
      params.speaker ?? null,
      params.text,
      params.start_time,
      params.end_time,
      params.confidence ?? null,
      params.source ?? "mic",
    ],
  );
  const idResult = database.exec("SELECT last_insert_rowid()");
  const id = idResult[0].values[0][0] as number;
  return {
    id,
    session_id: params.session_id,
    speaker: params.speaker ?? null,
    text: params.text,
    start_time: params.start_time,
    end_time: params.end_time,
    confidence: params.confidence ?? null,
    source: params.source ?? "mic",
  };
}

export function getTranscriptBySession(sessionId: string): TranscriptSegment[] {
  const database = getDatabase();
  const result = database.exec(
    `SELECT ${SEGMENT_COLS.join(", ")} FROM transcript_segments WHERE session_id = ? ORDER BY start_time`,
    [sessionId],
  );
  return mapRows<TranscriptSegment>(result, SEGMENT_COLS);
}

export function getRecentTranscriptSegments(
  sessionId: string,
  limit: number,
): TranscriptSegment[] {
  const database = getDatabase();
  const result = database.exec(
    `SELECT ${SEGMENT_COLS.join(", ")} FROM transcript_segments WHERE session_id = ? ORDER BY start_time DESC LIMIT ?`,
    [sessionId, limit],
  );
  return mapRows<TranscriptSegment>(result, SEGMENT_COLS).reverse();
}

const KNOWLEDGE_COLS = [
  "id",
  "source_path",
  "chunk_index",
  "text",
  "embedding",
  "updated_at",
];

export function insertKnowledgeChunk(params: {
  source_path: string;
  chunk_index: number;
  text: string;
  embedding?: Uint8Array;
}): KnowledgeChunk {
  const database = getDatabase();
  const now = Date.now();
  database.run(
    "INSERT INTO knowledge_chunks (source_path, chunk_index, text, embedding, updated_at) VALUES (?, ?, ?, ?, ?)",
    [
      params.source_path,
      params.chunk_index,
      params.text,
      params.embedding ?? null,
      now,
    ],
  );
  const idResult = database.exec("SELECT last_insert_rowid()");
  const id = idResult[0].values[0][0] as number;
  return {
    id,
    source_path: params.source_path,
    chunk_index: params.chunk_index,
    text: params.text,
    embedding: params.embedding ?? null,
    updated_at: now,
  };
}

export function getAllKnowledgeChunks(): KnowledgeChunk[] {
  const database = getDatabase();
  const result = database.exec(
    `SELECT ${KNOWLEDGE_COLS.join(", ")} FROM knowledge_chunks ORDER BY source_path, chunk_index`,
  );
  return mapRows<KnowledgeChunk>(result, KNOWLEDGE_COLS);
}

export function updateKnowledgeChunkEmbedding(
  id: number,
  embedding: Uint8Array,
): void {
  const database = getDatabase();
  const now = Date.now();
  database.run(
    "UPDATE knowledge_chunks SET embedding = ?, updated_at = ? WHERE id = ?",
    [embedding, now, id],
  );
}

export function deleteKnowledgeChunksBySource(sourcePath: string): void {
  const database = getDatabase();
  database.run("DELETE FROM knowledge_chunks WHERE source_path = ?", [sourcePath]);
}

const SCREENSHOT_COLS = [
  "id",
  "session_id",
  "path",
  "captured_at",
  "analysis",
  "is_manual",
];

export function createScreenshot(params: {
  session_id: string;
  path: string;
  is_manual?: boolean;
}): Screenshot {
  const database = getDatabase();
  const now = Date.now();
  const isManual = params.is_manual ? 1 : 0;
  database.run(
    "INSERT INTO screenshots (session_id, path, captured_at, is_manual) VALUES (?, ?, ?, ?)",
    [params.session_id, params.path, now, isManual],
  );
  const idResult = database.exec("SELECT last_insert_rowid()");
  const id = idResult[0].values[0][0] as number;
  return {
    id,
    session_id: params.session_id,
    path: params.path,
    captured_at: now,
    analysis: null,
    is_manual: isManual,
  };
}

export function getScreenshotsBySession(sessionId: string): Screenshot[] {
  const database = getDatabase();
  const result = database.exec(
    `SELECT ${SCREENSHOT_COLS.join(", ")} FROM screenshots WHERE session_id = ? ORDER BY captured_at`,
    [sessionId],
  );
  return mapRows<Screenshot>(result, SCREENSHOT_COLS);
}

export function updateScreenshotAnalysis(id: number, analysis: string): void {
  const database = getDatabase();
  database.run("UPDATE screenshots SET analysis = ? WHERE id = ?", [analysis, id]);
}

const NOTE_COLS = [
  "id",
  "session_id",
  "template_id",
  "content",
  "created_at",
  "updated_at",
];

export function createNote(params: {
  session_id: string;
  template_id?: string;
  content?: string;
}): Note {
  const database = getDatabase();
  const id = uuidv4();
  const now = Date.now();
  const content = params.content ?? "";
  database.run(
    "INSERT INTO notes (id, session_id, template_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    [id, params.session_id, params.template_id ?? null, content, now, now],
  );
  return {
    id,
    session_id: params.session_id,
    template_id: params.template_id ?? null,
    content,
    created_at: now,
    updated_at: now,
  };
}

export function getNote(id: string): Note | null {
  const database = getDatabase();
  const result = database.exec(
    `SELECT ${NOTE_COLS.join(", ")} FROM notes WHERE id = ?`,
    [id],
  );
  const rows = mapRows<Note>(result, NOTE_COLS);
  return rows[0] ?? null;
}

export function getNotesBySession(sessionId: string): Note[] {
  const database = getDatabase();
  const result = database.exec(
    `SELECT ${NOTE_COLS.join(", ")} FROM notes WHERE session_id = ? ORDER BY created_at`,
    [sessionId],
  );
  return mapRows<Note>(result, NOTE_COLS);
}

export function updateNote(id: string, content: string): void {
  const database = getDatabase();
  const now = Date.now();
  database.run(
    "UPDATE notes SET content = ?, updated_at = ? WHERE id = ?",
    [content, now, id],
  );
}

const TEMPLATE_COLS = ["id", "name", "prompt", "structure", "is_default"];

export function getAllNoteTemplates(): NoteTemplate[] {
  const database = getDatabase();
  const result = database.exec(
    `SELECT ${TEMPLATE_COLS.join(", ")} FROM note_templates ORDER BY name`,
  );
  return mapRows<NoteTemplate>(result, TEMPLATE_COLS);
}

export function getDefaultNoteTemplates(): NoteTemplate[] {
  const database = getDatabase();
  const result = database.exec(
    `SELECT ${TEMPLATE_COLS.join(", ")} FROM note_templates WHERE is_default = 1 ORDER BY name`,
  );
  return mapRows<NoteTemplate>(result, TEMPLATE_COLS);
}

export function createNoteTemplate(params: {
  name: string;
  prompt: string;
  structure?: string;
  is_default?: boolean;
}): NoteTemplate {
  const database = getDatabase();
  const id = uuidv4();
  const isDefault = params.is_default ? 1 : 0;
  database.run(
    "INSERT INTO note_templates (id, name, prompt, structure, is_default) VALUES (?, ?, ?, ?, ?)",
    [id, params.name, params.prompt, params.structure ?? null, isDefault],
  );
  return {
    id,
    name: params.name,
    prompt: params.prompt,
    structure: params.structure ?? null,
    is_default: isDefault,
  };
}

export function getNotesCount(): number {
  const db = getDatabase();
  const result = db.exec("SELECT COUNT(*) FROM notes");
  if (result.length > 0 && result[0].values.length > 0) {
    return result[0].values[0][0] as number;
  }
  return 0;
}

// ── Knowledge Base Sources ──────────────────────────────────────────────────

export interface KbSource {
  id: number;
  path: string;
  status: "pending" | "indexing" | "indexed" | "error";
  chunk_count: number;
  added_at: number;
  indexed_at: number | null;
}

const KB_SOURCE_COLS = ["id", "path", "status", "chunk_count", "added_at", "indexed_at"];

export function addKbSource(path: string): KbSource {
  const database = getDatabase();
  const now = Date.now();
  database.run(
    "INSERT OR IGNORE INTO kb_sources (path, status, chunk_count, added_at) VALUES (?, ?, 0, ?)",
    [path, "pending", now],
  );
  const result = database.exec(
    `SELECT ${KB_SOURCE_COLS.join(", ")} FROM kb_sources WHERE path = ?`,
    [path],
  );
  return mapRows<KbSource>(result, KB_SOURCE_COLS)[0];
}

export function getAllKbSources(): KbSource[] {
  const database = getDatabase();
  const result = database.exec(
    `SELECT ${KB_SOURCE_COLS.join(", ")} FROM kb_sources ORDER BY added_at DESC`,
  );
  return mapRows<KbSource>(result, KB_SOURCE_COLS);
}

export function updateKbSourceStatus(
  path: string,
  status: KbSource["status"],
  chunkCount: number,
): void {
  const database = getDatabase();
  const now = status === "indexed" ? Date.now() : null;
  database.run(
    "UPDATE kb_sources SET status = ?, chunk_count = ?, indexed_at = ? WHERE path = ?",
    [status, chunkCount, now, path],
  );
}

export function removeKbSource(path: string): void {
  const database = getDatabase();
  database.run("DELETE FROM kb_sources WHERE path = ?", [path]);
}
