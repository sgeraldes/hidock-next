import { ipcMain } from "electron";
import { getSetting, setSetting } from "../services/database-extras";
import { getDatabase, saveDatabase } from "../services/database";
import { getAIService } from "./ai-handlers";
import {
  getTranslationService,
  getSummarizationService,
} from "./translation-handlers";
import { getEndOfMeetingProcessor } from "./meeting-type-handlers";
import { modelConfig } from "../services/model-config";
import type { AIProviderConfig } from "../services/ai-provider.types";
import { reconfigureChirp3 } from "./chirp3-handlers";
import { BACKEND_GEMINI_MULTIMODAL } from "../services/transcription-backend";

/** Debounce timer for saveDatabase (avoids serializing entire DB on every keystroke). */
let saveDatabaseTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_DATABASE_DEBOUNCE_MS = 300;

function debouncedSaveDatabase(): void {
  if (saveDatabaseTimer) clearTimeout(saveDatabaseTimer);
  saveDatabaseTimer = setTimeout(() => {
    saveDatabaseTimer = null;
    saveDatabase();
  }, SAVE_DATABASE_DEBOUNCE_MS);
}

const AI_SETTING_KEYS = [
  "ai.provider",
  "ai.model",          // Keep for backward compat
  "ai.model.default",  // Primary model key
  "ai.apiKey",
  "ai.ollamaBaseUrl",
  "ai.bedrockRegion",
  "ai.bedrockAccessKeyId",
  "ai.bedrockSecretAccessKey",
  "ai.bedrockSessionToken",
  "ai.transcriptionProvider",
  "ai.transcriptionApiKey",
  "ai.transcriptionBackend",
  "ai.gcp.projectId",
  "ai.gcp.apiKey",
  "ai.gcp.serviceAccountJson",
  "ai.gcp.authType",
  "ai.gcp.location",
  "ai.chirp3.languageCode",
  "ai.chirp3.confidenceThreshold",
];

const SENSITIVE_KEYS = new Set([
  "ai.apiKey",
  "ai.bedrockAccessKeyId",
  "ai.bedrockSecretAccessKey",
  "ai.bedrockSessionToken",
  "ai.gcp.apiKey",
  "ai.gcp.serviceAccountJson",
]);

export const MIGRATION_VERSION_KEY = "settings.migration.version";
export const CURRENT_MIGRATION_VERSION = "3";

function maskSensitiveValue(value: string): string {
  if (value === "" || value === null || value === undefined) return "";
  if (value.length <= 4) return "****";
  return `****${value.slice(-4)}`;
}

function reconfigureAIIfNeeded(changedKey: string): void {
  if (
    !AI_SETTING_KEYS.includes(changedKey) &&
    !changedKey.startsWith("ai.model.context.")
  ) {
    return;
  }

  const provider = getSetting("ai.provider");
  // Read from ai.model.default, falling back to old ai.model for migration
  const model =
    getSetting("ai.model.default") ||
    getSetting("ai.model") ||
    modelConfig.getDefaultModel(provider || "google");
  if (!provider || !model) return;

  // Also get the transcription model from context config
  const transcriptionModelId =
    getSetting("ai.model.context.realtime") ||
    modelConfig.getModelForContext(provider, "realtime") ||
    model;

  const config: AIProviderConfig = {
    provider: provider as AIProviderConfig["provider"],
    model,
    apiKey: getSetting("ai.apiKey") ?? "",
    ollamaBaseUrl: getSetting("ai.ollamaBaseUrl") ?? undefined,
    bedrockRegion: getSetting("ai.bedrockRegion") ?? undefined,
    bedrockAccessKeyId: getSetting("ai.bedrockAccessKeyId") ?? undefined,
    bedrockSecretAccessKey:
      getSetting("ai.bedrockSecretAccessKey") ?? undefined,
    bedrockSessionToken: getSetting("ai.bedrockSessionToken") ?? undefined,
    transcriptionModel: transcriptionModelId,
    transcriptionProvider:
      (getSetting("ai.transcriptionProvider") as "google") ?? undefined,
    transcriptionApiKey: getSetting("ai.transcriptionApiKey") ?? undefined,
  };

  try {
    const aiService = getAIService();
    aiService.configure(config);

    const langModel = aiService.getModel();
    if (langModel) {
      getTranslationService().setModel(langModel);
      getSummarizationService().setModel(langModel);
      getEndOfMeetingProcessor().setModel(langModel);
    }

    console.log(`[Settings] AI service reconfigured (${provider}/${model})`);
  } catch (err) {
    console.warn("[Settings] Failed to reconfigure AI service:", err);
  }

  // Reconfigure Chirp 3 when GCP or backend settings change
  if (
    changedKey.startsWith("ai.gcp.") ||
    changedKey.startsWith("ai.chirp3.") ||
    changedKey === "ai.transcriptionBackend"
  ) {
    reconfigureChirp3();
  }
}

