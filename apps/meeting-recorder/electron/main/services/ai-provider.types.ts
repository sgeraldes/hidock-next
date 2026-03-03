export type AIProviderKey =
  | "google"
  | "openai"
  | "anthropic"
  | "bedrock"
  | "ollama";

export interface AIProviderConfig {
  provider: AIProviderKey;
  model: string;
  apiKey?: string;
  ollamaBaseUrl?: string;
  bedrockRegion?: string;
  bedrockAccessKeyId?: string;
  bedrockSecretAccessKey?: string;
  bedrockSessionToken?: string;
  /** Secondary provider used for audio transcription when main provider is text-only. */
  transcriptionProvider?: "google";
  /** API key for the secondary transcription provider. */
  transcriptionApiKey?: string;
  /** Model to use for transcription fallback (from config). */
  transcriptionModel?: string;
}

export interface TranscriptionSegment {
  speaker: string;
  text: string;
  startMs?: number;
  endMs?: number;
  sentiment?: string;
  language?: string;
}

export interface TranscriptionResult {
  segments: TranscriptionSegment[];
  topics: string[];
  actionItems: Array<{ text: string; assignee?: string }>;
}

export interface SummarizationResult {
  summary: string;
  keyPoints: string[];
}

export interface TranslationResult {
  translatedSegments: Array<{
    originalText: string;
    translatedText: string;
    targetLanguage: string;
  }>;
}

export interface EndOfMeetingResult {
  title: string;
  summary: string;
  keyTopics: string[];
  actionItems: Array<{ text: string; assignee?: string; dueDate?: string }>;
  sentiment: string;
  duration?: string;
}

// REMOVED: AUDIO_CAPABLE_PROVIDERS constant -- now served by modelConfig.isAudioCapable()
// REMOVED: DEFAULT_MODELS constant -- now served by ModelConfigService (models.config.json)
// See: electron/main/config/models.config.json for the single source of truth.

