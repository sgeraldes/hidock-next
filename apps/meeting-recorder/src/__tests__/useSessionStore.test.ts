import { describe, it, expect, beforeEach } from "vitest";
import { useSessionStore } from "../store/useSessionStore";

// NOTE: persist middleware writes to localStorage; test key defined in store
const STORE_KEY = "session-store";

describe("useSessionStore", () => {
  beforeEach(() => {
    useSessionStore.setState({
      activeSessionId: null,
      viewingSessionId: null,
      sessions: new Map(),
    });
  });

  it("starts with no active or viewing session", () => {
    const state = useSessionStore.getState();
    expect(state.activeSessionId).toBeNull();
    expect(state.viewingSessionId).toBeNull();
    expect(state.sessions.size).toBe(0);
  });

  it("setActiveSession updates activeSessionId", () => {
    useSessionStore.getState().setActiveSession("session-1");
    expect(useSessionStore.getState().activeSessionId).toBe("session-1");
  });

  it("setActiveSession with null clears active session", () => {
    useSessionStore.getState().setActiveSession("session-1");
    useSessionStore.getState().setActiveSession(null);
    expect(useSessionStore.getState().activeSessionId).toBeNull();
  });

  it("switchView updates viewingSessionId", () => {
    useSessionStore.getState().switchView("session-2");
    expect(useSessionStore.getState().viewingSessionId).toBe("session-2");
  });

  it("addSession adds to the sessions map", () => {
    useSessionStore.getState().addSession({
      id: "session-1",
      status: "active",
      started_at: "2026-01-01T00:00:00Z",
    });
    const sessions = useSessionStore.getState().sessions;
    expect(sessions.size).toBe(1);
    expect(sessions.get("session-1")).toEqual(
      expect.objectContaining({ id: "session-1", status: "active" }),
    );
  });

  it("updateSessionStatus changes status of existing session", () => {
    useSessionStore.getState().addSession({
      id: "session-1",
      status: "active",
      started_at: "2026-01-01T00:00:00Z",
    });
    useSessionStore.getState().updateSessionStatus("session-1", "inactive");
    expect(useSessionStore.getState().sessions.get("session-1")?.status).toBe(
      "inactive",
    );
  });

  it("updateSessionStatus does nothing for unknown session", () => {
    useSessionStore.getState().updateSessionStatus("unknown", "inactive");
    expect(useSessionStore.getState().sessions.size).toBe(0);
  });

  it("loadSessions replaces entire sessions map", () => {
    useSessionStore.getState().addSession({
      id: "old",
      status: "complete",
      started_at: "2026-01-01",
    });
    useSessionStore.getState().loadSessions([
      { id: "s1", status: "active", started_at: "2026-02-01" },
      { id: "s2", status: "complete", started_at: "2026-02-02" },
    ]);
    const sessions = useSessionStore.getState().sessions;
    expect(sessions.size).toBe(2);
    expect(sessions.has("old")).toBe(false);
    expect(sessions.has("s1")).toBe(true);
    expect(sessions.has("s2")).toBe(true);
  });

  it("activeSessionId and viewingSessionId are independent", () => {
    useSessionStore.getState().setActiveSession("session-1");
    useSessionStore.getState().switchView("session-2");
    const state = useSessionStore.getState();
    expect(state.activeSessionId).toBe("session-1");
    expect(state.viewingSessionId).toBe("session-2");
  });

  describe("persistence", () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it("persists viewingSessionId to localStorage when switched", () => {
      useSessionStore.getState().switchView("persisted-session");
      const raw = localStorage.getItem(STORE_KEY);
      expect(raw).not.toBeNull();
      const stored = JSON.parse(raw!);
      expect(stored.state.viewingSessionId).toBe("persisted-session");
    });

    it("does not persist sessions Map to localStorage", () => {
      useSessionStore.getState().addSession({
        id: "s1",
        status: "active",
        started_at: "2026-01-01T00:00:00Z",
      });
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const stored = JSON.parse(raw);
        expect(stored.state?.sessions).toBeUndefined();
      }
    });

    it("does not persist activeSessionId to localStorage", () => {
      useSessionStore.getState().setActiveSession("active-123");
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const stored = JSON.parse(raw);
        expect(stored.state?.activeSessionId).toBeUndefined();
      }
    });
  });
});
