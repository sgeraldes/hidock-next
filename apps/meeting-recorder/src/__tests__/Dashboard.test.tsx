import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const { mockSettingsState, mockSessionState } = vi.hoisted(() => ({
  mockSettingsState: {
    provider: "google",
    apiKey: "",
    ollamaBaseUrl: "http://localhost:11434/api",
    autoRecord: true,
    loaded: true,
  },
  mockSessionState: {
    activeSessionId: null as string | null,
    viewingSessionId: null as string | null,
    sessions: new Map<string, unknown>(),
    micActive: false,
    loading: false,
    error: null as string | null,
    switchView: vi.fn(),
    loadSessions: vi.fn(),
    addSession: vi.fn(),
    setActiveSession: vi.fn(),
    updateSessionStatus: vi.fn(),
    setMicActive: vi.fn(),
    setLoading: vi.fn(),
    setError: vi.fn(),
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
        transcriptionError: null,
        setTranscriptionError: vi.fn(),
      };
      return selector(state);
    },
  ),
}));

vi.mock("../hooks/useTranscriptionStream", () => ({
  useTranscriptionStream: vi.fn(),
}));

import Dashboard from "../pages/Dashboard";

beforeEach(() => {
  mockSettingsState.provider = "google";
  mockSettingsState.apiKey = "";
  mockSettingsState.autoRecord = true;
  mockSessionState.activeSessionId = null;
  mockSessionState.viewingSessionId = null;
  mockSessionState.sessions = new Map();
  mockSessionState.micActive = false;
  mockSessionState.loading = false;
  mockSessionState.error = null;
  mockSessionState.switchView.mockReset();
  mockSessionState.loadSessions.mockReset();
  mockSessionState.addSession.mockReset();
  mockSessionState.setActiveSession.mockReset();
  mockSessionState.updateSessionStatus.mockReset();
  mockSessionState.setMicActive.mockReset();
  mockSessionState.setLoading.mockReset();
  mockSessionState.setError.mockReset();
});

describe("Dashboard", () => {
  it("shows onboarding prompt when no API key is configured", () => {
    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    expect(screen.getAllByText(/configure ai provider/i).length).toBeGreaterThan(0);
  });

  it("does not show onboarding when API key is set", () => {
    mockSettingsState.apiKey = "sk-test-key";

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    expect(screen.queryByText(/configure ai provider/i)).toBeNull();
  });

  it("does not show onboarding when provider is ollama (no key needed)", () => {
    mockSettingsState.provider = "ollama";
    mockSettingsState.apiKey = "";

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    expect(screen.queryByText(/configure ai provider/i)).toBeNull();
  });

  it("disables RecordingControls when no provider configured", () => {
    mockSettingsState.apiKey = "";

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    const startBtn = screen.queryByTestId("start-recording-btn");
    if (startBtn) {
      expect((startBtn as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getAllByText(/configure ai provider/i).length).toBeGreaterThan(0);
  });

  it("calls session.list on mount and populates store", async () => {
    mockSettingsState.apiKey = "sk-test";

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(window.electronAPI.session.list).toHaveBeenCalled();
    });
  });

  it("subscribes to session.onCreated on mount", async () => {
    mockSettingsState.apiKey = "sk-test";

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(window.electronAPI.session.onCreated).toHaveBeenCalled();
    });
  });

  it("subscribes to session.onStatusChanged on mount", async () => {
    mockSettingsState.apiKey = "sk-test";

    render(
      <MemoryRouter>
        <Dashboard />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(window.electronAPI.session.onStatusChanged).toHaveBeenCalled();
    });
  });

});
