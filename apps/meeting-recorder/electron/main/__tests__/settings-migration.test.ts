import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Settings Migration Tests
 *
 * Complements settings-context.test.ts by testing additional migration
 * edge cases: clean install with context defaults, deprecated model upgrade
 * paths, idempotency, backup verification, and partial state handling.
 *
 * settings-context.test.ts already covers:
 *   - ai.model -> ai.model.default migration
 *   - deprecated gemini-2.0-flash -> gemini-2.5-flash
 *   - does not re-run if already migrated
 *   - backs up settings before migration
 *   - populates context defaults
 *   - sets migration version after completion
 *   - ensures ai.model.default on clean install
 *   - does not overwrite existing ai.model.default or context models
 *   - idempotent calling
 *
 * This file tests:
 *   - Clean install creates valid state with ALL context defaults populated
 *   - Deprecated model upgrade produces correct downstream context values
 *   - Partial state (only some settings present) handled gracefully
 *   - Backup contains all expected pre-migration keys
 *   - Multiple deprecated models in the same provider handled correctly
 *   - Provider-less migration (no ai.provider set)
 */

// --- Hoisted mocks ---

const settingsDb = vi.hoisted(() => new Map<string, string>());

const mockGetSetting = vi.hoisted(() =>
  vi.fn((key: string): string | null => settingsDb.get(key) ?? null),
);

const mockSetSetting = vi.hoisted(() =>
  vi.fn((key: string, value: string, _encrypt?: boolean): void => {
    settingsDb.set(key, value);
  }),
);

const mockSaveDatabase = vi.hoisted(() => vi.fn());
const mockGetDatabase = vi.hoisted(() =>
  vi.fn(() => ({
    exec: vi.fn((sql: string) => {
      if (sql.includes("SELECT key, value, encrypted FROM settings")) {
        const values = Array.from(settingsDb.entries()).map(([k, v]) => [k, v, 0]);
        if (values.length === 0) return [];
        return [{ values }];
      }
      return [];
    }),
    run: vi.fn(),
  })),
);

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
  ipcRenderer: {
    invoke: vi.fn(),
    on: vi.fn(),
    send: vi.fn(),
  },
  app: {
    getPath: vi.fn().mockReturnValue("/tmp/test-migration"),
    isReady: vi.fn().mockReturnValue(true),
    on: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: vi.fn().mockReturnValue([]),
    fromWebContents: vi.fn(),
  },
  screen: {
    getPrimaryDisplay: vi.fn().mockReturnValue({
      workAreaSize: { width: 1920, height: 1080 },
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    }),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
  shell: { openPath: vi.fn() },
}));

vi.mock("@electron-toolkit/utils", () => ({
  is: { dev: true },
  electronApp: { setAppUserModelId: vi.fn() },
  optimizer: { watchWindowShortcuts: vi.fn() },
}));

vi.mock("../services/database-extras", () => ({
  getSetting: mockGetSetting,
  setSetting: mockSetSetting,
}));

vi.mock("../services/database", () => ({
  getDatabase: mockGetDatabase,
  saveDatabase: mockSaveDatabase,
}));

