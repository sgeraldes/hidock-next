import type {
  Chirp3Config,
  Chirp3StreamConfig,
  Chirp3StreamResult,
  Chirp3StreamEvents,
  Chirp3Word,
} from "./chirp3-provider.types";

/**
 * Google enforces a ~305-second streaming limit. We proactively restart
 * at 270 seconds to allow overlap bridging before the hard cutoff.
 */
const STREAM_DURATION_LIMIT_MS = 270_000;

/** Maximum number of consecutive reconnection attempts before giving up. */
const MAX_RECONNECT_ATTEMPTS = 5;

/** Delay between reconnection attempts (doubles each time). */
const RECONNECT_BASE_DELAY_MS = 500;

/**
 * Size of the audio ring buffer (in bytes). At 16kHz mono LINEAR16 (3200 bytes/100ms),
 * 5 seconds of audio = 160,000 bytes. We keep the last 5 seconds so that on
 * reconnect we can replay a brief overlap to avoid losing words at the boundary.
 */
const AUDIO_RING_BUFFER_SECONDS = 5;

/** Maximum concurrent streaming sessions per Chirp3Provider instance. */
export const MAX_CONCURRENT_STREAMS = 2;

/**
 * Manages a single streaming recognition session with Google Cloud
 * Speech-to-Text **V2 API**.
 *
 * Architecture:
 * - Uses an async generator to yield requests to `client.streamingRecognize()`.
 * - The first yielded request is the config (recognizer path + StreamingRecognitionConfig).
 * - Subsequent yields are audio chunks (raw LINEAR16 PCM bytes).
 * - Responses arrive as an async iterable; a consumer loop reads them.
 *
 * Responsibilities:
 * - Opens a V2 gRPC bidirectional stream via async generator pattern
 * - Accepts raw LINEAR16 PCM audio frames via `writeAudio()`
 * - Emits interim and final results via event callbacks
 * - Automatically reconnects when the ~5-minute stream limit is reached
 * - Maintains a ring buffer of recent audio for seamless reconnection overlap
 * - Deduplicates results from overlap replay using resultEndTimeMs tracking
 */
export class Chirp3StreamSession {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any;
  private config: Chirp3Config;
  private streamConfig: Chirp3StreamConfig;
  private events: Chirp3StreamEvents;

  /**
   * The audio queue feeds the async generator that drives the V2 stream.
   * `writeAudio()` pushes buffers here; the generator yields them as requests.
   * A `null` sentinel signals the generator to stop (half-close).
   */
  private audioQueue: (Buffer | null)[] = [];
  private audioQueueResolve: (() => void) | null = null;

  /** AbortController to cancel the response consumer loop on stop/restart. */
  private abortController: AbortController | null = null;

  private streamStartTime = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private stopped = false;

  /** Ring buffer of recent audio for overlap on reconnect. */
  private audioRingBuffer: Buffer[] = [];
  private audioRingBufferBytes = 0;
  private audioRingBufferMaxBytes: number;

  /** Tracks the end time of the last final result for deduplication and bridging. */
  private lastFinalResultEndTimeMs = 0;

  /** Cumulative time offset across stream restarts. */
  private streamTimeOffsetMs = 0;

  /** Total audio bytes written to the current stream (for debugging). */
  private bytesWrittenToCurrentStream = 0;

