/**
 * Tests for the Electron preload bridge API surface.
 * Verifies all expected channels are exposed to the renderer.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockInvoke, mockSend, mockOn, mockRemoveListener, mockExposeInMainWorld } =
  vi.hoisted(() => ({
    mockInvoke: vi.fn().mockResolvedValue(undefined),
    mockSend: vi.fn(),
    mockOn: vi.fn(),
    mockRemoveListener: vi.fn(),
    mockExposeInMainWorld: vi.fn(),
  }));

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: mockExposeInMainWorld,
  },
  ipcRenderer: {
    invoke: mockInvoke,
    send: mockSend,
    on: mockOn,
    removeListener: mockRemoveListener,
  },
}));

await import("../index");

function getExposedAPI(): Record<string, unknown> {
  expect(mockExposeInMainWorld).toHaveBeenCalledWith(
    "electronAPI",
    expect.any(Object),
  );
  return mockExposeInMainWorld.mock.calls[0][1] as Record<string, unknown>;
}

describe("preload bridge", () => {
  beforeEach(() => {
    mockInvoke.mockClear();
    mockSend.mockClear();
    mockOn.mockClear();
    mockRemoveListener.mockClear();
  });

  describe("audio API", () => {
    it("sendChunk sends audio:chunk with mimeType", () => {
      const api = getExposedAPI();
      const audio = api.audio as Record<string, unknown>;
      const data = new ArrayBuffer(8);
      (audio.sendChunk as (d: ArrayBuffer, s: string, i: number, m: string) => void)(
        data,
        "sess-1",
        0,
        "audio/webm",
      );
      expect(mockSend).toHaveBeenCalledWith(
        "audio:chunk",
        data,
        "sess-1",
        0,
        "audio/webm",
      );
    });

    it("onChunkAck registers listener for audio:chunkAck", () => {
      const api = getExposedAPI();
      const audio = api.audio as Record<string, unknown>;
      const cb = vi.fn();
      (audio.onChunkAck as (cb: unknown) => unknown)(cb);
      expect(mockOn).toHaveBeenCalledWith("audio:chunkAck", expect.any(Function));
    });

    it("onChunkAck returns cleanup that removes listener", () => {
      const api = getExposedAPI();
      const audio = api.audio as Record<string, unknown>;
      const cb = vi.fn();
      const cleanup = (audio.onChunkAck as (cb: unknown) => () => void)(cb);
      cleanup();
      expect(mockRemoveListener).toHaveBeenCalledWith(
        "audio:chunkAck",
        expect.any(Function),
      );
    });
  });

  describe("transcription API", () => {
    it("start invokes transcription:start", async () => {
      const api = getExposedAPI();
      const transcription = api.transcription as Record<string, unknown>;
      await (transcription.start as (id: string) => Promise<void>)("sess-1");
      expect(mockInvoke).toHaveBeenCalledWith("transcription:start", "sess-1");
    });

    it("stop invokes transcription:stop", async () => {
      const api = getExposedAPI();
      const transcription = api.transcription as Record<string, unknown>;
      await (transcription.stop as (id: string) => Promise<void>)("sess-1");
      expect(mockInvoke).toHaveBeenCalledWith("transcription:stop", "sess-1");
    });

    it("exposes existing event listeners", () => {
      const api = getExposedAPI();
      const transcription = api.transcription as Record<string, unknown>;
      expect(typeof transcription.onNewSegments).toBe("function");
      expect(typeof transcription.onError).toBe("function");
      expect(typeof transcription.onStatus).toBe("function");
    });
  });
});
