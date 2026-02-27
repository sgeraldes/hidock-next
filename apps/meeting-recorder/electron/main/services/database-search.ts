import { getDatabase, mapRows } from "./database";
import type { Session, TranscriptSegment } from "./database.types";

const SEARCH_SESSION_COLS = [
  "id",
  "status",
  "started_at",
  "ended_at",
  "meeting_type_id",
  "title",
  "summary",
  "created_at",
];

export function searchSessions(query: string): Session[] {
  const database = getDatabase();
  const escaped = query.replace(/[%_\\]/g, "\\$&");
  const like = `%${escaped}%`;
  const result = database.exec(
    `SELECT DISTINCT ${SEARCH_SESSION_COLS.map((c) => `s.${c}`).join(", ")} FROM sessions s LEFT JOIN transcript_segments t ON s.id = t.session_id WHERE s.title LIKE ? ESCAPE '\\' OR s.status LIKE ? ESCAPE '\\' OR t.text LIKE ? ESCAPE '\\' ORDER BY s.started_at DESC`,
    [like, like, like],
  );
  return mapRows<Session>(result, SEARCH_SESSION_COLS);
}

const RECENT_SEGMENT_COLS = [
  "id",
  "session_id",
  "speaker_name",
  "text",
  "start_ms",
  "end_ms",
  "sentiment",
  "created_at",
];

export function getRecentTranscriptSegments(
  sessionId: string,
  limit: number,
): TranscriptSegment[] {
  const database = getDatabase();
  const result = database.exec(
    `SELECT ${RECENT_SEGMENT_COLS.join(", ")} FROM transcript_segments WHERE session_id = ? ORDER BY start_ms DESC LIMIT ?`,
    [sessionId, limit],
  );
  const rows = mapRows<TranscriptSegment>(result, RECENT_SEGMENT_COLS);
  return rows.reverse();
}
