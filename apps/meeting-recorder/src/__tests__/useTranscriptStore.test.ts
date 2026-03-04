import { describe, it, expect, beforeEach } from "vitest";
import { useTranscriptStore } from "../store/useTranscriptStore";

const makeSegment = (id: string, text: string) => ({
  id,
  speaker: "Speaker 1",
  text,
  timestamp: "0:00",
  startMs: 0,
  sentiment: "neutral" as const,
});

describe("useTranscriptStore", () => {
  beforeEach(() => {
    useTranscriptStore.setState({
      segments: new Map(),
      topics: new Map(),
      actionItems: new Map(),
      translations: new Map(),
    });
  });

  it("starts empty", () => {
    const state = useTranscriptStore.getState();
    expect(state.segments.size).toBe(0);
    expect(state.topics.size).toBe(0);
    expect(state.actionItems.size).toBe(0);
    expect(state.translations.size).toBe(0);
  });

  describe("addSegments", () => {
    it("adds segments for a session", () => {
      const segs = [makeSegment("seg1", "Hello world")];
      useTranscriptStore.getState().addSegments("session-1", segs);

      const result = useTranscriptStore.getState().getSegments("session-1");
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe("Hello world");
    });

    it("appends additional segments to existing session", () => {
      useTranscriptStore
        .getState()
        .addSegments("session-1", [makeSegment("seg1", "First")]);
      useTranscriptStore
        .getState()
        .addSegments("session-1", [makeSegment("seg2", "Second")]);

      const result = useTranscriptStore.getState().getSegments("session-1");
      expect(result).toHaveLength(2);
      expect(result[1].text).toBe("Second");
    });

    it("keeps segments for different sessions separate", () => {
      useTranscriptStore
        .getState()
        .addSegments("session-1", [makeSegment("seg1", "Session 1")]);
      useTranscriptStore
        .getState()
        .addSegments("session-2", [makeSegment("seg2", "Session 2")]);

      expect(
        useTranscriptStore.getState().getSegments("session-1"),
      ).toHaveLength(1);
      expect(
        useTranscriptStore.getState().getSegments("session-2"),
      ).toHaveLength(1);
    });
  });

  describe("getSegments", () => {
    it("returns empty array for unknown session", () => {
      expect(
        useTranscriptStore.getState().getSegments("unknown"),
      ).toEqual([]);
    });

    it("returns correct segments for the requested session only", () => {
      useTranscriptStore
        .getState()
        .addSegments("session-1", [makeSegment("s1", "A")]);
      useTranscriptStore
        .getState()
        .addSegments("session-2", [makeSegment("s2", "B")]);

      const s1 = useTranscriptStore.getState().getSegments("session-1");
      expect(s1.every((s) => s.text === "A")).toBe(true);
    });
  });

  describe("clearSession", () => {
    it("removes segments for the cleared session", () => {
      useTranscriptStore
        .getState()
        .addSegments("session-1", [makeSegment("seg1", "Hello")]);
      useTranscriptStore.getState().clearSession("session-1");

      expect(
        useTranscriptStore.getState().getSegments("session-1"),
      ).toEqual([]);
    });

    it("removes topics and actionItems for the cleared session", () => {
      useTranscriptStore
        .getState()
        .setTopics("session-1", ["topic1", "topic2"]);
      useTranscriptStore
        .getState()
        .setActionItems("session-1", [{ text: "Do something" }]);
      useTranscriptStore.getState().clearSession("session-1");

      const state = useTranscriptStore.getState();
      expect(state.topics.has("session-1")).toBe(false);
      expect(state.actionItems.has("session-1")).toBe(false);
    });

    it("does not affect other sessions", () => {
      useTranscriptStore
        .getState()
        .addSegments("session-1", [makeSegment("seg1", "S1")]);
      useTranscriptStore
        .getState()
        .addSegments("session-2", [makeSegment("seg2", "S2")]);
      useTranscriptStore.getState().clearSession("session-1");

      expect(
        useTranscriptStore.getState().getSegments("session-2"),
      ).toHaveLength(1);
    });
  });

  describe("setTopics", () => {
    it("stores topics for a session", () => {
      useTranscriptStore
        .getState()
        .setTopics("session-1", ["budget", "roadmap"]);

      const state = useTranscriptStore.getState();
      expect(state.topics.get("session-1")).toEqual(["budget", "roadmap"]);
    });

    it("accumulates topics on re-set (deduplicating)", () => {
      useTranscriptStore.getState().setTopics("session-1", ["old"]);
      useTranscriptStore
        .getState()
        .setTopics("session-1", ["new1", "new2"]);

      // FIX TOP-001: setTopics now accumulates instead of replacing
      expect(useTranscriptStore.getState().topics.get("session-1")).toEqual([
        "old",
        "new1",
        "new2",
      ]);
    });
  });

  describe("setActionItems", () => {
    it("stores action items for a session", () => {
      useTranscriptStore.getState().setActionItems("session-1", [
        { text: "Fix bug", assignee: "Alice" },
      ]);

      const state = useTranscriptStore.getState();
      expect(state.actionItems.get("session-1")).toHaveLength(1);
      expect(state.actionItems.get("session-1")![0].assignee).toBe("Alice");
    });
  });

  describe("setSegments (replace — for historical loads)", () => {
    it("replaces all existing segments for a session", () => {
      useTranscriptStore
        .getState()
        .addSegments("session-1", [makeSegment("seg1", "Original text")]);

      useTranscriptStore.getState().setSegments("session-1", [
        { ...makeSegment("seg2", "Original text"), speaker: "Sebastian" },
      ]);

      const result = useTranscriptStore.getState().getSegments("session-1");
      expect(result).toHaveLength(1);
      expect(result[0].speaker).toBe("Sebastian");
    });

    it("does not duplicate segments when speaker was renamed between visits", () => {
      // Simulate: session loaded the first time → "Speaker 1" segments in store
      useTranscriptStore.getState().addSegments("session-1", [
        { ...makeSegment("seg1", "Hello"), speaker: "Speaker 1" },
        { ...makeSegment("seg2", "World"), speaker: "Speaker 1" },
      ]);

      // User renames "Speaker 1" → "Sebastian" in DB. On session revisit,
      // loadHistoricalData calls setSegments with the updated DB rows.
      useTranscriptStore.getState().setSegments("session-1", [
        { ...makeSegment("seg3", "Hello"), speaker: "Sebastian" },
        { ...makeSegment("seg4", "World"), speaker: "Sebastian" },
      ]);

      const result = useTranscriptStore.getState().getSegments("session-1");
      // Must have exactly 2 segments — not 4 (old + renamed duplicates)
      expect(result).toHaveLength(2);
      expect(result.every((s) => s.speaker === "Sebastian")).toBe(true);
    });

    it("does not affect other sessions", () => {
      useTranscriptStore
        .getState()
        .addSegments("session-2", [makeSegment("seg-b", "Session B text")]);

      useTranscriptStore.getState().setSegments("session-1", [
        makeSegment("seg-a", "Session A text"),
      ]);

      expect(
        useTranscriptStore.getState().getSegments("session-2"),
      ).toHaveLength(1);
      expect(
        useTranscriptStore.getState().getSegments("session-2")[0].text,
      ).toBe("Session B text");
    });

    it("can set an empty array to clear all segments for a session", () => {
      useTranscriptStore
        .getState()
        .addSegments("session-1", [makeSegment("seg1", "Some text")]);

      useTranscriptStore.getState().setSegments("session-1", []);

      expect(
        useTranscriptStore.getState().getSegments("session-1"),
      ).toHaveLength(0);
    });
  });

  // SPEC-006: clearSession must clean up associated translations
  describe("clearSession and translations (SPEC-006)", () => {
    it("clearSession removes translations for segments in that session", () => {
      // Add segments and translations for session-1
      useTranscriptStore.getState().addSegments("session-1", [
        makeSegment("seg-a1", "Hello"),
        makeSegment("seg-a2", "World"),
      ]);
      useTranscriptStore.getState().setTranslation("seg-a1", "Hola");
      useTranscriptStore.getState().setTranslation("seg-a2", "Mundo");

      useTranscriptStore.getState().clearSession("session-1");

      const { translations } = useTranscriptStore.getState();
      expect(translations.has("seg-a1")).toBe(false);
      expect(translations.has("seg-a2")).toBe(false);
    });

    it("clearSession does not remove translations for other sessions", () => {
      // session-1 with translations
      useTranscriptStore.getState().addSegments("session-1", [
        makeSegment("seg-a1", "Hello"),
      ]);
      useTranscriptStore.getState().setTranslation("seg-a1", "Hola");

      // session-2 with translations
      useTranscriptStore.getState().addSegments("session-2", [
        makeSegment("seg-b1", "Goodbye"),
      ]);
      useTranscriptStore.getState().setTranslation("seg-b1", "Adios");

      useTranscriptStore.getState().clearSession("session-1");

      const { translations } = useTranscriptStore.getState();
      expect(translations.has("seg-a1")).toBe(false);
      expect(translations.get("seg-b1")).toBe("Adios");
    });
  });

  describe("setTranslation", () => {
    it("stores a translation keyed by segmentId", () => {
      useTranscriptStore
        .getState()
        .setTranslation("seg-abc", "Hola mundo");

      const state = useTranscriptStore.getState();
      expect(state.translations.get("seg-abc")).toBe("Hola mundo");
    });

    it("overwrites previous translation for same segmentId", () => {
      useTranscriptStore
        .getState()
        .setTranslation("seg-abc", "First translation");
      useTranscriptStore
        .getState()
        .setTranslation("seg-abc", "Updated translation");

      expect(
        useTranscriptStore.getState().translations.get("seg-abc"),
      ).toBe("Updated translation");
    });
  });
});
