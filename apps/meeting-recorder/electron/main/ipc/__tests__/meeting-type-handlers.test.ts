import { describe, it, expect, vi, beforeEach } from "vitest";

const mockHandle = vi.hoisted(() => vi.fn());
const mockGetMeetingTypes = vi.hoisted(() => vi.fn(() => []));
const mockCreateMeetingType = vi.hoisted(() =>
  vi.fn((p: Record<string, unknown>) => ({ id: "mt-1", ...p })),
);
const mockUpdateSession = vi.hoisted(() => vi.fn());
const mockSaveDatabase = vi.hoisted(() => vi.fn());
const mockProcess = vi.hoisted(() => vi.fn());
const mockMarkSessionProcessing = vi.hoisted(() => vi.fn());
const mockMarkSessionComplete = vi.hoisted(() => vi.fn());
const mockGetSessionList = vi.hoisted(() =>
  vi.fn(() => [{ id: "sess-1", meeting_type_id: "mt-1" }]),
);

vi.mock("electron", () => ({
  ipcMain: { handle: mockHandle },
}));

vi.mock("../../services/database", () => ({
  getMeetingTypes: mockGetMeetingTypes,
  createMeetingType: mockCreateMeetingType,
  updateSession: mockUpdateSession,
  saveDatabase: mockSaveDatabase,
}));

vi.mock("../../services/end-of-meeting-processor", () => ({
  EndOfMeetingProcessor: class {
    process = mockProcess;
    setModel = vi.fn();
  },
}));

vi.mock("../session-handlers", () => ({
  getSessionManager: () => ({
    markSessionProcessing: mockMarkSessionProcessing,
    markSessionComplete: mockMarkSessionComplete,
    getSessionList: mockGetSessionList,
  }),
}));

describe("meeting-type-handlers", () => {
  let handlers: Record<string, (...args: unknown[]) => unknown>;

  beforeEach(async () => {
    vi.clearAllMocks();
    handlers = {};
    mockHandle.mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers[channel] = handler;
    });

    const mod = await import("../meeting-type-handlers");
    mod.registerMeetingTypeHandlers();
  });

  it("registers all four IPC channels", () => {
    expect(handlers["meetingType:list"]).toBeDefined();
    expect(handlers["meetingType:create"]).toBeDefined();
    expect(handlers["meetingType:setForSession"]).toBeDefined();
    expect(handlers["meetingType:processSession"]).toBeDefined();
  });

  it("processSession marks complete on success", async () => {
    mockProcess.mockResolvedValue(undefined);
    await handlers["meetingType:processSession"]({}, "sess-1");
    expect(mockMarkSessionProcessing).toHaveBeenCalledWith("sess-1");
    expect(mockMarkSessionComplete).toHaveBeenCalledWith("sess-1");
  });

  it("processSession recovers session status on failure", async () => {
    mockProcess.mockRejectedValue(new Error("LLM error"));
    await expect(
      handlers["meetingType:processSession"]({}, "sess-1"),
    ).rejects.toThrow("LLM error");
    expect(mockMarkSessionProcessing).toHaveBeenCalledWith("sess-1");
    expect(mockUpdateSession).toHaveBeenCalledWith("sess-1", {
      status: "complete",
      summary: "Processing failed: LLM error",
    });
    expect(mockSaveDatabase).toHaveBeenCalled();
    expect(mockMarkSessionComplete).not.toHaveBeenCalled();
  });
});