  /** Monotonically increasing sequence counter for results. */
  private sequenceCounter = 0;

  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: any,
    config: Chirp3Config,
    streamConfig: Chirp3StreamConfig,
    events: Chirp3StreamEvents,
  ) {
    this.client = client;
    this.config = config;
    this.streamConfig = streamConfig;
    this.events = events;

    // Calculate ring buffer size: sampleRate * channels * 2 bytes * seconds
    this.audioRingBufferMaxBytes =
      streamConfig.sampleRateHertz *
      streamConfig.audioChannelCount *
      2 * // 16-bit = 2 bytes per sample
      AUDIO_RING_BUFFER_SECONDS;
  }

  /**
   * Start the streaming session. Opens the V2 gRPC stream and begins
   * accepting audio data via writeAudio().
   */
  start(): void {
    if (this.stopped) return;
    this.openStream();
  }

  /**
   * Write a chunk of raw LINEAR16 PCM audio to the stream.
   * Audio should be provided in small frames (~100ms = 3200 bytes at 16kHz mono).
   */
  writeAudio(audioData: Buffer): void {
    if (this.stopped) return;

    // Append to ring buffer (trim to max size)
    this.audioRingBuffer.push(audioData);
    this.audioRingBufferBytes += audioData.length;
    while (this.audioRingBufferBytes > this.audioRingBufferMaxBytes) {
      const removed = this.audioRingBuffer.shift();
      if (removed) this.audioRingBufferBytes -= removed.length;
    }

    // Push to the async generator queue
    this.audioQueue.push(audioData);
    this.bytesWrittenToCurrentStream += audioData.length;

    // Wake up the generator if it is waiting for data
    if (this.audioQueueResolve) {
      this.audioQueueResolve();
      this.audioQueueResolve = null;
    }
  }

  /**
   * Gracefully stop the streaming session. Sends a sentinel to the
   * generator so the server can flush any pending finals.
   */
  stop(): void {
    this.stopped = true;

    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    // Signal the generator to stop (half-close the write side)
    this.audioQueue.push(null);
    if (this.audioQueueResolve) {
      this.audioQueueResolve();
      this.audioQueueResolve = null;
    }

    // Cancel the response consumer loop
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    this.events.onClose("manual");
  }

  /** Returns true if the session has been stopped. */
  isStopped(): boolean {
    return this.stopped;
  }

  /** Returns the last final result end time (for deduplication by the pipeline). */
  getLastFinalResultEndTimeMs(): number {
    return this.lastFinalResultEndTimeMs;
  }

  // --- Private: Stream lifecycle ---

  private openStream(): void {
    if (this.stopped) return;

    const projectId = this.config.projectId;
    const location = this.config.location ?? "us-central1";

    if (!projectId) {
      const err = new Error(
        "Chirp3Provider: projectId is required for V2 streaming. " +
          "Set it in Settings > Chirp 3 > GCP Project ID.",
      );
      this.events.onError(err, false);
      this.events.onClose("error");
      this.stopped = true;
      return;
    }

    // Reset the audio queue for the new stream
    this.audioQueue = [];
    this.audioQueueResolve = null;
    this.abortController = new AbortController();

    // Build the V2 config request (first message in the stream)
    const configRequest = {
      recognizer: `projects/${projectId}/locations/${location}/recognizers/_`,
      streamingConfig: {
        config: {
          explicitDecodingConfig: {
            encoding: "LINEAR16",
            sampleRateHertz: this.streamConfig.sampleRateHertz,
            audioChannelCount: this.streamConfig.audioChannelCount,
          },
          languageCodes: [this.config.languageCode ?? "en-US"],
          model: this.config.model ?? "chirp_2",
          features: {
            enableWordTimeOffsets: this.streamConfig.enableWordTimeOffsets,
            enableWordConfidence: this.streamConfig.enableWordConfidence,
            enableAutomaticPunctuation: this.streamConfig.enableAutomaticPunctuation,
          },
        },
        streamingFeatures: {
          interimResults: this.streamConfig.interimResults,
        },
      },
    };

    // Create the async generator that yields config first, then audio chunks
    const self = this;
    async function* requestGenerator() {
      // First yield: config request (no audio)
      yield configRequest;

      // Subsequent yields: audio chunks from the queue
      while (true) {
        if (self.audioQueue.length === 0) {
          // Wait for data to arrive
          await new Promise<void>((resolve) => {
            self.audioQueueResolve = resolve;
          });
        }

        while (self.audioQueue.length > 0) {
          const chunk = self.audioQueue.shift();
          if (chunk === null) {
            // Sentinel: half-close the stream
            return;
          }
          yield { audio: chunk };
        }
      }
    }

    // Start the V2 streaming call
    this.streamStartTime = Date.now();
    this.bytesWrittenToCurrentStream = 0;

    // The V2 client.streamingRecognize() accepts an async iterable of requests
    // and returns an async iterable of responses.
    let responseStream: AsyncIterable<unknown>;
    try {
      responseStream = this.client.streamingRecognize(requestGenerator());
    } catch (err) {
      console.error("[Chirp3Stream] Failed to open V2 stream:", err);
      this.events.onError(
        err instanceof Error ? err : new Error(String(err)),
        true,
      );
      this.scheduleReconnect();
      return;
    }

    // Schedule proactive restart before Google's hard limit
    this.restartTimer = setTimeout(() => {
      console.log(
        `[Chirp3Stream] Proactive restart after ${STREAM_DURATION_LIMIT_MS}ms`,
      );
      this.restartStream();
    }, STREAM_DURATION_LIMIT_MS);

    console.log(
      `[Chirp3Stream] V2 stream opened (offset: ${this.streamTimeOffsetMs}ms, ` +
        `reconnect attempt: ${this.reconnectAttempts})`,
    );

    // Consume responses in a background async loop
    this.consumeResponses(responseStream);
  }

  /**
   * Background loop that reads responses from the V2 async iterable.
   * Runs until the stream ends, errors, or is aborted by stop()/restart.
   */
  private async consumeResponses(
    responseStream: AsyncIterable<unknown>,
  ): Promise<void> {
    try {
      for await (const response of responseStream) {
        if (this.stopped || this.abortController?.signal.aborted) break;
        this.handleStreamData(response);
      }

      // Stream ended naturally
      if (!this.stopped) {
        console.log("[Chirp3Stream] V2 stream ended by server, will reconnect");
        this.scheduleReconnect();
      }
    } catch (err) {
      if (this.stopped || this.abortController?.signal.aborted) return;
      this.handleStreamError(
        err instanceof Error ? (err as Error & { code?: number }) : new Error(String(err)),
      );
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleStreamData(response: any): void {
    const results = response?.results;
    if (!results || results.length === 0) return;

    const result = results[0];
    if (!result.alternatives || result.alternatives.length === 0) return;

    const alt = result.alternatives[0];
    const isFinal = result.isFinal === true;

    // V2 uses `resultEndOffset` (string Duration, e.g. "3.5s") instead of V1's
    // `resultEndTime` (proto Duration with seconds/nanos fields).
    const resultEndTimeMs = this.parseV2Duration(result.resultEndOffset);
    const adjustedEndTimeMs = resultEndTimeMs + this.streamTimeOffsetMs;

    // Deduplication: skip results from overlap replay that we already processed
    if (isFinal && adjustedEndTimeMs <= this.lastFinalResultEndTimeMs) {
      console.log(
        `[Chirp3Stream] Skipping duplicate final result ` +
          `(endTime=${adjustedEndTimeMs}ms <= last=${this.lastFinalResultEndTimeMs}ms)`,
      );
      return;
    }

    const words: Chirp3Word[] = [];
    let totalConfidence = 0;

    if (isFinal && alt.words) {
      for (const w of alt.words) {
        const word: Chirp3Word = {
          word: w.word ?? "",
          startTime: this.parseV2Duration(w.startOffset) / 1000 +
            this.streamTimeOffsetMs / 1000,
          endTime: this.parseV2Duration(w.endOffset) / 1000 +
            this.streamTimeOffsetMs / 1000,
          confidence: w.confidence ?? 0,
          speakerTag: w.speakerTag,
        };
        words.push(word);
        totalConfidence += word.confidence;
      }
    }

    const streamResult: Chirp3StreamResult = {
      transcript: alt.transcript ?? "",
      words,
      confidence: words.length > 0 ? totalConfidence / words.length : 0,
      languageCode: result.languageCode ?? this.config.languageCode ?? "en-US",
      isFinal,
      resultEndTimeMs: adjustedEndTimeMs,
      speaker: undefined, // V2 diarization not enabled in this config; Gemini handles speaker ID
      sequence: this.sequenceCounter++,
    };

    if (isFinal) {
      this.lastFinalResultEndTimeMs = adjustedEndTimeMs;
      // Reset reconnect counter on successful final result
      this.reconnectAttempts = 0;
    }

    this.events.onResult(streamResult);
  }

  private handleStreamError(err: Error & { code?: number }): void {
    // Error code 11 = OUT_OF_RANGE (stream time limit exceeded) -- recoverable
    // Error code 4 = DEADLINE_EXCEEDED -- recoverable
    // Error code 14 = UNAVAILABLE -- recoverable (transient)
    const recoverableCodes = [4, 11, 14];
    const isRecoverable = recoverableCodes.includes(err.code ?? -1);

    console.error(
      `[Chirp3Stream] V2 stream error (code=${err.code}, recoverable=${isRecoverable}):`,
      err.message,
    );

    this.events.onError(err, isRecoverable);

    if (isRecoverable && !this.stopped) {
      this.scheduleReconnect();
    } else if (!isRecoverable) {
      this.stop();
    }
  }

  /**
   * Proactive restart: close current stream and open a new one.
   * Replays buffered audio to maintain continuity.
   */
  private restartStream(): void {
    if (this.stopped) return;

    // Update time offset for the new stream
    this.streamTimeOffsetMs += Date.now() - this.streamStartTime;

    // Close old stream
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    // Signal the old generator to stop
    this.audioQueue.push(null);
    if (this.audioQueueResolve) {
      this.audioQueueResolve();
      this.audioQueueResolve = null;
    }

    // Cancel old response consumer
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    // Open new stream (resets audioQueue)
    this.openStream();

    // Replay ring buffer into new stream for seamless bridging
    if (this.audioRingBuffer.length > 0) {
      console.log(
        `[Chirp3Stream] Replaying ${this.audioRingBuffer.length} buffered frames ` +
          `(${this.audioRingBufferBytes} bytes) into new stream`,
      );
      for (const frame of this.audioRingBuffer) {
        // Push directly to the queue (not via writeAudio, to avoid double-buffering)
        this.audioQueue.push(frame);
      }
      // Wake the generator
      if (this.audioQueueResolve) {
        this.audioQueueResolve();
        this.audioQueueResolve = null;
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error(
        `[Chirp3Stream] Max reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`,
      );
      this.events.onError(
        new Error("Max stream reconnection attempts exceeded"),
        false,
      );
      this.events.onClose("error");
      this.stopped = true;
      return;
    }

    const delay = RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;

    console.log(
      `[Chirp3Stream] Scheduling reconnect attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} ` +
        `in ${delay}ms`,
    );
    this.events.onReconnecting(this.reconnectAttempts);

    setTimeout(() => {
      if (this.stopped) return;

      this.restartStream();

      // Only emit onReconnected if the stream actually opened successfully
      // (openStream sets streamStartTime; if it failed, it would have called
      // scheduleReconnect again or stopped, so reaching here means success)
      if (!this.stopped) {
        this.events.onReconnected();
      }
    }, delay);
  }

  /**
   * Parse a V2 Duration string (e.g., "3.5s", "120s", "0.123456789s") to milliseconds.
   * The V2 API returns `resultEndOffset` and word offsets as string Durations,
   * unlike V1 which uses proto Duration objects with seconds/nanos fields.
   */
  private parseV2Duration(duration: string | undefined | null): number {
    if (!duration) return 0;
    // V2 format: "123.456s" or "123s"
    const match = String(duration).match(/^(\d+(?:\.\d+)?)s$/);
    if (!match) return 0;
    return parseFloat(match[1]) * 1000;
  }
}
