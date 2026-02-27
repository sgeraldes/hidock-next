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

export const AUDIO_CAPABLE_PROVIDERS: AIProviderKey[] = ["google"];

export const DEFAULT_MODELS: Record<AIProviderKey, string> = {
  google: "gemini-2.0-flash",
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-20250514",
  bedrock: "anthropic.claude-sonnet-4-20250514-v1:0",
  ollama: "llama3.2",
};
