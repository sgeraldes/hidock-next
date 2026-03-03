import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mocks ---

const { mockSend, mockGetAllWindows, mockInsertTranscriptSegment, mockGetRecentTranscriptSegments, mockSaveDatabase, mockCreateTalkingPoint, mockCreateActionItem } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockGetAllWindows: vi.fn().mockReturnValue([]),
  mockInsertTranscriptSegment: vi.fn(),
  mockGetRecentTranscriptSegments: vi.fn().mockReturnValue([]),
  mockSaveDatabase: vi.fn(),
  mockCreateTalkingPoint: vi.fn(),
  mockCreateActionItem: vi.fn(),
}));

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: mockGetAllWindows,
  },
}));

vi.mock("../services/database", () => ({
  insertTranscriptSegment: mockInsertTranscriptSegment,
  getRecentTranscriptSegments: mockGetRecentTranscriptSegments,
  saveDatabase: mockSaveDatabase,
}));

vi.mock("../services/database-extras", () => ({
  createTalkingPoint: mockCreateTalkingPoint,
  createActionItem: mockCreateActionItem,
  getTalkingPointsBySession: vi.fn().mockReturnValue([]),
  getActionItemsBySession: vi.fn().mockReturnValue([]),
}));

import { TranscriptionPipeline } from "../services/transcription-pipeline";
import type { AIProviderService } from "../services/ai-provider";
import type { Chirp3Provider } from "../services/chirp3-provider";

// --- Helpers ---

function makeMockWindow() {
  const send = vi.fn();
  return { webContents: { send } };
}

function makeMockAIProvider(overrides?: Partial<AIProviderService>) {
  return {
    transcribe: vi.fn().mockResolvedValue({
      segments: [{ speaker: "Speaker 1", text: "test", sentiment: "neutral" }],
      topics: [],
      actionItems: [],
    }),
    transcribeAudio: vi.fn().mockResolvedValue({
      segments: [{ speaker: "Speaker 1", text: "audio test", sentiment: "neutral" }],
      topics: [],
      actionItems: [],
    }),
    analyzeTranscript: vi.fn().mockResolvedValue({
      segments: [{ speaker: "Alice", text: "analyzed text", sentiment: "positive" }],
      topics: ["project update"],
      actionItems: [{ text: "Review PR", assignee: "Alice" }],
    }),
    ...overrides,
  } as unknown as AIProviderService;
}

function makeMockChirp3Provider(overrides?: Partial<Chirp3Provider>) {
  return {
    isConfigured: vi.fn().mockReturnValue(true),
    recognizeChunk: vi.fn().mockResolvedValue({
      transcript: "Hello world from Chirp",
      words: [
        { word: "Hello", startTime: 0, endTime: 0.3, confidence: 0.95 },
        { word: "world", startTime: 0.3, endTime: 0.6, confidence: 0.9 },
        { word: "from", startTime: 0.6, endTime: 0.8, confidence: 0.88 },
        { word: "Chirp", startTime: 0.8, endTime: 1.0, confidence: 0.92 },
      ],
      confidence: 0.91,
      languageCode: "en-US",
      isFinal: true,
    }),
    filterByConfidence: vi.fn().mockImplementation((words) =>
      words.filter((w: { confidence: number }) => w.confidence >= 0.7),
    ),
    ...overrides,
  } as unknown as Chirp3Provider;
}

// --- Tests ---

