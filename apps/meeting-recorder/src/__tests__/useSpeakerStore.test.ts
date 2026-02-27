import { describe, it, expect, beforeEach } from "vitest";
import { useSpeakerStore } from "../store/useSpeakerStore";

const makeSpeaker = (id: string, name: string) => ({
  id,
  name,
  displayName: null,
  segmentCount: 1,
});

describe("useSpeakerStore", () => {
  beforeEach(() => {
    useSpeakerStore.setState({ speakers: new Map() });
  });

  it("starts empty", () => {
    expect(useSpeakerStore.getState().speakers.size).toBe(0);
  });

  describe("setSpeakers", () => {
    it("stores speakers keyed by sessionId", () => {
      const speakers = [makeSpeaker("sp1", "Alice"), makeSpeaker("sp2", "Bob")];
      useSpeakerStore.getState().setSpeakers("session-1", speakers);
      const state = useSpeakerStore.getState();
      expect(state.speakers.has("session-1")).toBe(true);
    });

    it("stores different speakers for different sessions", () => {
      useSpeakerStore.getState().setSpeakers("session-1", [makeSpeaker("sp1", "Alice")]);
      useSpeakerStore.getState().setSpeakers("session-2", [makeSpeaker("sp2", "Bob")]);
      const state = useSpeakerStore.getState();
      expect(state.speakers.has("session-1")).toBe(true);
      expect(state.speakers.has("session-2")).toBe(true);
    });
  });

  describe("getSpeakersForSession", () => {
    it("returns only speakers for the given session", () => {
      useSpeakerStore.getState().setSpeakers("session-1", [makeSpeaker("sp1", "Alice")]);
      useSpeakerStore.getState().setSpeakers("session-2", [makeSpeaker("sp2", "Bob")]);

      const session1Speakers = useSpeakerStore
        .getState()
        .getSpeakersForSession("session-1");
      expect(session1Speakers).toHaveLength(1);
      expect(session1Speakers[0].name).toBe("Alice");
    });

    it("returns empty array for unknown session", () => {
      const speakers = useSpeakerStore.getState().getSpeakersForSession("unknown");
      expect(speakers).toEqual([]);
    });

    it("does NOT return speakers from other sessions", () => {
      useSpeakerStore.getState().setSpeakers("session-1", [makeSpeaker("sp1", "Alice")]);
      useSpeakerStore.getState().setSpeakers("session-2", [makeSpeaker("sp2", "Bob")]);

      const session1Speakers = useSpeakerStore
        .getState()
        .getSpeakersForSession("session-1");
      const names = session1Speakers.map((s) => s.name);
      expect(names).not.toContain("Bob");
    });
  });

  describe("renameSpeaker", () => {
    it("renames a speaker within a session", () => {
      useSpeakerStore
        .getState()
        .setSpeakers("session-1", [makeSpeaker("sp1", "Speaker 1")]);

      useSpeakerStore.getState().renameSpeaker("session-1", "sp1", "Alice");

      const speakers = useSpeakerStore
        .getState()
        .getSpeakersForSession("session-1");
      expect(speakers[0].displayName).toBe("Alice");
    });

    it("does not affect speakers in other sessions", () => {
      useSpeakerStore.getState().setSpeakers("session-1", [makeSpeaker("sp1", "Speaker 1")]);
      useSpeakerStore.getState().setSpeakers("session-2", [makeSpeaker("sp1", "Speaker 1")]);

      useSpeakerStore.getState().renameSpeaker("session-1", "sp1", "Alice");

      const s2Speakers = useSpeakerStore
        .getState()
        .getSpeakersForSession("session-2");
      expect(s2Speakers[0].displayName).toBeNull();
    });
  });
});
