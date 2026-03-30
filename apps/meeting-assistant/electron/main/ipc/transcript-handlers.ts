import { createHandler } from "./create-handler";
import { CHANNELS } from "./channels";
import { TranscriptGetSegmentsInput, TranscriptGetRecentInput } from "./validation";
import {
  getTranscriptBySession,
  getRecentTranscriptSegments,
} from "../services/database-queries";

export function registerTranscriptHandlers(): void {
  createHandler({
    channel: CHANNELS.transcript.getSegments,
    schema: TranscriptGetSegmentsInput,
    handler: async (input) => {
      return getTranscriptBySession(input.sessionId);
    },
  });

  createHandler({
    channel: CHANNELS.transcript.getRecent,
    schema: TranscriptGetRecentInput,
    handler: async (input) => {
      return getRecentTranscriptSegments(input.sessionId, input.maxCount ?? 50);
    },
  });

  console.log("[IPC] Transcript handlers registered");
}
