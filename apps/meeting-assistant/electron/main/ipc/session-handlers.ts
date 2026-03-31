import { createHandler } from "./create-handler";
import { CHANNELS } from "./channels";
import {
  SessionListInput,
  SessionCreateInput,
  SessionGetInput,
  SessionEndInput,
  SessionDeleteInput,
  SessionLinkMeetingInput,
  SessionStatsInput,
} from "./validation";
import { getSessionManager } from "../services/session-manager";
import { getOrchestrator } from "../services/session-orchestrator";
import {
  getAllSessions,
  getSession,
  deleteSession,
  getNotesCount,
} from "../services/database-queries";
import { saveDatabase } from "../services/database";
import type { Session as DbSession } from "../services/database-types";

/** Renderer-side camelCase Session shape (mirrors src/types/models.ts). */
interface RendererSession {
  id: string;
  title: string;
  startedAt: number;
  endedAt: number | null;
  status: "recording" | "processing" | "completed";
  meetingId: string | null;
  audioPath: string | null;
  transcriptPath: string | null;
}

/**
 * Map a snake_case DB Session to the camelCase Session shape expected by the renderer.
 */
function mapDbSession(s: DbSession): RendererSession {
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

export function registerSessionHandlers(): void {
  createHandler({
    channel: CHANNELS.session.list,
    schema: SessionListInput,
    handler: async () => {
      return getAllSessions().map(mapDbSession);
    },
  });

  createHandler({
    channel: CHANNELS.session.create,
    schema: SessionCreateInput,
    handler: async () => {
      const orchestrator = getOrchestrator();
      if (orchestrator) {
        const sessionId = await orchestrator.startSession();
        const session = getSession(sessionId);
        return session ? mapDbSession(session) : null;
      }
      return getSessionManager().startSession();
    },
  });

  createHandler({
    channel: CHANNELS.session.get,
    schema: SessionGetInput,
    handler: async (input) => {
      const s = getSession(input.sessionId);
      return s ? mapDbSession(s) : null;
    },
  });

  createHandler({
    channel: CHANNELS.session.end,
    schema: SessionEndInput,
    handler: async (_input) => {
      const orchestrator = getOrchestrator();
      if (orchestrator) {
        await orchestrator.stopSession();
        return null;
      }
      return getSessionManager().endSession();
    },
  });

  createHandler({
    channel: CHANNELS.session.delete,
    schema: SessionDeleteInput,
    handler: async (input) => {
      deleteSession(input.sessionId);
      saveDatabase();
      return null;
    },
  });

  createHandler({
    channel: CHANNELS.session.linkMeeting,
    schema: SessionLinkMeetingInput,
    handler: async (input) => {
      getSessionManager().linkMeeting(input.sessionId, input.meetingId);
      return getSessionManager().getCurrentSession();
    },
  });

  createHandler({
    channel: CHANNELS.session.stats,
    schema: SessionStatsInput,
    handler: async () => {
      const sessions = getAllSessions();
      const totalSessions = sessions.length;
      const totalRecordingMs = sessions.reduce((sum, s) => {
        if (s.ended_at && s.started_at) return sum + (s.ended_at - s.started_at);
        return sum;
      }, 0);
      const totalRecordingMinutes = Math.round(totalRecordingMs / 60000);
      const notesCount = getNotesCount();
      return { totalSessions, totalRecordingMinutes, notesCount };
    },
  });

  console.log("[IPC] Session handlers registered");
}