/** Migrate old settings to new schema and handle deprecated models. */
export function migrateModelSettings(): void {
  const currentVersion = getSetting(MIGRATION_VERSION_KEY);
  if (currentVersion === CURRENT_MIGRATION_VERSION) {
    return; // Already migrated
  }

  console.log("[Settings Migration] Starting model settings migration...");

  const provider = getSetting("ai.provider") || "google";
  const existingModel = getSetting("ai.model");
  const existingDefault = getSetting("ai.model.default");

  // Backup: store original values before migration
  if (existingModel || provider) {
    const backupKey = `settings.migration.backup.${Date.now()}`;
    setSetting(
      backupKey,
      JSON.stringify({ provider, model: existingModel }),
      false,
    );
    console.log(
      `[Settings Migration] Backed up original settings to "${backupKey}"`,
    );
  }

  // Migration 1: ai.model -> ai.model.default (if new key doesn't exist yet)
  if (existingModel && !existingDefault) {
    // Handle deprecated model migration inline
    let migratedModel = existingModel;
    if (modelConfig.isModelDeprecated(provider, existingModel)) {
      const migration = modelConfig.getDeprecationMigration(
        provider,
        existingModel,
      );
      if (migration) {
        migratedModel = migration;
        console.log(
          `[Settings Migration] Upgrading deprecated model: ` +
          `${existingModel} -> ${migration}`,
        );
      }
    }
    setSetting("ai.model.default", migratedModel, false);
    console.log(
      `[Settings Migration] Migrated ai.model -> ai.model.default = "${migratedModel}"`,
    );
  }

  // Migration 2: If ai.model.default exists but is deprecated, upgrade it
  const currentDefault = getSetting("ai.model.default");
  if (currentDefault && modelConfig.isModelDeprecated(provider, currentDefault)) {
    const migration = modelConfig.getDeprecationMigration(
      provider,
      currentDefault,
    );
    if (migration) {
      console.log(
        `[Settings Migration] Migrating deprecated default: ` +
        `${currentDefault} -> ${migration}`,
      );
      setSetting("ai.model.default", migration, false);
      // Also update legacy key for backward compatibility
      if (existingModel) {
        setSetting("ai.model", migration, false);
      }
    }
  }

  // Migration 3: Set context defaults from config if not already set
  const contexts = modelConfig.getContextIds();
  for (const contextId of contexts) {
    const key = `ai.model.context.${contextId}`;
    if (!getSetting(key)) {
      const contextModel = modelConfig.getModelForContext(provider, contextId);
      if (contextModel) {
        setSetting(key, contextModel, false);
        console.log(
          `[Settings Migration] Set context default: ${key} = "${contextModel}"`,
        );
      }
    }
  }

  // Migration 4: Ensure ai.model.default has a valid value
  if (!getSetting("ai.model.default")) {
    const defaultModel = modelConfig.getDefaultModel(provider);
    setSetting("ai.model.default", defaultModel, false);
    console.log(
      `[Settings Migration] Set default model: ai.model.default = "${defaultModel}"`,
    );
  }

  // Migration 5: Set default transcription backend if not present
  if (!getSetting("ai.transcriptionBackend")) {
    setSetting("ai.transcriptionBackend", BACKEND_GEMINI_MULTIMODAL, false);
    console.log(
      `[Settings Migration] Set default transcription backend: gemini-multimodal`,
    );
  }

  // Mark migration as complete
  setSetting(MIGRATION_VERSION_KEY, CURRENT_MIGRATION_VERSION, false);
  saveDatabase();
  console.log(
    `[Settings Migration] Migration complete (v${CURRENT_MIGRATION_VERSION})`,
  );
}

/** Configure AI service from database on startup (avoids masked key bug). */
export function initializeAIFromSettings(): void {
  migrateModelSettings();
  reconfigureAIIfNeeded("ai.provider");
}

