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
import { broadcastToAllWindows } from "./broadcast";
import { mapDbSession } from "./map-db-session";

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
      const orchestrator = getOrchestrator();
      if (orchestrator?.isSessionActive(input.sessionId)) {
        await orchestrator.stopSession();
      }
      deleteSession(input.sessionId);
      saveDatabase();
      broadcastToAllWindows("session:deleted", { sessionId: input.sessionId });
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
