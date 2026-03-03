export interface GCPCredentials {
  type: "api-key" | "service-account";
  apiKey?: string;
  serviceAccountJson?: string;
}

export interface Chirp3Config {
  credentials: GCPCredentials;
  /** GCP project ID. Required for V2 streaming API. */
  projectId?: string;
  location?: string;
  languageCode?: string;
  model?: string;
  confidenceThreshold?: number;
}

export interface Chirp3Word {
  word: string;
  startTime: number;
  endTime: number;
  confidence: number;
  speakerTag?: number;
}

export interface Chirp3Result {
  transcript: string;
  words: Chirp3Word[];
  confidence: number;
  languageCode: string;
  isFinal: boolean;
}

/** Configuration for a streaming session. */
export interface Chirp3StreamConfig {
  /** Audio encoding. For streaming, LINEAR16 (raw PCM) is required. */
  encoding: "LINEAR16";
  /** Sample rate in Hz. Must match the audio source. */
  sampleRateHertz: number;
  /** Number of audio channels (1 = mono). */
  audioChannelCount: number;
  /** Enable interim (partial) results for live UI feedback. */
  interimResults: boolean;
  /** Enable word-level time offsets in final results. */
  enableWordTimeOffsets: boolean;
  /** Enable word-level confidence scores in final results. */
  enableWordConfidence: boolean;
  /** Enable automatic punctuation in transcripts. */
  enableAutomaticPunctuation: boolean;
}

/** Emitted for both interim and final streaming results. */
export interface Chirp3StreamResult {
  /** The transcribed text (partial for interim, complete for final). */
  transcript: string;
  /** Word-level details. Only populated for final results. */
  words: Chirp3Word[];
  /** Average confidence across words. 0 for interim results. */
  confidence: number;
  /** The language detected or configured. */
  languageCode: string;
  /** Whether this is a final (stable) result or an interim (partial) one. */
  isFinal: boolean;
  /**
   * Timestamp (ms from stream start) where this result's audio ends.
   * Used for stream reconnection to calculate overlap/bridging offset
   * and for fallback timestamp calculation in storeAndBroadcast().
   */
  resultEndTimeMs: number;
  /** Speaker label, if available from the recognition result. */
  speaker?: string;
  /** Monotonically increasing sequence number for ordering results within a session. */
  sequence: number;
}

/** Events emitted by the streaming session. */
export interface Chirp3StreamEvents {
  /** Fired for every interim or final result from the API. */
  onResult: (result: Chirp3StreamResult) => void;
  /** Fired when the stream encounters an error. */
  onError: (error: Error, isRecoverable: boolean) => void;
  /** Fired when the stream is closed (intentionally or due to timeout). */
  onClose: (reason: "manual" | "timeout" | "error") => void;
  /** Fired when a stream reconnection starts. */
  onReconnecting: (attempt: number) => void;
  /** Fired when a stream reconnection succeeds (stream is open and accepting audio). */
  onReconnected: () => void;
}
