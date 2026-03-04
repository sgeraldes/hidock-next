/**
 * Tests for useTranscriptionStream — SPEC-005: Transcript Session Isolation
 *
 * Verifies that live segment events from one session cannot land in another
 * session's store entry during rapid session switching.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTranscriptionStream } from "../hooks/useTranscriptionStream";
import { useTranscriptStore } from "../store/useTranscriptStore";

// Capture callbacks registered by the hook so tests can fire them
let capturedSegmentsCallback: ((data: unknown) => void) | null = null;
let capturedTopicsCallback: ((data: unknown) => void) | null = null;
let capturedActionsCallback: ((data: unknown) => void) | null = null;

const mockElectronAPI = {
  session: {
    getTranscript: vi.fn().mockResolvedValue([]),
    getTopics: vi.fn().mockResolvedValue([]),
    getActionItems: vi.fn().mockResolvedValue([]),
    getSummary: vi.fn().mockResolvedValue(""),
  },
  transcription: {
    onNewSegments: vi.fn((cb: (data: unknown) => void) => {
      capturedSegmentsCallback = cb;
      return () => { capturedSegmentsCallback = null; };
    }),
    onTopicsUpdated: vi.fn((cb: (data: unknown) => void) => {
      capturedTopicsCallback = cb;
      return () => { capturedTopicsCallback = null; };
    }),
    onActionItemsUpdated: vi.fn((cb: (data: unknown) => void) => {
      capturedActionsCallback = cb;
      return () => { capturedActionsCallback = null; };
    }),
    onInterimResult: vi.fn().mockReturnValue(() => {}),
  },
};

Object.defineProperty(window, "electronAPI", {
  value: mockElectronAPI,
  writable: true,
});

function resetStore() {
  useTranscriptStore.setState({
    segments: new Map(),
    topics: new Map(),
    actionItems: new Map(),
    translations: new Map(),
  });
}

describe("useTranscriptionStream — SPEC-005 session isolation", () => {
  beforeEach(() => {
    resetStore();
    capturedSegmentsCallback = null;
    capturedTopicsCallback = null;
    capturedActionsCallback = null;
    vi.clearAllMocks();
    mockElectronAPI.transcription.onNewSegments.mockImplementation(
      (cb: (data: unknown) => void) => {
        capturedSegmentsCallback = cb;
        return () => { capturedSegmentsCallback = null; };
      },
    );
    mockElectronAPI.transcription.onTopicsUpdated.mockImplementation(
      (cb: (data: unknown) => void) => {
        capturedTopicsCallback = cb;
        return () => { capturedTopicsCallback = null; };
      },
    );
    mockElectronAPI.transcription.onActionItemsUpdated.mockImplementation(
      (cb: (data: unknown) => void) => {
        capturedActionsCallback = cb;
        return () => { capturedActionsCallback = null; };
      },
    );
    mockElectronAPI.transcription.onInterimResult.mockReturnValue(() => {});
    mockElectronAPI.session.getTranscript.mockResolvedValue([]);
    mockElectronAPI.session.getTopics.mockResolvedValue([]);
    mockElectronAPI.session.getActionItems.mockResolvedValue([]);
    mockElectronAPI.session.getSummary.mockResolvedValue("");
  });

  it("discards live segments whose sessionId does not match the active session", () => {
    renderHook(() => useTranscriptionStream("session-A"));

    // Fire a newSegments event belonging to session-B (wrong session)
    capturedSegmentsCallback?.({
      sessionId: "session-B",
      chunkIndex: 0,
      segments: [
        { speaker: "Speaker 1", text: "This belongs to B", sentiment: "neutral", startMs: 0 },
      ],
    });

    // session-A store must remain empty — the foreign segment was discarded
    const segments = useTranscriptStore.getState().getSegments("session-A");
    expect(segments).toHaveLength(0);

    // session-B store must also be empty (we're not the owner)
    const segmentsB = useTranscriptStore.getState().getSegments("session-B");
    expect(segmentsB).toHaveLength(0);
  });

  it("accepts live segments whose sessionId matches the active session", () => {
    renderHook(() => useTranscriptionStream("session-A"));

    // Fire a newSegments event belonging to session-A (correct session)
    capturedSegmentsCallback?.({
      sessionId: "session-A",
      chunkIndex: 0,
      segments: [
        { speaker: "Speaker 1", text: "This belongs to A", sentiment: "neutral", startMs: 0 },
      ],
    });

    const segments = useTranscriptStore.getState().getSegments("session-A");
    expect(segments).toHaveLength(1);
    expect(segments[0].text).toBe("This belongs to A");
  });

  it("handleTopics, handleActions, and handleSegments all require matching sessionId", () => {
    renderHook(() => useTranscriptionStream("session-A"));

    // Topics — fire with wrong session
    capturedTopicsCallback?.({ sessionId: "session-B", topics: ["topic1"] });
    const topicsA = useTranscriptStore.getState().topics.get("session-A");
    expect(topicsA).toBeUndefined();

    // Actions — fire with wrong session
    capturedActionsCallback?.({ sessionId: "session-B", actionItems: [{ text: "do thing" }] });
    const actionsA = useTranscriptStore.getState().actionItems.get("session-A");
    expect(actionsA).toBeUndefined();

    // Segments — fire with wrong session (the new guard being tested)
    capturedSegmentsCallback?.({
      sessionId: "session-B",
      chunkIndex: 0,
      segments: [{ speaker: "X", text: "wrong", sentiment: "neutral", startMs: 0 }],
    });
    const segmentsA = useTranscriptStore.getState().getSegments("session-A");
    expect(segmentsA).toHaveLength(0);
  });
});
