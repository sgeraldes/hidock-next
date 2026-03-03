import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mocks ---

const { mockHandle, mockGetSetting, mockGetAIService, mockGetChirp3Provider } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  mockGetSetting: vi.fn(),
  mockGetAIService: vi.fn().mockReturnValue({
    transcribe: vi.fn(),
    transcribeAudio: vi.fn(),
    analyzeTranscript: vi.fn(),
  }),
  mockGetChirp3Provider: vi.fn().mockReturnValue(null),
}));

const mockPipelineInstances: Array<{
  stop: ReturnType<typeof vi.fn>;
  processChunk: ReturnType<typeof vi.fn>;
  constructorArgs: unknown[];
}> = [];

vi.mock("electron", () => ({
  ipcMain: { handle: mockHandle, on: vi.fn() },
}));

vi.mock("../../services/database-extras", () => ({
  getSetting: mockGetSetting,
}));

vi.mock("../ai-handlers", () => ({
  getAIService: mockGetAIService,
}));

vi.mock("../chirp3-handlers", () => ({
  getChirp3Provider: mockGetChirp3Provider,
}));

vi.mock("../../services/transcription-pipeline", () => ({
  TranscriptionPipeline: vi.fn(function (
    this: Record<string, unknown>,
    ...args: unknown[]
  ) {
    this.stop = vi.fn();
    this.processChunk = vi.fn();
    this.initializeStreaming = vi.fn();
    this.isStreaming = vi.fn().mockReturnValue(false);
    this.feedAudioStream = vi.fn();
    this.flush = vi.fn().mockResolvedValue(undefined);
    mockPipelineInstances.push({
      stop: this.stop as ReturnType<typeof vi.fn>,
      processChunk: this.processChunk as ReturnType<typeof vi.fn>,
      constructorArgs: args,
    });
  }),
  BACKEND_CHIRP3_GEMINI: "chirp3+gemini",
  BACKEND_GEMINI_MULTIMODAL: "gemini-multimodal",
}));

import { registerTranscriptionHandlers, startPipeline, stopPipeline, getPipeline } from "../transcription-handlers";
import { TranscriptionPipeline } from "../../services/transcription-pipeline";

// --- Tests ---

describe("transcription-handlers (Chirp 3 integration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPipelineInstances.length = 0;
    // Reset module state - we need to clear any pipelines from previous tests
    // by stopping all known sessions
    stopPipeline("test-session");
    stopPipeline("session-1");
    mockPipelineInstances.length = 0;
    vi.clearAllMocks();
  });

  describe("pipeline creation with Chirp 3 injection", () => {
    it("injects chirp3 provider and backend setting into pipeline", () => {
      const mockChirp3 = { isConfigured: vi.fn().mockReturnValue(true) };
      mockGetChirp3Provider.mockReturnValue(mockChirp3);
      mockGetSetting.mockImplementation((key: string) => {
        if (key === "ai.transcriptionBackend") return "chirp3+gemini";
        return null;
      });

      startPipeline("session-1");

      expect(TranscriptionPipeline).toHaveBeenCalledWith(
        "session-1",
        expect.anything(), // AI service
        mockChirp3,
        "chirp3+gemini",
      );
    });

    it("injects null chirp3 when provider not available", () => {
      mockGetChirp3Provider.mockReturnValue(null);
      mockGetSetting.mockImplementation((key: string) => {
        if (key === "ai.transcriptionBackend") return "gemini-multimodal";
        return null;
      });

      startPipeline("session-1");

      expect(TranscriptionPipeline).toHaveBeenCalledWith(
        "session-1",
        expect.anything(),
        null,
        "gemini-multimodal",
      );
    });

    it("defaults backend to gemini-multimodal when setting is missing", () => {
      mockGetChirp3Provider.mockReturnValue(null);
      mockGetSetting.mockReturnValue(null);

      startPipeline("session-1");

      const constructorArgs = mockPipelineInstances[0].constructorArgs;
      expect(constructorArgs[3]).toBe("gemini-multimodal");
    });

    it("does not create duplicate pipeline for same session", () => {
      mockGetChirp3Provider.mockReturnValue(null);
      mockGetSetting.mockReturnValue(null);

      startPipeline("session-1");
      startPipeline("session-1"); // second call

      expect(mockPipelineInstances).toHaveLength(1);
    });
  });

  describe("IPC handlers", () => {
    it("registers transcription:start, stop, and processChunk handlers", () => {
      registerTranscriptionHandlers();

      const channels = mockHandle.mock.calls.map((call: unknown[]) => call[0]);
      expect(channels).toContain("transcription:start");
      expect(channels).toContain("transcription:stop");
      expect(channels).toContain("transcription:processChunk");
    });

    it("transcription:start creates pipeline with chirp3 settings", () => {
      const mockChirp3 = { isConfigured: vi.fn().mockReturnValue(true) };
      mockGetChirp3Provider.mockReturnValue(mockChirp3);
      mockGetSetting.mockImplementation((key: string) => {
        if (key === "ai.transcriptionBackend") return "chirp3+gemini";
        return null;
      });

      registerTranscriptionHandlers();

      const startHandler = mockHandle.mock.calls.find(
        (call: unknown[]) => call[0] === "transcription:start",
      )?.[1] as (event: unknown, sessionId: string) => void;

      startHandler({}, "ipc-session-1");

      expect(TranscriptionPipeline).toHaveBeenCalledWith(
        "ipc-session-1",
        expect.anything(),
        mockChirp3,
        "chirp3+gemini",
      );
    });

    it("transcription:stop cleans up pipeline", () => {
      registerTranscriptionHandlers();
      mockGetChirp3Provider.mockReturnValue(null);
      mockGetSetting.mockReturnValue(null);

      const startHandler = mockHandle.mock.calls.find(
        (call: unknown[]) => call[0] === "transcription:start",
      )?.[1] as (event: unknown, sessionId: string) => void;

      const stopHandler = mockHandle.mock.calls.find(
        (call: unknown[]) => call[0] === "transcription:stop",
      )?.[1] as (event: unknown, sessionId: string) => void;

      startHandler({}, "cleanup-session");
      stopHandler({}, "cleanup-session");

      expect(mockPipelineInstances[0].stop).toHaveBeenCalled();
    });
  });

  describe("getPipeline()", () => {
    it("returns pipeline for active session", () => {
      mockGetChirp3Provider.mockReturnValue(null);
      mockGetSetting.mockReturnValue(null);

      startPipeline("active-session");
      const pipeline = getPipeline("active-session");
      expect(pipeline).toBeDefined();
    });

    it("returns undefined for unknown session", () => {
      const pipeline = getPipeline("nonexistent");
      expect(pipeline).toBeUndefined();
    });
  });
});
