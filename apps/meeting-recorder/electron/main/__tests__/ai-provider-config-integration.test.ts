import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * AI Provider + Config Integration Tests
 *
 * These tests verify that AIProviderService correctly integrates with the
 * ModelConfigService for config-based model loading. They do NOT duplicate
 * the basic configure/transcribe tests in ai-provider.test.ts, but instead
 * focus on the config-integration seams:
 *
 * - createModel passes the config model ID to the SDK (no hardcoding)
 * - Transcription fallback uses config (not hardcoded model strings)
 * - isAudioCapableForConfig delegates to modelConfig
 * - Deprecated model warning in configure()
 * - Config default used when no model specified
 */

// --- Hoisted mocks ---

const { mockGoogleModel, mockGenerateObject } = vi.hoisted(() => ({
  mockGoogleModel: vi.fn().mockReturnValue({ modelId: "gemini-2.5-flash" }),
  mockGenerateObject: vi.fn().mockResolvedValue({
    object: {
      segments: [{ speaker: "Speaker 1", text: "Hello world" }],
      topics: ["greeting"],
      actionItems: [],
    },
  }),
}));

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: vi.fn().mockReturnValue(mockGoogleModel),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn().mockReturnValue(vi.fn().mockReturnValue({ modelId: "gpt-4o" })),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn().mockReturnValue(vi.fn().mockReturnValue({ modelId: "claude" })),
}));

vi.mock("@ai-sdk/amazon-bedrock", () => ({
  createAmazonBedrock: vi.fn().mockReturnValue(vi.fn().mockReturnValue({ modelId: "bedrock" })),
}));

vi.mock("ollama-ai-provider", () => ({
  createOllama: vi.fn().mockReturnValue(vi.fn().mockReturnValue({ modelId: "llama" })),
}));

vi.mock("ai", () => ({
  generateObject: (...args: unknown[]) => mockGenerateObject(...args),
}));

vi.mock("electron", () => ({
  app: { getPath: vi.fn().mockReturnValue("/tmp/test") },
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
}));

const mockModelConfig = vi.hoisted(() => ({
  validateModel: vi.fn().mockReturnValue(true),
  isModelDeprecated: vi.fn().mockReturnValue(false),
  getDeprecationMigration: vi.fn().mockReturnValue(null),
  getDefaultModel: vi.fn().mockReturnValue("gemini-2.5-flash"),
  getModelForContext: vi.fn().mockReturnValue("gemini-2.5-flash"),
  isAudioCapable: vi.fn().mockImplementation((p: string) => p === "google"),
  getCostMultiplier: vi.fn().mockReturnValue(1),
  getModelsForProvider: vi.fn().mockReturnValue([]),
  getActiveModelsForProvider: vi.fn().mockReturnValue([]),
  getFullConfig: vi.fn().mockReturnValue({ version: 1, providers: {}, contexts: {} }),
  getProviderIds: vi.fn().mockReturnValue(["google", "openai"]),
  getContextIds: vi.fn().mockReturnValue(["realtime", "postprocess", "critical", "batch"]),
  reload: vi.fn(),
}));

vi.mock("../services/model-config", () => ({
  modelConfig: mockModelConfig,
}));

import { AIProviderService } from "../services/ai-provider";

