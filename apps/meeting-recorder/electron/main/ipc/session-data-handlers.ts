import { ipcMain } from "electron";
import {
  getTranscriptBySession,
  getSession,
  renameSpeakerInSession,
  saveDatabase,
} from "../services/database";
import {
  getTalkingPointsBySession,
  getActionItemsBySession,
} from "../services/database-extras";

// FIX TRX-003, TOP-003, ACT-003, SUM-002: Handlers for loading historical session data
export function registerSessionDataHandlers(): void {
  // Load transcript segments for a session
  ipcMain.handle("session:getTranscript", async (_, sessionId: string) => {
    try {
      const segments = getTranscriptBySession(sessionId);
      return segments;
    } catch (err) {
      console.error("[SessionDataHandlers] Failed to get transcript:", err);
      return [];
    }
  });

  // Load topics (talking points) for a session
  ipcMain.handle("session:getTopics", async (_, sessionId: string) => {
    try {
      const talkingPoints = getTalkingPointsBySession(sessionId);
      return talkingPoints.map((tp) => tp.topic);
    } catch (err) {
      console.error("[SessionDataHandlers] Failed to get topics:", err);
      return [];
    }
  });

  // Load action items for a session
  ipcMain.handle("session:getActionItems", async (_, sessionId: string) => {
    try {
      const actionItems = getActionItemsBySession(sessionId);
      return actionItems.map((ai) => ({
        text: ai.text,
        assignee: ai.assignee,
      }));
    } catch (err) {
      console.error("[SessionDataHandlers] Failed to get action items:", err);
      return [];
    }
  });

  // Load summary for a session
  ipcMain.handle("session:getSummary", async (_, sessionId: string) => {
    try {
      const session = getSession(sessionId);
      return session?.summary ?? null;
    } catch (err) {
      console.error("[SessionDataHandlers] Failed to get summary:", err);
      return null;
    }
  });

  // SPEC-003 REQ-4: Rename a speaker in all transcript segments for a session
  ipcMain.handle(
    "session:renameSpeaker",
    async (_, sessionId: string, oldName: string, newName: string) => {
      try {
        const count = renameSpeakerInSession(sessionId, oldName, newName);
        saveDatabase();
        console.log(
          `[SessionDataHandlers] Renamed speaker "${oldName}" to "${newName}" in ${count} segments for session ${sessionId}`,
        );
        return { success: true, count };
      } catch (err) {
        console.error("[SessionDataHandlers] Failed to rename speaker:", err);
        throw new Error(
          `Failed to rename speaker: ${err instanceof Error ? err.message : "Unknown error"}`,
        );
      }
    },
  );
}
