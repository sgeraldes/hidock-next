import { z } from "zod";
import { createHandler } from "./create-handler";
import { CHANNELS } from "./channels";
import {
  SessionListInput,
  SessionCreateInput,
  SessionGetInput,
  SessionEndInput,
  SessionDeleteInput,
  SessionLinkMeetingInput,
} from "./validation";
import { getSessionManager } from "../services/session-manager";
import {
  getAllSessions,
  getSession,
  deleteSession,
} from "../services/database-queries";
import { getDatabase, saveDatabase } from "../services/database";

export function registerSessionHandlers(): void {
  createHandler({
    channel: CHANNELS.session.list,
    schema: SessionListInput,
    handler: async () => {
      return getAllSessions();
    },
  });

  createHandler({
    channel: CHANNELS.session.create,
    schema: SessionCreateInput,
    handler: async () => {
      return getSessionManager().startSession();
    },
  });

  createHandler({
    channel: CHANNELS.session.get,
    schema: SessionGetInput,
    handler: async (input) => {
      return getSession(input.sessionId);
    },
  });

  createHandler({
    channel: CHANNELS.session.end,
    schema: SessionEndInput,
    handler: async (_input) => {
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
    schema: z.void(),
    handler: async () => {
      const sessions = getAllSessions();
      const totalSessions = sessions.length;
      const totalRecordingMs = sessions.reduce((sum, s) => {
        if (s.ended_at && s.started_at) return sum + (s.ended_at - s.started_at);
        return sum;
      }, 0);
      const totalRecordingMinutes = Math.round(totalRecordingMs / 60000);
      const db = getDatabase();
      const notesResult = db.exec("SELECT COUNT(*) FROM notes");
      const notesCount =
        notesResult.length > 0 ? (notesResult[0].values[0][0] as number) : 0;
      return { totalSessions, totalRecordingMinutes, notesCount };
    },
  });

  console.log("[IPC] Session handlers registered");
}
