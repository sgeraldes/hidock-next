import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

const mockConfigure = vi.hoisted(() => vi.fn());
const mockGetModel = vi.hoisted(() => vi.fn().mockReturnValue({}));
const mockSetModel = vi.hoisted(() => vi.fn());

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
    getPath: vi.fn().mockReturnValue("/tmp/test"),
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
      const models: Record<string, Record<string, { id: string; deprecated?: boolean; migratesTo?: string }>> = {
        google: {
          "gemini-2.5-flash": { id: "gemini-2.5-flash" },
          "gemini-2.5-pro": { id: "gemini-2.5-pro" },
          "gemini-2.0-flash": { id: "gemini-2.0-flash", deprecated: true, migratesTo: "gemini-2.5-flash" },
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
    configure: mockConfigure,
    getModel: mockGetModel,
  }),
}));

vi.mock("../ipc/translation-handlers", () => ({
  getTranslationService: vi.fn().mockReturnValue({ setModel: mockSetModel }),
  getSummarizationService: vi.fn().mockReturnValue({ setModel: mockSetModel }),
}));

vi.mock("../ipc/meeting-type-handlers", () => ({
  getEndOfMeetingProcessor: vi.fn().mockReturnValue({ setModel: mockSetModel }),
}));

// --- Collect IPC handlers ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type IpcHandler = (event: any, ...args: any[]) => any;

const handlers = new Map<string, IpcHandler>();

import { ipcMain } from "electron";

// Capture handlers registered via ipcMain.handle
vi.mocked(ipcMain.handle).mockImplementation(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (channel: string, handler: (event: any, ...args: any[]) => any) => {
    handlers.set(channel, handler);
    return undefined as never;
  },
);

// --- Import module under test ---

import {
  registerSettingsHandlers,
  migrateModelSettings,
  MIGRATION_VERSION_KEY,
  CURRENT_MIGRATION_VERSION,
} from "../ipc/settings-handlers";
import { modelConfig } from "../services/model-config";

// Helper to call a registered IPC handler
function callHandler(channel: string, ...args: unknown[]): unknown {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`No handler registered for channel: ${channel}`);
  // First arg is the IpcMainInvokeEvent, pass null
  return handler(null, ...args);
}

