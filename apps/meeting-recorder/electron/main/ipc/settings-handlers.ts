import { ipcMain } from "electron";
import { getSetting, setSetting } from "../services/database-extras";
import { getDatabase, saveDatabase } from "../services/database";
import { getAIService } from "./ai-handlers";
import {
  getTranslationService,
  getSummarizationService,
} from "./translation-handlers";
import { getEndOfMeetingProcessor } from "./meeting-type-handlers";
import type { AIProviderConfig } from "../services/ai-provider.types";

const AI_SETTING_KEYS = [
  "ai.provider",
  "ai.model",
  "ai.apiKey",
  "ai.ollamaBaseUrl",
  "ai.bedrockRegion",
  "ai.bedrockAccessKeyId",
  "ai.bedrockSecretAccessKey",
  "ai.bedrockSessionToken",
];

const SENSITIVE_KEYS = new Set([
  "ai.apiKey",
  "ai.bedrockAccessKeyId",
  "ai.bedrockSecretAccessKey",
  "ai.bedrockSessionToken",
]);

function maskSensitiveValue(value: string): string {
  if (!value) return "";
  return `****${value.slice(-4)}`;
}

function reconfigureAIIfNeeded(changedKey: string): void {
  if (!AI_SETTING_KEYS.includes(changedKey)) return;

  const provider = getSetting("ai.provider");
  const model = getSetting("ai.model");
  if (!provider || !model) return;

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
}

/** Configure AI service from database on startup (avoids masked key bug). */
export function initializeAIFromSettings(): void {
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
    const encrypt =
      key.includes("apiKey") ||
      key.includes("SecretAccessKey") ||
      key.includes("AccessKeyId") ||
      key.includes("SessionToken");
    setSetting(key, value, encrypt);
    saveDatabase();
    reconfigureAIIfNeeded(key);
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
