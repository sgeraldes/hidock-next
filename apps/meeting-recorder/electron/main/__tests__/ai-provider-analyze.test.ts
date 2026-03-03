import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mocks ---

const { mockGoogleModel, mockGenerateObject } = vi.hoisted(() => ({
  mockGoogleModel: vi.fn().mockReturnValue({ modelId: "gemini-2.5-flash" }),
  mockGenerateObject: vi.fn(),
}));

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: vi.fn().mockReturnValue(mockGoogleModel),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn().mockReturnValue(vi.fn()),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: vi.fn().mockReturnValue(vi.fn()),
}));

vi.mock("@ai-sdk/amazon-bedrock", () => ({
  createAmazonBedrock: vi.fn().mockReturnValue(vi.fn()),
}));

vi.mock("ollama-ai-provider", () => ({
  createOllama: vi.fn().mockReturnValue(vi.fn()),
}));

vi.mock("ai", () => ({
  generateObject: (...args: unknown[]) => mockGenerateObject(...args),
}));

vi.mock("../services/model-config", () => ({
  modelConfig: {
    validateModel: vi.fn().mockReturnValue(true),
    isModelDeprecated: vi.fn().mockReturnValue(false),
    getDeprecationMigration: vi.fn().mockReturnValue(null),
    getDefaultModel: vi.fn().mockReturnValue("gemini-2.5-flash"),
    isAudioCapable: vi.fn().mockImplementation((p: string) => p === "google"),
    getModelForContext: vi.fn().mockReturnValue(null),
  },
}));

import { AIProviderService } from "../services/ai-provider";

// --- Helpers ---

function makeAnalysisResult(overrides?: Record<string, unknown>) {
  return {
    object: {
      segments: [
        { speaker: "Speaker 1", text: "We need to ship by Friday", sentiment: "neutral" },
        { speaker: "Speaker 2", text: "I agree, let's do it", sentiment: "positive" },
      ],
      topics: ["shipping deadline"],
      actionItems: [{ text: "Ship by Friday", assignee: "Speaker 1" }],
      ...overrides,
    },
  };
}

// --- Tests ---

describe("AIProviderService.analyzeTranscript()", () => {
  let service: AIProviderService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AIProviderService();
    service.configure({
      provider: "google",
      model: "gemini-2.5-flash",
      apiKey: "test-key",
    });
  });

  it("returns structured analysis from raw text", async () => {
    mockGenerateObject.mockResolvedValueOnce(makeAnalysisResult());

    const result = await service.analyzeTranscript(
      "We need to ship by Friday. I agree, let's do it.",
    );

    expect(result.segments).toHaveLength(2);
    expect(result.segments[0].speaker).toBe("Speaker 1");
    expect(result.topics).toContain("shipping deadline");
    expect(result.actionItems).toHaveLength(1);
    expect(result.actionItems[0].text).toBe("Ship by Friday");
  });

  it("passes meeting context to the prompt", async () => {
    mockGenerateObject.mockResolvedValueOnce(makeAnalysisResult());

    await service.analyzeTranscript("some text", {
      meetingContext: "Previous: talked about budgets",
    });

    const callArgs = mockGenerateObject.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.system).toContain("Previous context");
    expect(callArgs.system).toContain("talked about budgets");
  });

  it("passes attendee list to the prompt", async () => {
    mockGenerateObject.mockResolvedValueOnce(makeAnalysisResult());

    await service.analyzeTranscript("some text", {
      attendees: ["Alice", "Bob"],
    });

    const callArgs = mockGenerateObject.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.system).toContain("Alice");
    expect(callArgs.system).toContain("Bob");
  });

  it("includes word timing guidance when wordData provided", async () => {
    mockGenerateObject.mockResolvedValueOnce(makeAnalysisResult());

    await service.analyzeTranscript("hello world", {
      wordData: [
        { word: "hello", startTime: 0, endTime: 0.5, confidence: 0.9 },
        { word: "world", startTime: 0.5, endTime: 1.0, confidence: 0.85 },
      ],
    });

    const callArgs = mockGenerateObject.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.system).toContain("Word-level timing data");
  });

  it("throws on auth error", async () => {
    mockGenerateObject.mockRejectedValueOnce(
      new Error("API key not valid. Please pass a valid API key."),
    );

    await expect(service.analyzeTranscript("test")).rejects.toThrow(
      "API key error",
    );
  });

  it("falls back to basic result on non-auth error", async () => {
    mockGenerateObject.mockRejectedValueOnce(
      new Error("Internal server error"),
    );

    const result = await service.analyzeTranscript("some transcript text");
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].speaker).toBe("Unknown");
    expect(result.segments[0].text).toBe("some transcript text");
    expect(result.topics).toEqual([]);
    expect(result.actionItems).toEqual([]);
  });

  it("throws when AI provider not configured", async () => {
    const unconfigured = new AIProviderService();
    await expect(unconfigured.analyzeTranscript("test")).rejects.toThrow(
      "AI provider not configured",
    );
  });

  it("uses the main model (not transcription model) since it's text-only", async () => {
    mockGenerateObject.mockResolvedValueOnce(makeAnalysisResult());

    await service.analyzeTranscript("test");

    const callArgs = mockGenerateObject.mock.calls[0][0] as Record<string, unknown>;
    // The model should be the main model, not the transcription model
    expect(callArgs.model).toBe(mockGoogleModel());
  });

  it("uses TRANSCRIPT_ANALYSIS prompt (not TRANSCRIPTION)", async () => {
    mockGenerateObject.mockResolvedValueOnce(makeAnalysisResult());

    await service.analyzeTranscript("test");

    const callArgs = mockGenerateObject.mock.calls[0][0] as Record<string, unknown>;
    const system = callArgs.system as string;
    // TRANSCRIPT_ANALYSIS prompt focuses on speaker identification from text
    expect(system).toContain("meeting analysis AI");
    expect(system).toContain("Identify distinct speakers");
  });
});
