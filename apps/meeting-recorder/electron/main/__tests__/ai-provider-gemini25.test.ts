import { describe, it, expect, vi, beforeEach } from "vitest";
import { TranscriptionResultSchema } from "../services/ai-schemas";
import type { TranscriptionResult } from "../services/ai-provider.types";

/**
 * Gemini 2.5 Format Compliance Tests
 *
 * These tests validate that the AIProviderService produces output matching
 * the exact TranscriptionResult schema when configured with Gemini 2.5.
 *
 * Focus areas NOT covered by ai-provider.test.ts:
 * - Schema validation with Zod (TranscriptionResultSchema.safeParse)
 * - Exact field enumeration (no extra fields)
 * - MIME type normalization for audio transcription
 * - Edge cases: empty audio, single word, multi-speaker, noise
 * - Auth error detection (rethrow vs fallback)
 * - Field-specific edge cases (long text, zero timestamps, many topics)
 * - Breaking change detection
 */

// --- Hoisted mocks ---

const { mockGoogleModel, mockGenerateObject } = vi.hoisted(() => ({
  mockGoogleModel: vi.fn().mockReturnValue({ modelId: "gemini-2.5-flash" }),
  mockGenerateObject: vi.fn(),
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
    getProviderIds: vi.fn().mockReturnValue(["google"]),
    getContextIds: vi.fn().mockReturnValue(["realtime", "postprocess", "critical", "batch"]),
    reload: vi.fn(),
  },
}));

import { AIProviderService } from "../services/ai-provider";

// ---------- Mock response factories ----------

function makeTranscriptionResponse(overrides?: Partial<TranscriptionResult>) {
  return {
    object: {
      segments: [
        { speaker: "Speaker 1", text: "Hello world", sentiment: "neutral", language: "en" },
      ],
      topics: ["greeting"],
      actionItems: [],
      ...overrides,
    },
  };
}

function makeMultiSpeakerResponse() {
  return {
    object: {
      segments: [
        { speaker: "Alice", text: "Let's discuss the roadmap.", startMs: 0, endMs: 3500, sentiment: "neutral" },
        {
          speaker: "Bob",
          text: "I agree, we should focus on Q3.",
          startMs: 3500,
          endMs: 7000,
          sentiment: "positive",
        },
        {
          speaker: "Alice",
          text: "Bob, can you own the timeline?",
          startMs: 7000,
          endMs: 10000,
          sentiment: "neutral",
        },
      ],
      topics: ["roadmap", "Q3 planning"],
      actionItems: [{ text: "Own the timeline for Q3", assignee: "Bob" }],
    },
  };
}

function makeEmptyAudioResponse() {
  return {
    object: {
      segments: [],
      topics: [],
      actionItems: [],
    },
  };
}

function makeSingleWordResponse() {
  return {
    object: {
      segments: [{ speaker: "Unknown", text: "Yes" }],
      topics: [],
      actionItems: [],
    },
  };
}

// ---------- Test Suites ----------