describe("Context-aware model settings", () => {
  beforeEach(() => {
    settingsDb.clear();
    handlers.clear();
    vi.clearAllMocks();

    // Re-register handlers
    registerSettingsHandlers();

    // Set up with known state
    settingsDb.set("ai.provider", "google");
    settingsDb.set("ai.model.default", "gemini-2.5-flash");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("settings:getModelForContext", () => {
    it("returns context-specific model when set and valid", () => {
      settingsDb.set("ai.model.context.critical", "gemini-2.5-pro");
      const model = callHandler("settings:getModelForContext", "critical");
      expect(model).toBe("gemini-2.5-pro");
    });

    it("falls back to default when context not set", () => {
      // No context.realtime set, should fall back to ai.model.default
      const model = callHandler("settings:getModelForContext", "realtime");
      expect(model).toBe("gemini-2.5-flash");
    });

    it("falls back to config default when no settings at all", () => {
      settingsDb.delete("ai.model.default");
      settingsDb.delete("ai.model.context.realtime");
      const model = callHandler("settings:getModelForContext", "realtime");
      expect(model).toBeTruthy();
      expect(model).toBe("gemini-2.5-flash"); // config default
    });

    it("skips deprecated context model and falls back to default", () => {
      settingsDb.set("ai.model.context.realtime", "gemini-2.0-flash");
      const model = callHandler("settings:getModelForContext", "realtime");
      // Should NOT return the deprecated model
      expect(model).not.toBe("gemini-2.0-flash");
      expect(model).toBe("gemini-2.5-flash"); // falls to ai.model.default
    });

    it("skips deprecated default model and falls back to config", () => {
      settingsDb.set("ai.model.default", "gemini-2.0-flash");
      const model = callHandler("settings:getModelForContext", "realtime");
      expect(model).not.toBe("gemini-2.0-flash");
      expect(model).toBe("gemini-2.5-flash"); // config default
    });

    it("returns different models for different contexts", () => {
      settingsDb.set("ai.model.context.realtime", "gemini-2.5-flash");
      settingsDb.set("ai.model.context.critical", "gemini-2.5-pro");

      const realtime = callHandler("settings:getModelForContext", "realtime");
      const critical = callHandler("settings:getModelForContext", "critical");

      expect(realtime).toBe("gemini-2.5-flash");
      expect(critical).toBe("gemini-2.5-pro");
    });
  });

  describe("settings:set with ai.model redirect", () => {
    it("redirects ai.model to ai.model.default", () => {
      callHandler("settings:set", "ai.model", "gemini-2.5-flash");
      expect(settingsDb.get("ai.model.default")).toBe("gemini-2.5-flash");
    });

    it("does not override context models when default changes", () => {
      settingsDb.set("ai.model.context.critical", "gemini-2.5-pro");
      callHandler("settings:set", "ai.model.default", "gemini-2.5-flash");
      expect(settingsDb.get("ai.model.context.critical")).toBe("gemini-2.5-pro");
    });

    it("redirects deprecated model to config default", () => {
      callHandler("settings:set", "ai.model.default", "gemini-2.0-flash");
      // The deprecated model should be redirected to the config default
      expect(settingsDb.get("ai.model.default")).toBe("gemini-2.5-flash");
    });
  });

  describe("provider change behavior", () => {
    it("updates default model when provider changes and current is invalid", () => {
      settingsDb.set("ai.model.default", "gemini-2.5-flash");
      callHandler("settings:set", "ai.provider", "openai");
      const defaultModel = settingsDb.get("ai.model.default");
      expect(defaultModel).toBe("gpt-4o");
    });

    it("keeps default model when provider changes and model is still valid", () => {
      // Mock validateModel to return true for cross-provider
      vi.mocked(modelConfig.validateModel).mockReturnValueOnce(true);

      settingsDb.set("ai.model.default", "gemini-2.5-flash");
      callHandler("settings:set", "ai.provider", "openai");
      // Since we mocked it as valid, default should not change
      expect(settingsDb.get("ai.model.default")).toBe("gemini-2.5-flash");
    });
  });

  describe("settings:getAll returns context keys", () => {
    it("includes ai.model.context.* keys in getAll response", () => {
      settingsDb.set("ai.model.context.realtime", "gemini-2.5-flash");
      settingsDb.set("ai.model.context.critical", "gemini-2.5-pro");

      const result = callHandler("settings:getAll") as Record<string, string>;
      expect(result["ai.model.context.realtime"]).toBe("gemini-2.5-flash");
      expect(result["ai.model.context.critical"]).toBe("gemini-2.5-pro");
    });
  });
});

describe("migrateModelSettings", () => {
  beforeEach(() => {
    settingsDb.clear();
    vi.clearAllMocks();
  });

  it("migrates ai.model to ai.model.default", () => {
    settingsDb.set("ai.provider", "google");
    settingsDb.set("ai.model", "gemini-2.5-flash");

    migrateModelSettings();

    expect(settingsDb.get("ai.model.default")).toBe("gemini-2.5-flash");
  });

  it("migrates deprecated model (gemini-2.0-flash -> gemini-2.5-flash)", () => {
    settingsDb.set("ai.provider", "google");
    settingsDb.set("ai.model", "gemini-2.0-flash");

    migrateModelSettings();

    expect(settingsDb.get("ai.model.default")).toBe("gemini-2.5-flash");
  });

  it("does not re-run if already migrated", () => {
    settingsDb.set(MIGRATION_VERSION_KEY, CURRENT_MIGRATION_VERSION);
    const spy = vi.spyOn(console, "log");

    migrateModelSettings();

    expect(spy).not.toHaveBeenCalledWith(
      expect.stringContaining("Starting model settings"),
    );
    spy.mockRestore();
  });

  it("backs up settings before migration", () => {
    settingsDb.set("ai.provider", "google");
    settingsDb.set("ai.model", "gemini-2.0-flash");

    migrateModelSettings();

    // Check that a backup key was created
    const backupKeys = Array.from(settingsDb.keys()).filter(
      (k) => k.startsWith("settings.migration.backup."),
    );
    expect(backupKeys.length).toBeGreaterThan(0);

    const backup = JSON.parse(settingsDb.get(backupKeys[0])!);
    expect(backup.provider).toBe("google");
    expect(backup.model).toBe("gemini-2.0-flash");
  });

  it("populates context defaults from config", () => {
    settingsDb.set("ai.provider", "google");

    migrateModelSettings();

    const realtimeModel = settingsDb.get("ai.model.context.realtime");
    expect(realtimeModel).toBeTruthy();
    const criticalModel = settingsDb.get("ai.model.context.critical");
    expect(criticalModel).toBeTruthy();
  });

  it("sets migration version after completion", () => {
    settingsDb.set("ai.provider", "google");

    migrateModelSettings();

    expect(settingsDb.get(MIGRATION_VERSION_KEY)).toBe(CURRENT_MIGRATION_VERSION);
  });

  it("ensures ai.model.default has a value even on clean install", () => {
    // No ai.model or ai.model.default set
    migrateModelSettings();

    const defaultModel = settingsDb.get("ai.model.default");
    expect(defaultModel).toBeTruthy();
  });

  it("does not overwrite existing ai.model.default during migration", () => {
    settingsDb.set("ai.provider", "google");
    settingsDb.set("ai.model", "gemini-2.0-flash");
    settingsDb.set("ai.model.default", "gemini-2.5-pro");

    migrateModelSettings();

    // Should NOT overwrite the existing ai.model.default with the old ai.model value
    // Migration 1 skips because ai.model.default already exists
    // But Migration 2 may upgrade it if it's deprecated (it's not in this case)
    expect(settingsDb.get("ai.model.default")).toBe("gemini-2.5-pro");
  });

  it("does not overwrite existing context models", () => {
    settingsDb.set("ai.provider", "google");
    settingsDb.set("ai.model.context.realtime", "gemini-2.5-pro");

    migrateModelSettings();

    // Should keep the existing user override
    expect(settingsDb.get("ai.model.context.realtime")).toBe("gemini-2.5-pro");
  });

  it("is idempotent - calling twice produces same result", () => {
    settingsDb.set("ai.provider", "google");
    settingsDb.set("ai.model", "gemini-2.0-flash");

    migrateModelSettings();

    const stateAfterFirst = new Map(settingsDb);

    // Reset version to allow second run
    settingsDb.delete(MIGRATION_VERSION_KEY);

    migrateModelSettings();

    // Key values should be the same (except backup key timestamps differ)
    expect(settingsDb.get("ai.model.default")).toBe(
      stateAfterFirst.get("ai.model.default"),
    );
    expect(settingsDb.get("ai.model.context.realtime")).toBe(
      stateAfterFirst.get("ai.model.context.realtime"),
    );
  });
});

describe("Context model independence", () => {
  beforeEach(() => {
    settingsDb.clear();
    handlers.clear();
    vi.clearAllMocks();

    registerSettingsHandlers();

    settingsDb.set("ai.provider", "google");
    settingsDb.set("ai.model.default", "gemini-2.5-flash");
    settingsDb.set("ai.model.context.critical", "gemini-2.5-pro");
    settingsDb.set("ai.model.context.realtime", "gemini-2.5-flash");
  });

  it("changing default model does NOT change context models", () => {
    callHandler("settings:set", "ai.model.default", "gemini-2.5-flash");

    expect(settingsDb.get("ai.model.context.critical")).toBe("gemini-2.5-pro");
    expect(settingsDb.get("ai.model.context.realtime")).toBe("gemini-2.5-flash");
  });

  it("changing one context model does NOT change other contexts", () => {
    callHandler("settings:set", "ai.model.context.realtime", "gemini-2.5-pro");

    // realtime updated, critical untouched
    expect(settingsDb.get("ai.model.context.realtime")).toBe("gemini-2.5-pro");
    expect(settingsDb.get("ai.model.context.critical")).toBe("gemini-2.5-pro");
    expect(settingsDb.get("ai.model.default")).toBe("gemini-2.5-flash");
  });

  it("context model resolution is independent per context", () => {
    const realtime = callHandler("settings:getModelForContext", "realtime");
    const critical = callHandler("settings:getModelForContext", "critical");
    const batch = callHandler("settings:getModelForContext", "batch");

    expect(realtime).toBe("gemini-2.5-flash");
    expect(critical).toBe("gemini-2.5-pro");
    // batch not set, falls through to default
    expect(batch).toBe("gemini-2.5-flash");
  });
});
