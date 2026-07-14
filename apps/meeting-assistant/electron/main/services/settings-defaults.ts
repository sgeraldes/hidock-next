import type { SettingCategory, SettingDefinition, SettingsKey } from "./settings-types";

// Using explicit type to allow heterogeneous array without losing definition-level generics
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SETTING_DEFINITIONS: SettingDefinition<any>[] = [
  // ── Screenshots ──────────────────────────────────────────────────────────
  {
    key: "screenshots.enabled",
    type: "boolean",
    category: "screenshots",
    default: false,
  },
  {
    key: "screenshots.hotkey",
    type: "string",
    category: "screenshots",
    default: "CmdOrCtrl+Shift+S",
  },
  {
    key: "screenshots.autoCapture",
    type: "boolean",
    category: "screenshots",
    default: false,
  },
  {
    key: "screenshots.autoIntervalSeconds",
    type: "number",
    category: "screenshots",
    default: 30,
    min: 5,
    max: 300,
  },
  {
    key: "screenshots.analyzeWithLLM",
    type: "boolean",
    category: "screenshots",
    default: true,
  },
  {
    key: "screenshots.includeInNotes",
    type: "boolean",
    category: "screenshots",
    default: true,
  },
  {
    key: "screenshots.maxPerSession",
    type: "number",
    category: "screenshots",
    default: 100,
    min: 10,
    max: 500,
  },

  // ── Calendar ─────────────────────────────────────────────────────────────
  {
    key: "calendar.source",
    type: "string",
    category: "calendar",
    default: "",
  },
  {
    key: "calendar.preNotificationSeconds",
    type: "number",
    category: "calendar",
    default: 15,
    min: 0,
    max: 3600,
  },
  {
    key: "calendar.enabled",
    type: "boolean",
    category: "calendar",
    default: true,
  },
  {
    key: "calendar.pollIntervalMinutes",
    type: "number",
    category: "calendar",
    default: 15,
    min: 1,
    max: 60,
  },
  {
    key: "calendar.autoRecordOnMeeting",
    type: "boolean",
    category: "calendar",
    default: false,
  },

  // ── Mic ──────────────────────────────────────────────────────────────────
  {
    key: "mic.enabled",
    type: "boolean",
    category: "mic",
    default: true,
  },
  {
    key: "mic.defaultAction",
    type: "enum",
    category: "mic",
    default: "ask",
    enumValues: ["ask", "always_record", "ignore"],
  },
  {
    key: "mic.rememberChoice",
    type: "boolean",
    category: "mic",
    default: false,
  },
  {
    key: "mic.autoRecordWithCalendar",
    type: "boolean",
    category: "mic",
    default: true,
  },

  // ── Correlation ───────────────────────────────────────────────────────────
  {
    key: "correlation.autoLinkMinutes",
    type: "number",
    category: "correlation",
    default: 5,
    min: 1,
    max: 120,
  },
  {
    key: "correlation.suggestLinkMinutes",
    type: "number",
    category: "correlation",
    default: 120,
    min: 1,
    max: 480,
  },
  {
    key: "correlation.suggestEnabled",
    type: "boolean",
    category: "correlation",
    default: true,
  },

  // ── Notes ─────────────────────────────────────────────────────────────────
  {
    key: "notes.autoCategorize",
    type: "boolean",
    category: "notes",
    default: true,
  },
  {
    key: "notes.showPostSessionPrompt",
    type: "boolean",
    category: "notes",
    default: true,
  },
  {
    key: "notes.defaultLanguage",
    type: "string",
    category: "notes",
    default: "auto",
  },
  {
    key: "notes.customTemplatesPath",
    type: "string",
    category: "notes",
    default: null,
    nullable: true,
  },

  // ── AI Provider ───────────────────────────────────────────────────────────
  {
    key: "ai.provider",
    type: "enum",
    category: "ai",
    default: "ollama",
    enumValues: ["google", "openai", "anthropic", "bedrock", "ollama"],
  },
  {
    key: "ai.model",
    type: "string",
    category: "ai",
    default: "llama3.2",
  },
  {
    // NOTE: For production, ai.apiKey should be stored via credential-store.ts,
    // not in the SQLite settings database. Included here for development convenience.
    key: "ai.apiKey",
    type: "string",
    category: "ai",
    default: "",
    nullable: true,
  },
  {
    key: "ai.embeddingProvider",
    type: "enum",
    category: "ai",
    default: "ollama",
    enumValues: ["google", "openai", "bedrock", "ollama"],
  },
  {
    key: "ai.embeddingModel",
    type: "string",
    category: "ai",
    default: "nomic-embed-text",
  },

  // ── Knowledge Base ────────────────────────────────────────────────────────
  {
    key: "kb.sourcePath",
    type: "string",
    category: "kb",
    default: "",
  },
  {
    key: "kb.chunkSize",
    type: "number",
    category: "kb",
    default: 2000,
    min: 500,
    max: 10000,
  },
  {
    key: "kb.chunkOverlap",
    type: "number",
    category: "kb",
    default: 200,
    min: 0,
    max: 2000,
  },
  {
    key: "kb.autoReindex",
    type: "boolean",
    category: "kb",
    default: true,
  },

  // ── Suggestions ───────────────────────────────────────────────────────────
  {
    key: "suggestions.enabled",
    type: "boolean",
    category: "suggestions",
    default: true,
  },
  {
    key: "suggestions.triggerIntervalSeconds",
    type: "number",
    category: "suggestions",
    default: 90,
    min: 30,
    max: 600,
  },
  {
    key: "suggestions.maxSuggestions",
    type: "number",
    category: "suggestions",
    default: 3,
    min: 1,
    max: 10,
  },
  {
    key: "suggestions.contextWindowSeconds",
    type: "number",
    category: "suggestions",
    default: 120,
    min: 30,
    max: 600,
  },
] satisfies SettingDefinition<SettingsKey>[];

/** Fast key → definition lookup */
export const SETTING_DEFINITIONS_MAP: Record<
  SettingsKey,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SettingDefinition<any>
> = Object.fromEntries(
  SETTING_DEFINITIONS.map((d) => [d.key, d]),
) as Record<SettingsKey, SettingDefinition<SettingsKey>>;

/** Human-readable labels for each category */
export const CATEGORY_LABELS: Record<SettingCategory, string> = {
  screenshots: "Screenshots",
  calendar: "Calendar",
  mic: "Microphone",
  correlation: "Correlation",
  notes: "Notes",
  ai: "AI Provider",
  kb: "Knowledge Base",
  suggestions: "Suggestions",
};
