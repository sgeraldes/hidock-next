import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface SessionMeta {
  id: string;
  status: string;
  started_at: string;
  ended_at?: string | null;
  title?: string | null;
}

interface SessionState {
  activeSessionId: string | null;
  viewingSessionId: string | null;
  sessions: Map<string, SessionMeta>;
  micActive: boolean;
  loading: boolean;
  error: string | null;
  /** Transient ref: stop recorder and wait for all chunks to be ACK'd */
  stopAndFlushRef: (() => Promise<void>) | null;

  setActiveSession: (id: string | null) => void;
  switchView: (sessionId: string) => void;
  addSession: (session: SessionMeta) => void;
  updateSessionStatus: (sessionId: string, status: string) => void;
  loadSessions: (sessions: SessionMeta[]) => void;
  setMicActive: (active: boolean) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setStopAndFlushRef: (ref: (() => Promise<void>) | null) => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      activeSessionId: null,
      viewingSessionId: null,
      sessions: new Map(),
      micActive: false,
      loading: false,
      error: null,
      stopAndFlushRef: null,

      setActiveSession: (id) => set({ activeSessionId: id }),

      switchView: (sessionId) => set({ viewingSessionId: sessionId }),

      addSession: (session) =>
        set((state) => {
          const next = new Map(state.sessions);
          next.set(session.id, session);
          return { sessions: next };
        }),

      updateSessionStatus: (sessionId, status) =>
        set((state) => {
          const existing = state.sessions.get(sessionId);
          if (!existing) return state;
          const next = new Map(state.sessions);
          next.set(sessionId, { ...existing, status });
          return { sessions: next };
        }),

      loadSessions: (sessions) =>
        set(() => {
          const map = new Map<string, SessionMeta>();
          for (const s of sessions) {
            map.set(s.id, s);
          }
          return { sessions: map };
        }),

      setMicActive: (active) => set({ micActive: active }),
      setLoading: (loading) => set({ loading }),
      setError: (error) => set({ error }),
      setStopAndFlushRef: (ref) => set({ stopAndFlushRef: ref }),
    }),
    {
      name: "session-store",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ viewingSessionId: state.viewingSessionId }),
    },
  ),
);
