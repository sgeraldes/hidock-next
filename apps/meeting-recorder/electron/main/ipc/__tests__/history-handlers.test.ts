import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockHandle } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: { handle: mockHandle },
}));

const {
  mockGetAllSessions,
  mockSearchSessions,
  mockDeleteSession,
  mockSaveDatabase,
} = vi.hoisted(() => ({
  mockGetAllSessions: vi.fn().mockReturnValue([]),
  mockSearchSessions: vi.fn().mockReturnValue([]),
  mockDeleteSession: vi.fn(),
  mockSaveDatabase: vi.fn(),
}));

vi.mock("../../services/database", () => ({
  getAllSessions: mockGetAllSessions,
  searchSessions: mockSearchSessions,
  deleteSession: mockDeleteSession,
  saveDatabase: mockSaveDatabase,
}));

import { registerHistoryHandlers } from "../history-handlers";

describe("registerHistoryHandlers", () => {
  beforeEach(() => {
    mockHandle.mockClear();
    mockGetAllSessions.mockClear();
    mockSearchSessions.mockClear();
    mockDeleteSession.mockClear();
    mockSaveDatabase.mockClear();
  });

  it("registers history IPC handlers", () => {
    registerHistoryHandlers();
    const channels = mockHandle.mock.calls.map((call: unknown[]) => call[0]);
    expect(channels).toContain("history:search");
    expect(channels).toContain("history:delete");
  });

  it("history:search with empty query returns all sessions", async () => {
    const mockSessions = [
      { id: "s1", title: "Team Standup", status: "completed" },
      { id: "s2", title: "Product Review", status: "completed" },
    ];
    mockGetAllSessions.mockReturnValue(mockSessions);

    registerHistoryHandlers();
    const handler = mockHandle.mock.calls.find(
      (call: unknown[]) => call[0] === "history:search",
    )?.[1] as (_: unknown, query: string) => unknown;

    const result = await handler({}, "");
    expect(result).toEqual(mockSessions);
    expect(mockGetAllSessions).toHaveBeenCalled();
    expect(mockSearchSessions).not.toHaveBeenCalled();
  });

  it("history:search with a query calls searchSessions (no N+1)", async () => {
    const matchingSessions = [
      { id: "s1", title: "Team Standup", status: "completed" },
    ];
    mockSearchSessions.mockReturnValue(matchingSessions);

    registerHistoryHandlers();
    const handler = mockHandle.mock.calls.find(
      (call: unknown[]) => call[0] === "history:search",
    )?.[1] as (_: unknown, query: string) => unknown;

    const result = await handler({}, "standup");
    expect(mockSearchSessions).toHaveBeenCalledWith("standup");
    expect(mockSearchSessions).toHaveBeenCalledTimes(1);
    expect(result).toEqual(matchingSessions);
  });

  it("history:search with whitespace-only query returns all sessions", async () => {
    const mockSessions = [{ id: "s1", title: null, status: "active" }];
    mockGetAllSessions.mockReturnValue(mockSessions);

    registerHistoryHandlers();
    const handler = mockHandle.mock.calls.find(
      (call: unknown[]) => call[0] === "history:search",
    )?.[1] as (_: unknown, query: string) => unknown;

    const result = await handler({}, "   ");
    expect(result).toEqual(mockSessions);
    expect(mockGetAllSessions).toHaveBeenCalled();
    expect(mockSearchSessions).not.toHaveBeenCalled();
  });

  it("history:delete calls deleteSession and saves database", async () => {
    registerHistoryHandlers();
    const handler = mockHandle.mock.calls.find(
      (call: unknown[]) => call[0] === "history:delete",
    )?.[1] as (_: unknown, sessionId: string) => unknown;

    await handler({}, "session-abc");
    expect(mockDeleteSession).toHaveBeenCalledWith("session-abc");
    expect(mockSaveDatabase).toHaveBeenCalled();
  });
});