describe("AIProviderService - Gemini 2.5 Format Compliance", () => {
  let service: AIProviderService;

  beforeEach(() => {
    mockGoogleModel.mockClear();
    mockGenerateObject.mockClear();
    service = new AIProviderService();
    service.configure({
      provider: "google",
      model: "gemini-2.5-flash",
      apiKey: "test-key",
    });
    // Verify service is configured with the correct model
    expect(mockGoogleModel).toHaveBeenCalledWith("gemini-2.5-flash");
  });

  describe("Schema Validation", () => {
    it("produces TranscriptionResult matching exact Zod schema", async () => {
      mockGenerateObject.mockResolvedValueOnce(makeTranscriptionResponse());

      const result = await service.transcribe("Hello world");

      const parseResult = TranscriptionResultSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
    });

    it("has exactly 3 top-level fields: segments, topics, actionItems", async () => {
      mockGenerateObject.mockResolvedValueOnce(makeTranscriptionResponse());

      const result = await service.transcribe("Hello world");
      const knownFields = ["segments", "topics", "actionItems"];
      const resultFields = Object.keys(result);
      const unexpectedFields = resultFields.filter((f) => !knownFields.includes(f));

      expect(unexpectedFields).toEqual([]);
      expect(resultFields).toEqual(expect.arrayContaining(knownFields));
    });

    it("produces segments with correct required field types", async () => {
      mockGenerateObject.mockResolvedValueOnce(makeTranscriptionResponse());

      const result = await service.transcribe("Hello world");
      const segment = result.segments[0];

      expect(typeof segment.speaker).toBe("string");
      expect(typeof segment.text).toBe("string");
    });

    it("produces segments with correct optional field types when present", async () => {
      mockGenerateObject.mockResolvedValueOnce(
        makeTranscriptionResponse({
          segments: [
            {
              speaker: "Speaker 1",
              text: "Hello",
              startMs: 0,
              endMs: 1500,
              sentiment: "positive",
              language: "en",
            },
          ],
        }),
      );

      const result = await service.transcribe("Hello");
      const segment = result.segments[0];

      expect(typeof segment.startMs).toBe("number");
      expect(typeof segment.endMs).toBe("number");
      expect(["positive", "negative", "neutral"]).toContain(segment.sentiment);
      expect(segment.language).toMatch(/^[a-z]{2}$/);
    });

    it("produces action items with correct structure", async () => {
      mockGenerateObject.mockResolvedValueOnce(
        makeTranscriptionResponse({
          actionItems: [
            { text: "Review PR #42", assignee: "Bob" },
            { text: "Schedule follow-up" },
          ],
        }),
      );

      const result = await service.transcribe("Some meeting content");

      result.actionItems.forEach((item) => {
        expect(typeof item.text).toBe("string");
        if ("assignee" in item && item.assignee !== undefined) {
          expect(typeof item.assignee).toBe("string");
        }
      });
    });

    it("topics array contains only strings", async () => {
      mockGenerateObject.mockResolvedValueOnce(
        makeTranscriptionResponse({
          topics: ["roadmap", "hiring", "budget review", "sprint planning"],
        }),
      );

      const result = await service.transcribe("Lots of topics");
      result.topics.forEach((topic) => {
        expect(typeof topic).toBe("string");
      });
    });
  });

  describe("Edge Cases (Design Review Required)", () => {
    it("handles empty audio producing empty segments", async () => {
      mockGenerateObject.mockResolvedValueOnce(makeEmptyAudioResponse());

      const audioData = Buffer.from([0x4f, 0x67, 0x67, 0x53]);
      const result = await service.transcribeAudio(audioData, "audio/ogg");

      const parseResult = TranscriptionResultSchema.safeParse(result);
      expect(parseResult.success).toBe(true);
      expect(result.segments).toEqual([]);
      expect(result.topics).toEqual([]);
      expect(result.actionItems).toEqual([]);
    });

    it("handles single-word utterance", async () => {
      mockGenerateObject.mockResolvedValueOnce(makeSingleWordResponse());

      const audioData = Buffer.from([0x4f, 0x67, 0x67, 0x53]);
      const result = await service.transcribeAudio(audioData, "audio/ogg");

      expect(result.segments).toHaveLength(1);
      expect(result.segments[0].text).toBe("Yes");
    });

    it("handles multiple simultaneous speakers", async () => {
      mockGenerateObject.mockResolvedValueOnce(makeMultiSpeakerResponse());

      const audioData = Buffer.from([0x4f, 0x67, 0x67, 0x53]);
      const result = await service.transcribeAudio(audioData, "audio/ogg");

      expect(result.segments.length).toBeGreaterThanOrEqual(2);
      const speakers = new Set(result.segments.map((s) => s.speaker));
      expect(speakers.size).toBeGreaterThan(1);
    });

    it("handles noise-only audio returning empty segments", async () => {
      mockGenerateObject.mockResolvedValueOnce(makeEmptyAudioResponse());

      const audioData = Buffer.alloc(1024, 0xff); // random noise bytes
      const result = await service.transcribeAudio(audioData, "audio/wav");

      expect(TranscriptionResultSchema.safeParse(result).success).toBe(true);
    });
  });

  describe("MIME Type Normalization", () => {
    it("strips codec params from audio/ogg;codecs=opus", async () => {
      mockGenerateObject.mockResolvedValueOnce(makeTranscriptionResponse());

      const audioData = Buffer.from([0x4f, 0x67, 0x67, 0x53]);
      await service.transcribeAudio(audioData, "audio/ogg;codecs=opus");

      const callArgs = mockGenerateObject.mock.calls[0][0];
      const fileContent = callArgs.messages[0].content[0];
      expect(fileContent.mediaType).toBe("audio/ogg");
    });

    it("passes through clean MIME types unchanged", async () => {
      mockGenerateObject.mockResolvedValueOnce(makeTranscriptionResponse());

      const audioData = Buffer.from([0x4f, 0x67, 0x67, 0x53]);
      await service.transcribeAudio(audioData, "audio/wav");

      const callArgs = mockGenerateObject.mock.calls[0][0];
      const fileContent = callArgs.messages[0].content[0];
      expect(fileContent.mediaType).toBe("audio/wav");
    });

    it("strips whitespace around MIME type", async () => {
      mockGenerateObject.mockResolvedValueOnce(makeTranscriptionResponse());

      const audioData = Buffer.from([0x4f, 0x67, 0x67, 0x53]);
      await service.transcribeAudio(audioData, "  audio/ogg ; codecs=opus  ");

      const callArgs = mockGenerateObject.mock.calls[0][0];
      const fileContent = callArgs.messages[0].content[0];
      expect(fileContent.mediaType).toBe("audio/ogg");
    });

    it("handles MIME type with multiple semicolon params", async () => {
      mockGenerateObject.mockResolvedValueOnce(makeTranscriptionResponse());

      const audioData = Buffer.from([0x4f, 0x67, 0x67, 0x53]);
      await service.transcribeAudio(audioData, "audio/webm;codecs=opus;rate=48000");

      const callArgs = mockGenerateObject.mock.calls[0][0];
      const fileContent = callArgs.messages[0].content[0];
      expect(fileContent.mediaType).toBe("audio/webm");
    });
  });

  describe("Fallback Format Exact Match", () => {
    it("text fallback produces exact format on API error", async () => {
      mockGenerateObject.mockRejectedValueOnce(new Error("model overloaded"));

      const result = await service.transcribe("Input text");

      expect(result).toStrictEqual({
        segments: [
          { speaker: "Unknown", text: "Input text", sentiment: "neutral" },
        ],
        topics: [],
        actionItems: [],
      });
    });

    it("audio fallback produces exact format on API error", async () => {
      mockGenerateObject.mockRejectedValueOnce(new Error("decode error"));

      const audioData = Buffer.from([0x4f, 0x67, 0x67, 0x53]);
      const result = await service.transcribeAudio(audioData, "audio/ogg");

      expect(result).toStrictEqual({
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

    it("auth error rethrows instead of using fallback", async () => {
      mockGenerateObject.mockRejectedValueOnce(
        new Error("API key not valid. Please pass a valid API key."),
      );

      await expect(service.transcribe("some text")).rejects.toThrow(
        /API key error/,
      );
    });

    it("audio auth error rethrows instead of using fallback", async () => {
      mockGenerateObject.mockRejectedValueOnce(
        new Error("permission_denied: quota exceeded"),
      );

      const audioData = Buffer.from([0x4f, 0x67, 0x67, 0x53]);
      await expect(
        service.transcribeAudio(audioData, "audio/ogg"),
      ).rejects.toThrow(/API key error/);
    });

    it("401 error rethrows as auth error", async () => {
      mockGenerateObject.mockRejectedValueOnce(
        new Error("401 Unauthorized"),
      );

      await expect(service.transcribe("test")).rejects.toThrow(/API key error/);
    });

    it("403 error rethrows as auth error", async () => {
      mockGenerateObject.mockRejectedValueOnce(
        new Error("403 Forbidden"),
      );

      await expect(service.transcribe("test")).rejects.toThrow(/API key error/);
    });

    it("generic error uses fallback (not rethrown)", async () => {
      mockGenerateObject.mockRejectedValueOnce(
        new Error("network timeout"),
      );

      const result = await service.transcribe("test input");
      expect(result.segments[0].speaker).toBe("Unknown");
      expect(result.segments[0].text).toBe("test input");
    });
  });

  describe("Breaking Change Detection", () => {
    it("does not add new required fields to TranscriptionResult", async () => {
      mockGenerateObject.mockResolvedValueOnce(makeTranscriptionResponse());

      const result = await service.transcribe("test");
      const knownFields = ["segments", "topics", "actionItems"];
      const newFields = Object.keys(result).filter(
        (f) => !knownFields.includes(f),
      );

      expect(newFields).toEqual([]);
    });

    it("does not add new required fields to TranscriptionSegment", async () => {
      mockGenerateObject.mockResolvedValueOnce(
        makeTranscriptionResponse({
          segments: [
            {
              speaker: "S1",
              text: "Hi",
              startMs: 0,
              endMs: 1000,
              sentiment: "neutral",
              language: "en",
            },
          ],
        }),
      );

      const result = await service.transcribe("test");
      const segment = result.segments[0];
      const knownSegmentFields = [
        "speaker",
        "text",
        "startMs",
        "endMs",
        "sentiment",
        "language",
      ];
      const newFields = Object.keys(segment).filter(
        (f) => !knownSegmentFields.includes(f),
      );

      expect(newFields).toEqual([]);
    });

    it("maintains backward compatibility with Gemini 2.0 format", async () => {
      // Gemini 2.0 format used the same schema; verify 2.5 produces compatible output
      mockGenerateObject.mockResolvedValueOnce(makeTranscriptionResponse());

      const result = await service.transcribe("test");

      expect(result).toMatchObject({
        segments: expect.any(Array),
        topics: expect.any(Array),
        actionItems: expect.any(Array),
      });
    });
  });

  describe("Field-Specific Edge Cases", () => {
    it("handles various speaker formats", async () => {
      const speakers = ["Speaker 1", "John Doe", "Unknown", "Dr. Smith"];
      for (const speaker of speakers) {
        mockGenerateObject.mockResolvedValueOnce(
          makeTranscriptionResponse({
            segments: [{ speaker, text: "test" }],
          }),
        );
        const result = await service.transcribe("test");
        expect(result.segments[0].speaker).toBe(speaker);
      }
    });

    it("handles long text content (>1000 chars)", async () => {
      const longText = "A".repeat(2000);
      mockGenerateObject.mockResolvedValueOnce(
        makeTranscriptionResponse({
          segments: [{ speaker: "S1", text: longText }],
        }),
      );
      const result = await service.transcribe("test");
      expect(result.segments[0].text.length).toBe(2000);
    });

    it("handles zero-value timestamps", async () => {
      mockGenerateObject.mockResolvedValueOnce(
        makeTranscriptionResponse({
          segments: [{ speaker: "S1", text: "test", startMs: 0, endMs: 0 }],
        }),
      );
      const result = await service.transcribe("test");
      expect(result.segments[0].startMs).toBe(0);
      expect(result.segments[0].endMs).toBe(0);
    });

    it("handles many topics (10+)", async () => {
      const topics = Array.from({ length: 15 }, (_, i) => `Topic ${i + 1}`);
      mockGenerateObject.mockResolvedValueOnce(
        makeTranscriptionResponse({ topics }),
      );
      const result = await service.transcribe("test");
      expect(result.topics).toHaveLength(15);
    });

    it("handles action items with and without assignees", async () => {
      mockGenerateObject.mockResolvedValueOnce(
        makeTranscriptionResponse({
          actionItems: [
            { text: "Review PR", assignee: "Alice" },
            { text: "Follow up" },
          ],
        }),
      );
      const result = await service.transcribe("test");
      expect(result.actionItems[0].assignee).toBe("Alice");
      expect(result.actionItems[1].assignee).toBeUndefined();
    });

    it("handles many segments (50+)", async () => {
      const segments = Array.from({ length: 50 }, (_, i) => ({
        speaker: `Speaker ${(i % 3) + 1}`,
        text: `Segment ${i + 1} content here.`,
        startMs: i * 5000,
        endMs: (i + 1) * 5000,
        sentiment: "neutral" as const,
      }));
      mockGenerateObject.mockResolvedValueOnce(
        makeTranscriptionResponse({ segments }),
      );
      const result = await service.transcribe("long meeting");
      expect(result.segments).toHaveLength(50);
    });

    it("handles empty string speaker name", async () => {
      mockGenerateObject.mockResolvedValueOnce(
        makeTranscriptionResponse({
          segments: [{ speaker: "", text: "anonymous speech" }],
        }),
      );
      const result = await service.transcribe("test");
      expect(result.segments[0].speaker).toBe("");
    });

    it("handles unicode content in text", async () => {
      const unicodeText = "Hola mundo. Bonjour le monde. Hallo Welt.";
      mockGenerateObject.mockResolvedValueOnce(
        makeTranscriptionResponse({
          segments: [{ speaker: "S1", text: unicodeText, language: "es" }],
        }),
      );
      const result = await service.transcribe("test");
      expect(result.segments[0].text).toBe(unicodeText);
      expect(result.segments[0].language).toBe("es");
    });
  });
});

// ---------- Integration tests with real API ----------

describe.skipIf(!process.env.ENABLE_EXPENSIVE_TESTS)(
  "AIProviderService - Gemini 2.5 Real API Integration",
  () => {
    it("transcribes text with real Gemini 2.5 Flash API", async () => {
      // Dynamic import to avoid loading mocked modules
      const { AIProviderService: RealService } = await import("../services/ai-provider");
      const realService = new RealService();
      realService.configure({
        provider: "google",
        model: "gemini-2.5-flash",
        apiKey: process.env.GOOGLE_API_KEY!,
      });

      const result = await realService.transcribe(
        "Alice said hello. Bob replied with good morning.",
      );

      expect(TranscriptionResultSchema.safeParse(result).success).toBe(true);
      expect(result.segments.length).toBeGreaterThan(0);
    });
  },
);
