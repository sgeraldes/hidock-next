import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockTranscribe,
  mockTranscribeAudio,
  mockIsAudioCapable,
  mockInsertSegment,
  mockGetRecentTranscriptSegments,
  mockBroadcast,
} = vi.hoisted(() => ({
  mockTranscribe: vi.fn().mockResolvedValue({
    segments: [{ speaker: "Speaker A", text: "Hello world", sentiment: "neutral" }],
    topics: ["greeting"],
    actionItems: [],
  }),
  mockTranscribeAudio: vi.fn().mockResolvedValue({
    segments: [{ speaker: "Speaker A", text: "Audio hello", sentiment: "neutral" }],
    topics: [],
    actionItems: [],
  }),
  mockIsAudioCapable: vi.fn().mockReturnValue(false),
  mockInsertSegment: vi.fn().mockReturnValue({ id: "seg-1" }),
  mockGetRecentTranscriptSegments: vi.fn().mockReturnValue([]),
  mockBroadcast: vi.fn(),
}));

const mockAIService = {
  transcribe: mockTranscribe,
  transcribeAudio: mockTranscribeAudio,
  isAudioCapable: mockIsAudioCapable,
  configure: vi.fn(),
  getActiveProvider: vi.fn().mockReturnValue("google"),
  summarize: vi.fn(),
  validateApiKey: vi.fn(),
};

vi.mock("../services/database", () => ({
  insertTranscriptSegment: mockInsertSegment,
  getRecentTranscriptSegments: mockGetRecentTranscriptSegments,
  saveDatabase: vi.fn(),
  createSession: vi.fn().mockReturnValue("session-1"),
  updateSession: vi.fn(),
  getSession: vi.fn(),
  getAllSessions: vi.fn().mockReturnValue([]),
  createRecording: vi.fn(),
  updateRecording: vi.fn(),
}));

vi.mock("../services/database-extras", () => ({
  createTalkingPoint: vi.fn(),
  createActionItem: vi.fn(),
  getTalkingPointsBySession: vi.fn().mockReturnValue([]),
  getActionItemsBySession: vi.fn().mockReturnValue([]),
}));

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: vi
      .fn()
      .mockReturnValue([{ webContents: { send: mockBroadcast } }]),
  },
  app: { getPath: vi.fn().mockReturnValue("/tmp/test") },
}));

import { TranscriptionPipeline } from "../services/transcription-pipeline";

