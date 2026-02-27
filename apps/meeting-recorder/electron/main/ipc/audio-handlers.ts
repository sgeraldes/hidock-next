import { BrowserWindow, IpcMainEvent, ipcMain } from "electron";
import { AudioStorage } from "../services/audio-storage";
import { AudioConcatenation } from "../services/audio-concatenation";
import { MicDetector, MicStatus } from "../services/mic-detector";
import { getSetting, updateSession } from "../services/database";
import { getPipeline } from "./transcription-handlers";
import { getSessionManager } from "./session-handlers";

const audioStorage = new AudioStorage();
const audioConcatenation = new AudioConcatenation(audioStorage);
const micDetector = new MicDetector();

function broadcastToAllWindows(channel: string, data: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, data);
  }
}

export function registerAudioHandlers(): void {
  ipcMain.on(
    "audio:chunk",
    (
      event: IpcMainEvent,
      data: ArrayBuffer,
      sessionId: string,
      chunkIndex: number,
      mimeType: string,
    ) => {
      try {
        const buffer = Buffer.from(data);
        audioStorage.saveChunk(sessionId, chunkIndex, buffer);
        event.sender.send("audio:chunkAck", { sessionId, chunkIndex });

        const pipeline = getPipeline(sessionId);
        if (pipeline) {
          pipeline
            .processAudioChunk(buffer, mimeType, chunkIndex)
            .catch((err: unknown) => {
              console.error("[AudioHandlers] Pipeline error:", err);
              // Propagate pipeline errors to renderer (ERR-003)
              event.sender.send("audio:chunkError", {
                sessionId,
                chunkIndex,
                error: err instanceof Error ? err.message : "Pipeline error",
              });
            });
        }
      } catch (err) {
        console.error("[AudioHandlers] Failed to save chunk:", err);
        // Propagate storage errors to renderer (ERR-003)
        event.sender.send("audio:chunkError", {
          sessionId,
          chunkIndex,
          error: err instanceof Error ? err.message : "Failed to save audio chunk",
        });
      }
    },
  );

  // FIX PLY-001: Get audio path for playback
  ipcMain.handle("audio:getPath", async (_, sessionId: string) => {
    try {
      const audioPath = await audioConcatenation.concatenateSession(sessionId);
      if (audioPath) {
        // Update database with audio path
        updateSession(sessionId, { audio_path: audioPath });
      }
      return audioPath;
    } catch (err) {
      console.error("[AudioHandlers] Failed to get audio path:", err);
      return null;
    }
  });

  micDetector.start((status: MicStatus) => {
    broadcastToAllWindows("audio:micStatus", status);
    const autoRecordSetting = getSetting("recording.autoRecord");
    const autoRecordEnabled = autoRecordSetting !== "false";
    if (autoRecordEnabled) {
      getSessionManager().onMicStatusChange(status);
    }
  });
}

export function stopMicDetector(): void {
  micDetector.stop();
}

export function getAudioStorage(): AudioStorage {
  return audioStorage;
}
