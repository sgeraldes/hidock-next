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

export function registerSettingsHandlers(): void {
  createHandler({
    channel: CHANNELS.settings.get,
    schema: SettingsGetInput,
    handler: ({ key }) => {
      return settingsStore.get(key as SettingsKey);
    },
  });

  createHandler({
    channel: CHANNELS.settings.set,
    schema: SettingsSetInput,
    handler: ({ key, value }) => {
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
