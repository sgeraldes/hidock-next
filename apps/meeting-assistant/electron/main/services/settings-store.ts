import { getSetting, setSetting } from "./database-settings";
import {
  SETTING_DEFINITIONS,
  SETTING_DEFINITIONS_MAP,
  CATEGORY_LABELS,
} from "./settings-defaults";
import type {
  SettingCategory,
  SettingDefinition,
  SettingsKey,
  SettingsMap,
} from "./settings-types";

// ── Serialisation helpers ────────────────────────────────────────────────────

function serialize(value: unknown): string {
  if (value === null) return "null";
  return String(value);
}

function deserialize<K extends SettingsKey>(
  raw: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  definition: SettingDefinition<any>,
): SettingsMap[K] {
  if (raw === "null" && definition.nullable) {
    return null as SettingsMap[K];
  }

  switch (definition.type) {
    case "boolean":
      return (raw === "true") as SettingsMap[K];
    case "number": {
      const n = Number(raw);
      if (Number.isNaN(n)) {
        throw new Error(
          `[SettingsStore] Corrupted value for "${definition.key}": "${raw}" is not a number`,
        );
      }
      return n as SettingsMap[K];
    }
    case "enum":
    case "string":
      return raw as SettingsMap[K];
    default:
      return raw as SettingsMap[K];
  }
}

// ── Validation ───────────────────────────────────────────────────────────────

function validate<K extends SettingsKey>(
  key: K,
  value: SettingsMap[K],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  definition: SettingDefinition<any>,
): void {
  // Null check
  if (value === null) {
    if (!definition.nullable) {
      throw new Error(
        `[SettingsStore] Setting "${key}" is not nullable`,
      );
    }
    return;
  }

  // Type check
  switch (definition.type) {
    case "boolean":
      if (typeof value !== "boolean") {
        throw new Error(
          `[SettingsStore] Setting "${key}" expects a boolean, got ${typeof value}`,
        );
      }
      break;

    case "number": {
      if (typeof value !== "number" || Number.isNaN(value)) {
        throw new Error(
          `[SettingsStore] Setting "${key}" expects a number, got ${typeof value}`,
        );
      }
      if (definition.min !== undefined && (value as number) < definition.min) {
        throw new Error(
          `[SettingsStore] Setting "${key}" value ${value} is below minimum ${definition.min}`,
        );
      }
      if (definition.max !== undefined && (value as number) > definition.max) {
        throw new Error(
          `[SettingsStore] Setting "${key}" value ${value} exceeds maximum ${definition.max}`,
        );
      }
      break;
    }

    case "enum": {
      if (typeof value !== "string") {
        throw new Error(
          `[SettingsStore] Setting "${key}" expects a string (enum), got ${typeof value}`,
        );
      }
      const allowed = definition.enumValues ?? [];
      if (!allowed.includes(value as string)) {
        throw new Error(
          `[SettingsStore] Setting "${key}" value "${value}" is not one of: ${allowed.join(", ")}`,
        );
      }
      break;
    }

    case "string":
      if (typeof value !== "string") {
        throw new Error(
          `[SettingsStore] Setting "${key}" expects a string, got ${typeof value}`,
        );
      }
      break;
  }
}

// ── Category grouping return type ────────────────────────────────────────────

export interface CategoryGroup {
  category: SettingCategory;
  label: string;
  settings: Array<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    definition: SettingDefinition<any>;
    value: SettingsMap[SettingsKey];
  }>;
}

// ── SettingsStore ────────────────────────────────────────────────────────────

export class SettingsStore {
  /**
   * Read a setting. Returns the stored value if present, otherwise the
   * registered default.
   */
  get<K extends SettingsKey>(key: K): SettingsMap[K] {
    const definition = SETTING_DEFINITIONS_MAP[key];
    if (!definition) {
      throw new Error(`[SettingsStore] Unknown setting key: "${key}"`);
    }

    const row = getSetting(key);
    if (row === null) {
      return definition.default as SettingsMap[K];
    }

    try {
      return deserialize<K>(row.value, definition);
    } catch (e) {
      console.warn(
        `[SettingsStore] Failed to deserialize "${key}", falling back to default. Error: ${(e as Error).message}`,
      );
      return definition.default as SettingsMap[K];
    }
  }

  /**
   * Persist a setting after validation.
   * Throws a descriptive error if the value fails type, range, or enum checks.
   */
  set<K extends SettingsKey>(key: K, value: SettingsMap[K]): void {
    const definition = SETTING_DEFINITIONS_MAP[key];
    if (!definition) {
      throw new Error(`[SettingsStore] Unknown setting key: "${key}"`);
    }

    validate(key, value, definition);

    setSetting(
      key,
      serialize(value),
      definition.type === "enum" ? "string" : definition.type,
      definition.category,
    );
  }

  /**
   * Return every setting merged with its current DB value (or default).
   */
  getAll(): Partial<SettingsMap> {
    const result: Partial<SettingsMap> = {};
    for (const definition of SETTING_DEFINITIONS) {
      const key = definition.key as SettingsKey;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result as any)[key] = this.get(key);
    }
    return result;
  }

  /**
   * Return settings grouped by category with their current values.
   * Useful for building Settings UI panels.
   */
  getByCategory(): CategoryGroup[] {
    const categoryOrder: SettingCategory[] = [
      "screenshots",
      "calendar",
      "mic",
      "correlation",
      "notes",
    ];

    return categoryOrder.map((category) => {
      const definitions = SETTING_DEFINITIONS.filter(
        (d) => d.category === category,
      );

      return {
        category,
        label: CATEGORY_LABELS[category],
        settings: definitions.map((definition) => ({
          definition,
          value: this.get(definition.key as SettingsKey),
        })),
      };
    });
  }

  /**
   * Reset a single setting to its registered default by removing the DB row.
   */
  resetToDefault<K extends SettingsKey>(key: K): void {
    const definition = SETTING_DEFINITIONS_MAP[key];
    if (!definition) {
      throw new Error(`[SettingsStore] Unknown setting key: "${key}"`);
    }
    // Write the default value back so the row exists with the canonical value
    this.set(key, definition.default as SettingsMap[K]);
  }

  /**
   * Reset all settings to their registered defaults.
   */
  resetAllToDefaults(): void {
    for (const definition of SETTING_DEFINITIONS) {
      const key = definition.key as SettingsKey;
      this.resetToDefault(key);
    }
  }

  /**
   * Write defaults for any settings that do not yet have a DB row.
   * Safe to call on every app start (INSERT OR IGNORE semantics via setSetting).
   */
  seedDefaults(): void {
    const { getDatabase } = require("./database") as {
      getDatabase: () => import("sql.js").Database;
    };

    const database = getDatabase();

    for (const definition of SETTING_DEFINITIONS) {
      const serialized = serialize(definition.default);
      const dbType =
        definition.type === "enum" ? "string" : definition.type;

      database.run(
        `INSERT OR IGNORE INTO settings (key, value, type, category) VALUES (?, ?, ?, ?)`,
        [definition.key, serialized, dbType, definition.category],
      );
    }
  }
}

/** Singleton instance for use throughout the main process */
export const settingsStore = new SettingsStore();
