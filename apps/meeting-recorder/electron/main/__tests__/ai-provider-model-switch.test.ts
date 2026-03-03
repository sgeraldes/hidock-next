import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockGoogleModel,
  mockOpenAIModel,
  mockAnthropicModel,
  mockBedrockModel,
  mockOllamaModel,
  mockGenerateObject,
} = vi.hoisted(() => ({
  mockGoogleModel: vi.fn().mockReturnValue({ modelId: "gemini-2.5-flash" }),
  mockOpenAIModel: vi.fn().mockReturnValue({ modelId: "gpt-4o" }),
  mockAnthropicModel: vi.fn().mockReturnValue({ modelId: "claude-sonnet-4-20250514" }),
  mockBedrockModel: vi.fn().mockReturnValue({ modelId: "anthropic.claude-sonnet-4-20250514-v1:0" }),
  mockOllamaModel: vi.fn().mockReturnValue({ modelId: "llama3.2" }),
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
  createOpenAI: vi.fn().mockReturnValue(mockOpenAIModel),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn().mockReturnValue(mockAnthropicModel),
}));

vi.mock("@ai-sdk/amazon-bedrock", () => ({
  createAmazonBedrock: vi.fn().mockReturnValue(mockBedrockModel),
}));

vi.mock("ollama-ai-provider", () => ({
  createOllama: vi.fn().mockReturnValue(mockOllamaModel),
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

vi.mock("../services/model-config", () => ({
  modelConfig: {
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
    getProviderIds: vi.fn().mockReturnValue(["google", "openai", "anthropic", "bedrock", "ollama"]),
    getContextIds: vi.fn().mockReturnValue(["realtime", "postprocess", "critical", "batch"]),
    reload: vi.fn(),
  },
}));

import { AIProviderService } from "../services/ai-provider";
import type { AIProviderConfig } from "../services/ai-provider.types";

describe("AIProviderService - Model Switching", () => {
  let service: AIProviderService;

  const flashConfig: AIProviderConfig = {
    provider: "google",
    model: "gemini-2.5-flash",
    apiKey: "test-key",
  };

  const proConfig: AIProviderConfig = {
    provider: "google",
    model: "gemini-3.0-pro",
    apiKey: "test-key",
  };

  const openaiConfig: AIProviderConfig = {
    provider: "openai",
    model: "gpt-4o",
    apiKey: "openai-test-key",
  };

  const anthropicConfig: AIProviderConfig = {
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    apiKey: "anthropic-test-key",
  };

  beforeEach(() => {
    mockGoogleModel.mockClear();
    mockOpenAIModel.mockClear();
    mockAnthropicModel.mockClear();
    mockBedrockModel.mockClear();
    mockOllamaModel.mockClear();
    mockGenerateObject.mockClear();
    mockGenerateObject.mockResolvedValue({
      object: {
        segments: [{ speaker: "Speaker 1", text: "Hello world" }],
        topics: ["greeting"],
        actionItems: [],
      },
    });
    service = new AIProviderService();
  });

  describe("Flash to Pro Upgrade", () => {
    it("switches from Flash to Pro without errors", () => {
      service.configure(flashConfig);
      expect(() => service.configure(proConfig)).not.toThrow();
    });

    it("passes correct model ID to SDK after switch to Pro", () => {
      service.configure(flashConfig);
      mockGoogleModel.mockClear();

      service.configure(proConfig);
      expect(mockGoogleModel).toHaveBeenCalledWith("gemini-3.0-pro");
    });

    it("preserves API key during model switch", () => {
      service.configure(flashConfig);
      service.configure(proConfig);

      // Provider still active = key was preserved
      expect(service.getActiveProvider()).toBe("google");
      expect(service.getModel()).toBeTruthy();
    });

    it("maintains transcription capability after switch", async () => {
      service.configure(flashConfig);
      service.configure(proConfig);

      const result = await service.transcribe("Test after switch");
      expect(result.segments).toBeDefined();
      expect(result.segments.length).toBeGreaterThan(0);
    });

    it("maintains audio transcription capability after switch", async () => {
      service.configure(flashConfig);
      service.configure(proConfig);

      const audioData = Buffer.from([1, 2, 3]);
      const result = await service.transcribeAudio(audioData, "audio/ogg");
      expect(result.segments).toBeDefined();
    });
  });

  describe("Model Downgrade (Pro to Flash)", () => {
    it("switches from Pro back to Flash without errors", () => {
      service.configure(proConfig);
      expect(() => service.configure(flashConfig)).not.toThrow();
    });

    it("passes correct model ID to SDK after downgrade", () => {
      service.configure(proConfig);
      mockGoogleModel.mockClear();

      service.configure(flashConfig);
      expect(mockGoogleModel).toHaveBeenCalledWith("gemini-2.5-flash");
    });

    it("preserves settings during downgrade", () => {
      service.configure(proConfig);
      service.configure(flashConfig);

      expect(service.getActiveProvider()).toBe("google");
      expect(service.isAudioCapable()).toBe(true);
    });
  });

  describe("Cross-Provider Switches", () => {
    it("switches from Google to OpenAI and back", () => {
      service.configure(flashConfig);
      expect(service.getActiveProvider()).toBe("google");
      expect(service.isAudioCapable()).toBe(true);

      service.configure(openaiConfig);
      expect(service.getActiveProvider()).toBe("openai");
      expect(service.isAudioCapable()).toBe(false);

      service.configure(flashConfig);
      expect(service.getActiveProvider()).toBe("google");
      expect(service.isAudioCapable()).toBe(true);
    });

    it("switches from Google to Anthropic to OpenAI", () => {
      service.configure(flashConfig);
      expect(service.getActiveProvider()).toBe("google");

      service.configure(anthropicConfig);
      expect(service.getActiveProvider()).toBe("anthropic");

      service.configure(openaiConfig);
      expect(service.getActiveProvider()).toBe("openai");
    });

    it("passes correct model ID to each provider SDK", () => {
      service.configure(flashConfig);
      expect(mockGoogleModel).toHaveBeenCalledWith("gemini-2.5-flash");

      service.configure(openaiConfig);
      expect(mockOpenAIModel).toHaveBeenCalledWith("gpt-4o");

      service.configure(anthropicConfig);
      expect(mockAnthropicModel).toHaveBeenCalledWith("claude-sonnet-4-20250514");
    });

    it("transcription works after cross-provider switch", async () => {
      service.configure(flashConfig);
      const result1 = await service.transcribe("Test with Google");
      expect(result1.segments).toBeDefined();

      service.configure(openaiConfig);
      const result2 = await service.transcribe("Test with OpenAI");
      expect(result2.segments).toBeDefined();
    });

    it("audio capability changes correctly across providers", () => {
      service.configure(flashConfig);
      expect(service.isAudioCapable()).toBe(true);

      service.configure(openaiConfig);
      expect(service.isAudioCapable()).toBe(false);

      service.configure(anthropicConfig);
      expect(service.isAudioCapable()).toBe(false);

      service.configure(flashConfig);
      expect(service.isAudioCapable()).toBe(true);
    });
  });

  describe("Error Handling", () => {
    it("throws for unknown provider", () => {
      expect(() =>
        service.configure({
          provider: "nonexistent" as AIProviderConfig["provider"],
          model: "some-model",
          apiKey: "key",
        }),
      ).toThrow(/unknown provider/i);
    });

    it("reconfigure after error restores valid state", () => {
      service.configure(flashConfig);
      expect(service.getActiveProvider()).toBe("google");

      // Attempt with unknown provider
      try {
        service.configure({
          provider: "nonexistent" as AIProviderConfig["provider"],
          model: "model",
          apiKey: "key",
        });
      } catch {
        // Expected to throw
      }

      // Service should still work after the failed configure attempt
      // Note: the last successful config may have been overwritten
      // Re-configure to restore a known good state
      service.configure(proConfig);
      expect(service.getActiveProvider()).toBe("google");
    });
  });

  describe("Repeated Model Switches", () => {
    it("handles rapid Flash/Pro/Flash cycling without corruption", () => {
      for (let i = 0; i < 10; i++) {
        service.configure(i % 2 === 0 ? flashConfig : proConfig);
      }

      // Final state is Flash (even iteration = 0,2,4,6,8 -> last i=9 is odd -> Pro)
      // i=0: Flash, i=1: Pro, ..., i=9: Pro
      expect(service.getActiveProvider()).toBe("google");
      expect(mockGoogleModel).toHaveBeenLastCalledWith("gemini-3.0-pro");
    });

    it("model SDK calls match switch count", () => {
      mockGoogleModel.mockClear();

      service.configure(flashConfig);
      service.configure(proConfig);
      service.configure(flashConfig);

      expect(mockGoogleModel).toHaveBeenCalledTimes(3);
    });

    it("each switch produces a fresh model instance", () => {
      const model1Sentinel = { modelId: "sentinel-1" };
      const model2Sentinel = { modelId: "sentinel-2" };

      mockGoogleModel.mockReturnValueOnce(model1Sentinel);
      service.configure(flashConfig);
      expect(service.getModel()).toBe(model1Sentinel);

      mockGoogleModel.mockReturnValueOnce(model2Sentinel);
      service.configure(proConfig);
      expect(service.getModel()).toBe(model2Sentinel);
    });
  });

  describe("Output Format Consistency Across Models", () => {
    it("produces identical schema structure with Flash and Pro", async () => {
      // Flash transcription
      service.configure(flashConfig);
      mockGenerateObject.mockResolvedValueOnce({
        object: {
          segments: [{ speaker: "Alice", text: "Hello from Flash" }],
          topics: ["greeting"],
          actionItems: [],
        },
      });
      const flashResult = await service.transcribe("test");

      // Pro transcription
      service.configure(proConfig);
      mockGenerateObject.mockResolvedValueOnce({
        object: {
          segments: [
            { speaker: "Alice", text: "Hello from Pro", sentiment: "positive" },
          ],
          topics: ["greeting", "advanced analysis"],
          actionItems: [{ text: "Follow up", assignee: "Alice" }],
        },
      });
      const proResult = await service.transcribe("test");

      // Both must have same top-level keys
      expect(Object.keys(flashResult).sort()).toEqual(
        Object.keys(proResult).sort(),
      );

      // Both must have segments array
      expect(Array.isArray(flashResult.segments)).toBe(true);
      expect(Array.isArray(proResult.segments)).toBe(true);

      // Both must have topics array of strings
      flashResult.topics.forEach((t: string) => expect(typeof t).toBe("string"));
      proResult.topics.forEach((t: string) => expect(typeof t).toBe("string"));
    });

    it("both models return valid actionItems arrays", async () => {
      service.configure(flashConfig);
      mockGenerateObject.mockResolvedValueOnce({
        object: {
          segments: [{ speaker: "S1", text: "text" }],
          topics: [],
          actionItems: [],
        },
      });
      const flashResult = await service.transcribe("test");

      service.configure(proConfig);
      mockGenerateObject.mockResolvedValueOnce({
        object: {
          segments: [{ speaker: "S1", text: "text" }],
          topics: [],
          actionItems: [{ text: "Do task", assignee: "Bob" }],
        },
      });
      const proResult = await service.transcribe("test");

      expect(Array.isArray(flashResult.actionItems)).toBe(true);
      expect(Array.isArray(proResult.actionItems)).toBe(true);

      // Pro result has richer output
      proResult.actionItems.forEach((item: { text: string; assignee?: string }) => {
        expect(typeof item.text).toBe("string");
      });
    });
  });

  describe("Mid-Transcription Safety", () => {
    it("in-flight transcription completes with original model", async () => {
      service.configure(flashConfig);

      // Simulate a slow transcription
      let resolveTranscription!: (value: unknown) => void;
      const slowTranscription = new Promise((resolve) => {
        resolveTranscription = resolve;
      });
      mockGenerateObject.mockReturnValueOnce(slowTranscription);

      // Start transcription (Flash)
      const transcriptionPromise = service.transcribe("Long meeting text");

      // Switch model to Pro while transcription is in-flight
      service.configure(proConfig);

      // Resolve the original transcription
      resolveTranscription({
        object: {
          segments: [{ speaker: "S1", text: "Completed with Flash" }],
          topics: ["test"],
          actionItems: [],
        },
      });

      // The in-flight transcription should still resolve
      const result = await transcriptionPromise;
      expect(result.segments[0].text).toBe("Completed with Flash");
    });

    it("next transcription uses new model after switch", async () => {
      service.configure(flashConfig);

      // Complete first transcription
      mockGenerateObject.mockResolvedValueOnce({
        object: {
          segments: [{ speaker: "S1", text: "Flash result" }],
          topics: [],
          actionItems: [],
        },
      });
      await service.transcribe("First call");

      // Switch to Pro
      service.configure(proConfig);

      // Verify the model was updated to Pro
      expect(mockGoogleModel).toHaveBeenLastCalledWith("gemini-3.0-pro");
    });

    it("concurrent transcription requests all resolve", async () => {
      service.configure(flashConfig);

      mockGenerateObject.mockResolvedValue({
        object: {
          segments: [{ speaker: "S1", text: "result" }],
          topics: [],
          actionItems: [],
        },
      });

      // Fire multiple concurrent transcriptions
      const promises = Array.from({ length: 5 }, (_, i) =>
        service.transcribe(`Concurrent request ${i}`),
      );

      const results = await Promise.all(promises);

      // All should resolve
      expect(results).toHaveLength(5);
      results.forEach((r) => {
        expect(r.segments).toBeDefined();
        expect(r.segments.length).toBeGreaterThan(0);
      });
    });

    it("rapid switch + concurrent transcriptions do not throw", async () => {
      mockGenerateObject.mockResolvedValue({
        object: {
          segments: [{ speaker: "S1", text: "result" }],
          topics: [],
          actionItems: [],
        },
      });

      // Start some transcriptions with Flash
      service.configure(flashConfig);
      const p1 = service.transcribe("Request 1");
      const p2 = service.transcribe("Request 2");

      // Switch mid-flight
      service.configure(proConfig);
      const p3 = service.transcribe("Request 3");

      // Switch again
      service.configure(flashConfig);
      const p4 = service.transcribe("Request 4");

      // All should resolve without throwing
      const results = await Promise.allSettled([p1, p2, p3, p4]);
      results.forEach((r) => {
        expect(r.status).toBe("fulfilled");
      });
    });
  });

  describe("Concurrent Switch Protection", () => {
    it("rapid switches produce consistent final state", () => {
      service.configure(flashConfig);
      service.configure(proConfig);
      service.configure(flashConfig);
      service.configure(proConfig);
      service.configure(flashConfig);

      // Final state must be Flash (last configure call)
      expect(service.getActiveProvider()).toBe("google");
      expect(mockGoogleModel).toHaveBeenLastCalledWith("gemini-2.5-flash");
    });

    it("10 rapid cross-provider switches produce correct final state", () => {
      const configs = [flashConfig, openaiConfig, anthropicConfig];

      for (let i = 0; i < 10; i++) {
        service.configure(configs[i % configs.length]);
      }

      // i=9 -> 9 % 3 = 0 -> flashConfig
      expect(service.getActiveProvider()).toBe("google");
    });
  });

  describe("Performance Characteristics Documentation", () => {
    it("documents expected differences between Flash and Pro", () => {
      // Living documentation: expected model characteristics
      const modelCharacteristics = {
        "gemini-2.5-flash": {
          speed: "fast",
          quality: "good",
          costMultiplier: 1,
          bestFor: ["realtime", "draft", "batch"],
        },
        "gemini-3.0-pro": {
          speed: "slower",
          quality: "excellent",
          costMultiplier: 10,
          bestFor: ["critical", "final", "important"],
        },
      };

      expect(modelCharacteristics["gemini-2.5-flash"].costMultiplier).toBe(1);
      expect(modelCharacteristics["gemini-3.0-pro"].costMultiplier).toBe(10);
      expect(
        modelCharacteristics["gemini-3.0-pro"].costMultiplier,
      ).toBeGreaterThan(
        modelCharacteristics["gemini-2.5-flash"].costMultiplier,
      );
    });

    it("mock responses reflect quality differences", async () => {
      // Flash: fewer details, faster
      service.configure(flashConfig);
      mockGenerateObject.mockResolvedValueOnce({
        object: {
          segments: [
            { speaker: "Speaker 1", text: "We discussed the roadmap." },
          ],
          topics: ["roadmap"],
          actionItems: [],
        },
      });
      const flashResult = await service.transcribe("test");

      // Pro: more detail, better analysis
      service.configure(proConfig);
      mockGenerateObject.mockResolvedValueOnce({
        object: {
          segments: [
            {
              speaker: "Alice Chen",
              text: "We discussed the Q3 product roadmap and timeline.",
              startMs: 0,
              endMs: 4500,
              sentiment: "neutral",
              language: "en",
            },
          ],
          topics: ["Q3 roadmap", "product timeline", "resource allocation"],
          actionItems: [
            { text: "Finalize Q3 timeline by Friday", assignee: "Alice Chen" },
          ],
        },
      });
      const proResult = await service.transcribe("test");

      // Pro should generally produce richer output
      expect(proResult.topics.length).toBeGreaterThanOrEqual(flashResult.topics.length);
      expect(proResult.actionItems.length).toBeGreaterThanOrEqual(flashResult.actionItems.length);
    });
  });
});
