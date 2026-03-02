import { BrowserWindow } from "electron";
import { createSession, updateSession, getAllSessions } from "./database";
import type { MicStatus } from "./mic-detector";
import type { Session } from "./database.types";
import type { AudioConcatenation } from "./audio-concatenation";

function broadcastToAllWindows(channel: string, data: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, data);
  }
}

export class SessionManager {
  private activeSessionId: string | null = null;
  private audioConcatenation: AudioConcatenation | null = null;
  private manuallyStarted: boolean = false; // Track if session was manually started

  setAudioConcatenation(concatenation: AudioConcatenation): void {
    this.audioConcatenation = concatenation;
  }

  startSession(isManual: boolean = false): Session {
    if (this.activeSessionId) {
      this.endSession(this.activeSessionId);
    }

    const session = createSession();
    this.activeSessionId = session.id;
    this.manuallyStarted = isManual; // Track manual vs. auto start

    broadcastToAllWindows("session:created", session);

    return session;  // FIX REC-001: Return full session object
  }

  async endSession(sessionId: string): Promise<void> {
    if (this.activeSessionId !== sessionId) return;

    const now = new Date().toISOString();
    updateSession(sessionId, { status: "inactive", ended_at: now });
    this.activeSessionId = null;
    this.manuallyStarted = false; // Reset flag

    // Concatenate audio chunks into final file
    if (this.audioConcatenation) {
      try {
        const audioPath = await this.audioConcatenation.concatenateSession(sessionId);
        if (audioPath) {
          updateSession(sessionId, { audio_path: audioPath });
        }
      } catch (err) {
        console.error('[SessionManager] Failed to concatenate audio:', err);
      }
    }

    broadcastToAllWindows("session:statusChanged", {
      id: sessionId,
      status: "inactive",
      ended_at: now,
    });
  }

  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  async onMicStatusChange(status: MicStatus): Promise<void> {
    if (status.active && !this.activeSessionId) {
      // Auto-start session when mic becomes active (autoRecord feature)
      this.startSession(false); // false = not manually started
    } else if (!status.active && this.activeSessionId && !this.manuallyStarted) {
      // Only auto-end if session was auto-started (NOT manually started)
      // FIX REC-004: Don't auto-end manually-started sessions
      console.log('[SessionManager] Auto-ending auto-started session (mic inactive)');
      await this.endSession(this.activeSessionId);
    } else if (!status.active && this.activeSessionId && this.manuallyStarted) {
      console.log('[SessionManager] Ignoring mic inactive - session was manually started');
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

  async dispose(): Promise<void> {
    if (this.activeSessionId) {
      await this.endSession(this.activeSessionId);
    }
  }
}
