import * as fs from "fs";
import * as path from "path";
import type {
  Chirp3Config,
  Chirp3Result,
  Chirp3Word,
  Chirp3StreamConfig,
  Chirp3StreamEvents,
} from "./chirp3-provider.types";
import { getSetting } from "./database-extras";
import { Chirp3StreamSession, MAX_CONCURRENT_STREAMS } from "./chirp3-stream-session";

/** Factory type for creating SpeechClient instances (enables testing). */
export type SpeechClientFactory = () => { SpeechClient: new (opts?: unknown) => unknown };

/** Factory type for the V2 client (includes v2.SpeechClient). */
export type V2SpeechClientFactory = () => { SpeechClient: new (opts?: unknown) => unknown };

/**
 * Wraps Google Cloud Speech-to-Text with Chirp 3 (chirp_2 model ID)
 * for high-accuracy speech recognition. Each 3-second audio chunk
 * is sent as an individual `recognize()` request.
 *
 * Note: Google's model ID is "chirp_2" but the product is marketed as
 * "Chirp 3" / "Chirp Universal". We use "Chirp 3" in our UI/docs.
 */
export class Chirp3Provider {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private v2Client: any = null;
  private languageCode = "en-US";
  private model = "chirp_2";
  private confidenceThreshold = 0.7;
  private configured = false;
  private speechClientFactory: SpeechClientFactory;
  private config: Chirp3Config | null = null;

  /** Active streaming sessions keyed by session ID. */
  private streamSessions = new Map<string, Chirp3StreamSession>();

  constructor(speechClientFactory?: SpeechClientFactory) {
    this.speechClientFactory = speechClientFactory ?? requireSpeechModule;
  }

  configure(config: Chirp3Config): void {
    this.config = config;
    const { SpeechClient } = this.speechClientFactory();

    const clientOptions: Record<string, unknown> = {};

    // Set API endpoint based on location (regional endpoints improve latency)
    const location = config.location ?? "global";
    if (location !== "global") {
      clientOptions.apiEndpoint = `${location}-speech.googleapis.com`;
    }

    if (config.credentials.type === "api-key" && config.credentials.apiKey) {
      clientOptions.apiKey = config.credentials.apiKey;
    } else if (
      config.credentials.type === "service-account" &&
      config.credentials.serviceAccountJson
    ) {
      try {
        clientOptions.credentials = JSON.parse(
          config.credentials.serviceAccountJson,
        );
      } catch {
        throw new Error(
          "Invalid service account JSON. Please provide valid JSON credentials.",
        );
      }
    } else {
      throw new Error(
        "No valid credentials provided. Supply an API key or service account JSON.",
      );
    }

    this.client = new SpeechClient(clientOptions);
    this.languageCode = config.languageCode ?? "en-US";
    this.model = config.model ?? "chirp_2";
    this.confidenceThreshold = config.confidenceThreshold ?? 0.7;
    this.configured = true;
  }

  isConfigured(): boolean {
    return this.configured && this.client !== null;
  }

  async recognizeChunk(
    audioData: Buffer,
    mimeType: string,
    sessionId?: string,
  ): Promise<Chirp3Result> {
    if (!this.client || !this.configured) {
      throw new Error("Chirp3Provider not configured");
    }

    const encoding = this.mapEncoding(mimeType);

    const request = {
      audio: { content: audioData.toString("base64") },
      config: {
        encoding,
        // Omit sampleRateHertz for OGG_OPUS — the API auto-detects from the container
        ...(encoding !== "OGG_OPUS" && { sampleRateHertz: 16000 }),
        languageCode: this.languageCode,
        model: this.model,
        enableWordTimeOffsets: true,
        enableWordConfidence: true,
        enableAutomaticPunctuation: true,
      },
    };

    // Performance monitoring: measure API call time
    const apiStartTime = performance.now();
    const [response] = await this.client.recognize(request);
    const apiEndTime = performance.now();

    // Log timing if QA is enabled and we have a session ID
    if (sessionId) {
      const qaEnabled = getSetting('ui.qaLogsEnabled') === 'true';
      if (qaEnabled) {
        const duration = apiEndTime - apiStartTime;
        console.log(
          `[QA-MONITOR] [Perf] Chirp3 API call: ${duration.toFixed(1)}ms (session: ${sessionId})`
        );
      }
    }

    return this.mapResponse(response);
  }

  async recognizeBatch(audioPath: string): Promise<Chirp3Result> {
    if (!this.client || !this.configured) {
      throw new Error("Chirp3Provider not configured");
    }

    const audioData = await fs.promises.readFile(audioPath);
    const ext = path.extname(audioPath).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".ogg": "audio/ogg",
      ".webm": "audio/webm",
      ".wav": "audio/wav",
      ".flac": "audio/flac",
    };