describe("TranscriptionPipeline", () => {
  let pipeline: TranscriptionPipeline;

  beforeEach(() => {
    mockTranscribe.mockClear();
    mockTranscribeAudio.mockClear();
    mockIsAudioCapable.mockClear().mockReturnValue(false);
    mockInsertSegment.mockClear().mockReturnValue({ id: "seg-1" });
    mockGetRecentTranscriptSegments.mockClear().mockReturnValue([]);
    mockBroadcast.mockClear();
    pipeline = new TranscriptionPipeline("session-1", mockAIService as never);
  });

  afterEach(() => {
    pipeline.stop();
  });

  describe("processChunk (text mode)", () => {
    it("sends text to AI provider and stores result", async () => {
      await pipeline.processChunk("Hello world", 0);

      expect(mockTranscribe).toHaveBeenCalledWith(
        "Hello world",
        expect.objectContaining({ meetingContext: expect.any(String) }),
      );
      expect(mockInsertSegment).toHaveBeenCalledWith(
        expect.objectContaining({
          session_id: "session-1",
          text: "Hello world",
          speaker_name: "Speaker A",
          chunk_index: 0,
        }),
      );
    });

    it("broadcasts new segments to renderer", async () => {
      await pipeline.processChunk("Hello world", 0);

      expect(mockBroadcast).toHaveBeenCalledWith(
        "transcription:newSegments",
        expect.objectContaining({
          chunkIndex: 0,
          segments: expect.arrayContaining([
            expect.objectContaining({ text: "Hello world", speaker: "Speaker A" }),
          ]),
        }),
      );
    });

    it("broadcasts topics when present", async () => {
      await pipeline.processChunk("Let's discuss the project", 0);

      expect(mockBroadcast).toHaveBeenCalledWith(
        "transcription:topicsUpdated",
        expect.objectContaining({
          sessionId: "session-1",
          topics: expect.arrayContaining(["greeting"]),
        }),
      );
    });

    it("broadcasts action items when present", async () => {
      mockTranscribe.mockResolvedValueOnce({
        segments: [{ speaker: "Speaker A", text: "Action", sentiment: "neutral" }],
        topics: [],
        actionItems: [{ text: "Follow up on project", assignee: "Speaker A" }],
      });

      await pipeline.processChunk("We need to follow up", 0);

      expect(mockBroadcast).toHaveBeenCalledWith(
        "transcription:actionItemsUpdated",
        expect.objectContaining({
          sessionId: "session-1",
          actionItems: expect.arrayContaining([
            expect.objectContaining({ text: "Follow up on project" }),
          ]),
        }),
      );
    });
  });

  describe("processAudioChunk", () => {
    it("uses audio transcription when provider is audio-capable", async () => {
      mockIsAudioCapable.mockReturnValue(true);
      pipeline = new TranscriptionPipeline("session-1", mockAIService as never);

      const audioData = Buffer.from("fake-audio");
      await pipeline.processAudioChunk(audioData, "audio/ogg", 0);

      expect(mockTranscribeAudio).toHaveBeenCalledWith(
        audioData,
        "audio/ogg",
        expect.any(Object),
      );
    });
  });

  describe("context management", () => {
    it("includes previous segments as context in subsequent calls", async () => {
      mockGetRecentTranscriptSegments.mockReturnValue([
        { speaker_name: "Alice", text: "Previous context" },
      ]);

      await pipeline.processChunk("New utterance", 1);

      expect(mockTranscribe).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          meetingContext: expect.stringContaining("Previous context"),
        }),
      );
    });

    it("tracks speaker names across chunks", async () => {
      await pipeline.processChunk("Hello", 0);
      await pipeline.processChunk("World", 1);

      expect(mockTranscribe).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.objectContaining({
          attendees: expect.arrayContaining(["Speaker A"]),
        }),
      );
    });
  });

  describe("error handling", () => {
    it("broadcasts error on LLM failure after all retries exhausted", async () => {
      vi.useFakeTimers();
      mockTranscribe
        .mockRejectedValueOnce(new Error("LLM timeout"))
        .mockRejectedValueOnce(new Error("LLM timeout"))
        .mockRejectedValueOnce(new Error("LLM timeout"));

      const processPromise = pipeline.processChunk("test", 0);

      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(2000);
      await processPromise;

      expect(mockBroadcast).toHaveBeenCalledWith(
        "transcription:error",
        expect.stringContaining("LLM timeout"),
      );
      vi.useRealTimers();
    });

    it("retries with exponential backoff before succeeding", async () => {
      vi.useFakeTimers();
      mockTranscribe
        .mockRejectedValueOnce(new Error("Temporary"))
        .mockResolvedValueOnce({
          segments: [{ speaker: "B", text: "Recovered", sentiment: "neutral" }],
          topics: [],
          actionItems: [],
        });

      const processPromise = pipeline.processChunk("test", 0);

      await vi.advanceTimersByTimeAsync(1000);
      await processPromise;

      expect(mockTranscribe).toHaveBeenCalledTimes(2);
      expect(mockInsertSegment).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("does not crash on empty segments", async () => {
      mockTranscribe.mockResolvedValueOnce({
        segments: [],
        topics: [],
        actionItems: [],
      });

      await expect(pipeline.processChunk("silence", 0)).resolves.not.toThrow();
    });
  });

  describe("pipeline lifecycle", () => {
    it("stop prevents further processing", async () => {
      pipeline.stop();
      await pipeline.processChunk("test", 0);
      expect(mockTranscribe).not.toHaveBeenCalled();
    });

    it("getSessionId returns the session id", () => {
      expect(pipeline.getSessionId()).toBe("session-1");
    });

    it("status broadcasts pipeline state", async () => {
      await pipeline.processChunk("test", 0);
      expect(mockBroadcast).toHaveBeenCalledWith(
        "transcription:status",
        expect.any(String),
      );
    });
  });

  describe("session isolation", () => {
    it("different pipelines operate independently", async () => {
      const pipeline2 = new TranscriptionPipeline("session-2", mockAIService as never);

      await pipeline.processChunk("First", 0);
      await pipeline2.processChunk("Second", 0);

      const firstCall = mockInsertSegment.mock.calls[0][0];
      const secondCall = mockInsertSegment.mock.calls[1][0];

      expect(firstCall.session_id).toBe("session-1");
      expect(secondCall.session_id).toBe("session-2");

      pipeline2.stop();
    });
  });
});
