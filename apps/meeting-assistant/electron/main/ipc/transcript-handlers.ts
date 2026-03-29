import { createHandler } from "./create-handler";
import { CHANNELS } from "./channels";
import { TranscriptGetSegmentsInput, TranscriptGetRecentInput } from "./validation";

export function registerTranscriptHandlers(): void {
  createHandler({
    channel: CHANNELS.transcript.getSegments,
    schema: TranscriptGetSegmentsInput,
    handler: async (_input) => {
      // TODO: wire to TranscriptService
      return [];
    },
  });

  createHandler({
    channel: CHANNELS.transcript.getRecent,
    schema: TranscriptGetRecentInput,
    handler: async (_input) => {
      // TODO: wire to TranscriptService
      return [];
    },
  });

  console.log("[IPC] Transcript handlers registered");
}
