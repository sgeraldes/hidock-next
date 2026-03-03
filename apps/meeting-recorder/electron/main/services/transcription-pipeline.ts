import type { AIProviderService } from "./ai-provider";
import type { Chirp3Provider } from "./chirp3-provider";
import {
  insertTranscriptSegment,
  getRecentTranscriptSegments,
  saveDatabase,
} from "./database";
import {
  createTalkingPoint,
  createActionItem,
  getTalkingPointsBySession,
  getActionItemsBySession,
} from "./database-extras";
import type { TranscriptionResult } from "./ai-provider.types";
import { broadcastToAllWindows } from "./broadcast";

import {
  BACKEND_CHIRP3_GEMINI,
  BACKEND_GEMINI_MULTIMODAL,
} from "./transcription-backend";
import type { TranscriptionBackend } from "./transcription-backend";

export { BACKEND_CHIRP3_GEMINI, BACKEND_GEMINI_MULTIMODAL };
export type { TranscriptionBackend };

const MAX_CONTEXT_SEGMENTS = 10;
const TIMESLICE_MS = 3000;

export class TranscriptionPipeline {
  private sessionId: string;
  private aiProvider: AIProviderService;
  private chirp3Provider: Chirp3Provider | null;
  private transcriptionBackend: TranscriptionBackend;
  private knownSpeakers: Set<string> = new Set();
  private stopped = false;

  constructor(
    sessionId: string,
    aiProvider: AIProviderService,
    chirp3Provider?: Chirp3Provider | null,
    transcriptionBackend?: TranscriptionBackend,
  ) {
    this.sessionId = sessionId;
    this.aiProvider = aiProvider;
    this.chirp3Provider = chirp3Provider ?? null;
    this.transcriptionBackend = transcriptionBackend ?? BACKEND_GEMINI_MULTIMODAL;
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

    if (
      this.transcriptionBackend === BACKEND_CHIRP3_GEMINI &&
      this.chirp3Provider?.isConfigured()
    ) {
      await this.processWithChirp3(audioData, mimeType, chunkIndex, context);
    } else {
      await this.processWithGemini(audioData, mimeType, chunkIndex, context);
    }
  }

  // --- Two-Stage Pipeline: Chirp 3 STT → Gemini Analysis ---

  private async processWithChirp3(
    audioData: Buffer,
    mimeType: string,
    chunkIndex: number,
    context: string,
  ): Promise<void> {
    try {
      // Stage 1: Chirp 3 Speech-to-Text
      const chirp3Result = await this.callWithRetry(() =>
        this.chirp3Provider!.recognizeChunk(audioData, mimeType),
      );

      if (!chirp3Result.transcript.trim()) {
        console.log(
          `[Pipeline] Chunk ${chunkIndex}: Chirp 3 returned empty transcript (silence)`,
        );
        broadcastToAllWindows("transcription:status", "idle");
        return;
      }

      // Apply confidence filtering
      const filteredWords =
        this.chirp3Provider!.filterByConfidence(chirp3Result.words);
      const filteredTranscript = filteredWords.map((w) => w.word).join(" ");

      // Stage 2: Gemini analysis of text
      const result = await this.callWithRetry(() =>
        this.aiProvider.analyzeTranscript(
          filteredTranscript || chirp3Result.transcript,
          {
            meetingContext: context,
            attendees: Array.from(this.knownSpeakers),
            wordData: filteredWords.map((w) => ({
              word: w.word,
              startTime: w.startTime,
              endTime: w.endTime,
              confidence: w.confidence,
            })),
          },
        ),
      );

      this.storeAndBroadcast(result, chunkIndex);
      broadcastToAllWindows("transcription:status", "idle");
    } catch (err) {
      // If Chirp 3 fails, attempt fallback to Gemini multimodal
      console.warn(
        `[Pipeline] Chirp 3 failed for chunk ${chunkIndex}, falling back to Gemini multimodal:`,
        err,
      );
      broadcastToAllWindows("transcription:status", "chirp3-fallback");
      await this.processWithGemini(audioData, mimeType, chunkIndex, context);
    }
  }

  // --- Single-Stage Pipeline: Gemini Multimodal (existing behavior) ---

  private async processWithGemini(
    audioData: Buffer,
    mimeType: string,
    chunkIndex: number,
    context: string,
  ): Promise<void> {
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
    for (const segment of result.segments) {
      this.knownSpeakers.add(segment.speaker);

      // Use AI-provided timestamps when available, fall back to chunk-boundary estimates
      const chunkStartMs = chunkIndex * TIMESLICE_MS;
      const chunkEndMs = (chunkIndex + 1) * TIMESLICE_MS;

      insertTranscriptSegment({
        session_id: this.sessionId,
        speaker_name: segment.speaker,
        text: segment.text,
        start_ms: segment.startMs ?? chunkStartMs,
        end_ms: segment.endMs ?? chunkEndMs,
        sentiment: segment.sentiment,
        chunk_index: chunkIndex,
      });
    }

    if (result.topics.length > 0) {
      const existingTopics = getTalkingPointsBySession(this.sessionId);
      const existingTopicSet = new Set(existingTopics.map((tp) => tp.topic.toLowerCase()));
      for (const topic of result.topics) {
        if (!existingTopicSet.has(topic.toLowerCase())) {
          createTalkingPoint({
            session_id: this.sessionId,
            topic: topic,
            first_mentioned_ms: chunkIndex * TIMESLICE_MS,
          });
          existingTopicSet.add(topic.toLowerCase());
        }
      }
    }

    if (result.actionItems.length > 0) {
      const existingActions = getActionItemsBySession(this.sessionId);
      const existingActionSet = new Set(existingActions.map((ai) => ai.text.toLowerCase()));
      for (const item of result.actionItems) {
        if (!existingActionSet.has(item.text.toLowerCase())) {
          createActionItem({
            session_id: this.sessionId,
            text: item.text,
            assignee: item.assignee,
          });
          existingActionSet.add(item.text.toLowerCase());
        }
      }
    }

    saveDatabase();

    broadcastToAllWindows("transcription:newSegments", {
      chunkIndex,
      segments: result.segments,
    });

    if (result.topics.length > 0) {
      broadcastToAllWindows("transcription:topicsUpdated", {
        sessionId: this.sessionId,
        topics: result.topics,
      });
    }

    if (result.actionItems.length > 0) {
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
