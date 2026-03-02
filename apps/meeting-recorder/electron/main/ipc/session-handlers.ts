import { ipcMain, shell } from "electron";
import { SessionManager } from "../services/session-manager";
import { deleteSession, deleteSessionTranscript, saveDatabase, getSession, updateSession } from "../services/database";
import {
  showControlBar,
  hideControlBar,
  setMainWindowAlwaysOnTop,
} from "../services/window-manager";
import { startPipeline, stopPipeline } from "./transcription-handlers";
import { clearSessionInitSegment } from "./audio-handlers";
import { existsSync } from "fs";
import { AudioStorage } from "../services/audio-storage";

let sessionManager: SessionManager;

export function registerSessionHandlers(): void {
  sessionManager = new SessionManager();

  ipcMain.handle("session:list", () => {
    return sessionManager.getSessionList();
  });

  ipcMain.handle("session:create", () => {
    console.log("[SessionHandlers] ===== SESSION:CREATE CALLED =====");
    try {
      console.log("[SessionHandlers] Creating session with manuallyStarted=true");
      // FIX REC-004: Mark session as manually started to prevent MicDetector auto-end
      const session = sessionManager.startSession(true);  // true = manually started
      console.log("[SessionHandlers] Session created:", session);
      console.log("[SessionHandlers] Starting transcription pipeline");
      startPipeline(session.id);
      console.log("[SessionHandlers] Showing control bar");
      showControlBar();
      console.log("[SessionHandlers] Setting always on top");
      setMainWindowAlwaysOnTop(true);
      console.log("[SessionHandlers] Returning session:", session.id);
      return session;  // FIX REC-001: Return full session object
    } catch (err) {
      console.error("[SessionHandlers] Failed to create session:", err);
      throw new Error(
        `Failed to create session: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    }
  });

  ipcMain.handle("session:end", async (_, sessionId: string) => {
    console.log(`[SessionHandlers] ===== SESSION:END CALLED for ${sessionId} =====`);
    try {
      await sessionManager.endSession(sessionId);
      console.log(`[SessionHandlers] Session ended, stopping pipeline`);
      stopPipeline(sessionId);
      clearSessionInitSegment(sessionId);
      const activeSessions = sessionManager
        .getSessionList()
        .filter((s) => s.status === "active");
      if (activeSessions.length === 0) {
        hideControlBar();
        setMainWindowAlwaysOnTop(false);
      }
    } catch (err) {
      console.error("[SessionHandlers] Failed to end session:", err);
      throw new Error(
        `Failed to end session: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    }
  });

  ipcMain.handle("session:get", (_, sessionId: string) => {
    return (
      sessionManager.getSessionList().find((s) => s.id === sessionId) ?? null
    );
  });

  ipcMain.handle("session:delete", (_, sessionId: string) => {
    try {
      deleteSession(sessionId);
      saveDatabase();
    } catch (err) {
      console.error("[SessionHandlers] Failed to delete session:", err);
      throw new Error(
        `Failed to delete session: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    }
  });

  ipcMain.handle("session:openFileLocation", (_, sessionId: string) => {
    const session = getSession(sessionId);
    if (session?.audio_path && existsSync(session.audio_path)) {
      shell.showItemInFolder(session.audio_path);
    } else {
      // Try to open the session directory
      const storage = new AudioStorage();
      const dir = storage.getSessionDir(sessionId);
      if (existsSync(dir)) {
        shell.openPath(dir);
      }
    }
  });

  ipcMain.handle("session:deleteTranscript", (_, sessionId: string) => {
    try {
      deleteSessionTranscript(sessionId);
      // Also clear summary from session
      updateSession(sessionId, { status: "inactive" });
      saveDatabase();
    } catch (err) {
      console.error("[SessionHandlers] Failed to delete transcript:", err);
      throw new Error(
        `Failed to delete transcript: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    }
  });

  ipcMain.handle("session:retranscribe", async (_, sessionId: string) => {
    try {
      // Clear existing transcript data first
      deleteSessionTranscript(sessionId);
      saveDatabase();
      // Re-start the transcription pipeline
      stopPipeline(sessionId);
      startPipeline(sessionId);
    } catch (err) {
      console.error("[SessionHandlers] Failed to retranscribe:", err);
      throw new Error(
        `Failed to retranscribe: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    }
  });
}

export function getSessionManager(): SessionManager {
  return sessionManager;
}