    return this.recognizeChunk(audioData, mimeMap[ext] ?? "audio/ogg");
  }

  filterByConfidence(
    words: Chirp3Word[],
    threshold?: number,
  ): Chirp3Word[] {
    const t = threshold ?? this.confidenceThreshold;
    const filtered = words.filter((w) => w.confidence >= t);

    // Log filtering statistics if QA logs are enabled
    this.logFilteringStats(words, filtered, t);

    return filtered;
  }

  buildFilteredTranscript(
    words: Chirp3Word[],
    threshold?: number,
  ): string {
    const t = threshold ?? this.confidenceThreshold;
    return words
      .map((w) => (w.confidence >= t ? w.word : "[...]"))
      .join(" ")
      .replace(/\s*\[\.\.\.\]\s*(\[\.\.\.\]\s*)*/g, " [...] ")
      .trim();
  }

  getConfidenceThreshold(): number {
    return this.confidenceThreshold;
  }

  /**
   * Create and start a new streaming recognition session.
   * Audio frames are written via the returned session's writeAudio() method.
   *
   * @param sessionId - Unique identifier for this recording session
   * @param events - Callbacks for results, errors, and lifecycle events
   * @param streamConfig - Optional override for stream configuration
   * @returns The created Chirp3StreamSession
   * @throws If sessionId already has an active (non-stopped) session
   * @throws If MAX_CONCURRENT_STREAMS limit is reached
   * @throws If projectId is not configured (required for V2 API)
   */
  createStreamSession(
    sessionId: string,
    events: Chirp3StreamEvents,
    streamConfig?: Partial<Chirp3StreamConfig>,
  ): Chirp3StreamSession {
    if (!this.client || !this.configured) {
      throw new Error("Chirp3Provider not configured");
    }

    // Reject duplicate: if an active session exists for this sessionId, throw
    const existing = this.streamSessions.get(sessionId);
    if (existing && !existing.isStopped()) {
      throw new Error(
        `Streaming session already active for sessionId "${sessionId}". ` +
          `Call closeStreamSession() first.`,
      );
    }

    // Clean up stopped session if present
    if (existing) {
      this.streamSessions.delete(sessionId);
    }

    // Enforce concurrent session limit
    const activeSessions = [...this.streamSessions.values()].filter(
      (s) => !s.isStopped(),
    );
    if (activeSessions.length >= MAX_CONCURRENT_STREAMS) {
      throw new Error(
        `Maximum concurrent streaming sessions (${MAX_CONCURRENT_STREAMS}) reached. ` +
          `Close an existing session before creating a new one.`,
      );
    }

    // Validate projectId (required for V2 recognizer resource path)
    if (!this.config?.projectId) {
      throw new Error(
        "Chirp3Provider: projectId is required for streaming (V2 API). " +
          "Configure it in Settings > Chirp 3 > GCP Project ID.",
      );
    }

    const v2Client = this.getOrCreateV2Client();

    const config: Chirp3StreamConfig = {
      encoding: "LINEAR16",
      sampleRateHertz: 16000,
      audioChannelCount: 1,
      interimResults: true,
      enableWordTimeOffsets: true,
      enableWordConfidence: true,
      enableAutomaticPunctuation: true,
      ...streamConfig,
    };

    const session = new Chirp3StreamSession(
      v2Client,
      {
        credentials: { type: "api-key" }, // not used by session, client is already configured
        projectId: this.config.projectId,
        location: this.config.location ?? "us-central1",
        languageCode: this.languageCode,
        model: this.model,
        confidenceThreshold: this.confidenceThreshold,
      },
      config,
      events,
    );

    this.streamSessions.set(sessionId, session);
    session.start();

    console.log(
      `[Chirp3Provider] V2 streaming session created for ${sessionId} ` +
        `(active sessions: ${activeSessions.length + 1}/${MAX_CONCURRENT_STREAMS})`,
    );
    return session;
  }

  /**
   * Get the active streaming session for a given session ID.
   */
  getStreamSession(sessionId: string): Chirp3StreamSession | undefined {
    return this.streamSessions.get(sessionId);
  }

  /**
   * Close and clean up a streaming session.
   */
  closeStreamSession(sessionId: string): void {
    const session = this.streamSessions.get(sessionId);
    if (session) {
      session.stop();
      this.streamSessions.delete(sessionId);
      console.log(
        `[Chirp3Provider] Streaming session closed for ${sessionId}`,
      );
    }
  }

  dispose(): void {
    for (const [sessionId] of this.streamSessions) {
      this.closeStreamSession(sessionId);
    }

    if (this.v2Client) {
      try {
        this.v2Client.close();
      } catch {
        /* ignore close errors */
      }
      this.v2Client = null;
    }

    if (this.client) {
      try {
        this.client.close();
      } catch {
        /* ignore close errors */
      }
    }
    this.client = null;
    this.configured = false;
  }

  // --- Private helpers ---

  /**
   * Lazy-initialize the V2 SpeechClient for streaming.
   * The V2 client uses a regional endpoint and the same credentials as the V1 client.
   */
  private getOrCreateV2Client(): unknown {
    if (this.v2Client) return this.v2Client;

    const speechModule = this.speechClientFactory();
    // Access the V2 SpeechClient: require('@google-cloud/speech').v2.SpeechClient
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v2 = (speechModule as any).v2;
    if (!v2?.SpeechClient) {
      throw new Error(
        "@google-cloud/speech v2 API not available. Ensure version >= 6.0.0 is installed.",
      );
    }

    // V2 requires a regional endpoint (not "global")
    const location = this.config?.location ?? "us-central1";
    const clientOptions: Record<string, unknown> = {
      apiEndpoint: `${location}-speech.googleapis.com`,
    };

    // Reuse the same credentials as the V1 client
    if (this.config?.credentials.type === "api-key" && this.config.credentials.apiKey) {
      clientOptions.apiKey = this.config.credentials.apiKey;
    } else if (
      this.config?.credentials.type === "service-account" &&
      this.config.credentials.serviceAccountJson
    ) {
      clientOptions.credentials = JSON.parse(this.config.credentials.serviceAccountJson);
    }

    this.v2Client = new v2.SpeechClient(clientOptions);
    return this.v2Client;
  }

  private logFilteringStats(
    allWords: Chirp3Word[],
    filteredWords: Chirp3Word[],
    threshold: number,
  ): void {
    const qaEnabled = getSetting("ui.qaLogsEnabled") === "true";
    if (!qaEnabled) return;

    const totalWords = allWords.length;
    const keptWords = filteredWords.length;
    const removedWords = totalWords - keptWords;
    const removedPercentage =
      totalWords > 0 ? ((removedWords / totalWords) * 100).toFixed(1) : "0.0";

    const stats = this.calculateConfidenceStats(filteredWords);

    console.log(
      `[QA-MONITOR] Chirp3 confidence filtering: ${totalWords} words → ${keptWords} kept, ` +
        `${removedWords} removed (${removedPercentage}%), ` +
        `threshold=${(threshold * 100).toFixed(0)}%, ` +
        `min=${(stats.min * 100).toFixed(0)}% max=${(stats.max * 100).toFixed(0)}% mean=${(stats.mean * 100).toFixed(0)}%`,
    );
  }

  private calculateConfidenceStats(words: Chirp3Word[]): {
    min: number;
    max: number;
    mean: number;
  } {
    if (words.length === 0) {
      return { min: 0, max: 0, mean: 0 };
    }

    const confidences = words.map((w) => w.confidence);
    const min = Math.min(...confidences);
    const max = Math.max(...confidences);
    const mean = confidences.reduce((sum, c) => sum + c, 0) / confidences.length;

    return { min, max, mean };
  }

  private mapEncoding(mimeType: string): string {
    const base = mimeType.split(";")[0].trim();
    const encodingMap: Record<string, string> = {
      "audio/ogg": "OGG_OPUS",
      "audio/webm": "WEBM_OPUS",
      "audio/wav": "LINEAR16",
      "audio/flac": "FLAC",
    };
    return encodingMap[base] ?? "OGG_OPUS";
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private mapResponse(response: any): Chirp3Result {
    const results = response?.results ?? [];
    let transcript = "";
    const words: Chirp3Word[] = [];
    let totalConfidence = 0;
    let confidenceCount = 0;

    for (const result of results) {
      if (!result.alternatives?.length) continue;
      const alt = result.alternatives[0];
      transcript += (transcript ? " " : "") + (alt.transcript ?? "");

      if (alt.words) {
        for (const w of alt.words) {
          const word: Chirp3Word = {
            word: w.word ?? "",
            startTime: this.durationToSeconds(w.startTime),
            endTime: this.durationToSeconds(w.endTime),
            confidence: w.confidence ?? 0,
            speakerTag: w.speakerTag,
          };
          words.push(word);
          totalConfidence += word.confidence;
          confidenceCount++;
        }
      }
    }

    return {
      transcript: transcript.trim(),
      words,
      confidence: confidenceCount > 0 ? totalConfidence / confidenceCount : 0,
      languageCode: this.languageCode,
      isFinal: true,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private durationToSeconds(duration: any): number {
    if (!duration) return 0;
    const seconds = Number(duration.seconds ?? 0);
    const nanos = Number(duration.nanos ?? 0);
    return seconds + nanos / 1e9;
  }
}

/**
 * Lazy-load @google-cloud/speech to avoid import errors when not installed.
 * This lets the app start normally even without the dependency.
 */
function requireSpeechModule(): { SpeechClient: new (opts?: unknown) => unknown } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("@google-cloud/speech");
  } catch {
    throw new Error(
      "@google-cloud/speech is not installed. Run: npm install @google-cloud/speech",
    );
  }
}
