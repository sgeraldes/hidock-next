import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAudioCapture } from "../hooks/useAudioCapture";

const mockStartRecording = vi.fn();
const mockStopRecording = vi.fn();
const mockGetState = vi.fn().mockReturnValue("idle");
const mockGetMimeType = vi.fn().mockReturnValue("audio/ogg;codecs=opus");
const mockGetPendingChunkCount = vi.fn().mockReturnValue(0);
const mockAcknowledgeChunk = vi.fn();
const mockDispose = vi.fn();

vi.mock("../services/audio-recorder", () => ({
  AudioRecorder: vi.fn(function (
    this: Record<string, unknown>,
    options: Record<string, unknown>,
  ) {
    this.startRecording = mockStartRecording;
    this.stopRecording = mockStopRecording;
    this.getState = mockGetState;
    this.getMimeType = mockGetMimeType;
    this.getPendingChunkCount = mockGetPendingChunkCount;
    this.acknowledgeChunk = mockAcknowledgeChunk;
    this.dispose = mockDispose;
    (this as Record<string, unknown>)._onChunk = options?.onChunk;
    (this as Record<string, unknown>)._onError = options?.onError;
  }),
  AudioRecorderState: {
    Idle: "idle",
    Recording: "recording",
    Paused: "paused",
  },
}));

const mockSendChunk = vi.fn();
const mockOnChunkAck = vi.fn().mockReturnValue(vi.fn());
Object.defineProperty(window, "electronAPI", {
  value: {
    audio: {
      sendChunk: mockSendChunk,
      onMicStatus: vi.fn(),
      onChunkAck: mockOnChunkAck,
    },
  },
  writable: true,
});

describe("useAudioCapture", () => {
  beforeEach(() => {
    mockStartRecording.mockClear();
    mockStopRecording.mockClear();
    mockGetState.mockClear().mockReturnValue("idle");
    mockSendChunk.mockClear();
    mockOnChunkAck.mockClear().mockReturnValue(vi.fn());
    mockAcknowledgeChunk.mockClear();
  });

  it("initializes with idle state", () => {
    const { result } = renderHook(() => useAudioCapture("session-1"));
    expect(result.current.isRecording).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("start() calls AudioRecorder.startRecording()", async () => {
    const { result } = renderHook(() => useAudioCapture("session-1"));

    await act(async () => {
      await result.current.start();
    });

    expect(mockStartRecording).toHaveBeenCalled();
  });

  it("stop() calls AudioRecorder.stopRecording()", async () => {
    mockGetState.mockReturnValue("recording");
    const { result } = renderHook(() => useAudioCapture("session-1"));

    await act(async () => {
      await result.current.start();
    });

    act(() => {
      result.current.stop();
    });

    expect(mockStopRecording).toHaveBeenCalled();
  });

  it("exposes mimeType from AudioRecorder", () => {
    const { result } = renderHook(() => useAudioCapture("session-1"));
    expect(result.current.mimeType).toBe("audio/ogg;codecs=opus");
  });

  it("subscribes to onChunkAck on mount", () => {
    renderHook(() => useAudioCapture("session-1"));
    expect(mockOnChunkAck).toHaveBeenCalled();
  });

  it("calls acknowledgeChunk on recorder when chunkAck fires", () => {
    let capturedCallback: (() => void) | null = null;
    mockOnChunkAck.mockImplementation((cb: () => void) => {
      capturedCallback = cb;
      return vi.fn();
    });

    renderHook(() => useAudioCapture("session-1"));
    expect(capturedCallback).not.toBeNull();

    capturedCallback!();
    expect(mockAcknowledgeChunk).toHaveBeenCalled();
  });
});
