/**
 * Domain model interfaces used in the renderer process.
 * These mirror the database types defined in electron/main/services/database-types.ts
 * and the in-memory types from the service layer (e.g. session-manager.ts).
 */

// ── Session ───────────────────────────────────────────────────────────────────

export type SessionStatus = "recording" | "processing" | "completed";

/**
 * A recording session. The shape returned by the session IPC handlers
 * matches the SessionManager's in-memory Session (camelCase fields).
 */
export interface Session {
  id: string;
  title: string;
  startedAt: number;
  endedAt: number | null;
  status: SessionStatus;
  meetingId: string | null;
  audioPath: string | null;
  transcriptPath: string | null;
}

// ── Meeting ───────────────────────────────────────────────────────────────────

export interface Meeting {
  id: string;
  title: string | null;
  start_time: number;
  end_time: number | null;
  attendees: string | null;
  location: string | null;
  agenda: string | null;
  calendar_source: string | null;
}

// ── Transcript ────────────────────────────────────────────────────────────────

export type TranscriptSource = "mic" | "system";

export interface TranscriptSegment {
  id: number;
  session_id: string;
  speaker: string | null;
  text: string;
  start_time: number;
  end_time: number;
  confidence: number | null;
  source: TranscriptSource;
}

export interface TranscriptStatus {
  recording: boolean;
  source?: TranscriptSource;
  error?: string;
}

// ── Suggestion ────────────────────────────────────────────────────────────────

export interface Suggestion {
  id: string;
  text: string;
  source: "knowledge" | "context";
  createdAt: number;
  dismissed: boolean;
}

// ── Notes ─────────────────────────────────────────────────────────────────────

export interface Note {
  id: string;
  session_id: string;
  template_id: string | null;
  content: string;
  created_at: number;
  updated_at: number;
}

export interface NoteTemplate {
  id: string;
  name: string;
  prompt: string;
  structure: string | null;
  is_default: number;
}

// ── Screenshot ────────────────────────────────────────────────────────────────

export interface Screenshot {
  id: number;
  session_id: string;
  path: string;
  captured_at: number;
  analysis: string | null;
  is_manual: number;
}

// ── Knowledge Base ────────────────────────────────────────────────────────────

export interface KnowledgeChunk {
  id: number;
  source_path: string;
  chunk_index: number;
  text: string;
  embedding: Uint8Array | null;
  updated_at: number;
}

export interface KnowledgeSearchResult {
  text: string;
  score: number;
  source_path?: string;
}

export interface KnowledgeIndexProgress {
  sourcePath: string;
  chunksProcessed: number;
  totalChunks: number;
}

export interface KnowledgeIndexComplete {
  sourcePath: string;
  chunksIndexed: number;
}

// ── Settings ──────────────────────────────────────────────────────────────────

export type SettingsKey =
  // Screenshots
  | "screenshots.enabled"
  | "screenshots.hotkey"
  | "screenshots.autoCapture"
  | "screenshots.autoIntervalSeconds"
  | "screenshots.analyzeWithLLM"
  | "screenshots.includeInNotes"
  | "screenshots.maxPerSession"
  // Calendar
  | "calendar.preNotificationSeconds"
  | "calendar.enabled"
  | "calendar.pollIntervalMinutes"
  | "calendar.autoRecordOnMeeting"
  // Mic
  | "mic.enabled"
  | "mic.defaultAction"
  | "mic.rememberChoice"
  | "mic.autoRecordWithCalendar"
  // Correlation
  | "correlation.autoLinkMinutes"
  | "correlation.suggestLinkMinutes"
  | "correlation.suggestEnabled"
  // Notes
  | "notes.autoCategorize"
  | "notes.showPostSessionPrompt"
  | "notes.defaultLanguage"
  | "notes.customTemplatesPath"
  // AI Provider
  | "ai.provider"
  | "ai.model"
  | "ai.apiKey"
  | "ai.embeddingProvider"
  | "ai.embeddingModel"
  // Knowledge Base
  | "kb.sourcePath"
  | "kb.chunkSize"
  | "kb.chunkOverlap"
  | "kb.autoReindex"
  // Suggestions
  | "suggestions.enabled"
  | "suggestions.triggerIntervalSeconds"
  | "suggestions.maxSuggestions"
  | "suggestions.contextWindowSeconds";

export type SettingCategory =
  | "screenshots"
  | "calendar"
  | "mic"
  | "correlation"
  | "notes"
  | "ai"
  | "kb"
  | "suggestions";

export interface SettingsMap {
  // Screenshots
  "screenshots.enabled": boolean;
  "screenshots.hotkey": string;
  "screenshots.autoCapture": boolean;
  "screenshots.autoIntervalSeconds": number;
  "screenshots.analyzeWithLLM": boolean;
  "screenshots.includeInNotes": boolean;
  "screenshots.maxPerSession": number;
  // Calendar
  "calendar.preNotificationSeconds": number;
  "calendar.enabled": boolean;
  "calendar.pollIntervalMinutes": number;
  "calendar.autoRecordOnMeeting": boolean;
  // Mic
  "mic.enabled": boolean;
  "mic.defaultAction": "ask" | "always_record" | "ignore";
  "mic.rememberChoice": boolean;
  "mic.autoRecordWithCalendar": boolean;
  // Correlation
  "correlation.autoLinkMinutes": number;
  "correlation.suggestLinkMinutes": number;
  "correlation.suggestEnabled": boolean;
  // Notes
  "notes.autoCategorize": boolean;
  "notes.showPostSessionPrompt": boolean;
  "notes.defaultLanguage": string;
  "notes.customTemplatesPath": string | null;
  // AI Provider
  "ai.provider": "google" | "openai" | "anthropic" | "bedrock" | "ollama";
  "ai.model": string;
  "ai.apiKey": string;
  "ai.embeddingProvider": "google" | "openai" | "bedrock" | "ollama";
  "ai.embeddingModel": string;
  // Knowledge Base
  "kb.sourcePath": string;
  "kb.chunkSize": number;
  "kb.chunkOverlap": number;
  "kb.autoReindex": boolean;
  // Suggestions
  "suggestions.enabled": boolean;
  "suggestions.triggerIntervalSeconds": number;
  "suggestions.maxSuggestions": number;
  "suggestions.contextWindowSeconds": number;
}

// ── Settings category group (returned by settings:getCategory) ────────────────

export interface SettingEntry {
  definition: {
    key: SettingsKey;
    type: string;
    category: SettingCategory;
    enumValues?: string[];
    min?: number;
    max?: number;
    nullable?: boolean;
  };
  value: SettingsMap[SettingsKey];
}

export interface SettingsCategoryGroup {
  category: SettingCategory;
  label: string;
  settings: SettingEntry[];
}

// ── App info ──────────────────────────────────────────────────────────────────

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
}
