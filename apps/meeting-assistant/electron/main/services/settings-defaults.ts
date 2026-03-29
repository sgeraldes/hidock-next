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
};
