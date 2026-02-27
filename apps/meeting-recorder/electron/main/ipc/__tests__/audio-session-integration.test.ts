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
}));

vi.mock("../../services/audio-storage", () => ({
  AudioStorage: vi.fn(function (this: Record<string, unknown>) {
    this.saveChunk = vi.fn();
    this.ensureSessionDir = vi.fn();
    this.getSessionDir = vi.fn();
    this.getChunkFiles = vi.fn().mockReturnValue([]);
    this.getRecordingPath = vi.fn();
  }),
}));

const { mockMicDetectorStart, mockMicDetectorStop } = vi.hoisted(() => ({
  mockMicDetectorStart: vi.fn(),
  mockMicDetectorStop: vi.fn(),
}));

vi.mock("../../services/mic-detector", () => ({
  MicDetector: vi.fn(function (this: Record<string, unknown>) {
    this.start = mockMicDetectorStart;
    this.stop = mockMicDetectorStop;
    this.poll = vi.fn().mockResolvedValue({ active: false });
    this.isRunning = vi.fn().mockReturnValue(false);
  }),
}));

vi.mock("../transcription-handlers", () => ({
  getPipeline: vi.fn(),
  startPipeline: vi.fn(),
  stopPipeline: vi.fn(),
  registerTranscriptionHandlers: vi.fn(),
}));

const { mockOnMicStatusChange } = vi.hoisted(() => ({
  mockOnMicStatusChange: vi.fn(),
}));

vi.mock("../session-handlers", () => ({
  getSessionManager: vi.fn(() => ({
    onMicStatusChange: mockOnMicStatusChange,
  })),
  registerSessionHandlers: vi.fn(),
}));

const { mockGetSetting } = vi.hoisted(() => ({
  mockGetSetting: vi.fn(),
}));

vi.mock("../../services/database", () => ({
  getSetting: mockGetSetting,
  setSetting: vi.fn(),
  getDatabase: vi.fn(),
  saveDatabase: vi.fn(),
}));

import { registerAudioHandlers } from "../audio-handlers";

describe("audio-session integration (mic → session manager)", () => {
  beforeEach(() => {
    mockOn.mockClear();
    mockSend.mockClear();
    mockMicDetectorStart.mockClear();
    mockMicDetectorStop.mockClear();
    mockOnMicStatusChange.mockClear();
    mockGetSetting.mockClear();
  });

  function getMicCallback() {
    registerAudioHandlers();
    expect(mockMicDetectorStart).toHaveBeenCalledWith(expect.any(Function));
    return mockMicDetectorStart.mock.calls[0][0] as (status: {
      active: boolean;
    }) => void;
  }

  it("calls sessionManager.onMicStatusChange when mic becomes active and autoRecord is true", () => {
    mockGetSetting.mockReturnValue("true");
    const callback = getMicCallback();

    callback({ active: true });

    expect(mockOnMicStatusChange).toHaveBeenCalledWith({ active: true });
  });

  it("calls sessionManager.onMicStatusChange when autoRecord setting is null (default on)", () => {
    mockGetSetting.mockReturnValue(null);
    const callback = getMicCallback();

    callback({ active: true });

    expect(mockOnMicStatusChange).toHaveBeenCalledWith({ active: true });
  });

  it("does NOT call sessionManager.onMicStatusChange when autoRecord is false", () => {
    mockGetSetting.mockReturnValue("false");
    const callback = getMicCallback();

    callback({ active: true });

    expect(mockOnMicStatusChange).not.toHaveBeenCalled();
  });

  it("still broadcasts mic status to windows even when autoRecord is false", () => {
    mockGetSetting.mockReturnValue("false");
    const callback = getMicCallback();

    callback({ active: true });

    expect(mockSend).toHaveBeenCalledWith("audio:micStatus", { active: true });
  });

  it("calls onMicStatusChange when mic goes inactive and autoRecord is true", () => {
    mockGetSetting.mockReturnValue("true");
    const callback = getMicCallback();

    callback({ active: false });

    expect(mockOnMicStatusChange).toHaveBeenCalledWith({ active: false });
  });
});
