import { ipcMain } from "electron";
import { SessionManager } from "../services/session-manager";
import { deleteSession, saveDatabase } from "../services/database";
import {
  showControlBar,
  hideControlBar,
  setMainWindowAlwaysOnTop,
} from "../services/window-manager";
import { startPipeline, stopPipeline } from "./transcription-handlers";

let sessionManager: SessionManager;

export function registerSessionHandlers(): void {
  sessionManager = new SessionManager();

  ipcMain.handle("session:list", () => {
    return sessionManager.getSessionList();
  });

  ipcMain.handle("session:create", () => {
    const session = sessionManager.startSession();  // FIX REC-001: Get full session
    startPipeline(session.id);
    showControlBar();
    setMainWindowAlwaysOnTop(true);
    return session;  // FIX REC-001: Return full session object
  });

  ipcMain.handle("session:end", (_, sessionId: string) => {
    sessionManager.endSession(sessionId);
    stopPipeline(sessionId);
    const activeSessions = sessionManager
      .getSessionList()
      .filter((s) => s.status === "active");
    if (activeSessions.length === 0) {
      hideControlBar();
      setMainWindowAlwaysOnTop(false);
    }
  });

  ipcMain.handle("session:get", (_, sessionId: string) => {
    return (
      sessionManager.getSessionList().find((s) => s.id === sessionId) ?? null
    );
  });

  ipcMain.handle("session:delete", (_, sessionId: string) => {
    deleteSession(sessionId);
    saveDatabase();
  });
}

export function getSessionManager(): SessionManager {
  return sessionManager;
}
