import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs", () => ({
  default: { promises: { readFile: vi.fn() } },
  promises: { readFile: vi.fn() },
}));

import { Chirp3Provider } from "../services/chirp3-provider";
import type { SpeechClientFactory } from "../services/chirp3-provider";
import type { Chirp3Config } from "../services/chirp3-provider.types";

// --- Helpers ---

function createMockFactory() {
  const mockRecognize = vi.fn();
  const mockClose = vi.fn();
  const MockSpeechClient = vi.fn(function (this: Record<string, unknown>) {
    this.recognize = mockRecognize;
    this.close = mockClose;
  });
  const factory: SpeechClientFactory = () => ({ SpeechClient: MockSpeechClient as unknown as new (opts?: unknown) => unknown });

  return { factory, MockSpeechClient, mockRecognize, mockClose };
}

function makeConfig(overrides?: Partial<Chirp3Config>): Chirp3Config {
  return {
    credentials: { type: "api-key", apiKey: "test-key-123" },
    projectId: "test-project",
    ...overrides,
  };
}

function makeRecognizeResponse(
  transcript: string,
  words?: Array<{
    word: string;
    startTime?: { seconds: number; nanos?: number };
    endTime?: { seconds: number; nanos?: number };
    confidence?: number;
    speakerTag?: number;
  }>,
) {
  return [
    {
      results: [
        {
          alternatives: [
            {
              transcript,
              words: words ?? [],
            },
          ],
        },
      ],
    },
  ];
}

// --- Tests ---

