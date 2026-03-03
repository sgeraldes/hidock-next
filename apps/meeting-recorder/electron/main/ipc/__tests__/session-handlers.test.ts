import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockHandle, mockOn } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  mockOn: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: { handle: mockHandle, on: mockOn },
  BrowserWindow: {
    getAllWindows: vi.fn().mockReturnValue([]),
  },
  app: { getPath: vi.fn().mockReturnValue("/tmp/test") },
}));

const { mockStartSession, mockEndSession, mockGetActiveSessionId, mockGetSessionList } =
  vi.hoisted(() => ({
    mockStartSession: vi.fn().mockReturnValue({ id: "session-1", status: "active" }),
    mockEndSession: vi.fn(),
    mockGetActiveSessionId: vi.fn().mockReturnValue(null),
    mockGetSessionList: vi.fn().mockReturnValue([]),
  }));

// Capture lifecycle callbacks so mock SessionManager can trigger them
let capturedCallbacks: { onSessionStarted?: (id: string) => void; onSessionEnding?: (id: string) => void } = {};

vi.mock("../../services/session-manager", () => ({
  SessionManager: vi.fn(function (this: Record<string, unknown>) {
    this.startSession = (...args: unknown[]) => {
      const result = mockStartSession(...args);
      capturedCallbacks.onSessionStarted?.(result.id);
      return result;
    };
    this.endSession = async (...args: unknown[]) => {
      capturedCallbacks.onSessionEnding?.(args[0] as string);
      return mockEndSession(...args);
    };
    this.getActiveSessionId = mockGetActiveSessionId;
    this.getSessionList = mockGetSessionList;
    this.setLifecycleCallbacks = (cbs: typeof capturedCallbacks) => {
      capturedCallbacks = cbs;
    };
  }),
}));

const { mockDeleteSession, mockSaveDatabase } = vi.hoisted(() => ({
  mockDeleteSession: vi.fn(),
  mockSaveDatabase: vi.fn(),
}));

vi.mock("../../services/database", () => ({
  deleteSession: mockDeleteSession,
  deleteSessionTranscript: vi.fn(),
  getSession: vi.fn().mockReturnValue(null),
  updateSession: vi.fn(),
  saveDatabase: mockSaveDatabase,
}));

vi.mock("../../services/window-manager", () => ({
  showControlBar: vi.fn(),
  hideControlBar: vi.fn(),
  setMainWindowAlwaysOnTop: vi.fn(),
}));

const { mockStartPipeline, mockStopPipeline } = vi.hoisted(() => ({
  mockStartPipeline: vi.fn(),
  mockStopPipeline: vi.fn(),
}));

vi.mock("../transcription-handlers", () => ({
  startPipeline: mockStartPipeline,
  stopPipeline: mockStopPipeline,
  getPipeline: vi.fn(),
  registerTranscriptionHandlers: vi.fn(),
}));

vi.mock("../audio-handlers", () => ({
  clearSessionInitSegment: vi.fn(),
}));

vi.mock("../../services/audio-storage", () => ({
  AudioStorage: vi.fn().mockImplementation(() => ({
    getSessionDir: vi.fn().mockReturnValue("/tmp/test-session"),
  })),
}));

vi.mock("fs", () => ({
  default: {},
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue(Buffer.alloc(0)),
  readdirSync: vi.fn().mockReturnValue([]),
}));

import { registerSessionHandlers, getSessionManager } from "../session-handlers";

describe("registerSessionHandlers", () => {
  beforeEach(() => {
    capturedCallbacks = {};
    mockHandle.mockClear();
    mockOn.mockClear();
    mockStartSession.mockClear();
    mockEndSession.mockClear();
    mockGetActiveSessionId.mockClear();
    mockGetSessionList.mockClear();
    mockDeleteSession.mockClear();
    mockSaveDatabase.mockClear();
    mockStartPipeline.mockClear();
    mockStopPipeline.mockClear();
  });

  it("registers session IPC handlers", () => {
    registerSessionHandlers();
    const channels = mockHandle.mock.calls.map(
      (call: unknown[]) => call[0],
    );
    expect(channels).toContain("session:list");
    expect(channels).toContain("session:create");
    expect(channels).toContain("session:end");
    expect(channels).toContain("session:get");
    expect(channels).toContain("session:delete");
  });

  it("session:list returns all sessions", async () => {
    registerSessionHandlers();
    const handler = mockHandle.mock.calls.find(
      (call: unknown[]) => call[0] === "session:list",
    )?.[1] as (...args: unknown[]) => unknown;
    const mockSessions = [{ id: "s1", status: "active" }];
    mockGetSessionList.mockReturnValue(mockSessions);
    const result = await handler({});
    expect(result).toEqual(mockSessions);
  });

  it("session:create starts a new session", async () => {
    registerSessionHandlers();
    const handler = mockHandle.mock.calls.find(
      (call: unknown[]) => call[0] === "session:create",
    )?.[1] as (...args: unknown[]) => unknown;
    const result = await handler({});
    expect(mockStartSession).toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ id: "session-1" }));
  });

  it("session:end ends the specified session", async () => {
    registerSessionHandlers();
    const handler = mockHandle.mock.calls.find(
      (call: unknown[]) => call[0] === "session:end",
    )?.[1] as (...args: unknown[]) => unknown;
    await handler({}, "session-1");
    expect(mockEndSession).toHaveBeenCalledWith("session-1");
  });

  it("session:delete deletes session and saves database", async () => {
    registerSessionHandlers();
    const handler = mockHandle.mock.calls.find(
      (call: unknown[]) => call[0] === "session:delete",
    )?.[1] as (...args: unknown[]) => unknown;
    await handler({}, "session-1");
    expect(mockDeleteSession).toHaveBeenCalledWith("session-1");
    expect(mockSaveDatabase).toHaveBeenCalled();
  });

  it("exposes the session manager instance", () => {
    registerSessionHandlers();
    const manager = getSessionManager();
    expect(manager).toBeDefined();
    expect(manager.startSession).toBeDefined();
  });

  it("session:create starts transcription pipeline for the new session", async () => {
    registerSessionHandlers();
    const handler = mockHandle.mock.calls.find(
      (call: unknown[]) => call[0] === "session:create",
    )?.[1] as (...args: unknown[]) => unknown;
    await handler({});
    expect(mockStartPipeline).toHaveBeenCalledWith("session-1");
  });

  it("session:end stops transcription pipeline for the session", async () => {
    registerSessionHandlers();
    const handler = mockHandle.mock.calls.find(
      (call: unknown[]) => call[0] === "session:end",
    )?.[1] as (...args: unknown[]) => unknown;
    await handler({}, "session-1");
    expect(mockStopPipeline).toHaveBeenCalledWith("session-1");
  });
});
