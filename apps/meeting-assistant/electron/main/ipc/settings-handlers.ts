import { createHandler } from "./create-handler";
import { CHANNELS } from "./channels";
import {
  SettingsGetInput,
  SettingsSetInput,
  SettingsGetAllInput,
  SettingsGetCategoryInput,
  SettingsTestConnectionInput,
} from "./validation";
import { settingsStore } from "../services/settings-store";
import type { SettingsKey } from "../services/settings-types";
import * as credentialStore from "../services/credential-store";
import { SENSITIVE_SETTING_KEYS } from "../services/sensitive-keys";
import { getSetting, setSetting } from "../services/database-settings";

/**
 * Return the real (decrypted) value of a sensitive setting for use within the
 * main process. Returns null if the key is not in the DB or decryption fails.
 */
export function getDecryptedSetting(key: string): string | null {
  if (!SENSITIVE_SETTING_KEYS.has(key)) {
    // Not a sensitive key — read via normal settings store if it's a known key
    const row = getSetting(key);
    return row ? row.value : null;
  }

  // Check in-memory cache first
  if (credentialStore.has(key)) {
    return credentialStore.retrieve(key);
  }

  // Fall back to DB
  const row = getSetting(key);
  if (!row) return null;

  return credentialStore.retrieve(key, row.value);
}

export function registerSettingsHandlers(): void {
  createHandler({
    channel: CHANNELS.settings.get,
    schema: SettingsGetInput,
    handler: ({ key }) => {
      // For sensitive keys return a masked value — never expose plaintext to renderer
      if (SENSITIVE_SETTING_KEYS.has(key)) {
        const row = getSetting(key);
        if (!row || !row.value) return null;
        return "***";
      }
      return settingsStore.get(key as SettingsKey);
    },
  });

  createHandler({
    channel: CHANNELS.settings.set,
    schema: SettingsSetInput,
    handler: ({ key, value }) => {
      // For sensitive keys encrypt before writing to DB
      if (SENSITIVE_SETTING_KEYS.has(key)) {
        const plaintext = String(value);
        const encryptedBase64 = credentialStore.store(key, plaintext);
        setSetting(key, encryptedBase64, "string", "credentials");
        return null;
      }
      settingsStore.set(key as SettingsKey, value as never);
      return null;
    },
  });

  createHandler({
    channel: CHANNELS.settings.getAll,
    schema: SettingsGetAllInput,
    handler: () => {
      return settingsStore.getAll();
    },
  });

  createHandler({
    channel: CHANNELS.settings.getCategory,
    schema: SettingsGetCategoryInput,
    handler: ({ category }) => {
      const all = settingsStore.getByCategory();
      return all.find((g) => g.category === category) ?? null;
    },
  });

  createHandler({
    channel: CHANNELS.settings.testConnection,
    schema: SettingsTestConnectionInput,
    handler: () => {
      return { success: false, error: "Not implemented" };
    },
  });

  console.log("[IPC] Settings handlers registered");
}
