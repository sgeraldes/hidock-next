import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockGoogleModel,
  mockOpenAIModel,
  mockAnthropicModel,
  mockBedrockModel,
  mockOllamaModel,
  mockGenerateObject,
  mockGenerateText,
} = vi.hoisted(() => ({
  mockGoogleModel: vi.fn().mockReturnValue({ modelId: "gemini-2.0-flash" }),
  mockOpenAIModel: vi.fn().mockReturnValue({ modelId: "gpt-4o" }),
  mockAnthropicModel: vi
    .fn()
    .mockReturnValue({ modelId: "claude-sonnet-4-20250514" }),
  mockBedrockModel: vi
    .fn()
    .mockReturnValue({ modelId: "anthropic.claude-sonnet-4-20250514-v1:0" }),
  mockOllamaModel: vi.fn().mockReturnValue({ modelId: "llama3.2" }),
  mockGenerateObject: vi.fn().mockResolvedValue({
    object: {
      segments: [{ speaker: "Speaker 1", text: "Hello world" }],
      topics: ["greeting"],
      actionItems: [],
    },
  }),
  mockGenerateText: vi.fn().mockResolvedValue({ text: "Summary text" }),
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
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}));

vi.mock("electron", () => ({
  app: { getPath: vi.fn().mockReturnValue("/tmp/test") },
  safeStorage: {
    isEncryptionAvailable: vi.fn().mockReturnValue(false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
}));

import { AIProviderService } from "../services/ai-provider";
import type { AIProviderConfig } from "../services/ai-provider.types";

describe("AIProviderService", () => {
  let service: AIProviderService;

  beforeEach(() => {
    mockGenerateObject.mockClear();
    mockGenerateObject.mockResolvedValue({
      object: {
        segments: [{ speaker: "Speaker 1", text: "Hello world" }],
        topics: ["greeting"],
        actionItems: [],
      },
    });
    mockGenerateText.mockClear();
    service = new AIProviderService();
  });

  describe("configure", () => {
    it("accepts google provider config", () => {
      const config: AIProviderConfig = {
        provider: "google",
        model: "gemini-2.0-flash",
        apiKey: "test-key",
      };
      expect(() => service.configure(config)).not.toThrow();
    });

    it("accepts openai provider config", () => {
      const config: AIProviderConfig = {
        provider: "openai",
        model: "gpt-4o",
        apiKey: "test-key",
      };
      expect(() => service.configure(config)).not.toThrow();
    });

    it("accepts anthropic provider config", () => {
      const config: AIProviderConfig = {
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        apiKey: "test-key",
      };
      expect(() => service.configure(config)).not.toThrow();
    });

    it("accepts bedrock provider config", () => {
      const config: AIProviderConfig = {
        provider: "bedrock",
        model: "anthropic.claude-sonnet-4-20250514-v1:0",
        bedrockRegion: "us-east-1",
        bedrockAccessKeyId: "AKIA-test",
        bedrockSecretAccessKey: "secret-test",
      };
      expect(() => service.configure(config)).not.toThrow();
    });

    it("accepts ollama provider config", () => {
      const config: AIProviderConfig = {
        provider: "ollama",
        model: "llama3.2",
        ollamaBaseUrl: "http://localhost:11434",
      };
      expect(() => service.configure(config)).not.toThrow();
    });

    it("re-configuring replaces the active provider", () => {
      service.configure({
        provider: "google",
        model: "gemini-2.0-flash",
        apiKey: "key-1",
      });
      service.configure({
        provider: "openai",
        model: "gpt-4o",
        apiKey: "key-2",
      });
      expect(service.getActiveProvider()).toBe("openai");
    });
  });

  describe("getActiveProvider", () => {
    it("returns null when not configured", () => {
      expect(service.getActiveProvider()).toBeNull();
    });

    it("returns the configured provider key", () => {
      service.configure({
        provider: "google",
        model: "gemini-2.0-flash",
        apiKey: "test",
      });
      expect(service.getActiveProvider()).toBe("google");
    });
  });

  describe("isAudioCapable", () => {
    it("returns true for google", () => {
      service.configure({
        provider: "google",
        model: "gemini-2.0-flash",
        apiKey: "test",
      });
      expect(service.isAudioCapable()).toBe(true);
    });

    it("returns false for openai", () => {
      service.configure({
        provider: "openai",
        model: "gpt-4o",
        apiKey: "test",
      });
      expect(service.isAudioCapable()).toBe(false);
    });

    it("returns false when not configured", () => {
      expect(service.isAudioCapable()).toBe(false);
    });
  });

  describe("transcribe", () => {
    it("calls generateObject with transcription schema", async () => {
      service.configure({
        provider: "google",
        model: "gemini-2.0-flash",
        apiKey: "test",
      });

      const result = await service.transcribe("Hello world transcript text");

      expect(mockGenerateObject).toHaveBeenCalledWith(
        expect.objectContaining({
          schema: expect.any(Object),
        }),
      );
      expect(result.segments).toHaveLength(1);
      expect(result.segments[0].text).toBe("Hello world");
    });

    it("throws when not configured", async () => {
      await expect(service.transcribe("text")).rejects.toThrow(
        /not configured/i,
      );
    });

    it("returns fallback result when generateObject fails", async () => {
      service.configure({
        provider: "google",
        model: "gemini-2.0-flash",
        apiKey: "test",
      });

      mockGenerateObject.mockRejectedValueOnce(new Error("LLM error"));

      const result = await service.transcribe("Some text");
      expect(result.segments).toHaveLength(1);
      expect(result.segments[0].speaker).toBe("Unknown");
      expect(result.segments[0].text).toBe("Some text");
    });
  });

  describe("transcribeAudio", () => {
    it("calls generateObject with audio data for audio-capable providers", async () => {
      service.configure({
        provider: "google",
        model: "gemini-2.0-flash",
        apiKey: "test",
      });

      const audioData = Buffer.from([1, 2, 3]);
      const result = await service.transcribeAudio(
        audioData,
        "audio/ogg;codecs=opus",
      );

      expect(mockGenerateObject).toHaveBeenCalled();
      expect(result.segments).toBeDefined();
    });

    it("throws clear error for text-only providers without transcription fallback", async () => {
      service.configure({
        provider: "openai",
        model: "gpt-4o",
        apiKey: "test",
      });

      const audioData = Buffer.from([1, 2, 3]);
      await expect(
        service.transcribeAudio(audioData, "audio/ogg"),
      ).rejects.toThrow(/configure a transcription provider/i);
    });

    it("uses Gemini fallback for text-only providers when transcriptionApiKey is configured", async () => {
      service.configure({
        provider: "openai",
        model: "gpt-4o",
        apiKey: "test-openai-key",
        transcriptionProvider: "google",
        transcriptionApiKey: "test-google-key",
      });

      const audioData = Buffer.from([1, 2, 3]);
      const result = await service.transcribeAudio(audioData, "audio/ogg");

      expect(mockGenerateObject).toHaveBeenCalled();
      expect(result.segments).toBeDefined();
    });

    it("does not create transcription model when main provider is audio-capable", async () => {
      service.configure({
        provider: "google",
        model: "gemini-2.0-flash",
        apiKey: "test",
      });

      const audioData = Buffer.from([1, 2, 3]);
      const result = await service.transcribeAudio(audioData, "audio/ogg");
      expect(result.segments).toBeDefined();
    });
  });

  describe("summarize", () => {
    it("calls generateObject with summarization schema", async () => {
      mockGenerateObject.mockResolvedValueOnce({
        object: {
          summary: "Meeting discussed project updates.",
          keyPoints: ["Timeline confirmed", "Budget approved"],
        },
      });

      service.configure({
        provider: "google",
        model: "gemini-2.0-flash",
        apiKey: "test",
      });

      const result = await service.summarize("Full transcript text...");
      expect(result.summary).toBe("Meeting discussed project updates.");
      expect(result.keyPoints).toHaveLength(2);
    });
  });

  describe("validateApiKey", () => {
    it("returns error for empty API key on key-based providers", () => {
      const result = service.validateApiKey("google", "");
      expect(result.valid).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it("returns valid for non-empty API key", () => {
      const result = service.validateApiKey("google", "sk-test-key");
      expect(result.valid).toBe(true);
    });

    it("returns valid for ollama without API key", () => {
      const result = service.validateApiKey("ollama", "");
      expect(result.valid).toBe(true);
    });

    it("returns error for bedrock without region", () => {
      const result = service.validateApiKey("bedrock", "", {
        bedrockRegion: "",
      });
      expect(result.valid).toBe(false);
    });
  });
});
