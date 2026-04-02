import type { Session as DbSession } from "../services/database-types";

/** Renderer-side camelCase Session shape (mirrors src/types/models.ts). */
export interface RendererSession {
  id: string;
  title: string;
  startedAt: number;
  endedAt: number | null;
  status: "recording" | "processing" | "completed" | "interrupted";
  meetingId: string | null;
  audioPath: string | null;
  transcriptPath: string | null;
}

/**
 * Map a snake_case DB Session to the camelCase Session shape expected by the renderer.
 */
export function mapDbSession(s: DbSession): RendererSession {
  return {
    id: s.id,
    title: s.title ?? "",
    startedAt: s.started_at,
    endedAt: s.ended_at,
    status: s.status as RendererSession["status"],
    meetingId: s.meeting_id,
    audioPath: s.audio_path,
    transcriptPath: s.transcript_path,
  };
}
