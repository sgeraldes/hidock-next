import { describe, it, expect, beforeEach } from "vitest";
import { useTranscriptStore } from "../useTranscriptStore";

describe("useTranscriptStore - Interim Results", () => {
  beforeEach(() => {
    // Reset store state between tests
    const { clearSession } = useTranscriptStore.getState();
    clearSession("session-1");
    clearSession("session-2");
  });

  it("stores interim result keyed by sessionId", () => {
    const { setInterimResult, getInterimResult } = useTranscriptStore.getState();

    setInterimResult("session-1", {
      text: "hello",
      speaker: "...",
      timestamp: "0:05",
      sequence: 1,
    });

    expect(getInterimResult("session-1")).toEqual({
      text: "hello",
      speaker: "...",
      timestamp: "0:05",
      sequence: 1,
    });
    expect(getInterimResult("session-2")).toBeNull();
  });

  it("clears interim result for a session", () => {
    const { setInterimResult, clearInterimResult, getInterimResult } =
      useTranscriptStore.getState();

    setInterimResult("session-1", {
      text: "hello",
      speaker: "...",
      timestamp: "0:05",
      sequence: 1,
    });
    clearInterimResult("session-1");

    expect(getInterimResult("session-1")).toBeNull();
  });

  it("clearSession removes interim result", () => {
    const { setInterimResult, clearSession, getInterimResult } =
      useTranscriptStore.getState();

    setInterimResult("session-1", {
      text: "hello",
      speaker: "...",
      timestamp: "0:05",
      sequence: 1,
    });
    clearSession("session-1");

    expect(getInterimResult("session-1")).toBeNull();
  });

  it("replaces interim result when called multiple times", () => {
    const { setInterimResult, getInterimResult } = useTranscriptStore.getState();

    setInterimResult("session-1", {
      text: "first",
      speaker: "...",
      timestamp: "0:05",
      sequence: 1,
    });

    setInterimResult("session-1", {
      text: "second update",
      speaker: "Alice",
      timestamp: "0:06",
      sequence: 2,
    });

    const result = getInterimResult("session-1");
    expect(result?.text).toBe("second update");
    expect(result?.speaker).toBe("Alice");
    expect(result?.sequence).toBe(2);
  });

  it("stores interim results for multiple sessions independently", () => {
    const { setInterimResult, getInterimResult } = useTranscriptStore.getState();

    setInterimResult("session-1", {
      text: "session one text",
      speaker: "Alice",
      timestamp: "0:05",
      sequence: 1,
    });

    setInterimResult("session-2", {
      text: "session two text",
      speaker: "Bob",
      timestamp: "0:10",
      sequence: 1,
    });

    expect(getInterimResult("session-1")?.text).toBe("session one text");
    expect(getInterimResult("session-2")?.text).toBe("session two text");
  });
});
