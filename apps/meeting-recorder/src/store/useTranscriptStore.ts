import { create } from "zustand";

interface TranscriptSegment {
  id: string;
  speaker: string;
  text: string;
  timestamp: string;
  startMs: number;
  sentiment: "positive" | "negative" | "neutral";
}

interface InterimResult {
  /** The partial transcript text currently being recognized */
  text: string;
  /** Speaker name if known from diarization, otherwise "..." */
  speaker: string;
  /** Timestamp string of when this utterance started */
  timestamp: string;
  /** Monotonic counter to detect stale updates */
  sequence: number;
}

interface TranscriptState {
  segments: Map<string, TranscriptSegment[]>;
  topics: Map<string, string[]>;
  actionItems: Map<string, Array<{ text: string; assignee?: string }>>;
  /** Translations keyed by segmentId → translated text */
  translations: Map<string, string>;
  /** Summary text per session */
  summaries: Map<string, string>;
  /** Summary generation loading state per session */
  summaryLoading: Map<string, boolean>;
  /** Current transcription error message, null when no error */
  transcriptionError: string | null;
  /** Active interim (partial) result per session, null when no speech in progress (NOT persisted) */
  interimResult: Map<string, InterimResult>;
  /** Current audio playback position in milliseconds (transient, NOT persisted) */
  playbackTimeMs: number;

  addSegments: (sessionId: string, newSegments: TranscriptSegment[]) => void;
  setTopics: (sessionId: string, topics: string[]) => void;
  setActionItems: (
    sessionId: string,
    items: Array<{ text: string; assignee?: string }>,
  ) => void;
  setTranslation: (segmentId: string, translatedText: string) => void;
  getSegments: (sessionId: string) => TranscriptSegment[];
  setSummary: (sessionId: string, text: string) => void;
  appendSummaryChunk: (sessionId: string, chunk: string) => void;
  setSummaryLoading: (sessionId: string, loading: boolean) => void;
  setTranscriptionError: (error: string | null) => void;
  setInterimResult: (sessionId: string, result: InterimResult) => void;
  clearInterimResult: (sessionId: string) => void;
  getInterimResult: (sessionId: string) => InterimResult | null;
  setPlaybackTimeMs: (ms: number) => void;
  clearSession: (sessionId: string) => void;
}

export const useTranscriptStore = create<TranscriptState>()((set, get) => ({
  segments: new Map(),
  topics: new Map(),
  actionItems: new Map(),
  translations: new Map(),
  summaries: new Map(),
  summaryLoading: new Map(),
  transcriptionError: null,
  interimResult: new Map(),
  playbackTimeMs: 0,

  addSegments: (sessionId, newSegments) =>
    set((state) => {
      const map = new Map(state.segments);
      const existing = map.get(sessionId) ?? [];
      map.set(sessionId, [...existing, ...newSegments]);
      return { segments: map };
    }),

  // FIX TOP-001: Accumulate topics instead of replacing
  setTopics: (sessionId, topics) =>
    set((state) => {
      const map = new Map(state.topics);
      const existing = map.get(sessionId) ?? [];
      // Deduplicate by case-insensitive comparison
      const combined = [...existing];
      for (const newTopic of topics) {
        if (!existing.some(t => t.toLowerCase() === newTopic.toLowerCase())) {
          combined.push(newTopic);
        }
      }
      map.set(sessionId, combined);
      return { topics: map };
    }),

  // FIX ACT-002: Accumulate action items instead of replacing
  setActionItems: (sessionId, items) =>
    set((state) => {
      const map = new Map(state.actionItems);
      const existing = map.get(sessionId) ?? [];
      // Deduplicate by text comparison
      const combined = [...existing];
      for (const newItem of items) {
        if (!existing.some(e => e.text === newItem.text)) {
          combined.push(newItem);
        }
      }
      map.set(sessionId, combined);
      return { actionItems: map };
    }),

  setTranslation: (segmentId, translatedText) =>
    set((state) => {
      const map = new Map(state.translations);
      map.set(segmentId, translatedText);
      return { translations: map };
    }),

  getSegments: (sessionId) => {
    return get().segments.get(sessionId) ?? [];
  },

  setSummary: (sessionId, text) =>
    set((state) => {
      const summaries = new Map(state.summaries);
      summaries.set(sessionId, text);
      return { summaries };
    }),

  appendSummaryChunk: (sessionId, chunk) =>
    set((state) => {
      const summaries = new Map(state.summaries);
      const existing = summaries.get(sessionId) ?? "";
      summaries.set(sessionId, existing + chunk);
      return { summaries };
    }),

  setSummaryLoading: (sessionId, loading) =>
    set((state) => {
      const summaryLoading = new Map(state.summaryLoading);
      summaryLoading.set(sessionId, loading);
      return { summaryLoading };
    }),

  setTranscriptionError: (error) => set({ transcriptionError: error }),

  setInterimResult: (sessionId, result) =>
    set((state) => {
      const map = new Map(state.interimResult);
      map.set(sessionId, result);
      return { interimResult: map };
    }),

  clearInterimResult: (sessionId) =>
    set((state) => {
      const map = new Map(state.interimResult);
      map.delete(sessionId);
      return { interimResult: map };
    }),

  getInterimResult: (sessionId) => {
    return get().interimResult.get(sessionId) ?? null;
  },

  setPlaybackTimeMs: (ms) => set({ playbackTimeMs: ms }),

  clearSession: (sessionId) =>
    set((state) => {
      const segments = new Map(state.segments);
      const topics = new Map(state.topics);
      const actionItems = new Map(state.actionItems);
      const summaries = new Map(state.summaries);
      const summaryLoading = new Map(state.summaryLoading);
      const interimResult = new Map(state.interimResult);
      segments.delete(sessionId);
      topics.delete(sessionId);
      actionItems.delete(sessionId);
      summaries.delete(sessionId);
      summaryLoading.delete(sessionId);
      interimResult.delete(sessionId);
      return { segments, topics, actionItems, summaries, summaryLoading, interimResult };
    }),
}));