export function registerSettingsHandlers(): void {
  ipcMain.handle("settings:get", (_, key: string) => {
    const value = getSetting(key);
    if (value !== null && SENSITIVE_KEYS.has(key)) {
      return maskSensitiveValue(value);
    }
    return value;
  });

  ipcMain.handle("settings:set", (_, key: string, value: string) => {
    // Validate key prefix to prevent arbitrary writes
    const WRITABLE_PREFIXES = ["ai.", "recording.", "general.", "ui."];
    if (!WRITABLE_PREFIXES.some((p) => key.startsWith(p))) {
      console.warn(`[Settings] Rejected write to unauthorized key: "${key}"`);
      return;
    }

    // Backward compatibility: redirect old ai.model writes to ai.model.default
    const effectiveKey = key === "ai.model" ? "ai.model.default" : key;

    // When provider changes, update default model from config if current
    // default doesn't exist in the new provider
    if (effectiveKey === "ai.provider") {
      const newDefaultModel = modelConfig.getDefaultModel(value);
      if (newDefaultModel) {
        const currentDefault = getSetting("ai.model.default");
        if (!currentDefault || !modelConfig.validateModel(value, currentDefault)) {
          setSetting("ai.model.default", newDefaultModel, false);
          console.log(
            `[Settings] Provider changed to "${value}", ` +
            `default model set to "${newDefaultModel}"`,
          );
        }
      }
    }

    // Validate model against config when setting any ai.model.* key
    let effectiveValue = value;
    if (effectiveKey.startsWith("ai.model.")) {
      const provider = getSetting("ai.provider") || "google";
      const model = modelConfig.getModel(provider, effectiveValue);

      if (model?.deprecated) {
        const fallback = modelConfig.getDefaultModel(provider);
        console.warn(
          `[Settings] Model "${effectiveValue}" is deprecated. Redirecting to "${fallback}".`,
        );
        effectiveValue = fallback;
      } else if (!model) {
        // Unknown model: allow but warn (supports custom models)
        console.warn(
          `[Settings] Model "${effectiveValue}" not found in config for ` +
          `"${provider}". Allowing as custom model.`,
        );
      }
    }

    const encrypt =
      effectiveKey.includes("apiKey") ||
      effectiveKey.includes("SecretAccessKey") ||
      effectiveKey.includes("AccessKeyId") ||
      effectiveKey.includes("SessionToken") ||
      effectiveKey.includes("serviceAccountJson");
    setSetting(effectiveKey, effectiveValue, encrypt);
    debouncedSaveDatabase();

    // Reconfigure AI when model-related keys change
    if (effectiveKey === "ai.model.default" || effectiveKey === "ai.provider") {
      reconfigureAIIfNeeded("ai.model.default");
    } else {
      reconfigureAIIfNeeded(effectiveKey);
    }
  });

  ipcMain.handle("settings:getAll", () => {
    const database = getDatabase();
    const result = database.exec("SELECT key, value, encrypted FROM settings");
    if (result.length === 0) return {};

    const settings: Record<string, string> = {};
    for (const row of result[0].values) {
      const key = row[0] as string;
      const value = getSetting(key);
      if (value !== null) {
        settings[key] = SENSITIVE_KEYS.has(key)
          ? maskSensitiveValue(value)
          : value;
      }
    }
    return settings;
  });

  ipcMain.handle(
    "settings:getModelForContext",
    (_, context: string): string => {
      const provider = getSetting("ai.provider") || "google";

      // Step 1: Check context-specific setting
      const contextModel = getSetting(`ai.model.context.${context}`);
      if (contextModel) {
        const model = modelConfig.getModel(provider, contextModel);
        if (model && !model.deprecated) {
          return contextModel;
        }
        // Stored model is deprecated or removed -- fall through
        console.warn(
          `[Settings] Context model "${contextModel}" for "${context}" ` +
          `is deprecated/invalid. Falling back.`,
        );
      }

      // Step 2: Fall back to default model setting
      const defaultModel = getSetting("ai.model.default");
      if (defaultModel) {
        const model = modelConfig.getModel(provider, defaultModel);
        if (model && !model.deprecated) {
          return defaultModel;
        }
      }

      // Step 3: Fall back to config's default for the provider
      return modelConfig.getDefaultModel(provider);
    },
  );

  ipcMain.handle("settings:testConnection", async () => {
    const provider = getSetting("ai.provider");
    const apiKey = getSetting("ai.apiKey") ?? "";
    if (!provider) return { valid: false, error: "No provider configured" };

    const extras: Record<string, string> = {};
    const region = getSetting("ai.bedrockRegion");
    const accessKeyId = getSetting("ai.bedrockAccessKeyId");
    const secretAccessKey = getSetting("ai.bedrockSecretAccessKey");
    if (region) extras.bedrockRegion = region;
    if (accessKeyId) extras.bedrockAccessKeyId = accessKeyId;
    if (secretAccessKey) extras.bedrockSecretAccessKey = secretAccessKey;

    try {
      return await getAIService().validateApiKey(
        provider as AIProviderConfig["provider"],
        apiKey,
        Object.keys(extras).length > 0 ? extras : undefined,
      );
    } catch (err) {
      return {
        valid: false,
        error: err instanceof Error ? err.message : "Test failed",
      };
    }
  });
}
