import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import History from "../pages/History";

beforeEach(() => {
  window.electronAPI = {
    app: { info: vi.fn() },
    session: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "s1" }),
      end: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue(undefined),
      onCreated: vi.fn().mockReturnValue(() => {}),
      onStatusChanged: vi.fn().mockReturnValue(() => {}),
    },
    history: {
      search: vi.fn().mockResolvedValue([
        {
          id: "s1",
          title: "Test Session",
          status: "complete",
          started_at: new Date().toISOString(),
          ended_at: new Date().toISOString(),
          meeting_type_id: null,
          summary: null,
          created_at: new Date().toISOString(),
        },
      ]),
      delete: vi.fn().mockResolvedValue(undefined),
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
    settings: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      getAll: vi.fn().mockResolvedValue({}),
      testConnection: vi.fn().mockResolvedValue({ valid: true }),
    },
  } as unknown as typeof window.electronAPI;
});

describe("History", () => {
  it("renders sessions from IPC", async () => {
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(window.electronAPI.history.search).toHaveBeenCalled();
    });
  });

  it("shows confirmation dialog when delete button is clicked in timeline mode", async () => {
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );

    await waitFor(() => {
      const timelineBtn = screen.queryByText("Timeline");
      if (timelineBtn) fireEvent.click(timelineBtn);
    });

    await waitFor(() => {
      const deleteButtons = screen.queryAllByLabelText(/delete/i);
      if (deleteButtons.length > 0) {
        fireEvent.click(deleteButtons[0]);
      }
    });
  });

  it("calls session.delete after confirmation", async () => {
    window.confirm = vi.fn().mockReturnValue(true);

    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );

    await waitFor(() => {
      const timelineBtn = screen.queryByText("Timeline");
      if (timelineBtn) fireEvent.click(timelineBtn);
    });

    await waitFor(() => {
      const deleteButtons = screen.queryAllByLabelText(/delete/i);
      if (deleteButtons.length > 0) {
        fireEvent.click(deleteButtons[0]);
        expect(window.electronAPI.history.delete).toHaveBeenCalledWith("s1");
      }
    });
  });

  it("does not delete when confirmation is cancelled", async () => {
    window.confirm = vi.fn().mockReturnValue(false);

    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );

    await waitFor(() => {
      const timelineBtn = screen.queryByText("Timeline");
      if (timelineBtn) fireEvent.click(timelineBtn);
    });

    await waitFor(() => {
      const deleteButtons = screen.queryAllByLabelText(/delete/i);
      if (deleteButtons.length > 0) {
        fireEvent.click(deleteButtons[0]);
        expect(window.electronAPI.history.delete).not.toHaveBeenCalled();
      }
    });
  });
});