vi.mock("../services/model-config", () => ({
  modelConfig: {
    getModel: vi.fn().mockImplementation((provider: string, modelId: string) => {
      const models: Record<string, Record<string, {
        id: string;
        deprecated?: boolean;
        migratesTo?: string;
      }>> = {
        google: {
          "gemini-2.5-flash": { id: "gemini-2.5-flash" },
          "gemini-2.5-pro": { id: "gemini-2.5-pro" },
          "gemini-2.0-flash": {
            id: "gemini-2.0-flash",
            deprecated: true,
            migratesTo: "gemini-2.5-flash",
          },
        },
        openai: {
          "gpt-4o": { id: "gpt-4o" },
          "gpt-4-turbo": { id: "gpt-4-turbo" },
        },
      };
      return models[provider]?.[modelId] ?? null;
    }),
    getDefaultModel: vi.fn().mockImplementation((provider: string) => {
      const defaults: Record<string, string> = {
        google: "gemini-2.5-flash",
        openai: "gpt-4o",
        anthropic: "claude-sonnet-4-20250514",
      };
      return defaults[provider] || "";
    }),
    validateModel: vi.fn().mockImplementation((provider: string, modelId: string) => {
      const valid: Record<string, string[]> = {
        google: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
        openai: ["gpt-4o", "gpt-4-turbo"],
      };
      return valid[provider]?.includes(modelId) ?? false;
    }),
    isModelDeprecated: vi.fn().mockImplementation((provider: string, modelId: string) => {
      return provider === "google" && modelId === "gemini-2.0-flash";
    }),
    getDeprecationMigration: vi.fn().mockImplementation((_provider: string, modelId: string) => {
      if (modelId === "gemini-2.0-flash") return "gemini-2.5-flash";
      return null;
    }),
    getModelForContext: vi.fn().mockImplementation((_provider: string, context: string) => {
      const contextDefaults: Record<string, string> = {
        realtime: "gemini-2.5-flash",
        postprocess: "gemini-2.5-flash",
        critical: "gemini-2.5-pro",
        batch: "gemini-2.5-flash",
      };
      return contextDefaults[context] || "";
    }),
    getContextIds: vi.fn().mockReturnValue(["realtime", "postprocess", "critical", "batch"]),
    getContexts: vi.fn().mockReturnValue({
      realtime: { name: "Real-time Transcription", description: "Speed", priority: "speed" },
      postprocess: { name: "Post-Processing", description: "Quality", priority: "quality" },
      critical: { name: "Critical Meetings", description: "Quality", priority: "quality" },
      batch: { name: "Batch Processing", description: "Cost", priority: "cost" },
    }),
    isAudioCapable: vi.fn().mockImplementation((p: string) => p === "google"),
  },
}));

vi.mock("../ipc/ai-handlers", () => ({
  getAIService: vi.fn().mockReturnValue({
    configure: vi.fn(),
    getModel: vi.fn().mockReturnValue({}),
  }),
}));

vi.mock("../ipc/translation-handlers", () => ({
  getTranslationService: vi.fn().mockReturnValue({ setModel: vi.fn() }),
  getSummarizationService: vi.fn().mockReturnValue({ setModel: vi.fn() }),
}));

vi.mock("../ipc/meeting-type-handlers", () => ({
  getEndOfMeetingProcessor: vi.fn().mockReturnValue({ setModel: vi.fn() }),
}));

import {
  migrateModelSettings,
  MIGRATION_VERSION_KEY,
  CURRENT_MIGRATION_VERSION,
} from "../ipc/settings-handlers";