describe("TranscriptionPipeline - Chirp 3 integration", () => {
  let mockAI: AIProviderService;
  let mockChirp3: Chirp3Provider;

  beforeEach(() => {
    vi.clearAllMocks();
    const win = makeMockWindow();
    mockGetAllWindows.mockReturnValue([win]);
    mockSend.mockReset();
    mockAI = makeMockAIProvider();
    mockChirp3 = makeMockChirp3Provider();
  });

  describe("processAudioChunk routing", () => {
    it("routes to Chirp 3 when backend is chirp3+gemini and provider configured", async () => {
      const pipeline = new TranscriptionPipeline(
        "session-1",
        mockAI,
        mockChirp3,
        "chirp3+gemini",
      );

      await pipeline.processAudioChunk(
        Buffer.from("audio-data"),
        "audio/ogg",
        0,
      );

      // Stage 1: Chirp 3 recognizes (now includes sessionId)
      expect(mockChirp3.recognizeChunk).toHaveBeenCalledWith(
        Buffer.from("audio-data"),
        "audio/ogg",
        "session-1",
      );
      // Stage 2: Gemini analyzes text
      expect(mockAI.analyzeTranscript).toHaveBeenCalled();
      // Gemini multimodal NOT called
      expect(mockAI.transcribeAudio).not.toHaveBeenCalled();
    });

    it("routes to Gemini multimodal when backend is gemini-multimodal", async () => {
      const pipeline = new TranscriptionPipeline(
        "session-1",
        mockAI,
        mockChirp3,
        "gemini-multimodal",
      );

      await pipeline.processAudioChunk(
        Buffer.from("audio-data"),
        "audio/ogg",
        0,
      );

      expect(mockAI.transcribeAudio).toHaveBeenCalled();
      expect(mockChirp3.recognizeChunk).not.toHaveBeenCalled();
      expect(mockAI.analyzeTranscript).not.toHaveBeenCalled();
    });

    it("routes to Gemini multimodal when chirp3 provider is null", async () => {
      const pipeline = new TranscriptionPipeline(
        "session-1",
        mockAI,
        null,
        "chirp3+gemini",
      );

      await pipeline.processAudioChunk(
        Buffer.from("audio-data"),
        "audio/ogg",
        0,
      );

      expect(mockAI.transcribeAudio).toHaveBeenCalled();
    });

    it("routes to Gemini multimodal when chirp3 is not configured", async () => {
      const unconfiguredChirp3 = makeMockChirp3Provider({
        isConfigured: vi.fn().mockReturnValue(false),
      });
      const pipeline = new TranscriptionPipeline(
        "session-1",
        mockAI,
        unconfiguredChirp3,
        "chirp3+gemini",
      );

      await pipeline.processAudioChunk(
        Buffer.from("audio-data"),
        "audio/ogg",
        0,
      );

      expect(mockAI.transcribeAudio).toHaveBeenCalled();
      expect(unconfiguredChirp3.recognizeChunk).not.toHaveBeenCalled();
    });

    it("defaults to gemini-multimodal when no backend specified", async () => {
      const pipeline = new TranscriptionPipeline("session-1", mockAI);

      await pipeline.processAudioChunk(
        Buffer.from("audio-data"),
        "audio/ogg",
        0,
      );

      expect(mockAI.transcribeAudio).toHaveBeenCalled();
    });
  });

  describe("two-stage pipeline (Chirp 3 + Gemini)", () => {
    it("passes filtered transcript from Chirp 3 to Gemini analysis", async () => {
      const pipeline = new TranscriptionPipeline(
        "session-1",
        mockAI,
        mockChirp3,
        "chirp3+gemini",
      );

      await pipeline.processAudioChunk(
        Buffer.from("audio"),
        "audio/ogg",
        0,
      );

      // Chirp 3 was called
      expect(mockChirp3.recognizeChunk).toHaveBeenCalled();
      expect(mockChirp3.filterByConfidence).toHaveBeenCalled();

      // Gemini analysis received the text
      const analyzeCall = (mockAI.analyzeTranscript as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(analyzeCall[0]).toBe("Hello world from Chirp"); // filtered transcript
      expect(analyzeCall[1]).toHaveProperty("meetingContext");
      expect(analyzeCall[1]).toHaveProperty("attendees");
      expect(analyzeCall[1].wordData).toHaveLength(4);
    });

    it("stores segments and broadcasts results", async () => {
      const pipeline = new TranscriptionPipeline(
        "session-1",
        mockAI,
        mockChirp3,
        "chirp3+gemini",
      );

      await pipeline.processAudioChunk(
        Buffer.from("audio"),
        "audio/ogg",
        0,
      );

      // Database insertions
      expect(mockInsertTranscriptSegment).toHaveBeenCalledWith(
        expect.objectContaining({
          session_id: "session-1",
          speaker_name: "Alice",
          text: "analyzed text",
        }),
      );

      // Topics stored
      expect(mockCreateTalkingPoint).toHaveBeenCalledWith(
        expect.objectContaining({
          session_id: "session-1",
          topic: "project update",
        }),
      );

      // Action items stored
      expect(mockCreateActionItem).toHaveBeenCalledWith(
        expect.objectContaining({
          session_id: "session-1",
          text: "Review PR",
          assignee: "Alice",
        }),
      );

      expect(mockSaveDatabase).toHaveBeenCalled();
    });

    it("skips processing when Chirp 3 returns empty transcript (silence)", async () => {
      const silentChirp3 = makeMockChirp3Provider({
        recognizeChunk: vi.fn().mockResolvedValue({
          transcript: "   ",
          words: [],
          confidence: 0,
          languageCode: "en-US",
          isFinal: true,
        }),
      });

      const pipeline = new TranscriptionPipeline(
        "session-1",
        mockAI,
        silentChirp3,
        "chirp3+gemini",
      );

      await pipeline.processAudioChunk(
        Buffer.from("silence"),
        "audio/ogg",
        0,
      );

      expect(mockAI.analyzeTranscript).not.toHaveBeenCalled();
      expect(mockInsertTranscriptSegment).not.toHaveBeenCalled();
    });
  });

  describe("fallback behavior", () => {
    it("falls back to Gemini multimodal when Chirp 3 fails", async () => {
      const failingChirp3 = makeMockChirp3Provider({
        recognizeChunk: vi.fn().mockRejectedValue(new Error("Chirp 3 network error")),
      });

      const pipeline = new TranscriptionPipeline(
        "session-1",
        mockAI,
        failingChirp3,
        "chirp3+gemini",
      );

      await pipeline.processAudioChunk(
        Buffer.from("audio"),
        "audio/ogg",
        0,
      );

      // Should have fallen back to Gemini multimodal
      expect(mockAI.transcribeAudio).toHaveBeenCalled();
      // And should have stored the result
      expect(mockInsertTranscriptSegment).toHaveBeenCalled();
    });
  });

  describe("pipeline lifecycle", () => {
    it("does not process after stop()", async () => {
      const pipeline = new TranscriptionPipeline(
        "session-1",
        mockAI,
        mockChirp3,
        "chirp3+gemini",
      );

      pipeline.stop();

      await pipeline.processAudioChunk(
        Buffer.from("audio"),
        "audio/ogg",
        0,
      );

      expect(mockChirp3.recognizeChunk).not.toHaveBeenCalled();
      expect(mockAI.transcribeAudio).not.toHaveBeenCalled();
    });

    it("tracks known speakers across chunks", async () => {
      const pipeline = new TranscriptionPipeline(
        "session-1",
        mockAI,
        mockChirp3,
        "chirp3+gemini",
      );

      // First chunk
      await pipeline.processAudioChunk(
        Buffer.from("audio-1"),
        "audio/ogg",
        0,
      );

      // Second chunk - analyzeTranscript should receive Alice as known attendee
      (mockAI.analyzeTranscript as ReturnType<typeof vi.fn>).mockClear();
      await pipeline.processAudioChunk(
        Buffer.from("audio-2"),
        "audio/ogg",
        1,
      );

      const secondCallOptions = (mockAI.analyzeTranscript as ReturnType<typeof vi.fn>).mock.calls[0][1];
      expect(secondCallOptions.attendees).toContain("Alice");
    });
  });

  describe("timing calculations", () => {
    it("uses TIMESLICE_MS (3000) for segment timing", async () => {
      const pipeline = new TranscriptionPipeline(
        "session-1",
        mockAI,
        mockChirp3,
        "chirp3+gemini",
      );

      await pipeline.processAudioChunk(
        Buffer.from("audio"),
        "audio/ogg",
        5,
      );

      expect(mockInsertTranscriptSegment).toHaveBeenCalledWith(
        expect.objectContaining({
          start_ms: 15000, // 5 * 3000
          end_ms: 18000,   // 6 * 3000
          chunk_index: 5,
        }),
      );
    });

    it("uses TIMESLICE_MS for talking point timing", async () => {
      const pipeline = new TranscriptionPipeline(
        "session-1",
        mockAI,
        mockChirp3,
        "chirp3+gemini",
      );

      await pipeline.processAudioChunk(
        Buffer.from("audio"),
        "audio/ogg",
        3,
      );

      expect(mockCreateTalkingPoint).toHaveBeenCalledWith(
        expect.objectContaining({
          first_mentioned_ms: 9000, // 3 * 3000
        }),
      );
    });
  });
});