describe("Chirp3Provider", () => {
  let provider: Chirp3Provider;
  let mockRecognize: ReturnType<typeof vi.fn>;
  let mockClose: ReturnType<typeof vi.fn>;
  let MockSpeechClient: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const mocks = createMockFactory();
    mockRecognize = mocks.mockRecognize;
    mockClose = mocks.mockClose;
    MockSpeechClient = mocks.MockSpeechClient;
    provider = new Chirp3Provider(mocks.factory);
  });

  describe("configure()", () => {
    it("creates SpeechClient with API key credentials", () => {
      provider.configure(makeConfig());
      expect(MockSpeechClient).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: "test-key-123" }),
      );
      expect(provider.isConfigured()).toBe(true);
    });

    it("creates SpeechClient with service account JSON", () => {
      const saJson = JSON.stringify({
        type: "service_account",
        project_id: "test",
        private_key_id: "abc",
      });
      provider.configure(
        makeConfig({
          credentials: { type: "service-account", serviceAccountJson: saJson },
        }),
      );
      expect(MockSpeechClient).toHaveBeenCalledWith(
        expect.objectContaining({
          credentials: JSON.parse(saJson),
        }),
      );
      expect(provider.isConfigured()).toBe(true);
    });

    it("throws on invalid service account JSON", () => {
      expect(() =>
        provider.configure(
          makeConfig({
            credentials: {
              type: "service-account",
              serviceAccountJson: "not-json",
            },
          }),
        ),
      ).toThrow("Invalid service account JSON");
    });

    it("throws when no valid credentials provided", () => {
      expect(() =>
        provider.configure(
          makeConfig({
            credentials: { type: "api-key" }, // no apiKey
          }),
        ),
      ).toThrow("No valid credentials");
    });

    it("uses regional API endpoint for non-global locations", () => {
      provider.configure(makeConfig({ location: "us-central1" }));
      expect(MockSpeechClient).toHaveBeenCalledWith(
        expect.objectContaining({
          apiEndpoint: "us-central1-speech.googleapis.com",
        }),
      );
    });

    it("does not set apiEndpoint for global location", () => {
      provider.configure(makeConfig({ location: "global" }));
      const opts = MockSpeechClient.mock.calls[0][0] as Record<string, unknown>;
      expect(opts.apiEndpoint).toBeUndefined();
    });

    it("does not set apiEndpoint when location is not specified", () => {
      provider.configure(makeConfig()); // no location
      const opts = MockSpeechClient.mock.calls[0][0] as Record<string, unknown>;
      expect(opts.apiEndpoint).toBeUndefined();
    });
  });

  describe("isConfigured()", () => {
    it("returns false before configure", () => {
      expect(provider.isConfigured()).toBe(false);
    });

    it("returns true after configure", () => {
      provider.configure(makeConfig());
      expect(provider.isConfigured()).toBe(true);
    });

    it("returns false after dispose", () => {
      provider.configure(makeConfig());
      provider.dispose();
      expect(provider.isConfigured()).toBe(false);
    });
  });

  describe("recognizeChunk()", () => {
    beforeEach(() => {
      provider.configure(makeConfig());
    });

    it("sends audio data to SpeechClient and returns result", async () => {
      mockRecognize.mockResolvedValueOnce(
        makeRecognizeResponse("Hello world", [
          {
            word: "Hello",
            startTime: { seconds: 0, nanos: 0 },
            endTime: { seconds: 0, nanos: 500000000 },
            confidence: 0.95,
          },
          {
            word: "world",
            startTime: { seconds: 0, nanos: 500000000 },
            endTime: { seconds: 1, nanos: 0 },
            confidence: 0.92,
          },
        ]),
      );

      const audioData = Buffer.from("test-audio-data");
      const result = await provider.recognizeChunk(audioData, "audio/ogg");

      expect(result.transcript).toBe("Hello world");
      expect(result.words).toHaveLength(2);
      expect(result.words[0].word).toBe("Hello");
      expect(result.words[0].confidence).toBe(0.95);
      expect(result.words[0].startTime).toBe(0);
      expect(result.words[0].endTime).toBe(0.5);
      expect(result.words[1].endTime).toBe(1);
      expect(result.confidence).toBeCloseTo(0.935);
      expect(result.isFinal).toBe(true);
    });

    it("maps audio/ogg to OGG_OPUS encoding", async () => {
      mockRecognize.mockResolvedValueOnce(makeRecognizeResponse("test"));
      await provider.recognizeChunk(Buffer.from("test"), "audio/ogg");

      const request = mockRecognize.mock.calls[0][0] as Record<string, unknown>;
      expect((request.config as Record<string, unknown>).encoding).toBe("OGG_OPUS");
    });

    it("maps audio/webm to WEBM_OPUS encoding", async () => {
      mockRecognize.mockResolvedValueOnce(makeRecognizeResponse("test"));
      await provider.recognizeChunk(Buffer.from("test"), "audio/webm");

      const request = mockRecognize.mock.calls[0][0] as Record<string, unknown>;
      expect((request.config as Record<string, unknown>).encoding).toBe("WEBM_OPUS");
    });

    it("strips codec params from mimeType", async () => {
      mockRecognize.mockResolvedValueOnce(makeRecognizeResponse("test"));
      await provider.recognizeChunk(
        Buffer.from("test"),
        "audio/ogg;codecs=opus",
      );

      const request = mockRecognize.mock.calls[0][0] as Record<string, unknown>;
      expect((request.config as Record<string, unknown>).encoding).toBe("OGG_OPUS");
    });

    it("returns empty result for no speech", async () => {
      mockRecognize.mockResolvedValueOnce([{ results: [] }]);

      const result = await provider.recognizeChunk(
        Buffer.from("silence"),
        "audio/ogg",
      );
      expect(result.transcript).toBe("");
      expect(result.words).toHaveLength(0);
      expect(result.confidence).toBe(0);
    });

    it("throws when not configured", async () => {
      const mocks = createMockFactory();
      const unconfigured = new Chirp3Provider(mocks.factory);
      await expect(
        unconfigured.recognizeChunk(Buffer.from("test"), "audio/ogg"),
      ).rejects.toThrow("Chirp3Provider not configured");
    });

    it("sends base64-encoded audio content in request", async () => {
      mockRecognize.mockResolvedValueOnce(makeRecognizeResponse("test"));
      const audioData = Buffer.from("binary-audio");
      await provider.recognizeChunk(audioData, "audio/ogg");

      const request = mockRecognize.mock.calls[0][0] as Record<string, unknown>;
      expect((request.audio as Record<string, unknown>).content).toBe(
        audioData.toString("base64"),
      );
    });
  });

  describe("filterByConfidence()", () => {
    it("filters words below threshold", () => {
      const words = [
        { word: "hello", startTime: 0, endTime: 0.5, confidence: 0.9 },
        { word: "um", startTime: 0.5, endTime: 0.6, confidence: 0.3 },
        { word: "world", startTime: 0.6, endTime: 1.0, confidence: 0.85 },
      ];

      const filtered = provider.filterByConfidence(words);
      expect(filtered).toHaveLength(2);
      expect(filtered.map((w) => w.word)).toEqual(["hello", "world"]);
    });

    it("uses custom threshold", () => {
      const words = [
        { word: "maybe", startTime: 0, endTime: 0.5, confidence: 0.6 },
        { word: "sure", startTime: 0.5, endTime: 1.0, confidence: 0.5 },
      ];

      const filtered = provider.filterByConfidence(words, 0.55);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].word).toBe("maybe");
    });

    it("uses configured threshold by default", () => {
      provider.configure(makeConfig({ confidenceThreshold: 0.9 }));
      const words = [
        { word: "clear", startTime: 0, endTime: 0.5, confidence: 0.95 },
        { word: "maybe", startTime: 0.5, endTime: 1.0, confidence: 0.85 },
      ];

      const filtered = provider.filterByConfidence(words);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].word).toBe("clear");
    });
  });

  describe("buildFilteredTranscript()", () => {
    it("replaces low-confidence words with [...] markers", () => {
      const words = [
        { word: "hello", startTime: 0, endTime: 0.3, confidence: 0.9 },
        { word: "uh", startTime: 0.3, endTime: 0.4, confidence: 0.2 },
        { word: "um", startTime: 0.4, endTime: 0.5, confidence: 0.1 },
        { word: "world", startTime: 0.5, endTime: 1.0, confidence: 0.88 },
      ];

      const result = provider.buildFilteredTranscript(words);
      expect(result).toBe("hello [...] world");
    });

    it("returns clean transcript when all words are above threshold", () => {
      const words = [
        { word: "hello", startTime: 0, endTime: 0.3, confidence: 0.9 },
        { word: "world", startTime: 0.3, endTime: 0.6, confidence: 0.88 },
      ];

      const result = provider.buildFilteredTranscript(words);
      expect(result).toBe("hello world");
    });
  });

  describe("dispose()", () => {
    it("closes the client and resets state", () => {
      provider.configure(makeConfig());
      expect(provider.isConfigured()).toBe(true);

      provider.dispose();
      expect(mockClose).toHaveBeenCalled();
      expect(provider.isConfigured()).toBe(false);
    });

    it("handles close errors gracefully", () => {
      provider.configure(makeConfig());
      mockClose.mockImplementationOnce(() => {
        throw new Error("close failed");
      });

      expect(() => provider.dispose()).not.toThrow();
      expect(provider.isConfigured()).toBe(false);
    });
  });

  describe("getConfidenceThreshold()", () => {
    it("returns default threshold", () => {
      expect(provider.getConfidenceThreshold()).toBe(0.7);
    });

    it("returns configured threshold", () => {
      provider.configure(makeConfig({ confidenceThreshold: 0.85 }));
      expect(provider.getConfidenceThreshold()).toBe(0.85);
    });
  });
});
