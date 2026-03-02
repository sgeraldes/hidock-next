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
import { render, screen, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../App";

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

// Mock MediaRecorder
class MockMediaRecorder {
  state: string = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onstop: (() => void) | null = null;
  stream: MediaStream;
  mimeType: string;

  constructor(stream: MediaStream, options: { mimeType: string }) {
    this.stream = stream;
    this.mimeType = options.mimeType;
  }

  start(timeslice: number) {
    this.state = "recording";
    // Simulate chunk generation after 100ms
    setTimeout(() => {
      if (this.ondataavailable && this.state === "recording") {
        const blob = new Blob(["test-audio-data"], { type: this.mimeType });
        this.ondataavailable({ data: blob });
      }
    }, 100);
  }

  stop() {
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
const mockSessionCreatedListeners: Array<(session: any) => void> = [];
const mockMicStatusListeners: Array<(status: { active: boolean }) => void> = [];

beforeEach(() => {
  // Reset mocks
  vi.clearAllMocks();
  mockChunkAckListeners.length = 0;
  mockSessionCreatedListeners.length = 0;
  mockMicStatusListeners.length = 0;

  // Mock MediaRecorder globally
  global.MediaRecorder = MockMediaRecorder as any;

  // Mock navigator.mediaDevices
  Object.defineProperty(navigator, "mediaDevices", {
    value: {
      getUserMedia: mockGetUserMedia,
    },
    writable: true,
  });

  // Mock Electron API
  (global as any).window.electronAPI = {
    session: {
      list: mockListSessions,
      create: mockCreateSession,
      end: mockEndSession,
      get: vi.fn(),
      delete: vi.fn(),
      getTranscript: vi.fn(),
      getTopics: vi.fn(),
      getActionItems: vi.fn(),
      getSummary: vi.fn(),
      onCreated: (callback: any) => {
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
      onMicStatus: (callback: any) => {
        mockMicStatusListeners.push(callback);
        return () => {
          const idx = mockMicStatusListeners.indexOf(callback);
          if (idx > -1) mockMicStatusListeners.splice(idx, 1);
        };
      },
      onChunkAck: (callback: any) => {
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
  vi.clearAllTimers();
});

describe("Complete Recording Flow Integration", () => {
  it("should execute complete flow: click Record → capture audio → send chunks → receive ack", async () => {
    vi.useFakeTimers();

    const { container } = render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );

    // Wait for app to initialize
    await act(async () => {
      vi.advanceTimersByTime(100);
    });

    // STEP 1: Verify initial state (no recording)
    expect(mockCreateSession).not.toHaveBeenCalled();

    // STEP 2: Click Record button
    const recordButton = container.querySelector('[data-recording="false"]');
    expect(recordButton).toBeTruthy();

    await act(async () => {
      recordButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      vi.advanceTimersByTime(50);
    });

    // STEP 3: Verify session creation IPC call
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    // STEP 4: Simulate backend broadcasting session:created event
    await act(async () => {
      for (const listener of mockSessionCreatedListeners) {
        listener(mockSession);
      }
      vi.advanceTimersByTime(50);
    });

    // STEP 5: Verify getUserMedia called (audio capture initiated)
    await waitFor(() => {
      expect(mockGetUserMedia).toHaveBeenCalledWith({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
    });

    // STEP 6: Wait for MediaRecorder to generate first chunk
    await act(async () => {
      vi.advanceTimersByTime(150);
    });

    // STEP 7: Verify chunk sent via IPC
    await waitFor(() => {
      expect(mockSendChunk).toHaveBeenCalled();
      const call = mockSendChunk.mock.calls[0];
      expect(call[0]).toBeInstanceOf(ArrayBuffer); // chunk data
      expect(call[1]).toBe(mockSession.id); // sessionId
      expect(call[2]).toBe(0); // chunkIndex
      expect(call[3]).toContain("audio/"); // mimeType
    });

    // STEP 8: Simulate backend acknowledging chunk
    await act(async () => {
      for (const listener of mockChunkAckListeners) {
        listener({ sessionId: mockSession.id, chunkIndex: 0 });
      }
      vi.advanceTimersByTime(50);
    });

    // STEP 9: Verify recording state is active
    const recordingIndicator = container.querySelector('[data-recording="true"]');
    expect(recordingIndicator).toBeTruthy();

    vi.useRealTimers();
  });

  it("should handle microphone permission denial gracefully", async () => {
    mockGetUserMedia.mockRejectedValueOnce(
      new DOMException("Permission denied", "NotAllowedError")
    );

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );

    await act(async () => {
      // Trigger session creation
      mockCreateSession.mockResolvedValueOnce(mockSession);
      for (const listener of mockSessionCreatedListeners) {
        listener(mockSession);
      }
    });

    // Should attempt getUserMedia
    await waitFor(() => {
      expect(mockGetUserMedia).toHaveBeenCalled();
    });

    // Should NOT send any chunks
    expect(mockSendChunk).not.toHaveBeenCalled();
  });

  it("should send multiple chunks over time", async () => {
    vi.useFakeTimers();

    // Create a custom MockMediaRecorder that generates multiple chunks
    class MultiChunkMediaRecorder extends MockMediaRecorder {
      private intervalId: number | null = null;

      start(timeslice: number) {
        this.state = "recording";
        let chunkCount = 0;
        this.intervalId = window.setInterval(() => {
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

    global.MediaRecorder = MultiChunkMediaRecorder as any;

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );

    // Start recording
    await act(async () => {
      mockCreateSession.mockResolvedValueOnce(mockSession);
      for (const listener of mockSessionCreatedListeners) {
        listener(mockSession);
      }
      vi.advanceTimersByTime(100);
    });

    // Wait for first chunk
    await act(async () => {
      vi.advanceTimersByTime(15000);
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
      vi.advanceTimersByTime(15000);
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
      vi.advanceTimersByTime(15000);
    });

    await waitFor(() => {
      expect(mockSendChunk).toHaveBeenCalledTimes(3);
    });

    vi.useRealTimers();
  });
});