describe("AIProviderService - Config Integration", () => {
  let service: AIProviderService;

  beforeEach(() => {
    mockGoogleModel.mockClear();
    mockGenerateObject.mockClear();
    vi.clearAllMocks();

    // Restore default mock implementations
    mockModelConfig.validateModel.mockReturnValue(true);
    mockModelConfig.isModelDeprecated.mockReturnValue(false);
    mockModelConfig.getDeprecationMigration.mockReturnValue(null);
    mockModelConfig.getDefaultModel.mockReturnValue("gemini-2.5-flash");
    mockModelConfig.getModelForContext.mockReturnValue("gemini-2.5-flash");
    mockModelConfig.isAudioCapable.mockImplementation((p: string) => p === "google");

    mockGenerateObject.mockResolvedValue({
      object: {
        segments: [{ speaker: "Speaker 1", text: "Hello world" }],
        topics: ["greeting"],
        actionItems: [],
      },
    });

    service = new AIProviderService();
  });

  describe("createModel uses config-based model", () => {
    it("uses specified model from config parameter", () => {
      service.configure({
        provider: "google",
        model: "gemini-2.5-flash",
        apiKey: "test-key",
      });

      expect(mockGoogleModel).toHaveBeenCalledWith("gemini-2.5-flash");
    });

    it("passes different model IDs correctly to SDK", () => {
      service.configure({
        provider: "google",
        model: "gemini-2.5-pro",
        apiKey: "test-key",
      });

      expect(mockGoogleModel).toHaveBeenCalledWith("gemini-2.5-pro");
    });

    it("uses config default when model is empty string", () => {
      mockModelConfig.getDefaultModel.mockReturnValue("gemini-2.5-flash");

      service.configure({
        provider: "google",
        model: "",
        apiKey: "test-key",
      });

      // Empty model -> falls back to modelConfig.getDefaultModel()
      expect(mockGoogleModel).toHaveBeenCalledWith("gemini-2.5-flash");
    });

    it("does not hardcode any model string in createModel", () => {
      // The model passed to the SDK should be exactly what was in config.model
      const customModel = "gemini-custom-test-model";
      service.configure({
        provider: "google",
        model: customModel,
        apiKey: "test-key",
      });

      expect(mockGoogleModel).toHaveBeenCalledWith(customModel);
    });
  });

  describe("configure validates model against config", () => {
    it("warns when model is not found in config", () => {
      mockModelConfig.validateModel.mockReturnValue(false);
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      service.configure({
        provider: "google",
        model: "unknown-model-id",
        apiKey: "test-key",
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("not found in config"),
      );
      warnSpy.mockRestore();
    });

    it("does not warn for valid model", () => {
      mockModelConfig.validateModel.mockReturnValue(true);
      mockModelConfig.isModelDeprecated.mockReturnValue(false);
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      service.configure({
        provider: "google",
        model: "gemini-2.5-flash",
        apiKey: "test-key",
      });

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("warns when model is deprecated with migration target", () => {
      mockModelConfig.isModelDeprecated.mockReturnValue(true);
      mockModelConfig.getDeprecationMigration.mockReturnValue("gemini-2.5-flash");
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      service.configure({
        provider: "google",
        model: "gemini-2.0-flash",
        apiKey: "test-key",
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("deprecated"),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("gemini-2.5-flash"),
      );
      warnSpy.mockRestore();
    });

    it("warns when model is deprecated without migration target", () => {
      mockModelConfig.isModelDeprecated.mockReturnValue(true);
      mockModelConfig.getDeprecationMigration.mockReturnValue(null);
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      service.configure({
        provider: "google",
        model: "gemini-old",
        apiKey: "test-key",
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("deprecated"),
      );
      warnSpy.mockRestore();
    });
  });

  describe("isAudioCapableForConfig uses config data", () => {
    it("delegates to modelConfig.isAudioCapable for google", () => {
      service.configure({
        provider: "google",
        model: "gemini-2.5-flash",
        apiKey: "test-key",
      });

      expect(service.isAudioCapable()).toBe(true);
      expect(mockModelConfig.isAudioCapable).toHaveBeenCalledWith("google");
    });

    it("delegates to modelConfig.isAudioCapable for openai", () => {
      service.configure({
        provider: "openai",
        model: "gpt-4o",
        apiKey: "test-key",
      });

      expect(service.isAudioCapable()).toBe(false);
      expect(mockModelConfig.isAudioCapable).toHaveBeenCalledWith("openai");
    });
  });

  describe("transcription fallback uses config", () => {
    it("transcription model for text-only provider uses config context lookup", () => {
      mockModelConfig.isAudioCapable.mockReturnValue(false);
      mockModelConfig.getModelForContext.mockReturnValue("gemini-2.5-flash");
      mockModelConfig.getDefaultModel.mockReturnValue("gemini-2.5-flash");

      service.configure({
        provider: "openai",
        model: "gpt-4o",
        apiKey: "test-openai-key",
        transcriptionProvider: "google",
        transcriptionApiKey: "test-google-key",
      });

      // Verify the config service was consulted for transcription model
      expect(mockModelConfig.getModelForContext).toHaveBeenCalledWith("google", "realtime");
    });

    it("uses transcriptionModel override from config when provided", () => {
      mockModelConfig.isAudioCapable.mockReturnValue(false);

      service.configure({
        provider: "openai",
        model: "gpt-4o",
        apiKey: "test-openai-key",
        transcriptionProvider: "google",
        transcriptionApiKey: "test-google-key",
        transcriptionModel: "gemini-2.5-pro",
      });

      // When transcriptionModel is specified, it should be used directly
      expect(mockGoogleModel).toHaveBeenCalledWith("gemini-2.5-pro");
    });

    it("fallback returns correct schema on API failure", async () => {
      service.configure({
        provider: "google",
        model: "gemini-2.5-flash",
        apiKey: "test-key",
      });

      mockGenerateObject.mockRejectedValueOnce(new Error("model unavailable"));

      const result = await service.transcribe("Some text input");

      // Verify exact fallback format
      expect(result).toEqual({
        segments: [
          {
            speaker: "Unknown",
            text: "Some text input",
            sentiment: "neutral",
          },
        ],
        topics: [],
        actionItems: [],
      });
    });

    it("audio fallback returns correct schema on API failure", async () => {
      service.configure({
        provider: "google",
        model: "gemini-2.5-flash",
        apiKey: "test-key",
      });

      mockGenerateObject.mockRejectedValueOnce(new Error("audio decode failed"));

      const audioData = Buffer.from([0x4f, 0x67, 0x67, 0x53]);
      const result = await service.transcribeAudio(audioData, "audio/ogg");

      expect(result).toEqual({
        segments: [
          {
            speaker: "Unknown",
            text: "[Audio transcription failed]",
            sentiment: "neutral",
          },
        ],
        topics: [],
        actionItems: [],
      });
    });
  });

  describe("error handling during model creation", () => {
    it("throws for unknown provider", () => {
      expect(() =>
        service.configure({
          provider: "nonexistent" as never,
          model: "some-model",
          apiKey: "key",
        }),
      ).toThrow(/Unknown provider/);
    });
  });
});
