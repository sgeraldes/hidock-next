import { describe, it, expect, vi, beforeEach } from "vitest";

const mockStreamText = vi.hoisted(() => vi.fn());
const mockGetTranscriptBySession = vi.hoisted(() => vi.fn().mockReturnValue([]));
const mockUpdateSession = vi.hoisted(() => vi.fn());
const mockSaveDatabase = vi.hoisted(() => vi.fn());
const mockSend = vi.hoisted(() => vi.fn());

vi.mock("ai", () => ({
  streamText: mockStreamText,
}));

vi.mock("../services/database", () => ({
  getTranscriptBySession: mockGetTranscriptBySession,
  updateSession: mockUpdateSession,
  saveDatabase: mockSaveDatabase,
}));

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: vi.fn().mockReturnValue([
      { webContents: { send: mockSend } },
    ]),
  },
}));

import { SummarizationService } from "../services/summarization-service";

const SEGMENT = {
  id: "s1",
  session_id: "sess1",
  speaker_name: "Alice",
  text: "Let's finalize the roadmap",
  start_ms: 0,
  end_ms: 5000,
  sentiment: null,
  confidence: null,
  language: null,
  chunk_index: 0,
  created_at: "2026-01-01T00:00:00Z",
};

describe("SummarizationService", () => {
  let service: SummarizationService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new SummarizationService();
    service.setModel("mock-model");
  });

  it("returns empty result when transcript is empty", async () => {
    mockGetTranscriptBySession.mockReturnValue([]);
    const result = await service.summarizeSession("sess1");
    expect(result.summary).toBe("No transcript content to summarize.");
    expect(mockStreamText).not.toHaveBeenCalled();
  });

  it("calls streamText (not generateObject) for streaming", async () => {
    mockGetTranscriptBySession.mockReturnValue([SEGMENT]);

    const chunks = ["This ", "is ", "a summary."];
    mockStreamText.mockResolvedValue({
      textStream: (async function* () {
        for (const chunk of chunks) {
          yield chunk;
        }
      })(),
      text: Promise.resolve("This is a summary."),
    });

    await service.summarizeSession("sess1");

    expect(mockStreamText).toHaveBeenCalledTimes(1);
    const call = mockStreamText.mock.calls[0][0];
    expect(call.prompt).toContain("Alice: Let's finalize the roadmap");
  });

  it("pushes each chunk to renderer via summarization:chunk IPC", async () => {
    mockGetTranscriptBySession.mockReturnValue([SEGMENT]);

    const chunks = ["Part 1 ", "Part 2."];
    mockStreamText.mockResolvedValue({
      textStream: (async function* () {
        for (const chunk of chunks) {
          yield chunk;
        }
      })(),
      text: Promise.resolve("Part 1 Part 2."),
    });

    await service.summarizeSession("sess1");

    const chunkCalls = mockSend.mock.calls.filter(
      (c) => c[0] === "summarization:chunk",
    );
    expect(chunkCalls.length).toBeGreaterThan(0);
    expect(chunkCalls[0][1]).toMatchObject({ sessionId: "sess1" });
  });

  it("saves full summary to database after stream completes", async () => {
    mockGetTranscriptBySession.mockReturnValue([SEGMENT]);

    mockStreamText.mockResolvedValue({
      textStream: (async function* () {
        yield "Final summary text.";
      })(),
      text: Promise.resolve("Final summary text."),
    });

    await service.summarizeSession("sess1");

    expect(mockUpdateSession).toHaveBeenCalledWith(
      "sess1",
      expect.objectContaining({ summary: expect.stringContaining("Final summary text.") }),
    );
    expect(mockSaveDatabase).toHaveBeenCalled();
  });

  it("handles streamText failure gracefully", async () => {
    mockGetTranscriptBySession.mockReturnValue([SEGMENT]);
    mockStreamText.mockRejectedValue(new Error("Stream error"));

    await expect(service.summarizeSession("sess1")).rejects.toThrow(
      "Summarization failed",
    );
  });

  it("throws if model not set", async () => {
    const uninitialized = new SummarizationService();
    await expect(uninitialized.summarizeSession("sess1")).rejects.toThrow(
      "AI model not configured",
    );
  });
});
