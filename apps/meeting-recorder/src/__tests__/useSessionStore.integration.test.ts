/**
 * Integration tests for session store + IPC wiring.
 * Tests the patterns used by Dashboard's session lifecycle hooks.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useSessionStore } from "../store/useSessionStore";

type SessionMeta = {
  id: string;
  status: string;
  started_at: string;
  ended_at?: string | null;
  title?: string | null;
};

beforeEach(() => {
  useSessionStore.setState({
    activeSessionId: null,
    viewingSessionId: null,
    sessions: new Map(),
  });
});

describe("session loading", () => {
  it("loadSessions + autoSelect picks the active session", () => {
    const sessions: SessionMeta[] = [
      { id: "old-1", status: "complete", started_at: "2026-01-01T00:00:00Z" },
      { id: "active-1", status: "active", started_at: "2026-02-01T00:00:00Z" },
    ];
    useSessionStore.getState().loadSessions(sessions);

    const state = useSessionStore.getState();
    const activeSessions = Array.from(state.sessions.values()).filter(
      (s) => s.status === "active",
    );
    if (activeSessions.length > 0) {
      useSessionStore.getState().switchView(activeSessions[0].id);
    }

    expect(useSessionStore.getState().viewingSessionId).toBe("active-1");
  });

  it("loadSessions + autoSelect picks most recent when no active", () => {
    const sessions: SessionMeta[] = [
      { id: "s1", status: "complete", started_at: "2026-01-01T00:00:00Z" },
      { id: "s2", status: "complete", started_at: "2026-02-01T00:00:00Z" },
    ];
    useSessionStore.getState().loadSessions(sessions);

    const state = useSessionStore.getState();
    const sorted = Array.from(state.sessions.values()).sort(
      (a, b) => b.started_at.localeCompare(a.started_at),
    );
    if (sorted.length > 0) {
      useSessionStore.getState().switchView(sorted[0].id);
    }

    expect(useSessionStore.getState().viewingSessionId).toBe("s2");
  });
});

describe("IPC event simulation", () => {
  it("onCreated handler adds session AND sets it as active+viewing", () => {
    const newSession: SessionMeta = {
      id: "new-session",
      status: "active",
      started_at: "2026-02-25T10:00:00Z",
    };

    useSessionStore.getState().addSession(newSession);
    useSessionStore.getState().setActiveSession(newSession.id);
    useSessionStore.getState().switchView(newSession.id);

    const state = useSessionStore.getState();
    expect(state.sessions.has("new-session")).toBe(true);
    expect(state.activeSessionId).toBe("new-session");
    expect(state.viewingSessionId).toBe("new-session");
  });

  it("onStatusChanged updates session status without clearing others", () => {
    useSessionStore.getState().addSession({
      id: "s1",
      status: "active",
      started_at: "2026-02-25T10:00:00Z",
    });
    useSessionStore.getState().addSession({
      id: "s2",
      status: "active",
      started_at: "2026-02-25T10:01:00Z",
    });

    useSessionStore.getState().updateSessionStatus("s1", "complete");

    const state = useSessionStore.getState();
    expect(state.sessions.get("s1")?.status).toBe("complete");
    expect(state.sessions.get("s2")?.status).toBe("active");
    expect(state.sessions.size).toBe(2);
  });

  it("session:end clears activeSessionId", () => {
    useSessionStore.getState().setActiveSession("s1");
    expect(useSessionStore.getState().activeSessionId).toBe("s1");

    useSessionStore.getState().setActiveSession(null);

    expect(useSessionStore.getState().activeSessionId).toBeNull();
  });
});

describe("IPC mock-driven scenario", () => {
  it("full lifecycle: list → create → status change → end", () => {
    const mockList = vi.fn().mockResolvedValue([
      { id: "existing", status: "complete", started_at: "2026-02-24T09:00:00Z" },
    ]);
    const mockCreate = vi.fn().mockResolvedValue({
      id: "new-1",
      status: "active",
      started_at: "2026-02-25T10:00:00Z",
    });

    return mockList().then((sessions: SessionMeta[]) => {
      useSessionStore.getState().loadSessions(sessions);
      expect(useSessionStore.getState().sessions.size).toBe(1);

      return mockCreate();
    }).then((newSession: SessionMeta) => {
      useSessionStore.getState().addSession(newSession);
      useSessionStore.getState().setActiveSession(newSession.id);
      useSessionStore.getState().switchView(newSession.id);

      expect(useSessionStore.getState().activeSessionId).toBe("new-1");
      expect(useSessionStore.getState().viewingSessionId).toBe("new-1");
      expect(useSessionStore.getState().sessions.size).toBe(2);

      useSessionStore.getState().updateSessionStatus("new-1", "transcribing");
      expect(useSessionStore.getState().sessions.get("new-1")?.status).toBe("transcribing");

      useSessionStore.getState().setActiveSession(null);
      useSessionStore.getState().updateSessionStatus("new-1", "complete");

      expect(useSessionStore.getState().activeSessionId).toBeNull();
      expect(useSessionStore.getState().sessions.get("new-1")?.status).toBe("complete");
    });
  });
});
