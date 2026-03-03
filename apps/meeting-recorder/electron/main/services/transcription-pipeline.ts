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
  getSetting,
} from "./database-extras";
import type { TranscriptionResult } from "./ai-provider.types";
import { broadcastToAllWindows } from "./broadcast";
import { PerformanceMonitor } from "./performance-monitor";
import type {
  Chirp3StreamResult,
  Chirp3StreamEvents,
} from "./chirp3-provider.types";
import type { Chirp3StreamSession } from "./chirp3-stream-session";
import { AudioConverter } from "./audio-converter";

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

  /** Active streaming session (null when using batch mode). */
  private streamSession: Chirp3StreamSession | null = null;
  /** Audio converter: WebM/Opus -> LINEAR16 PCM. */
  private audioConverter: AudioConverter | null = null;
  /** Whether streaming mode is active for this pipeline instance. */
  private streamingEnabled = false;
  /**
   * Index counter for final results received via streaming.
   * Used as the chunkIndex equivalent for storeAndBroadcast().
   */
  private streamFinalIndex = 0;
  /**
   * Tracks the recording start time for absolute timestamp calculation.
   * @unused Reserved for future use in timestamp calculations.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private recordingStartTimeMs = 0;
  /**
   * Tracks the resultEndTimeMs of the last final result processed by the pipeline.
   * Used for fallback timestamp calculation in storeAndBroadcast().
   * @unused Reserved for future use in timestamp calculations.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private lastStreamFinalEndTimeMs = 0;

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

    if (this.audioConverter) {
      this.audioConverter.stop();
      this.audioConverter = null;
    }

    if (this.streamSession) {
      this.streamSession.stop();
      this.streamSession = null;
    }

    if (this.chirp3Provider) {
      this.chirp3Provider.closeStreamSession(this.sessionId);
    }
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

    const perfMonitor = new PerformanceMonitor(this.sessionId, chunkIndex);
    perfMonitor.mark('pipeline-entry');

    broadcastToAllWindows("transcription:status", "processing");

    const context = this.buildContext();

    if (
      this.transcriptionBackend === BACKEND_CHIRP3_GEMINI &&
      this.chirp3Provider?.isConfigured()
    ) {
      await this.processWithChirp3(audioData, mimeType, chunkIndex, context, perfMonitor);
    } else {
      await this.processWithGemini(audioData, mimeType, chunkIndex, context, perfMonitor);
    }

    perfMonitor.mark('pipeline-exit');
    perfMonitor.logStage('Total pipeline', 'pipeline-entry', 'pipeline-exit');
  }

  /**
   * Initialize streaming mode. Call this when the session starts,
   * before any audio data arrives.
   *
   * Streaming is activated only when ALL of the following are true:
   * 1. Backend is chirp3+gemini
   * 2. Chirp 3 provider is configured
   * 3. Feature flag ai.chirp3.useStreaming is not "false" (default: enabled)
   */
  initializeStreaming(): void {
    if (
      this.transcriptionBackend !== BACKEND_CHIRP3_GEMINI ||
      !this.chirp3Provider?.isConfigured()
    ) {
      console.log(
        "[Pipeline] Streaming not available (backend or provider not ready), " +
          "falling back to batch mode",
      );
      return;
    }

    // Feature flag: ai.chirp3.useStreaming (default: "true")
    const streamingFlag = getSetting("ai.chirp3.useStreaming");
    if (streamingFlag === "false") {
      console.log(
        "[Pipeline] Streaming disabled by feature flag (ai.chirp3.useStreaming=false), " +
          "using batch mode",
      );
      return;
    }

    this.streamingEnabled = true;
    this.streamFinalIndex = 0;
    this.recordingStartTimeMs = Date.now();
    this.lastStreamFinalEndTimeMs = 0;

    console.log(`[Pipeline] Streaming mode initialized for session ${this.sessionId}`);
  }

  /**
   * Feed raw audio data from the renderer into the streaming pipeline.
   * This replaces processAudioChunk() when streaming is active.
   *
   * @param audioData - WebM/Opus audio chunk from MediaRecorder
   * @param mimeType - MIME type of the audio data
   */
  feedAudioStream(audioData: Buffer, mimeType: string): void {
    if (this.stopped || !this.streamingEnabled) return;

    // Lazy-initialize the converter and stream session on first audio data
    if (!this.audioConverter) {
      this.audioConverter = new AudioConverter();
      this.audioConverter.start(
        mimeType,
        (pcmData: Buffer) => {
          // Forward PCM frames to the Chirp 3 stream
          this.streamSession?.writeAudio(pcmData);
        },
        (err: Error) => {
          console.error("[Pipeline] Audio converter error:", err);
          broadcastToAllWindows("transcription:error", err.message);
        },
      );
    }

    if (!this.streamSession && this.chirp3Provider) {
      const events: Chirp3StreamEvents = {
        onResult: (result: Chirp3StreamResult) => {
          this.handleStreamResult(result);
        },
        onError: (error: Error, isRecoverable: boolean) => {
          console.error(
            `[Pipeline] Stream error (recoverable=${isRecoverable}):`,
            error.message,
          );
          if (!isRecoverable) {
            broadcastToAllWindows("transcription:error", error.message);
            broadcastToAllWindows("transcription:status", "error");
          }
        },
        onClose: (reason) => {
          console.log(`[Pipeline] Stream closed: ${reason}`);
          if (reason === "error") {
            broadcastToAllWindows("transcription:status", "error");
          }
        },
        onReconnecting: (attempt: number) => {
          console.log(`[Pipeline] Stream reconnecting (attempt ${attempt})`);
          broadcastToAllWindows("transcription:status", "reconnecting");
        },
        onReconnected: () => {
          console.log("[Pipeline] Stream reconnected");
          broadcastToAllWindows("transcription:status", "processing");
        },
      };

      this.streamSession = this.chirp3Provider.createStreamSession(
        this.sessionId,
        events,
      );
      broadcastToAllWindows("transcription:status", "processing");
    }

    // Write the WebM chunk into the converter; PCM output goes to stream session
    this.audioConverter.write(audioData);
  }

  /**
   * Handle a streaming result (interim or final).
   */
  private handleStreamResult(result: Chirp3StreamResult): void {
    if (this.stopped) return;

    if (!result.isFinal) {
      // Interim result: broadcast to renderer for live display only.
      // Do NOT store in database or send to Gemini.
      // Channel: "transcription:interimResult" (matches existing camelCase convention)
      broadcastToAllWindows("transcription:interimResult", {
        sessionId: this.sessionId,
        transcript: result.transcript,
        resultEndTimeMs: result.resultEndTimeMs,
        speaker: result.speaker ?? undefined,
        sequence: result.sequence,
        isFinal: false,
      });
      return;
    }

    // Final result: run Stage 2 Gemini analysis, then store and broadcast.
    if (!result.transcript.trim()) {
      // Empty final result (silence segment), skip
      return;
    }

    const chunkIndex = this.streamFinalIndex++;
    this.lastStreamFinalEndTimeMs = result.resultEndTimeMs;
    const context = this.buildContext();

    // Apply confidence filtering
    const filteredWords = this.chirp3Provider
      ? this.chirp3Provider.filterByConfidence(result.words)
      : result.words;
    const filteredTranscript = filteredWords.map((w) => w.word).join(" ");

    // Stage 2: Gemini analysis (async, fire-and-forget with error handling)
    (async () => {
      try {
        broadcastToAllWindows("transcription:status", "processing");

        const analysisResult = await this.callWithRetry(() =>
          this.aiProvider.analyzeTranscript(
            filteredTranscript || result.transcript,
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

        this.storeAndBroadcast(analysisResult, chunkIndex);
        broadcastToAllWindows("transcription:status", "idle");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[Pipeline] Gemini analysis failed for stream final ${chunkIndex}:`,
          message,
        );
        broadcastToAllWindows("transcription:error", message);
        broadcastToAllWindows("transcription:status", "error");
      }
    })();
  }

  /**
   * Check if this pipeline is operating in streaming mode.
   */
  isStreaming(): boolean {
    return this.streamingEnabled;
  }

  // --- Two-Stage Pipeline: Chirp 3 STT → Gemini Analysis ---

  private async processWithChirp3(
    audioData: Buffer,
    mimeType: string,
    chunkIndex: number,
    context: string,
    perfMonitor: PerformanceMonitor,
  ): Promise<void> {
    if (!this.chirp3Provider) {
      throw new Error("Chirp3 provider not available");
    }

    const provider = this.chirp3Provider;

    try {
      // Stage 1: Chirp 3 Speech-to-Text
      perfMonitor.mark('chirp3-stage-start');
      const chirp3Result = await this.callWithRetry(() =>
        provider.recognizeChunk(audioData, mimeType, this.sessionId),
      );
      perfMonitor.mark('chirp3-stage-end');
      perfMonitor.logStage('Chirp3 STT stage', 'chirp3-stage-start', 'chirp3-stage-end');

      if (!chirp3Result.transcript.trim()) {
        console.log(
          `[Pipeline] Chunk ${chunkIndex}: Chirp 3 returned empty transcript (silence)`,
        );
        broadcastToAllWindows("transcription:status", "idle");
        return;
      }

      // Apply confidence filtering
      perfMonitor.mark('confidence-filter-start');
      const filteredWords =
        provider.filterByConfidence(chirp3Result.words);
      const filteredTranscript = filteredWords.map((w) => w.word).join(" ");
      perfMonitor.mark('confidence-filter-end');
      perfMonitor.logStage('Confidence filtering', 'confidence-filter-start', 'confidence-filter-end');

      // Stage 2: Gemini analysis of text
      perfMonitor.mark('gemini-analysis-start');
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
      perfMonitor.mark('gemini-analysis-end');
      perfMonitor.logStage('Gemini analysis stage', 'gemini-analysis-start', 'gemini-analysis-end');

      perfMonitor.mark('storage-start');
      this.storeAndBroadcast(result, chunkIndex);
      perfMonitor.mark('storage-end');
      perfMonitor.logStage('Storage and broadcast', 'storage-start', 'storage-end');

      broadcastToAllWindows("transcription:status", "idle");
    } catch (err) {
      // If Chirp 3 fails, attempt fallback to Gemini multimodal
      console.warn(
        `[Pipeline] Chirp 3 failed for chunk ${chunkIndex}, falling back to Gemini multimodal:`,
        err,
      );
      broadcastToAllWindows("transcription:status", "chirp3-fallback");
      await this.processWithGemini(audioData, mimeType, chunkIndex, context, perfMonitor);
    }
  }

  // --- Single-Stage Pipeline: Gemini Multimodal (existing behavior) ---

  private async processWithGemini(
    audioData: Buffer,
    mimeType: string,
    chunkIndex: number,
    context: string,
    perfMonitor: PerformanceMonitor,
  ): Promise<void> {
    let result: TranscriptionResult;
    try {
      perfMonitor.mark('gemini-multimodal-start');
      result = await this.callWithRetry(() =>
        this.aiProvider.transcribeAudio(audioData, mimeType, {
          meetingContext: context,
          attendees: Array.from(this.knownSpeakers),
        }),
      );
      perfMonitor.mark('gemini-multimodal-end');
      perfMonitor.logStage('Gemini multimodal transcription', 'gemini-multimodal-start', 'gemini-multimodal-end');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      broadcastToAllWindows("transcription:error", message);
      broadcastToAllWindows("transcription:status", "error");
      return;
    }

    perfMonitor.mark('storage-start');
    this.storeAndBroadcast(result, chunkIndex);
    perfMonitor.mark('storage-end');
    perfMonitor.logStage('Storage and broadcast', 'storage-start', 'storage-end');

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
        const lower = message.toLowerCase();
        const nonRetryable =
          lower.includes("api key error") ||
          lower.includes("not configured") ||
          lower.includes("model not found") ||
          lower.includes("not found") ||
          lower.includes("invalid model") ||
          lower.includes("content too large") ||
          lower.includes("quota exceeded");
        if (nonRetryable) {
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
