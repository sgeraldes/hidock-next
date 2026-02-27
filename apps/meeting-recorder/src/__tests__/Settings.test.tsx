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
      configure: vi.fn().mockResolvedValue({ provider: "google", model: "gemini-2.0-flash" }),
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

describe("Settings", () => {
  it("renders Provider, Recording, and General sections", async () => {
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("AI Provider")).toBeTruthy();
    });
    expect(screen.getByText("Recording")).toBeTruthy();
    expect(screen.getByText("General")).toBeTruthy();
  });

  it("loads saved settings on mount", async () => {
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

    await waitFor(() => {
      const providerSelect = screen.getByLabelText("Provider") as HTMLSelectElement;
      expect(providerSelect.value).toBe("openai");
    });
  });

  it("saves provider selection via IPC", async () => {
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Provider")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Provider"), {
      target: { value: "anthropic" },
    });

    await waitFor(() => {
      expect(window.electronAPI.settings.set).toHaveBeenCalledWith(
        "ai.provider",
        "anthropic",
      );
    });
  });

  it("shows API key input for non-ollama providers", async () => {
    window.electronAPI.settings.getAll = vi.fn().mockResolvedValue({
      "ai.provider": "openai",
    });

    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("API Key")).toBeTruthy();
    });
  });

  it("shows Bedrock AWS fields when bedrock is selected", async () => {
    window.electronAPI.settings.getAll = vi.fn().mockResolvedValue({
      "ai.provider": "bedrock",
    });

    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("AWS Region")).toBeTruthy();
      expect(screen.getByLabelText("Access Key ID")).toBeTruthy();
      expect(screen.getByLabelText("Secret Access Key")).toBeTruthy();
    });
  });

  it("shows Ollama base URL when ollama is selected", async () => {
    window.electronAPI.settings.getAll = vi.fn().mockResolvedValue({
      "ai.provider": "ollama",
    });

    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Ollama Base URL")).toBeTruthy();
    });
  });

  it("renders recording settings with auto-record toggle", async () => {
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Auto-Record")).toBeTruthy();
    });
  });

  it("renders general settings with theme selection", async () => {
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Theme")).toBeTruthy();
    });
  });

  it("validates API key via test button using settings.testConnection", async () => {
    window.electronAPI.settings.getAll = vi.fn().mockResolvedValue({
      "ai.provider": "google",
      "ai.apiKey": "****abcd",
    });

    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Test Connection")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Test Connection"));

    await waitFor(() => {
      expect(window.electronAPI.settings.testConnection).toHaveBeenCalled();
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

  it("shows meeting type creation form", async () => {
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Type name")).toBeTruthy();
    });
  });
});
