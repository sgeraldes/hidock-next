import { create } from "zustand";

interface SpeakerInfo {
  id: string;
  name: string;
  displayName: string | null;
  segmentCount: number;
}

interface SpeakerState {
  speakers: Map<string, SpeakerInfo[]>;

  setSpeakers: (sessionId: string, speakers: SpeakerInfo[]) => void;
  renameSpeaker: (
    sessionId: string,
    speakerId: string,
    newName: string,
  ) => void;
  getSpeakersForSession: (sessionId: string) => SpeakerInfo[];
}

export const useSpeakerStore = create<SpeakerState>()((set, get) => ({
  speakers: new Map(),

  setSpeakers: (sessionId, speakers) =>
    set((state) => {
      const map = new Map(state.speakers);
      map.set(sessionId, speakers);
      return { speakers: map };
    }),

  renameSpeaker: (sessionId, speakerId, newName) =>
    set((state) => {
      const sessionSpeakers = state.speakers.get(sessionId);
      if (!sessionSpeakers) return state;
      const updated = sessionSpeakers.map((s) =>
        s.id === speakerId ? { ...s, displayName: newName } : s,
      );
      const map = new Map(state.speakers);
      map.set(sessionId, updated);
      return { speakers: map };
    }),

  getSpeakersForSession: (sessionId) => {
    return get().speakers.get(sessionId) ?? [];
  },
}));
