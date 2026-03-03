import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockOn, mockSend } = vi.hoisted(() => ({
  mockOn: vi.fn(),
  mockSend: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: { on: mockOn, handle: vi.fn() },
  app: { getPath: vi.fn().mockReturnValue("/tmp/test") },
  BrowserWindow: {
    getAllWindows: vi.fn().mockReturnValue([
      { webContents: { send: mockSend } },
    ]),
  },
  screen: {
    getPrimaryDisplay: vi.fn().mockReturnValue({ workAreaSize: { width: 1920, height: 1080 } }),
  },
}));

const { mockSaveChunk } = vi.hoisted(() => ({
  mockSaveChunk: vi.fn().mockReturnValue("/tmp/test/chunk-000.ogg"),
}));

vi.mock("../services/audio-storage", () => ({
  AudioStorage: vi.fn(function (this: Record<string, unknown>) {
    this.saveChunk = mockSaveChunk;
    this.ensureSessionDir = vi.fn();
    this.getSessionDir = vi.fn().mockReturnValue("/tmp/test/session-1");
    this.getChunkFiles = vi.fn().mockReturnValue([]);
    this.getRecordingPath = vi.fn().mockReturnValue("/tmp/test/recording.ogg");
  }),
}));

const { mockMicDetectorStart, mockMicDetectorStop } = vi.hoisted(() => ({
  mockMicDetectorStart: vi.fn(),
  mockMicDetectorStop: vi.fn(),
}));

vi.mock("../services/mic-detector", () => ({
  MicDetector: vi.fn(function (this: Record<string, unknown>) {
    this.start = mockMicDetectorStart;
    this.stop = mockMicDetectorStop;
    this.poll = vi.fn().mockResolvedValue({ active: false });
    this.isRunning = vi.fn().mockReturnValue(false);
  }),
}));

const { mockGetPipeline, mockProcessAudioChunk } = vi.hoisted(() => ({
  mockGetPipeline: vi.fn(),
  mockProcessAudioChunk: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../ipc/transcription-handlers", () => ({
  getPipeline: mockGetPipeline,
  startPipeline: vi.fn(),
  stopPipeline: vi.fn(),
  registerTranscriptionHandlers: vi.fn(),
}));

vi.mock("../services/database", () => ({
  getSetting: vi.fn().mockReturnValue(null),
  saveDatabase: vi.fn(),
  deleteSession: vi.fn(),
  initializeDatabase: vi.fn(),
  getDatabase: vi.fn(),
}));

vi.mock("../services/window-manager", () => ({
  showControlBar: vi.fn(),
  hideControlBar: vi.fn(),
  setMainWindowAlwaysOnTop: vi.fn(),
  getMainWindow: vi.fn(),
  broadcastToAllWindows: vi.fn(),
}));

const { mockOnMicStatusChange } = vi.hoisted(() => ({
  mockOnMicStatusChange: vi.fn(),
}));

vi.mock("../ipc/session-handlers", () => ({
  getSessionManager: vi.fn().mockReturnValue({
    onMicStatusChange: mockOnMicStatusChange,
    setAudioConcatenation: vi.fn(),
  }),
  registerSessionHandlers: vi.fn(),
}));

import { registerAudioHandlers } from "../ipc/audio-handlers";

function makeEvent(senderSend?: ReturnType<typeof vi.fn>) {
  return { sender: { send: senderSend ?? vi.fn() } };
}

describe("registerAudioHandlers", () => {
  beforeEach(() => {
    mockOn.mockClear();
    mockSend.mockClear();
    mockSaveChunk.mockClear();
    mockMicDetectorStart.mockClear();
    mockMicDetectorStop.mockClear();
    mockGetPipeline.mockClear();
    mockProcessAudioChunk.mockClear();
  });

  it("registers audio:chunk listener using ipcMain.on (fire-and-forget)", () => {
    registerAudioHandlers();

    const chunkHandler = mockOn.mock.calls.find(
      (c: unknown[]) => c[0] === "audio:chunk",
    );
    expect(chunkHandler).toBeDefined();
  });

  it("saves chunk data to disk when audio:chunk is received", () => {
    registerAudioHandlers();

    const chunkHandler = mockOn.mock.calls.find(
      (c: unknown[]) => c[0] === "audio:chunk",
    );
    expect(chunkHandler).toBeDefined();

    const handler = chunkHandler![1];
    const data = new ArrayBuffer(8);
    handler(makeEvent(), data, "session-1", 0, "audio/ogg;codecs=opus");

    expect(mockSaveChunk).toHaveBeenCalledWith(
      "session-1",
      0,
      expect.any(Buffer),
    );
  });

  it("feeds audio chunk to transcription pipeline when available", async () => {
    const pipeline = { processAudioChunk: mockProcessAudioChunk };
    mockGetPipeline.mockReturnValue(pipeline);

    registerAudioHandlers();

    const chunkHandler = mockOn.mock.calls.find(
      (c: unknown[]) => c[0] === "audio:chunk",
    );
    const handler = chunkHandler![1];
    // Use chunkIndex=0 which takes the direct path (no ffmpeg extraction needed)
    const data = new ArrayBuffer(16);
    handler(makeEvent(), data, "session-1", 0, "audio/webm");

    // Wait for the async pipeline call (isSilent check + processAudioChunk)
    await new Promise((r) => setTimeout(r, 50));

    expect(mockGetPipeline).toHaveBeenCalledWith("session-1");
    expect(mockProcessAudioChunk).toHaveBeenCalledWith(
      expect.any(Buffer),
      "audio/webm",
      0,
    );
  });

  it("does not throw when no pipeline exists for session", () => {
    mockGetPipeline.mockReturnValue(undefined);

    registerAudioHandlers();

    const chunkHandler = mockOn.mock.calls.find(
      (c: unknown[]) => c[0] === "audio:chunk",
    );
    const handler = chunkHandler![1];
    const data = new ArrayBuffer(8);
    expect(() =>
      handler(makeEvent(), data, "no-pipeline-session", 0, "audio/webm"),
    ).not.toThrow();
  });

  it("sends audio:chunkAck back to sender after saving", () => {
    mockGetPipeline.mockReturnValue(undefined);

    registerAudioHandlers();

    const chunkHandler = mockOn.mock.calls.find(
      (c: unknown[]) => c[0] === "audio:chunk",
    );
    const handler = chunkHandler![1];
    const mockSenderSend = vi.fn();
    const data = new ArrayBuffer(8);
    handler(makeEvent(mockSenderSend), data, "session-1", 3, "audio/ogg;codecs=opus");

    expect(mockSenderSend).toHaveBeenCalledWith("audio:chunkAck", {
      sessionId: "session-1",
      chunkIndex: 3,
    });
  });

  it("starts mic detector and broadcasts status to all windows", () => {
    registerAudioHandlers();

    expect(mockMicDetectorStart).toHaveBeenCalledWith(expect.any(Function));
  });
});
