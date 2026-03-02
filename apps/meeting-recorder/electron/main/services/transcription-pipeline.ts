import { BrowserWindow } from "electron";
import type { AIProviderService } from "./ai-provider";
import {
  insertTranscriptSegment,
  getRecentTranscriptSegments,
  saveDatabase,
} from "./database";
import {
  createTalkingPoint,
  createActionItem,
} from "./database-extras";
import type { TranscriptionResult } from "./ai-provider.types";

function broadcastToAllWindows(channel: string, data: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, data);
  }
}

const MAX_CONTEXT_SEGMENTS = 10;

export class TranscriptionPipeline {
  private sessionId: string;
  private aiProvider: AIProviderService;
  private knownSpeakers: Set<string> = new Set();
  private stopped = false;

  constructor(sessionId: string, aiProvider: AIProviderService) {
    this.sessionId = sessionId;
    this.aiProvider = aiProvider;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  stop(): void {
    this.stopped = true;
  }

  async processChunk(text: string, chunkIndex: number): Promise<void> {
    if (this.stopped) return;

    broadcastToAllWindows("transcription:status", "processing");

    const context = this.buildContext();

    let result: TranscriptionResult;
    try {
      result = await this.callWithRetry(() =>
        this.aiProvider.transcribe(text, {
          meetingContext: context,
          attendees: Array.from(this.knownSpeakers),
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      broadcastToAllWindows("transcription:error", message);
      broadcastToAllWindows("transcription:status", "error");
      return;
    }

    this.storeAndBroadcast(result, chunkIndex);
    broadcastToAllWindows("transcription:status", "idle");
  }

  async processAudioChunk(
    audioData: Buffer,
    mimeType: string,
    chunkIndex: number,
  ): Promise<void> {
    if (this.stopped) return;

    broadcastToAllWindows("transcription:status", "processing");

    const context = this.buildContext();

    let result: TranscriptionResult;
    try {
      result = await this.callWithRetry(() =>
        this.aiProvider.transcribeAudio(audioData, mimeType, {
          meetingContext: context,
          attendees: Array.from(this.knownSpeakers),
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      broadcastToAllWindows("transcription:error", message);
      broadcastToAllWindows("transcription:status", "error");
      return;
    }

    this.storeAndBroadcast(result, chunkIndex);
    broadcastToAllWindows("transcription:status", "idle");
  }

  private buildContext(): string {
    const recent = getRecentTranscriptSegments(
      this.sessionId,
      MAX_CONTEXT_SEGMENTS,
    );

    if (recent.length === 0) {
      return "This is the start of the recording. There is no previous context.";
    }

    // Filter out empty/placeholder segments to avoid feeding garbage context
    const meaningful = recent.filter(
      (s) => s.text && s.text.trim().length > 0 && !s.text.startsWith("["),
    );

    if (meaningful.length === 0) {
      return "Previous audio did not contain clear speech.";
    }

    const lines = meaningful.map(
      (s) => `${s.speaker_name ?? "Unknown"}: ${s.text}`,
    );
    return `Previous transcribed speech (for speaker continuity only, do NOT repeat or extend this):\n${lines.join("\n")}`;
  }

  private storeAndBroadcast(
    result: TranscriptionResult,
    chunkIndex: number,
  ): void {
    // Store transcript segments
    // Use 3000ms timeslice (matches AudioRecorder default)
    const TIMESLICE_MS = 3000;
    for (const segment of result.segments) {
      this.knownSpeakers.add(segment.speaker);

      insertTranscriptSegment({
        session_id: this.sessionId,
        speaker_name: segment.speaker,
        text: segment.text,
        start_ms: chunkIndex * TIMESLICE_MS,
        end_ms: (chunkIndex + 1) * TIMESLICE_MS,
        sentiment: segment.sentiment,
        chunk_index: chunkIndex,
      });
    }

    // FIX TOP-007: Store topics to database
    if (result.topics.length > 0) {
      for (const topic of result.topics) {
        createTalkingPoint({
          session_id: this.sessionId,
          topic: topic,
          first_mentioned_ms: chunkIndex * 5000,
        });
      }
    }

    // FIX ACT-001: Store action items to database
    if (result.actionItems.length > 0) {
      for (const item of result.actionItems) {
        createActionItem({
          session_id: this.sessionId,
          text: item.text,
          assignee: item.assignee,
        });
      }
    }

    // Save database after all inserts
    saveDatabase();

    // Broadcast events to frontend (include chunkIndex for timestamp calculation)
    broadcastToAllWindows("transcription:newSegments", {
      chunkIndex,
      segments: result.segments,
    });

    if (result.topics.length > 0) {
      // FIX TOP-002: Include sessionId in event payload
      broadcastToAllWindows("transcription:topicsUpdated", {
        sessionId: this.sessionId,
        topics: result.topics,
      });
    }

    if (result.actionItems.length > 0) {
      // FIX ACT-004: Include sessionId in event payload
      broadcastToAllWindows("transcription:actionItemsUpdated", {
        sessionId: this.sessionId,
        actionItems: result.actionItems,
      });
    }
  }

  private async callWithRetry<T>(
    fn: () => Promise<T>,
    maxAttempts = 3,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        // Don't retry auth/config errors - they'll fail every time
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("API key error") || message.includes("not configured")) {
          console.error(`[TranscriptionPipeline] Non-retryable error: ${message}`);
          throw err;
        }
        if (attempt < maxAttempts - 1) {
          const delayMs = 1000 * Math.pow(2, attempt);
          console.warn(`[TranscriptionPipeline] Attempt ${attempt + 1}/${maxAttempts} failed, retrying in ${delayMs}ms: ${message}`);
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    }
    throw lastError;
  }
}
