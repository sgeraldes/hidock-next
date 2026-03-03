import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../App";

beforeEach(() => {
  window.electronAPI = {
    app: { info: vi.fn() },
    session: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "s1" }),
      end: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
      onCreated: vi.fn().mockReturnValue(() => {}),
      onStatusChanged: vi.fn().mockReturnValue(() => {}),
    },
    audio: {
      sendChunk: vi.fn(),
      onMicStatus: vi.fn().mockReturnValue(() => {}),
    },
    transcription: {
      onNewSegments: vi.fn().mockReturnValue(() => {}),
      onTopicsUpdated: vi.fn().mockReturnValue(() => {}),
      onActionItemsUpdated: vi.fn().mockReturnValue(() => {}),
      onError: vi.fn().mockReturnValue(() => {}),
      onStatus: vi.fn().mockReturnValue(() => {}),
    },
    ai: {
      configure: vi.fn(),
      getActiveProvider: vi.fn(),
      isAudioCapable: vi.fn(),
      transcribe: vi.fn(),
      transcribeAudio: vi.fn(),
      summarize: vi.fn(),
      validateApiKey: vi.fn(),
    },
    attachment: {
      addFile: vi.fn().mockResolvedValue({}),
      addNote: vi.fn().mockResolvedValue({}),
      list: vi.fn().mockResolvedValue([]),
    },
    speaker: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      getForSession: vi.fn().mockResolvedValue([]),
      linkToSession: vi.fn().mockResolvedValue(undefined),
    },
    translation: {
      translateBatch: vi.fn().mockResolvedValue([]),
    },
    summarization: {
      generate: vi.fn().mockResolvedValue({ summary: "", keyPoints: [] }),
      onChunk: vi.fn().mockReturnValue(() => {}),
    },
    meetingType: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      setForSession: vi.fn().mockResolvedValue(undefined),
      processSession: vi.fn().mockResolvedValue(undefined),
    },
    settings: {
      get: vi.fn(),
      set: vi.fn(),
      getAll: vi.fn(),
      testConnection: vi.fn(),
    },
    history: {
      search: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    window: {
      minimize: vi.fn().mockResolvedValue(undefined),
      maximize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      isMaximized: vi.fn().mockResolvedValue(false),
      closeControlBar: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as typeof window.electronAPI;
});

describe("App", () => {
  it("renders without crashing", () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(document.body).toBeTruthy();
  });

  it("renders a root element", () => {
    const { container } = render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(container.firstChild).toBeTruthy();
  });

  it("renders the dashboard with sessions sidebar", () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(document.body.textContent).toContain("Sessions");
  });
});
