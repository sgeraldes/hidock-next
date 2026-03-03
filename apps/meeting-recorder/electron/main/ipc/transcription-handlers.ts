import { ipcMain } from "electron";
import {
  TranscriptionPipeline,
  BACKEND_GEMINI_MULTIMODAL,
} from "../services/transcription-pipeline";
import type { TranscriptionBackend } from "../services/transcription-pipeline";
import { getAIService } from "./ai-handlers";
import { getChirp3Provider } from "./chirp3-handlers";
import { getSetting } from "../services/database-extras";

const pipelines = new Map<string, TranscriptionPipeline>();

function createPipeline(sessionId: string): TranscriptionPipeline {
  const chirp3 = getChirp3Provider();
  const backend =
    (getSetting("ai.transcriptionBackend") as TranscriptionBackend) ||
    BACKEND_GEMINI_MULTIMODAL;

  return new TranscriptionPipeline(
    sessionId,
    getAIService(),
    chirp3,
    backend,
  );
}

export function registerTranscriptionHandlers(): void {
  ipcMain.handle("transcription:start", (_, sessionId: string) => {
    if (pipelines.has(sessionId)) return;
    const pipeline = createPipeline(sessionId);
    pipelines.set(sessionId, pipeline);
  });

  ipcMain.handle("transcription:stop", (_, sessionId: string) => {
    const pipeline = pipelines.get(sessionId);
    if (pipeline) {
      pipeline.stop();
      pipelines.delete(sessionId);
    }
  });

  ipcMain.handle(
    "transcription:processChunk",
    async (_, sessionId: string, text: string, chunkIndex: number) => {
      const pipeline = pipelines.get(sessionId);
      if (pipeline) {
        await pipeline.processChunk(text, chunkIndex);
      }
    },
  );
}

export function getPipeline(
  sessionId: string,
): TranscriptionPipeline | undefined {
  return pipelines.get(sessionId);
}

export function startPipeline(sessionId: string): void {
  if (pipelines.has(sessionId)) return;
  const pipeline = createPipeline(sessionId);
  pipelines.set(sessionId, pipeline);
}

export function stopPipeline(sessionId: string): void {
  const pipeline = pipelines.get(sessionId);
  if (pipeline) {
    pipeline.stop();
    pipelines.delete(sessionId);
  }
}
