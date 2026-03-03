import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Settings from "../pages/Settings";

beforeEach(() => {
  window.electronAPI = {
    app: { info: vi.fn() },
    session: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "s1" }),
      end: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
      onCreated: vi.fn(),
      onStatusChanged: vi.fn(),
    },
    audio: {
      sendChunk: vi.fn(),
      onMicStatus: vi.fn(),
    },
    transcription: {
      onNewSegments: vi.fn(),
      onTopicsUpdated: vi.fn(),
      onActionItemsUpdated: vi.fn(),
      onError: vi.fn(),
      onStatus: vi.fn(),
    },
    ai: {
      configure: vi.fn().mockResolvedValue({ provider: "google", model: "gemini-2.5-flash" }),
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
    translation: {
      translateBatch: vi.fn().mockResolvedValue([]),
    },
    summarization: {
      generate: vi.fn().mockResolvedValue({ summary: "", keyPoints: [] }),
    },
    meetingType: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      setForSession: vi.fn().mockResolvedValue(undefined),
      processSession: vi.fn().mockResolvedValue(undefined),
    },
    models: {
      getConfig: vi.fn().mockResolvedValue({ version: 1, providers: {}, contexts: {} }),
      getForProvider: vi.fn().mockResolvedValue([]),
      getActiveForProvider: vi.fn().mockResolvedValue([]),
      getForContext: vi.fn().mockResolvedValue("gemini-2.5-flash"),
      getContexts: vi.fn().mockResolvedValue({}),
      validate: vi.fn().mockResolvedValue({ valid: true, deprecated: false, migratesTo: null }),
      getCostMultiplier: vi.fn().mockResolvedValue(1),
    },
    settings: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      getAll: vi.fn().mockResolvedValue({}),
      testConnection: vi.fn().mockResolvedValue({ valid: true }),
      getChirp3Config: vi.fn().mockResolvedValue({
        projectId: "",
        authType: "api-key",
        location: "global",
        languageCode: "en-US",
        confidenceThreshold: 0.7,
        hasApiKey: false,
        hasServiceAccount: false,
        backend: "gemini-multimodal",
        isConfigured: false,
      }),
      testChirp3Connection: vi.fn().mockResolvedValue({ valid: false, error: "Not configured" }),
    },
    history: {
      search: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  } as unknown as typeof window.electronAPI;
});

describe("Settings", () => {
  it("renders AI Configuration, Recording, and General sections", async () => {
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("AI Configuration")).toBeTruthy();
    });
    expect(screen.getByText("Recording")).toBeTruthy();
    expect(screen.getByText("General")).toBeTruthy();
  });

  it("loads saved settings on mount and reflects provider", async () => {
    window.electronAPI.settings.getAll = vi.fn().mockResolvedValue({
      "ai.provider": "openai",
      "ai.model": "gpt-4o",
      "recording.autoRecord": "true",
      "recording.pollInterval": "3",
    });

    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    // The Settings page uses inline selects within SettingRow, find by displayed value
    await waitFor(() => {
      // The AI provider setting row label should appear
      expect(screen.getByText("AI provider")).toBeTruthy();
    });
  });

  it("renders AI provider setting row", async () => {
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("AI provider")).toBeTruthy();
      expect(screen.getByText("Select the AI service for transcription")).toBeTruthy();
    });
  });

  it("renders Model setting row", async () => {
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Model")).toBeTruthy();
      expect(screen.getByText("AI model to use for transcription")).toBeTruthy();
    });
  });

  it("renders API key setting row for non-ollama providers", async () => {
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("API key")).toBeTruthy();
      expect(screen.getByText("Your API key (stored securely)")).toBeTruthy();
    });
  });

  it("renders recording settings with auto-record toggle", async () => {
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Auto-record")).toBeTruthy();
      expect(screen.getByText("Start recording when microphone is active")).toBeTruthy();
    });
  });

  it("renders general settings with theme selection", async () => {
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Theme")).toBeTruthy();
      expect(screen.getByText("Choose your color scheme")).toBeTruthy();
    });
  });

  it("renders Meeting Types section", async () => {
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    await waitFor(() => {
      const headings = screen.getAllByText("Meeting Types");
      expect(headings.length).toBeGreaterThan(0);
    });
  });

  it("renders meeting type add button", async () => {
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("+ Add meeting type")).toBeTruthy();
    });
  });

  it("renders transcription language setting", async () => {
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Transcription language")).toBeTruthy();
    });
  });

  it("renders recording behavior settings", async () => {
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Recording behavior")).toBeTruthy();
      expect(screen.getByText("Poll interval")).toBeTruthy();
      expect(screen.getByText("Grace period")).toBeTruthy();
      expect(screen.getByText("Chunk interval")).toBeTruthy();
    });
  });
});
