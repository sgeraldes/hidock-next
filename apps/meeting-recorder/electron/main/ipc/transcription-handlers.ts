import { ipcMain } from "electron";
import { TranscriptionPipeline } from "../services/transcription-pipeline";
import { getAIService } from "./ai-handlers";

const pipelines = new Map<string, TranscriptionPipeline>();

export function registerTranscriptionHandlers(): void {
  ipcMain.handle("transcription:start", (_, sessionId: string) => {
    if (pipelines.has(sessionId)) return;
    const pipeline = new TranscriptionPipeline(sessionId, getAIService());
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
  const pipeline = new TranscriptionPipeline(sessionId, getAIService());
  pipelines.set(sessionId, pipeline);
}

export function stopPipeline(sessionId: string): void {
  const pipeline = pipelines.get(sessionId);
  if (pipeline) {
    pipeline.stop();
    pipelines.delete(sessionId);
  }
}
