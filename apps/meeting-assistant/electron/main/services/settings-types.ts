// All known setting keys as a union type
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
  | "notes.customTemplatesPath";

export type SettingType = "boolean" | "number" | "string" | "enum";

export type SettingCategory =
  | "screenshots"
  | "calendar"
  | "mic"
  | "correlation"
  | "notes";

export interface SettingDefinition<K extends SettingsKey = SettingsKey> {
  key: K;
  type: SettingType;
  category: SettingCategory;
  default: SettingsMap[K];
  /** Allowed values for enum type */
  enumValues?: string[];
  /** Minimum value for number type */
  min?: number;
  /** Maximum value for number type */
  max?: number;
  /** Whether this setting can be null */
  nullable?: boolean;
}

/**
 * Maps each SettingsKey to its TypeScript value type.
 * This enables type-safe get<K>(key): SettingsMap[K].
 */
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
}
