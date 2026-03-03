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
      const models: Record<string, Record<string, {
        id: string;
        deprecated?: boolean;
        migratesTo?: string;
        costMultiplier?: number;
      }>> = {
        google: {
          "gemini-2.5-flash": { id: "gemini-2.5-flash", costMultiplier: 1 },
          "gemini-2.5-pro": { id: "gemini-2.5-pro", costMultiplier: 10 },
          "gemini-2.0-flash": {
            id: "gemini-2.0-flash",
            deprecated: true,
            migratesTo: "gemini-2.5-flash",
            costMultiplier: 1,
          },
        },
        openai: {
          "gpt-4o": { id: "gpt-4o", costMultiplier: 5 },
          "gpt-4-turbo": { id: "gpt-4-turbo", costMultiplier: 8 },
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
    getCostMultiplier: vi.fn().mockImplementation((_p: string, modelId: string) => {
      const costs: Record<string, number> = {
        "gemini-2.5-flash": 1,
        "gemini-2.5-pro": 10,
        "gpt-4o": 5,
        "gpt-4-turbo": 8,
      };
      return costs[modelId] ?? 1;
    }),
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
import { modelConfig } from "../services/model-config";

// Capture handlers registered via ipcMain.handle
vi.mocked(ipcMain.handle).mockImplementation(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (channel: string, handler: (event: any, ...args: any[]) => any) => {
    handlers.set(channel, handler);
    return undefined as never;
  },
);

import { registerSettingsHandlers } from "../ipc/settings-handlers";

// Helper to call a registered IPC handler
function callHandler(channel: string, ...args: unknown[]): unknown {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`No handler registered for channel: ${channel}`);
  return handler(null, ...args);
}

describe("Context-Aware Model Selection - Extended", () => {
  beforeEach(() => {
    settingsDb.clear();
    handlers.clear();
    vi.clearAllMocks();

    registerSettingsHandlers();

    settingsDb.set("ai.provider", "google");
    settingsDb.set("ai.model.default", "gemini-2.5-flash");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Fallback Chain Resolution", () => {
    it("uses context model when set and valid", () => {
      settingsDb.set("ai.model.context.critical", "gemini-2.5-pro");
      const model = callHandler("settings:getModelForContext", "critical");
      expect(model).toBe("gemini-2.5-pro");
    });

    it("falls back to ai.model.default when context key is unset", () => {
      // No context key for 'batch'
      settingsDb.set("ai.model.default", "gemini-2.5-flash");
      const model = callHandler("settings:getModelForContext", "batch");
      expect(model).toBe("gemini-2.5-flash");
    });

    it("falls back to config default when both context and default are unset", () => {
      settingsDb.delete("ai.model.default");
      settingsDb.delete("ai.model.context.realtime");
      const model = callHandler("settings:getModelForContext", "realtime");
      expect(model).toBeTruthy();
      // Should fall through to modelConfig.getDefaultModel("google") = "gemini-2.5-flash"
      expect(model).toBe("gemini-2.5-flash");
    });

    it("skips deprecated context model and falls back to default", () => {
      settingsDb.set("ai.model.context.realtime", "gemini-2.0-flash");
      const model = callHandler("settings:getModelForContext", "realtime");
      expect(model).not.toBe("gemini-2.0-flash");
      expect(model).toBe("gemini-2.5-flash");
    });

    it("skips deprecated default model and uses config fallback", () => {
      settingsDb.set("ai.model.default", "gemini-2.0-flash");
      settingsDb.delete("ai.model.context.realtime");
      const model = callHandler("settings:getModelForContext", "realtime");
      expect(model).not.toBe("gemini-2.0-flash");
      expect(model).toBe("gemini-2.5-flash");
    });

    it("skips unknown context model and uses default", () => {
      settingsDb.set("ai.model.context.realtime", "nonexistent-model");
      const model = callHandler("settings:getModelForContext", "realtime");
      // nonexistent-model returns null from getModel mock -> falls through
      expect(model).toBe("gemini-2.5-flash");
    });
  });

  describe("Context Model Persistence After Provider Switch", () => {
    it("context models persist in DB after provider changes", () => {
      settingsDb.set("ai.model.context.critical", "gemini-2.5-pro");
      settingsDb.set("ai.model.context.realtime", "gemini-2.5-flash");

      // Switch provider to OpenAI
      callHandler("settings:set", "ai.provider", "openai");

      // Context keys should still exist in the database
      expect(settingsDb.get("ai.model.context.critical")).toBe("gemini-2.5-pro");
      expect(settingsDb.get("ai.model.context.realtime")).toBe("gemini-2.5-flash");
    });

    it("default model updates when provider changes to incompatible model", () => {
      settingsDb.set("ai.model.default", "gemini-2.5-flash");

      // Switch provider to OpenAI - gemini model invalid for openai
      callHandler("settings:set", "ai.provider", "openai");

      // Default model should have been updated to openai's default
      expect(settingsDb.get("ai.model.default")).toBe("gpt-4o");
    });

    it("default model stays when provider changes with cross-valid model", () => {
      settingsDb.set("ai.model.default", "gemini-2.5-flash");

      // Make validateModel return true for this case
      vi.mocked(modelConfig.validateModel).mockReturnValueOnce(true);

      callHandler("settings:set", "ai.provider", "openai");

      // Default should not change because model is considered valid
      expect(settingsDb.get("ai.model.default")).toBe("gemini-2.5-flash");
    });
  });

  describe("Bulk Context Model Updates", () => {
    it("can set all contexts independently without interference", () => {
      callHandler("settings:set", "ai.model.context.realtime", "gemini-2.5-flash");
      callHandler("settings:set", "ai.model.context.postprocess", "gemini-2.5-pro");
      callHandler("settings:set", "ai.model.context.critical", "gemini-2.5-pro");
      callHandler("settings:set", "ai.model.context.batch", "gemini-2.5-flash");

      expect(settingsDb.get("ai.model.context.realtime")).toBe("gemini-2.5-flash");
      expect(settingsDb.get("ai.model.context.postprocess")).toBe("gemini-2.5-pro");
      expect(settingsDb.get("ai.model.context.critical")).toBe("gemini-2.5-pro");
      expect(settingsDb.get("ai.model.context.batch")).toBe("gemini-2.5-flash");
    });

    it("updating one context does not change others", () => {
      settingsDb.set("ai.model.context.realtime", "gemini-2.5-flash");
      settingsDb.set("ai.model.context.critical", "gemini-2.5-pro");

      callHandler("settings:set", "ai.model.context.realtime", "gemini-2.5-pro");

      // Only realtime changed
      expect(settingsDb.get("ai.model.context.realtime")).toBe("gemini-2.5-pro");
      expect(settingsDb.get("ai.model.context.critical")).toBe("gemini-2.5-pro");
    });

    it("getAll returns all context keys after bulk set", () => {
      settingsDb.set("ai.model.context.realtime", "gemini-2.5-flash");
      settingsDb.set("ai.model.context.postprocess", "gemini-2.5-pro");
      settingsDb.set("ai.model.context.critical", "gemini-2.5-pro");

      const all = callHandler("settings:getAll") as Record<string, string>;
      expect(all["ai.model.context.realtime"]).toBe("gemini-2.5-flash");
      expect(all["ai.model.context.postprocess"]).toBe("gemini-2.5-pro");
      expect(all["ai.model.context.critical"]).toBe("gemini-2.5-pro");
    });

    it("context resolution returns correct model for each context after bulk set", () => {
      settingsDb.set("ai.model.context.realtime", "gemini-2.5-flash");
      settingsDb.set("ai.model.context.critical", "gemini-2.5-pro");

      const realtime = callHandler("settings:getModelForContext", "realtime");
      const critical = callHandler("settings:getModelForContext", "critical");
      const batch = callHandler("settings:getModelForContext", "batch");

      expect(realtime).toBe("gemini-2.5-flash");
      expect(critical).toBe("gemini-2.5-pro");
      // batch not set -> falls back to default
      expect(batch).toBe("gemini-2.5-flash");
    });
  });

  describe("Cost Acknowledgment Tracking", () => {
    it("no costAck stored means warning should be shown", () => {
      const costAck = callHandler("settings:get", "ai.costAck.gemini-2.5-pro");
      expect(costAck).toBeNull();
    });

    it("stores cost acknowledgment with ISO timestamp", () => {
      const now = new Date().toISOString();
      callHandler("settings:set", "ai.costAck.gemini-2.5-pro", now);

      expect(settingsDb.get("ai.costAck.gemini-2.5-pro")).toBe(now);
    });

    it("acknowledged model returns stored timestamp", () => {
      const ackTimestamp = "2026-03-02T10:30:00Z";
      settingsDb.set("ai.costAck.gemini-2.5-pro", ackTimestamp);

      const value = callHandler("settings:get", "ai.costAck.gemini-2.5-pro");
      expect(value).toBe(ackTimestamp);
    });

    it("acknowledged model check is truthy", () => {
      settingsDb.set("ai.costAck.gemini-2.5-pro", "2026-03-02T10:30:00Z");
      const value = callHandler("settings:get", "ai.costAck.gemini-2.5-pro");
      expect(value).toBeTruthy();
    });

    it("cheap model has no costAck and none needed", () => {
      // Flash (costMultiplier=1) should not have costAck stored
      const value = callHandler("settings:get", "ai.costAck.gemini-2.5-flash");
      expect(value).toBeNull();
    });

    it("multiple models can have independent cost acknowledgments", () => {
      settingsDb.set("ai.costAck.gemini-2.5-pro", "2026-03-02T10:00:00Z");
      settingsDb.set("ai.costAck.gpt-4-turbo", "2026-03-02T11:00:00Z");

      const proAck = callHandler("settings:get", "ai.costAck.gemini-2.5-pro");
      const turboAck = callHandler("settings:get", "ai.costAck.gpt-4-turbo");

      expect(proAck).toBe("2026-03-02T10:00:00Z");
      expect(turboAck).toBe("2026-03-02T11:00:00Z");
    });

    it("costAck persists through model switches", () => {
      settingsDb.set("ai.costAck.gemini-2.5-pro", "2026-03-02T10:00:00Z");

      // Switch default model away
      callHandler("settings:set", "ai.model.default", "gemini-2.5-flash");

      // costAck should still be there
      expect(settingsDb.get("ai.costAck.gemini-2.5-pro")).toBe("2026-03-02T10:00:00Z");
    });

    it("costAck persists through provider switches", () => {
      settingsDb.set("ai.costAck.gemini-2.5-pro", "2026-03-02T10:00:00Z");

      callHandler("settings:set", "ai.provider", "openai");

      // costAck for the Google model should still exist
      expect(settingsDb.get("ai.costAck.gemini-2.5-pro")).toBe("2026-03-02T10:00:00Z");
    });
  });

  describe("Cost Warning Integration Logic", () => {
    it("costMultiplier > 5 with no ack means warning needed", () => {
      // Pro has costMultiplier=10 (from our mock)
      const costMultiplier = modelConfig.getCostMultiplier("google", "gemini-2.5-pro");
      const costAck = settingsDb.get("ai.costAck.gemini-2.5-pro");

      expect(costMultiplier).toBeGreaterThan(5);
      expect(costAck).toBeUndefined(); // No ack = show warning
    });

    it("costMultiplier > 5 with ack means no warning needed", () => {
      settingsDb.set("ai.costAck.gemini-2.5-pro", "2026-03-02T10:00:00Z");

      const costMultiplier = modelConfig.getCostMultiplier("google", "gemini-2.5-pro");
      const costAck = settingsDb.get("ai.costAck.gemini-2.5-pro");

      expect(costMultiplier).toBeGreaterThan(5);
      expect(costAck).toBeTruthy(); // Ack exists = no warning
    });

    it("costMultiplier <= 5 always skips warning regardless of ack", () => {
      const flashCost = modelConfig.getCostMultiplier("google", "gemini-2.5-flash");
      expect(flashCost).toBeLessThanOrEqual(5);

      // Even without ack, Flash should not trigger warning
      const costAck = settingsDb.get("ai.costAck.gemini-2.5-flash");
      expect(costAck).toBeUndefined();
      // UI rule: if costMultiplier <= 5, never show warning
    });

    it("gpt-4o at costMultiplier=5 is at the boundary (no warning)", () => {
      const cost = modelConfig.getCostMultiplier("openai", "gpt-4o");
      expect(cost).toBe(5);
      // 5 is NOT > 5, so no warning needed
    });

    it("gpt-4-turbo at costMultiplier=8 triggers warning", () => {
      const cost = modelConfig.getCostMultiplier("openai", "gpt-4-turbo");
      expect(cost).toBeGreaterThan(5);
      // Warning should be triggered for this model
    });
  });

  describe("Deprecated Model Redirect on Set", () => {
    it("setting a deprecated model redirects to provider default", () => {
      callHandler("settings:set", "ai.model.default", "gemini-2.0-flash");

      // The deprecated model should have been redirected
      expect(settingsDb.get("ai.model.default")).toBe("gemini-2.5-flash");
    });

    it("setting a deprecated context model redirects to provider default", () => {
      callHandler("settings:set", "ai.model.context.realtime", "gemini-2.0-flash");

      // Should be redirected away from deprecated model
      expect(settingsDb.get("ai.model.context.realtime")).toBe("gemini-2.5-flash");
    });
  });

  describe("AI Service Reconfiguration Triggers", () => {
    it("setting ai.model.default triggers AI reconfiguration", () => {
      mockConfigure.mockClear();
      callHandler("settings:set", "ai.model.default", "gemini-2.5-pro");

      expect(mockConfigure).toHaveBeenCalled();
    });

    it("setting ai.provider triggers AI reconfiguration", () => {
      mockConfigure.mockClear();
      callHandler("settings:set", "ai.provider", "google");

      expect(mockConfigure).toHaveBeenCalled();
    });

    it("setting context model triggers AI reconfiguration", () => {
      mockConfigure.mockClear();
      callHandler("settings:set", "ai.model.context.realtime", "gemini-2.5-pro");

      expect(mockConfigure).toHaveBeenCalled();
    });

    it("reconfiguration uses ai.model.default not context model", () => {
      settingsDb.set("ai.model.default", "gemini-2.5-flash");
      mockConfigure.mockClear();

      callHandler("settings:set", "ai.model.context.critical", "gemini-2.5-pro");

      // The configure call should use ai.model.default as the primary model
      expect(mockConfigure).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "gemini-2.5-flash",
        }),
      );
    });
  });

  describe("Legacy ai.model Key Redirect", () => {
    it("writing to ai.model actually writes to ai.model.default", () => {
      callHandler("settings:set", "ai.model", "gemini-2.5-pro");
      expect(settingsDb.get("ai.model.default")).toBe("gemini-2.5-pro");
    });

    it("writing to ai.model does not override context models", () => {
      settingsDb.set("ai.model.context.critical", "gemini-2.5-pro");

      callHandler("settings:set", "ai.model", "gemini-2.5-flash");

      expect(settingsDb.get("ai.model.context.critical")).toBe("gemini-2.5-pro");
      expect(settingsDb.get("ai.model.default")).toBe("gemini-2.5-flash");
    });
  });
});
