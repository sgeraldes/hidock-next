import { ipcMain } from "electron";
import {
  getAllSessions,
  searchSessions,
  deleteSession,
  saveDatabase,
} from "../services/database";

export function registerHistoryHandlers(): void {
  ipcMain.handle("history:search", (_, query: string) => {
    if (!query || query.trim().length === 0) return getAllSessions();
    return searchSessions(query);
  });

  ipcMain.handle("history:delete", (_, sessionId: string) => {
    deleteSession(sessionId);
    saveDatabase();
  });
}
