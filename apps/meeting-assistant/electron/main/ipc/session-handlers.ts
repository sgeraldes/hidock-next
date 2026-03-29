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

export function registerSessionHandlers(): void {
  createHandler({
    channel: CHANNELS.session.list,
    schema: SessionListInput,
    handler: async () => {
      // TODO: wire to SessionService
      return [];
    },
  });

  createHandler({
    channel: CHANNELS.session.create,
    schema: SessionCreateInput,
    handler: async () => {
      // TODO: wire to SessionService
      return null;
    },
  });

  createHandler({
    channel: CHANNELS.session.get,
    schema: SessionGetInput,
    handler: async (_input) => {
      // TODO: wire to SessionService
      return null;
    },
  });

  createHandler({
    channel: CHANNELS.session.end,
    schema: SessionEndInput,
    handler: async (_input) => {
      // TODO: wire to SessionService
      return null;
    },
  });

  createHandler({
    channel: CHANNELS.session.delete,
    schema: SessionDeleteInput,
    handler: async (_input) => {
      // TODO: wire to SessionService
      return null;
    },
  });

  createHandler({
    channel: CHANNELS.session.linkMeeting,
    schema: SessionLinkMeetingInput,
    handler: async (_input) => {
      // TODO: wire to SessionService
      return null;
    },
  });

  console.log("[IPC] Session handlers registered");
}
