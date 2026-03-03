import { ipcMain, shell } from "electron";
import { SessionManager } from "../services/session-manager";
import { deleteSession, deleteSessionTranscript, saveDatabase, getSession, updateSession } from "../services/database";
import {
  showControlBar,
  hideControlBar,
  setMainWindowAlwaysOnTop,
} from "../services/window-manager";
import { startPipeline, stopPipeline } from "./transcription-handlers";
import { clearSessionInitSegment, markSessionStopped } from "./audio-handlers";
import { existsSync } from "fs";
import { AudioStorage } from "../services/audio-storage";

let sessionManager: SessionManager;

export function registerSessionHandlers(): void {
  sessionManager = new SessionManager();

  // Wire up lifecycle callbacks for auto-started/ended sessions
  // so pipeline and buffer cleanup happens regardless of manual vs auto flow
  sessionManager.setLifecycleCallbacks({
    onSessionStarted: (sessionId) => {
      startPipeline(sessionId);
    },
    onSessionEnding: (sessionId) => {
      markSessionStopped(sessionId);
      stopPipeline(sessionId);
      clearSessionInitSegment(sessionId);
    },
  });

  ipcMain.handle("session:list", () => {
    return sessionManager.getSessionList();
  });

  ipcMain.handle("session:create", () => {
    console.log("[SessionHandlers] ===== SESSION:CREATE CALLED =====");
    try {
      console.log("[SessionHandlers] Creating session with manuallyStarted=true");
      // FIX REC-004: Mark session as manually started to prevent MicDetector auto-end
      // startSession calls lifecycle callback which starts the pipeline
      const session = sessionManager.startSession(true);  // true = manually started
      console.log("[SessionHandlers] Session created:", session);
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
      // endSession calls lifecycle callback which stops pipeline and clears buffers
      await sessionManager.endSession(sessionId);
      console.log(`[SessionHandlers] Session ended`);
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
      stopPipeline(sessionId);
      clearSessionInitSegment(sessionId);
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
      // Clear summary and title along with transcript
      updateSession(sessionId, { status: "inactive", summary: null, title: null });
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
      const session = getSession(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      // Clear existing transcript data
      deleteSessionTranscript(sessionId);
      updateSession(sessionId, { status: "inactive", summary: null, title: null });
      saveDatabase();

      // Stop any existing pipeline for this session
      stopPipeline(sessionId);

      // Check if we have a concatenated audio file to re-process
      if (session.audio_path && existsSync(session.audio_path)) {
        // Start a new pipeline and feed it the saved audio
        startPipeline(sessionId);
        const { getPipeline } = await import("./transcription-handlers");
        const pipeline = getPipeline(sessionId);
        if (pipeline) {
          const { readFileSync } = await import("fs");
          const audioBuffer = readFileSync(session.audio_path);
          // Process the entire file as a single chunk (chunk index 0)
          await pipeline.processAudioChunk(audioBuffer, "audio/ogg", 0);
          stopPipeline(sessionId);
        }
      } else {
        // No audio file available — check if raw chunks exist
        const storage = new AudioStorage();
        const sessionDir = storage.getSessionDir(sessionId);
        if (existsSync(sessionDir)) {
          startPipeline(sessionId);
          const { getPipeline } = await import("./transcription-handlers");
          const pipeline = getPipeline(sessionId);
          if (pipeline) {
            const { readdirSync, readFileSync } = await import("fs");
            const { join } = await import("path");
            const chunks = readdirSync(sessionDir)
              .filter((f: string) => f.startsWith("chunk-"))
              .sort();
            for (let i = 0; i < chunks.length; i++) {
              const chunkData = readFileSync(join(sessionDir, chunks[i]));
              await pipeline.processAudioChunk(chunkData, "audio/ogg", i);
            }
          }
          stopPipeline(sessionId);
        } else {
          throw new Error("No audio data available for re-transcription");
        }
      }
    } catch (err) {
      console.error("[SessionHandlers] Failed to retranscribe:", err);
      throw new Error(
        `Failed to retranscribe: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    }
  });
}

export function getSessionManager(): SessionManager {
  if (!sessionManager) {
    throw new Error("SessionManager not initialized. Call registerSessionHandlers() first.");
  }
  return sessionManager;
}
