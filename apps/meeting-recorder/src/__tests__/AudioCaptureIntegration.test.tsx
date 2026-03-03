/**
 * Integration tests for ActiveSessionRecorder component in Dashboard.
 * Tests that audio capture starts/stops correctly with session lifecycle.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const mockStart = vi.fn().mockResolvedValue(undefined);
const mockStop = vi.fn();
const mockStopAndFlush = vi.fn().mockResolvedValue(undefined);

vi.mock("../hooks/useAudioCapture", () => ({
  useAudioCapture: vi.fn(() => ({
    isRecording: false,
    error: null,
    mimeType: "audio/ogg;codecs=opus",
    pendingChunks: 0,
    start: mockStart,
    stop: mockStop,
    stopAndFlush: mockStopAndFlush,
  })),
}));

const { mockSettingsState, mockSessionState } = vi.hoisted(() => ({
  mockSettingsState: {
    provider: "google",
    apiKey: "sk-test",
    ollamaBaseUrl: "http://localhost:11434/api",
    autoRecord: true,
    loaded: true,
  },
  mockSessionState: {
    activeSessionId: "active-session-1" as string | null,
    viewingSessionId: "active-session-1" as string | null,
    sessions: new Map<string, unknown>([
      ["active-session-1", { id: "active-session-1", status: "active", started_at: "2026-02-25T10:00:00Z" }],
    ]),
    micActive: false,
    loading: false,
    error: null as string | null,
    stopAndFlushRef: null,
    switchView: vi.fn(),
    loadSessions: vi.fn(),
    addSession: vi.fn(),
    setActiveSession: vi.fn(),
    updateSessionStatus: vi.fn(),
    setMicActive: vi.fn(),
    setLoading: vi.fn(),
    setError: vi.fn(),
    setStopAndFlushRef: vi.fn(),
  },
}));

vi.mock("../store/useSettingsStore", () => ({
  useSettingsStore: vi.fn((selector: (s: typeof mockSettingsState) => unknown) =>
    selector(mockSettingsState),
  ),
}));

vi.mock("../store/useSessionStore", () => ({
  useSessionStore: vi.fn(
    (selector: (s: typeof mockSessionState) => unknown) =>
      selector(mockSessionState),
  ),
}));

vi.mock("../store/useTranscriptStore", () => ({
  useTranscriptStore: vi.fn(
    (selector: (s: Record<string, unknown>) => unknown) => {
      const state = {
        segments: new Map(),
        topics: new Map(),
        actionItems: new Map(),
        summaries: new Map(),
        summaryLoading: new Map(),
        transcriptionError: null,
        setTranscriptionError: vi.fn(),
        appendSummaryChunk: vi.fn(),
        setSummaryLoading: vi.fn(),
      };
      return selector(state);
    },
  ),
}));

vi.mock("../hooks/useTranscriptionStream", () => ({
  useTranscriptionStream: vi.fn(),
}));

import Dashboard from "../pages/Dashboard";
import { useAudioCapture } from "../hooks/useAudioCapture";

beforeEach(() => {
  mockStart.mockClear();
  mockStop.mockClear();
  mockStopAndFlush.mockClear();
  mockSessionState.activeSessionId = "active-session-1";
  mockSessionState.setStopAndFlushRef.mockClear();
  (useAudioCapture as ReturnType<typeof vi.fn>).mockClear();
});

describe("ActiveSessionRecorder", () => {
  it("renders ActiveSessionRecorder when activeSessionId is set", async () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(useAudioCapture).toHaveBeenCalledWith("active-session-1");
    });
  });

  it("starts audio capture on mount when session is active", async () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mockStart).toHaveBeenCalled();
    });
  });

  it("does not use useAudioCapture when no active session", async () => {
    mockSessionState.activeSessionId = null;

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(useAudioCapture).not.toHaveBeenCalled();
  });
});
