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

export function registerSessionHandlers(): void {
  createHandler({
    channel: CHANNELS.session.list,
    schema: SessionListInput,
    handler: async () => {
      // TODO: query from database once persistence is wired (Phase 5)
      const current = getSessionManager().getCurrentSession();
      return current ? [current] : [];
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
      const current = getSessionManager().getCurrentSession();
      return current?.id === input.sessionId ? current : null;
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
    handler: async (_input) => {
      // TODO: wire to database deletion once persistence is added
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

  console.log("[IPC] Session handlers registered");
}
