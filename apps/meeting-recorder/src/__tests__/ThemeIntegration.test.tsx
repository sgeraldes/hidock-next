import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../store/useSettingsStore", () => ({
  useSettingsStore: vi.fn(),
}));

import { useSettingsStore } from "../store/useSettingsStore";
import App from "../App";

const mockUseSettingsStore = useSettingsStore as unknown as ReturnType<typeof vi.fn>;

function mockStore(theme: "light" | "dark" | "system") {
  mockUseSettingsStore.mockImplementation((selector: (s: { theme: string }) => unknown) =>
    selector({ theme, provider: "", apiKey: "", loaded: true } as never),
  );
}

beforeEach(() => {
  document.documentElement.className = "";
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
    audio: { sendChunk: vi.fn(), onMicStatus: vi.fn().mockReturnValue(() => {}) },
    transcription: {
      onNewSegments: vi.fn().mockReturnValue(() => {}),
      onTopicsUpdated: vi.fn().mockReturnValue(() => {}),
      onActionItemsUpdated: vi.fn().mockReturnValue(() => {}),
      onError: vi.fn().mockReturnValue(() => {}),
      onStatus: vi.fn().mockReturnValue(() => {}),
    },
    ai: {
      configure: vi.fn().mockResolvedValue(null),
      getActiveProvider: vi.fn().mockResolvedValue(null),
      isAudioCapable: vi.fn().mockResolvedValue(false),
      transcribe: vi.fn(),
      transcribeAudio: vi.fn(),
      summarize: vi.fn(),
      validateApiKey: vi.fn().mockResolvedValue({ valid: true }),
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
    translation: { translateBatch: vi.fn().mockResolvedValue([]) },
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
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      getAll: vi.fn().mockResolvedValue({}),
      testConnection: vi.fn().mockResolvedValue({ valid: true }),
    },
    history: {
      search: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as typeof window.electronAPI;
});

afterEach(() => {
  document.documentElement.className = "";
  vi.clearAllMocks();
});

describe("ThemeIntegration", () => {
  it("applies dark class when theme is dark", () => {
    mockStore("dark");
    render(<MemoryRouter><App /></MemoryRouter>);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("removes dark class when theme is light", () => {
    document.documentElement.classList.add("dark");
    mockStore("light");
    render(<MemoryRouter><App /></MemoryRouter>);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("applies dark class for system theme when matchMedia prefers-dark", () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    mockStore("system");
    render(<MemoryRouter><App /></MemoryRouter>);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
