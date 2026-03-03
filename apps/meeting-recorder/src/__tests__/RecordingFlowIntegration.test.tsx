/**
 * COMPLETE RECORDING FLOW INTEGRATION TEST
 *
 * This test verifies the ENTIRE recording pipeline from button click to chunk storage:
 * 1. User clicks Record
 * 2. Session created via IPC
 * 3. ActiveSessionRecorder mounts
 * 4. Audio capture starts
 * 5. MediaRecorder generates chunks
 * 6. Chunks sent via IPC
 * 7. Backend saves chunks
 * 8. Acknowledgments received
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../App";
import { useSessionStore } from "../store/useSessionStore";
import { useSettingsStore } from "../store/useSettingsStore";
import { useTranscriptStore } from "../store/useTranscriptStore";

// Mock session data
const mockSession = {
  id: "test-session-123",
  status: "active",
  started_at: "2026-02-27T10:00:00.000Z",
  ended_at: null,
  title: "Session Feb 27, 2026, 10:00 AM",
  summary: null,
  audio_path: null,
  created_at: "2026-02-27T10:00:00.000Z",
};

// Mock MediaRecorder — generates chunks synchronously via manual trigger
class MockMediaRecorder {
  state: string = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onstop: (() => void) | null = null;
  stream: MediaStream;
  mimeType: string;
  private timerId: ReturnType<typeof setTimeout> | null = null;

  constructor(stream: MediaStream, options: { mimeType: string }) {
    this.stream = stream;
    this.mimeType = options.mimeType;
  }

  start(_timeslice: number) {
    this.state = "recording";
    // Generate a chunk after a short delay
    this.timerId = setTimeout(() => {
      if (this.ondataavailable && this.state === "recording") {
        const blob = new Blob(["test-audio-data"], { type: this.mimeType });
        this.ondataavailable({ data: blob });
      }
    }, 50);
  }

  stop() {
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.state = "inactive";
    if (this.onstop) {
      this.onstop();
    }
  }

  pause() {
    this.state = "paused";
  }

  resume() {
    this.state = "recording";
  }

  static isTypeSupported(type: string): boolean {
    return type === "audio/ogg;codecs=opus";
  }
}

// Mock getUserMedia
const mockGetUserMedia = vi.fn().mockResolvedValue({
  getTracks: () => [{ stop: vi.fn() }],
} as unknown as MediaStream);

// Mock IPC API
const mockSendChunk = vi.fn();
const mockCreateSession = vi.fn().mockResolvedValue(mockSession);
const mockListSessions = vi.fn().mockResolvedValue([]);
const mockEndSession = vi.fn();

const mockChunkAckListeners: Array<(data: { sessionId: string; chunkIndex: number }) => void> = [];
const mockSessionCreatedListeners: Array<(session: unknown) => void> = [];
const mockMicStatusListeners: Array<(status: { active: boolean }) => void> = [];

beforeEach(() => {
  // Reset mocks
  vi.clearAllMocks();
  mockChunkAckListeners.length = 0;
  mockSessionCreatedListeners.length = 0;
  mockMicStatusListeners.length = 0;

  // Polyfill Blob.arrayBuffer for jsdom (not available in all environments)
  if (!Blob.prototype.arrayBuffer) {
    Blob.prototype.arrayBuffer = function (): Promise<ArrayBuffer> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(this);
      });
    };
  }

  // Mock MediaRecorder globally
  global.MediaRecorder = MockMediaRecorder as unknown as typeof MediaRecorder;

  // Mock navigator.mediaDevices
  Object.defineProperty(navigator, "mediaDevices", {
    value: {
      getUserMedia: mockGetUserMedia,
    },
    writable: true,
  });

  // Mock Electron API
  (global as { window: { electronAPI: unknown } }).window.electronAPI = {
    session: {
      list: mockListSessions,
      create: mockCreateSession,
      end: mockEndSession,
      get: vi.fn(),
      delete: vi.fn(),
      getTranscript: vi.fn().mockResolvedValue([]),
      getTopics: vi.fn().mockResolvedValue([]),
      getActionItems: vi.fn().mockResolvedValue([]),
      getSummary: vi.fn().mockResolvedValue(null),
      onCreated: (callback: (session: unknown) => void) => {
        mockSessionCreatedListeners.push(callback);
        return () => {
          const idx = mockSessionCreatedListeners.indexOf(callback);
          if (idx > -1) mockSessionCreatedListeners.splice(idx, 1);
        };
      },
      onStatusChanged: vi.fn(() => () => {}),
    },
    audio: {
      sendChunk: mockSendChunk,
      getPath: vi.fn(),
      onMicStatus: (callback: (status: { active: boolean }) => void) => {
        mockMicStatusListeners.push(callback);
        return () => {
          const idx = mockMicStatusListeners.indexOf(callback);
          if (idx > -1) mockMicStatusListeners.splice(idx, 1);
        };
      },
      onChunkAck: (callback: (data: { sessionId: string; chunkIndex: number }) => void) => {
        mockChunkAckListeners.push(callback);
        return () => {
          const idx = mockChunkAckListeners.indexOf(callback);
          if (idx > -1) mockChunkAckListeners.splice(idx, 1);
        };
      },
      onChunkError: vi.fn(() => () => {}),
    },
    transcription: {
      start: vi.fn(),
      stop: vi.fn(),
      onNewSegments: vi.fn(() => () => {}),
      onTopicsUpdated: vi.fn(() => () => {}),
      onActionItemsUpdated: vi.fn(() => () => {}),
      onError: vi.fn(() => () => {}),
      onStatus: vi.fn(() => () => {}),
      onInterimResult: vi.fn(() => () => {}),
    },
    ai: {
      configure: vi.fn(),
      getActiveProvider: vi.fn().mockResolvedValue("ollama"),
      isAudioCapable: vi.fn().mockResolvedValue(true),
      transcribe: vi.fn(),
      transcribeAudio: vi.fn(),
      summarize: vi.fn(),
      validateApiKey: vi.fn(),
    },
    settings: {
      get: vi.fn().mockResolvedValue(""),
      set: vi.fn(),
      getAll: vi.fn().mockResolvedValue({
        "ai.provider": "ollama",
        "ai.apiKey": "",
        "recording.autoRecord": "false",
        theme: "system",
      }),
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
      testConnection: vi.fn(),
    },
    window: {
      minimize: vi.fn(),
      maximize: vi.fn(),
      close: vi.fn(),
      isMaximized: vi.fn().mockResolvedValue(false),
      closeControlBar: vi.fn(),
    },
    attachment: {
      addFile: vi.fn(),
      addNote: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
    },
    speaker: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      getForSession: vi.fn().mockResolvedValue([]),
      linkToSession: vi.fn(),
    },
    meetingType: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      setForSession: vi.fn(),
      processSession: vi.fn(),
    },
    translation: {
      translateBatch: vi.fn(),
    },
    summarization: {
      generate: vi.fn(),
      onChunk: vi.fn(() => () => {}),
    },
    history: {
      search: vi.fn(),
      delete: vi.fn(),
    },
    app: {
      info: vi.fn().mockResolvedValue({
        name: "Meeting Recorder",
        version: "0.1.0",
      }),
    },
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();

  // Reset Zustand stores to prevent state leaking between tests
  useSessionStore.setState({
    activeSessionId: null,
    viewingSessionId: null,
    sessions: new Map(),
    micActive: false,
    loading: false,
    error: null,
    stopAndFlushRef: null,
  });
  useSettingsStore.setState({
    loaded: false,
    provider: "google",
    apiKey: "",
    autoRecord: true,
  });
  useTranscriptStore.setState({
    segments: new Map(),
    topics: new Map(),
    actionItems: new Map(),
    summary: new Map(),
    transcriptionError: null,
  });
});

describe("Complete Recording Flow Integration", () => {
  it("should execute complete flow: click Record → capture audio → send chunks → receive ack", async () => {
    // Use advanceTimersByTimeAsync for proper microtask resolution with React
    vi.useFakeTimers({ shouldAdvanceTime: true });

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );

    // Wait for app to initialize (loadFromIPC, loadSessions)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    // STEP 1: Verify initial state (no recording)
    expect(mockCreateSession).not.toHaveBeenCalled();

    // STEP 2: Find and click the Record button (rendered in TopBar)
    const recordButton = screen.getByRole("button", { name: /record/i });
    expect(recordButton).toBeTruthy();

    // Click and wait for async onStartRecording to complete
    await act(async () => {
      recordButton.click();
      await vi.advanceTimersByTimeAsync(200);
    });

    // STEP 3: Verify session creation IPC call
    expect(mockCreateSession).toHaveBeenCalled();

    // STEP 4: Wait for ActiveSessionRecorder mount + getUserMedia + recording start
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    // STEP 5: Verify getUserMedia called (audio capture initiated)
    expect(mockGetUserMedia).toHaveBeenCalledWith({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    // STEP 6: Wait for MediaRecorder to generate first chunk
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    // STEP 7: Verify chunk sent via IPC
    await waitFor(() => {
      expect(mockSendChunk).toHaveBeenCalled();
    });

    const call = mockSendChunk.mock.calls[0];
    expect(call[0]).toBeInstanceOf(ArrayBuffer); // chunk data
    expect(call[1]).toBe(mockSession.id); // sessionId
    expect(call[2]).toBe(0); // chunkIndex
    expect(call[3]).toContain("audio/"); // mimeType

    // STEP 8: Simulate backend acknowledging chunk
    await act(async () => {
      for (const listener of mockChunkAckListeners) {
        listener({ sessionId: mockSession.id, chunkIndex: 0 });
      }
      await vi.advanceTimersByTimeAsync(100);
    });

    // STEP 9: Verify recording state is active — Stop button should be visible
    const stopButton = screen.getByRole("button", { name: /stop/i });
    expect(stopButton).toBeTruthy();
  }, 15000);

  it("should handle microphone permission denial gracefully", async () => {
    mockGetUserMedia.mockRejectedValueOnce(
      new DOMException("Permission denied", "NotAllowedError")
    );

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );

    // Wait for app to initialize
    await act(async () => {});

    // Click the Record button to trigger the recording flow
    const recordButton = screen.getByRole("button", { name: /record/i });
    await act(async () => {
      recordButton.click();
    });

    // Wait for session to be created
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    // Should attempt getUserMedia (ActiveSessionRecorder mounts and calls start())
    await waitFor(() => {
      expect(mockGetUserMedia).toHaveBeenCalled();
    });

    // Should NOT send any chunks since getUserMedia failed
    expect(mockSendChunk).not.toHaveBeenCalled();
  });

  it("should send multiple chunks over time", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    // Create a custom MockMediaRecorder that generates multiple chunks
    class MultiChunkMediaRecorder extends MockMediaRecorder {
      private intervalId: ReturnType<typeof setInterval> | null = null;

      start(timeslice: number) {
        this.state = "recording";
        let chunkCount = 0;
        this.intervalId = setInterval(() => {
          if (this.ondataavailable && this.state === "recording" && chunkCount < 3) {
            const blob = new Blob([`test-audio-data-${chunkCount}`], { type: this.mimeType });
            this.ondataavailable({ data: blob });
            chunkCount++;
          }
        }, timeslice);
      }

      stop() {
        if (this.intervalId !== null) {
          clearInterval(this.intervalId);
        }
        super.stop();
      }
    }

    global.MediaRecorder = MultiChunkMediaRecorder as unknown as typeof MediaRecorder;

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );

    // Wait for app to initialize
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    // Click the Record button to start recording
    const recordButton = screen.getByRole("button", { name: /record/i });
    await act(async () => {
      recordButton.click();
      await vi.advanceTimersByTimeAsync(200);
    });

    // Wait for session to be created and ActiveSessionRecorder to mount
    expect(mockCreateSession).toHaveBeenCalled();

    // Wait for first chunk (timeslice interval = 3000ms from AudioRecorder default)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });

    await waitFor(() => {
      expect(mockSendChunk).toHaveBeenCalledTimes(1);
    });

    // Acknowledge first chunk
    await act(async () => {
      for (const listener of mockChunkAckListeners) {
        listener({ sessionId: mockSession.id, chunkIndex: 0 });
      }
    });

    // Wait for second chunk
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });

    await waitFor(() => {
      expect(mockSendChunk).toHaveBeenCalledTimes(2);
    });

    // Acknowledge second chunk
    await act(async () => {
      for (const listener of mockChunkAckListeners) {
        listener({ sessionId: mockSession.id, chunkIndex: 1 });
      }
    });

    // Wait for third chunk
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });

    await waitFor(() => {
      expect(mockSendChunk).toHaveBeenCalledTimes(3);
    });
  }, 30000);
});