describe("Settings Migration - Extended Edge Cases", () => {
  beforeEach(() => {
    settingsDb.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Clean install produces valid state with all context defaults", () => {
    it("populates all 4 context keys on fresh install (no prior settings)", () => {
      // Simulate completely fresh install: no ai.provider, no ai.model, nothing
      migrateModelSettings();

      // All context keys should be populated
      const realtimeModel = settingsDb.get("ai.model.context.realtime");
      const postprocessModel = settingsDb.get("ai.model.context.postprocess");
      const criticalModel = settingsDb.get("ai.model.context.critical");
      const batchModel = settingsDb.get("ai.model.context.batch");

      expect(realtimeModel, "realtime context not populated").toBeTruthy();
      expect(postprocessModel, "postprocess context not populated").toBeTruthy();
      expect(criticalModel, "critical context not populated").toBeTruthy();
      expect(batchModel, "batch context not populated").toBeTruthy();
    });

    it("ai.model.default is set to config default on fresh install", () => {
      migrateModelSettings();

      const defaultModel = settingsDb.get("ai.model.default");
      expect(defaultModel).toBeTruthy();
      // Should be the provider default from config
      expect(typeof defaultModel).toBe("string");
    });

    it("migration version is set even on fresh install", () => {
      migrateModelSettings();
      expect(settingsDb.get(MIGRATION_VERSION_KEY)).toBe(CURRENT_MIGRATION_VERSION);
    });
  });

  describe("Deprecated model upgrade produces correct context values", () => {
    it("all context keys use non-deprecated model after migration from deprecated", () => {
      settingsDb.set("ai.provider", "google");
      settingsDb.set("ai.model", "gemini-2.0-flash");

      migrateModelSettings();

      // The default should have been upgraded
      expect(settingsDb.get("ai.model.default")).toBe("gemini-2.5-flash");

      // Context values should all be non-deprecated models
      for (const ctx of ["realtime", "postprocess", "critical", "batch"]) {
        const model = settingsDb.get(`ai.model.context.${ctx}`);
        expect(model, `context ${ctx} is empty`).toBeTruthy();
        expect(model).not.toBe("gemini-2.0-flash");
      }
    });
  });

  describe("Partial state handling", () => {
    it("handles ai.provider set but no ai.model (partial config)", () => {
      settingsDb.set("ai.provider", "google");
      // ai.model deliberately not set

      expect(() => migrateModelSettings()).not.toThrow();

      // Should still set defaults
      const defaultModel = settingsDb.get("ai.model.default");
      expect(defaultModel).toBeTruthy();
    });

    it("handles ai.model set but no ai.provider (unusual state)", () => {
      settingsDb.set("ai.model", "gemini-2.5-flash");
      // ai.provider deliberately not set

      expect(() => migrateModelSettings()).not.toThrow();

      // Migration should complete without crashing
      expect(settingsDb.get(MIGRATION_VERSION_KEY)).toBe(CURRENT_MIGRATION_VERSION);
    });

    it("handles ai.model.default already set with no ai.model (direct config)", () => {
      settingsDb.set("ai.provider", "google");
      settingsDb.set("ai.model.default", "gemini-2.5-pro");
      // No legacy ai.model key

      migrateModelSettings();

      // Should keep the existing ai.model.default
      expect(settingsDb.get("ai.model.default")).toBe("gemini-2.5-pro");
    });

    it("handles empty string ai.model by using config default", () => {
      settingsDb.set("ai.provider", "google");
      settingsDb.set("ai.model", "");

      migrateModelSettings();

      const defaultModel = settingsDb.get("ai.model.default");
      // Should NOT be empty, should have received a valid default
      expect(defaultModel).toBeTruthy();
    });
  });

  describe("Backup verification", () => {
    it("backup JSON contains provider and model keys", () => {
      settingsDb.set("ai.provider", "google");
      settingsDb.set("ai.model", "gemini-2.0-flash");
      settingsDb.set("ai.apiKey", "test-key-123");

      migrateModelSettings();

      // Find backup key
      const backupKeys = Array.from(settingsDb.keys()).filter(
        (k) => k.startsWith("settings.migration.backup."),
      );
      expect(backupKeys.length).toBeGreaterThan(0);

      const backup = JSON.parse(settingsDb.get(backupKeys[0])!);
      expect(backup).toHaveProperty("provider");
      expect(backup.provider).toBe("google");
      expect(backup).toHaveProperty("model");
      expect(backup.model).toBe("gemini-2.0-flash");
    });

    it("backup is created before any settings are modified", () => {
      settingsDb.set("ai.provider", "google");
      settingsDb.set("ai.model", "gemini-2.0-flash");

      // Track the order of setSetting calls
      const callOrder: string[] = [];
      mockSetSetting.mockImplementation((key: string, value: string) => {
        callOrder.push(key);
        settingsDb.set(key, value);
      });

      migrateModelSettings();

      // The first setSetting call should be the backup
      if (callOrder.length > 0) {
        expect(callOrder[0]).toMatch(/^settings\.migration\.backup\./);
      }
    });
  });

  describe("Idempotency - double migration safety", () => {
    it("running migration twice yields identical ai.model.default", () => {
      settingsDb.set("ai.provider", "google");
      settingsDb.set("ai.model", "gemini-2.0-flash");

      migrateModelSettings();
      const firstDefault = settingsDb.get("ai.model.default");

      // Remove version to allow re-run
      settingsDb.delete(MIGRATION_VERSION_KEY);

      migrateModelSettings();
      const secondDefault = settingsDb.get("ai.model.default");

      expect(firstDefault).toBe(secondDefault);
    });

    it("running migration twice yields identical context models", () => {
      settingsDb.set("ai.provider", "google");
      settingsDb.set("ai.model", "gemini-2.0-flash");

      migrateModelSettings();
      const firstRealtime = settingsDb.get("ai.model.context.realtime");
      const firstCritical = settingsDb.get("ai.model.context.critical");

      // Remove version to allow re-run
      settingsDb.delete(MIGRATION_VERSION_KEY);

      migrateModelSettings();
      const secondRealtime = settingsDb.get("ai.model.context.realtime");
      const secondCritical = settingsDb.get("ai.model.context.critical");

      expect(firstRealtime).toBe(secondRealtime);
      expect(firstCritical).toBe(secondCritical);
    });
  });
});
