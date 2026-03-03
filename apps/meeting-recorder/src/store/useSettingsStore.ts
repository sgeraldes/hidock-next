import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type SettingsField =
  | "provider"
  | "model"        // Maps to ai.model.default
  | "apiKey"
  | "ollamaBaseUrl"
  | "bedrockRegion"
  | "bedrockAccessKeyId"
  | "bedrockSecretAccessKey"
  | "bedrockSessionToken"
  | "autoRecord"
  | "pollInterval"
  | "gracePeriod"
  | "chunkInterval"
  | "transcriptionLanguage"
  | "translationLanguage"
  | "theme"
  | "startMinimized"
  | "closeToTray";

export interface SettingsState {
  provider: string;
  model: string;              // The default model (ai.model.default)
  apiKey: string;
  ollamaBaseUrl: string;
  bedrockRegion: string;
  bedrockAccessKeyId: string;
  bedrockSecretAccessKey: string;
  bedrockSessionToken: string;

  autoRecord: boolean;
  pollInterval: number;
  gracePeriod: number;
  chunkInterval: number;

  transcriptionLanguage: string;
  translationLanguage: string;
  theme: "light" | "dark" | "system";
  startMinimized: boolean;
  closeToTray: boolean;

  loaded: boolean;

  // Context-aware model selections (transient -- NOT persisted in localStorage)
  contextModels: Record<string, string>;

  // Actions
  setField: (key: SettingsField, value: string | number | boolean) => void;
  loadFromIPC: () => Promise<void>;
  saveToIPC: (key: string, value: string) => Promise<void>;

  // Context-aware model actions
  updateModelForContext: (context: string, modelId: string) => Promise<void>;
  getModelForContext: (context: string) => Promise<string>;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      provider: "google",
      model: "gemini-2.5-flash",
      apiKey: "",
      ollamaBaseUrl: "http://localhost:11434/api",
      bedrockRegion: "us-east-1",
      bedrockAccessKeyId: "",
      bedrockSecretAccessKey: "",
      bedrockSessionToken: "",

      autoRecord: true,
      pollInterval: 3,
      gracePeriod: 15,
      chunkInterval: 15,

      transcriptionLanguage: "en",
      translationLanguage: "es",
      theme: "system",
      startMinimized: false,
      closeToTray: true,

      loaded: false,

      // Transient: NOT persisted (see partialize below)
      contextModels: {},

      setField: (key, value) => {
        set({ [key]: value });
      },

      loadFromIPC: async () => {
        try {
          const all = await window.electronAPI.settings.getAll();
          const updates: Partial<SettingsState> = { loaded: true };

          if (all["ai.provider"]) updates.provider = all["ai.provider"];
          // Read from ai.model.default, fall back to old ai.model
          if (all["ai.model.default"]) {
            updates.model = all["ai.model.default"];
          } else if (all["ai.model"]) {
            updates.model = all["ai.model"];
          }
          if (all["ai.apiKey"]) updates.apiKey = all["ai.apiKey"];
          if (all["ai.ollamaBaseUrl"])
            updates.ollamaBaseUrl = all["ai.ollamaBaseUrl"];
          if (all["ai.bedrockRegion"])
            updates.bedrockRegion = all["ai.bedrockRegion"];
          if (all["ai.bedrockAccessKeyId"])
            updates.bedrockAccessKeyId = all["ai.bedrockAccessKeyId"];
          if (all["ai.bedrockSecretAccessKey"])
            updates.bedrockSecretAccessKey = all["ai.bedrockSecretAccessKey"];
          if (all["ai.bedrockSessionToken"])
            updates.bedrockSessionToken = all["ai.bedrockSessionToken"];

          if (all["recording.autoRecord"])
            updates.autoRecord = all["recording.autoRecord"] === "true";
          if (all["recording.pollInterval"]) {
            const pi = parseInt(all["recording.pollInterval"], 10);
            if (!isNaN(pi) && pi > 0) updates.pollInterval = pi;
          }
          if (all["recording.gracePeriod"]) {
            const gp = parseInt(all["recording.gracePeriod"], 10);
            if (!isNaN(gp) && gp > 0) updates.gracePeriod = gp;
          }
          if (all["recording.chunkInterval"]) {
            const ci = parseInt(all["recording.chunkInterval"], 10);
            if (!isNaN(ci) && ci > 0) updates.chunkInterval = ci;
          }

          if (all["general.transcriptionLanguage"])
            updates.transcriptionLanguage =
              all["general.transcriptionLanguage"];
          if (all["general.translationLanguage"])
            updates.translationLanguage = all["general.translationLanguage"];
          if (all["general.theme"])
            updates.theme = all["general.theme"] as "light" | "dark" | "system";
          if (all["general.startMinimized"])
            updates.startMinimized = all["general.startMinimized"] === "true";
          if (all["general.closeToTray"])
            updates.closeToTray = all["general.closeToTray"] === "true";

          // Load context-specific model selections
          const contextModels: Record<string, string> = {};
          const contextPrefix = "ai.model.context.";
          for (const [key, value] of Object.entries(all)) {
            if (key.startsWith(contextPrefix) && value) {
              const context = key.slice(contextPrefix.length);
              contextModels[context] = value;
            }
          }
          updates.contextModels = contextModels;

          set(updates);

          // NOTE: AI service is auto-configured in the main process at startup
          // using real (unmasked) keys from the database. Do NOT call ai.configure
          // from the renderer here because settings:getAll returns masked API keys
          // (e.g. "****xxxx") which would overwrite the valid configuration.
        } catch (err) {
          console.warn("[SettingsStore] Failed to load settings:", err);
          set({ loaded: true });
        }
      },

      saveToIPC: async (key, value) => {
        try {
          await window.electronAPI.settings.set(key, value);
          // NOTE: settings:set handler in main process auto-reconfigures
          // the AI service when any ai.* key changes, using real (unmasked)
          // values from the database. No need to call ai.configure from here.
        } catch (err) {
          console.warn("[SettingsStore] Failed to save setting:", key, err);
        }
      },

      updateModelForContext: async (context: string, modelId: string) => {
        const key = `ai.model.context.${context}`;
        try {
          await window.electronAPI.settings.set(key, modelId);
          set((state) => ({
            contextModels: {
              ...state.contextModels,
              [context]: modelId,
            },
          }));
        } catch (err) {
          console.warn(
            "[SettingsStore] Failed to update context model:",
            context,
            err,
          );
        }
      },

      getModelForContext: async (context: string): Promise<string> => {
        try {
          const resolved =
            await window.electronAPI.settings.getModelForContext(context);
          return resolved;
        } catch (err) {
          console.warn(
            "[SettingsStore] Failed to resolve model for context:",
            context,
            err,
          );
          // Local fallback
          const state = get();
          return state.contextModels[context] || state.model;
        }
      },
    }),
    {
      name: "meeting-recorder-settings",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        provider: state.provider,
        model: state.model,
        theme: state.theme,
        // contextModels intentionally NOT persisted -- loaded fresh from IPC
        // (see zustand-stores.md: transient state excluded from partialize)
      }),
    },
  ),
);

// ---------- Granular selector hooks ----------

/** Current default model */
export const useDefaultModel = () =>
  useSettingsStore((s) => s.model);

/** Current provider */
export const useProvider = () =>
  useSettingsStore((s) => s.provider);

/** Whether settings have loaded from IPC */
export const useSettingsLoaded = () =>
  useSettingsStore((s) => s.loaded);
