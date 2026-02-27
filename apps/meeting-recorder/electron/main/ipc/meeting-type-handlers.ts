import { ipcMain } from "electron";
import {
  getMeetingTypes,
  createMeetingType,
  updateSession,
  saveDatabase,
} from "../services/database";
import { EndOfMeetingProcessor } from "../services/end-of-meeting-processor";
import { getSessionManager } from "./session-handlers";

const processor = new EndOfMeetingProcessor();

export function registerMeetingTypeHandlers(): void {
  ipcMain.handle("meetingType:list", () => {
    return getMeetingTypes();
  });

  ipcMain.handle(
    "meetingType:create",
    (
      _,
      params: {
        name: string;
        description?: string;
        prompt_template?: string;
        icon?: string;
      },
    ) => {
      return createMeetingType(params);
    },
  );

  ipcMain.handle(
    "meetingType:setForSession",
    (_, sessionId: string, meetingTypeId: string | null) => {
      updateSession(sessionId, { meeting_type_id: meetingTypeId });
    },
  );

  ipcMain.handle("meetingType:processSession", async (_, sessionId: string) => {
    const sm = getSessionManager();
    sm.markSessionProcessing(sessionId);

    const session = sm.getSessionList().find((s) => s.id === sessionId);
    const meetingTypeId = session?.meeting_type_id ?? undefined;

    try {
      await processor.process(sessionId, meetingTypeId);
      sm.markSessionComplete(sessionId);
    } catch (err) {
      updateSession(sessionId, {
        status: "complete",
        summary: `Processing failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      saveDatabase();
      throw err;
    }
  });
}

export function getEndOfMeetingProcessor(): EndOfMeetingProcessor {
  return processor;
}
