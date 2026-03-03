import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockHandle } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: { handle: mockHandle, on: vi.fn() },
  BrowserWindow: {
    getAllWindows: vi.fn().mockReturnValue([]),
  },
  app: { getPath: vi.fn().mockReturnValue("/tmp/test") },
}));

vi.mock("../../services/database", () => ({
  insertTranscriptSegment: vi.fn(),
  getRecentTranscriptSegments: vi.fn().mockReturnValue([]),
  getTranscriptBySession: vi.fn().mockReturnValue([]),
  saveDatabase: vi.fn(),
  createSession: vi.fn(),
  updateSession: vi.fn(),
  getSession: vi.fn(),
  getAllSessions: vi.fn().mockReturnValue([]),
  createRecording: vi.fn(),
  updateRecording: vi.fn(),
}));

vi.mock("../../services/database-extras", () => ({
  getSetting: vi.fn().mockReturnValue(null),
  createTalkingPoint: vi.fn(),
  createActionItem: vi.fn(),
}));

vi.mock("../ai-handlers", () => ({
  getAIService: vi.fn().mockReturnValue({
    transcribe: vi.fn(),
    transcribeAudio: vi.fn(),
    analyzeTranscript: vi.fn(),
  }),
}));

vi.mock("../chirp3-handlers", () => ({
  getChirp3Provider: vi.fn().mockReturnValue(null),
}));

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: vi.fn().mockReturnValue(vi.fn()),
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
  generateObject: vi.fn(),
  generateText: vi.fn(),
}));

import { registerTranscriptionHandlers } from "../transcription-handlers";

describe("registerTranscriptionHandlers", () => {
  beforeEach(() => {
    mockHandle.mockClear();
  });

  it("registers transcription IPC handlers", () => {
    registerTranscriptionHandlers();
    const channels = mockHandle.mock.calls.map(
      (call: unknown[]) => call[0],
    );
    expect(channels).toContain("transcription:start");
    expect(channels).toContain("transcription:stop");
    expect(channels).toContain("transcription:processChunk");
  });

  it("transcription:start creates a pipeline for a session", async () => {
    registerTranscriptionHandlers();
    const handler = mockHandle.mock.calls.find(
      (call: unknown[]) => call[0] === "transcription:start",
    )?.[1] as (...args: unknown[]) => unknown;
    expect(() => handler({}, "session-1")).not.toThrow();
  });

  it("transcription:stop does not throw for unknown session", async () => {
    registerTranscriptionHandlers();
    const handler = mockHandle.mock.calls.find(
      (call: unknown[]) => call[0] === "transcription:stop",
    )?.[1] as (...args: unknown[]) => unknown;
    expect(() => handler({}, "nonexistent")).not.toThrow();
  });
});
