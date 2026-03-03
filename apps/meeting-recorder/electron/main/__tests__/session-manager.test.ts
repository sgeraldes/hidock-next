import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const makeSession = (id: string) => ({
  id,
  status: "active",
  started_at: new Date().toISOString(),
  ended_at: null,
  meeting_type_id: null,
  title: null,
  summary: null,
  created_at: new Date().toISOString(),
});

const { mockCreateSession, mockUpdateSession, mockGetSession, mockGetAllSessions } =
  vi.hoisted(() => ({
    mockCreateSession: vi.fn(),
    mockUpdateSession: vi.fn(),
    mockGetSession: vi.fn().mockReturnValue(null),
    mockGetAllSessions: vi.fn().mockReturnValue([]),
  }));

vi.mock("../services/database", () => ({
  createSession: mockCreateSession,
  updateSession: mockUpdateSession,
  getSession: mockGetSession,
  getAllSessions: mockGetAllSessions,
  createRecording: vi.fn().mockReturnValue("recording-uuid-1"),
  updateRecording: vi.fn(),
  saveDatabase: vi.fn(),
}));

const { mockBroadcast } = vi.hoisted(() => ({
  mockBroadcast: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getPath: vi.fn().mockReturnValue("/tmp/test") },
  BrowserWindow: {
    getAllWindows: vi
      .fn()
      .mockReturnValue([{ webContents: { send: mockBroadcast } }]),
  },
}));

import { SessionManager } from "../services/session-manager";

describe("SessionManager", () => {
  let manager: SessionManager;

  beforeEach(() => {
    mockCreateSession.mockClear().mockReturnValue(makeSession("session-uuid-1"));
    mockUpdateSession.mockClear();
    mockGetSession.mockClear();
    mockGetAllSessions.mockClear().mockReturnValue([]);
    mockBroadcast.mockClear();
    manager = new SessionManager();
  });

  afterEach(() => {
    manager.dispose();
  });

  describe("startSession", () => {
    it("creates a new session in the database", () => {
      const session = manager.startSession();
      expect(mockCreateSession).toHaveBeenCalled();
      expect(session).toEqual(expect.objectContaining({ id: "session-uuid-1" }));
    });

    it("sets the session as active", () => {
      manager.startSession();
      expect(manager.getActiveSessionId()).toBe("session-uuid-1");
    });

    it("broadcasts session:created event", () => {
      manager.startSession();
      expect(mockBroadcast).toHaveBeenCalledWith(
        "session:created",
        expect.objectContaining({ id: "session-uuid-1" }),
      );
    });

    it("ends previous active session before starting new one", () => {
      manager.startSession();
      mockCreateSession.mockReturnValueOnce(makeSession("session-uuid-2"));
      manager.startSession();
      expect(mockUpdateSession).toHaveBeenCalledWith(
        "session-uuid-1",
        expect.objectContaining({ status: "inactive" }),
      );
      expect(manager.getActiveSessionId()).toBe("session-uuid-2");
    });
  });

  describe("endSession", () => {
    it("transitions active session to inactive", () => {
      manager.startSession();
      manager.endSession("session-uuid-1");
      expect(mockUpdateSession).toHaveBeenCalledWith(
        "session-uuid-1",
        expect.objectContaining({ status: "inactive" }),
      );
    });

    it("clears active session id", () => {
      manager.startSession();
      manager.endSession("session-uuid-1");
      expect(manager.getActiveSessionId()).toBeNull();
    });

    it("broadcasts session:statusChanged event", () => {
      manager.startSession();
      mockBroadcast.mockClear();
      manager.endSession("session-uuid-1");
      expect(mockBroadcast).toHaveBeenCalledWith(
        "session:statusChanged",
        expect.objectContaining({
          id: "session-uuid-1",
          status: "inactive",
        }),
      );
    });

    it("does nothing if session is not active", () => {
      mockUpdateSession.mockClear();
      manager.endSession("nonexistent");
      expect(mockUpdateSession).not.toHaveBeenCalled();
    });
  });

  describe("getActiveSessionId", () => {
    it("returns null when no session is active", () => {
      expect(manager.getActiveSessionId()).toBeNull();
    });

    it("returns the active session id after start", () => {
      manager.startSession();
      expect(manager.getActiveSessionId()).toBe("session-uuid-1");
    });
  });

  describe("onMicStatusChange", () => {
    it("starts a new session when mic becomes active and no session exists", () => {
      manager.onMicStatusChange({ active: true });
      expect(mockCreateSession).toHaveBeenCalled();
      expect(manager.getActiveSessionId()).toBe("session-uuid-1");
    });

    it("does not start a new session when one is already active", () => {
      manager.startSession();
      mockCreateSession.mockClear();
      manager.onMicStatusChange({ active: true });
      expect(mockCreateSession).not.toHaveBeenCalled();
    });

    it("ends session when mic becomes inactive", () => {
      manager.startSession();
      manager.onMicStatusChange({ active: false });
      expect(mockUpdateSession).toHaveBeenCalledWith(
        "session-uuid-1",
        expect.objectContaining({ status: "inactive" }),
      );
    });

    it("does not end session if no active session on mic inactive", () => {
      mockUpdateSession.mockClear();
      manager.onMicStatusChange({ active: false });
      expect(mockUpdateSession).not.toHaveBeenCalled();
    });
  });

  describe("getSessionList", () => {
    it("returns all sessions from database", () => {
      const mockSessions = [
        { id: "s1", status: "complete", started_at: "2026-01-01" },
        { id: "s2", status: "active", started_at: "2026-01-02" },
      ];
      mockGetAllSessions.mockReturnValue(mockSessions);
      const result = manager.getSessionList();
      expect(result).toEqual(mockSessions);
    });
  });

  describe("dispose", () => {
    it("ends any active session", () => {
      manager.startSession();
      manager.dispose();
      expect(mockUpdateSession).toHaveBeenCalledWith(
        "session-uuid-1",
        expect.objectContaining({ status: "inactive" }),
      );
    });
  });
});
