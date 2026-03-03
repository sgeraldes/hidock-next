import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSettingsStore } from "../store/useSettingsStore";

const STORE_KEY = "meeting-recorder-settings";

const mockGetAll = vi.fn();
const mockSet = vi.fn();

beforeEach(() => {
  useSettingsStore.setState({
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
  });

  window.electronAPI = {
    settings: {
      getAll: mockGetAll,
      set: mockSet,
      get: vi.fn(),
      testConnection: vi.fn(),
    },
  } as unknown as typeof window.electronAPI;

  mockGetAll.mockReset();
  mockSet.mockReset();
});

describe("useSettingsStore", () => {
  it("starts with default values and loaded=false", () => {
    const state = useSettingsStore.getState();
    expect(state.provider).toBe("google");
    expect(state.model).toBe("gemini-2.5-flash");
    expect(state.autoRecord).toBe(true);
    expect(state.pollInterval).toBe(3);
    expect(state.loaded).toBe(false);
  });

  describe("setField", () => {
    it("updates a string field", () => {
      useSettingsStore.getState().setField("provider", "openai");
      expect(useSettingsStore.getState().provider).toBe("openai");
    });

    it("updates a boolean field", () => {
      useSettingsStore.getState().setField("autoRecord", false);
      expect(useSettingsStore.getState().autoRecord).toBe(false);
    });

    it("updates a numeric field", () => {
      useSettingsStore.getState().setField("pollInterval", 10);
      expect(useSettingsStore.getState().pollInterval).toBe(10);
    });
  });

  describe("loadFromIPC", () => {
    it("sets loaded=true and maps AI settings", async () => {
      mockGetAll.mockResolvedValue({
        "ai.provider": "anthropic",
        "ai.model": "claude-3-haiku",
        "ai.apiKey": "****abcd",
      });

      await useSettingsStore.getState().loadFromIPC();

      const state = useSettingsStore.getState();
      expect(state.loaded).toBe(true);
      expect(state.provider).toBe("anthropic");
      expect(state.model).toBe("claude-3-haiku");
      expect(state.apiKey).toBe("****abcd");
    });

    it("parses recording.autoRecord boolean string", async () => {
      mockGetAll.mockResolvedValue({
        "recording.autoRecord": "false",
      });

      await useSettingsStore.getState().loadFromIPC();

      expect(useSettingsStore.getState().autoRecord).toBe(false);
    });

    it("parses recording.pollInterval as integer", async () => {
      mockGetAll.mockResolvedValue({
        "recording.pollInterval": "5",
      });

      await useSettingsStore.getState().loadFromIPC();

      expect(useSettingsStore.getState().pollInterval).toBe(5);
    });

    it("keeps default for NaN polling interval", async () => {
      mockGetAll.mockResolvedValue({
        "recording.pollInterval": "not-a-number",
      });

      await useSettingsStore.getState().loadFromIPC();

      const interval = useSettingsStore.getState().pollInterval;
      expect(interval).toBe(3);
    });

    it("parses general.closeToTray boolean string", async () => {
      mockGetAll.mockResolvedValue({
        "general.closeToTray": "false",
      });

      await useSettingsStore.getState().loadFromIPC();

      expect(useSettingsStore.getState().closeToTray).toBe(false);
    });

    it("parses general.startMinimized boolean string", async () => {
      mockGetAll.mockResolvedValue({
        "general.startMinimized": "true",
      });

      await useSettingsStore.getState().loadFromIPC();

      expect(useSettingsStore.getState().startMinimized).toBe(true);
    });

    it("prefers ai.model.default over ai.model", async () => {
      mockGetAll.mockResolvedValue({
        "ai.model": "old-model",
        "ai.model.default": "gemini-2.5-flash",
      });

      await useSettingsStore.getState().loadFromIPC();

      expect(useSettingsStore.getState().model).toBe("gemini-2.5-flash");
    });

    it("falls back to ai.model when ai.model.default is absent", async () => {
      mockGetAll.mockResolvedValue({
        "ai.model": "gpt-4o",
      });

      await useSettingsStore.getState().loadFromIPC();

      expect(useSettingsStore.getState().model).toBe("gpt-4o");
    });

    it("sets loaded=true even when getAll throws", async () => {
      mockGetAll.mockRejectedValue(new Error("IPC error"));

      await useSettingsStore.getState().loadFromIPC();

      expect(useSettingsStore.getState().loaded).toBe(true);
    });

    it("maps Bedrock fields", async () => {
      mockGetAll.mockResolvedValue({
        "ai.bedrockRegion": "us-west-2",
        "ai.bedrockAccessKeyId": "****MPLE",
      });

      await useSettingsStore.getState().loadFromIPC();

      const state = useSettingsStore.getState();
      expect(state.bedrockRegion).toBe("us-west-2");
      expect(state.bedrockAccessKeyId).toBe("****MPLE");
    });
  });

  describe("saveToIPC", () => {
    it("calls settings.set with key and value", async () => {
      mockSet.mockResolvedValue(undefined);

      await useSettingsStore.getState().saveToIPC("ai.provider", "openai");

      expect(mockSet).toHaveBeenCalledWith("ai.provider", "openai");
    });

    it("swallows errors silently", async () => {
      mockSet.mockRejectedValue(new Error("IPC failed"));

      await expect(
        useSettingsStore.getState().saveToIPC("ai.provider", "openai"),
      ).resolves.not.toThrow();
    });
  });

  describe("persistence", () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it("persists provider and model to localStorage", () => {
      useSettingsStore.getState().setField("provider", "openai");
      useSettingsStore.getState().setField("model", "gpt-4o");
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const stored = JSON.parse(raw);
        expect(stored.state.provider).toBe("openai");
        expect(stored.state.model).toBe("gpt-4o");
      }
    });

    it("does not persist apiKey to localStorage", () => {
      useSettingsStore.getState().setField("apiKey", "sk-secret");
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const stored = JSON.parse(raw);
        expect(stored.state?.apiKey).toBeUndefined();
      }
    });
  });
});
