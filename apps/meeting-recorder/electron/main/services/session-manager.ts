import { BrowserWindow } from "electron";
import { createSession, updateSession, getAllSessions } from "./database";
import type { MicStatus } from "./mic-detector";
import type { Session } from "./database.types";

function broadcastToAllWindows(channel: string, data: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, data);
  }
}

export class SessionManager {
  private activeSessionId: string | null = null;

  startSession(): Session {
    if (this.activeSessionId) {
      this.endSession(this.activeSessionId);
    }

    const session = createSession();
    this.activeSessionId = session.id;

    broadcastToAllWindows("session:created", session);

    return session;  // FIX REC-001: Return full session object
  }

  endSession(sessionId: string): void {
    if (this.activeSessionId !== sessionId) return;

    const now = new Date().toISOString();
    updateSession(sessionId, { status: "inactive", ended_at: now });
    this.activeSessionId = null;

    broadcastToAllWindows("session:statusChanged", {
      id: sessionId,
      status: "inactive",
      ended_at: now,
    });
  }

  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  onMicStatusChange(status: MicStatus): void {
    if (status.active && !this.activeSessionId) {
      this.startSession();
    } else if (!status.active && this.activeSessionId) {
      this.endSession(this.activeSessionId);
    }
  }

  getSessionList(): Session[] {
    return getAllSessions();
  }

  markSessionProcessing(sessionId: string): void {
    updateSession(sessionId, { status: "processing" });
    broadcastToAllWindows("session:statusChanged", {
      id: sessionId,
      status: "processing",
    });
  }

  markSessionComplete(sessionId: string): void {
    updateSession(sessionId, { status: "complete" });
    broadcastToAllWindows("session:statusChanged", {
      id: sessionId,
      status: "complete",
    });
  }

  dispose(): void {
    if (this.activeSessionId) {
      this.endSession(this.activeSessionId);
    }
  }
}
