import { describe, it, expect, vi, beforeEach } from "vitest";

const VALID_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const VALID_UUID_2 = "b2c3d4e5-f6a7-8901-bcde-f12345678901";

const {
  mockMkdirSync,
  mockWriteFileSync,
  mockExistsSync,
  mockReaddirSync,
  mockUnlinkSync,
} = vi.hoisted(() => ({
  mockMkdirSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockExistsSync: vi.fn().mockReturnValue(false),
  mockReaddirSync: vi.fn().mockReturnValue([]),
  mockUnlinkSync: vi.fn(),
}));

vi.mock("fs", () => {
  const mocks = {
    mkdirSync: mockMkdirSync,
    writeFileSync: mockWriteFileSync,
    existsSync: mockExistsSync,
    readdirSync: mockReaddirSync,
    unlinkSync: mockUnlinkSync,
  };
  return { ...mocks, default: mocks };
});

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn().mockReturnValue("/home/testuser/Documents"),
  },
}));

import { AudioStorage } from "../services/audio-storage";

describe("AudioStorage", () => {
  let storage: AudioStorage;

  beforeEach(() => {
    mockMkdirSync.mockClear();
    mockWriteFileSync.mockClear();
    mockExistsSync.mockClear().mockReturnValue(false);
    mockReaddirSync.mockClear().mockReturnValue([]);
    mockUnlinkSync.mockClear();
    storage = new AudioStorage();
  });

  describe("getSessionDir", () => {
    it("returns path under Documents/MeetingRecorder/recordings/<sessionId>", () => {
      const dir = storage.getSessionDir(VALID_UUID);
      expect(dir).toContain("MeetingRecorder");
      expect(dir).toContain("recordings");
      expect(dir).toContain(VALID_UUID);
    });

    it("rejects invalid session IDs", () => {
      expect(() => storage.getSessionDir("invalid-id")).toThrow(
        "Invalid session ID",
      );
    });
  });

  describe("ensureSessionDir", () => {
    it("creates the session directory recursively", () => {
      storage.ensureSessionDir(VALID_UUID);
      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringContaining(VALID_UUID),
        { recursive: true },
      );
    });
  });

  describe("saveChunk", () => {
    it("writes chunk data to a numbered file", () => {
      const data = Buffer.from([1, 2, 3, 4]);
      const filePath = storage.saveChunk(VALID_UUID, 0, data);

      expect(mockMkdirSync).toHaveBeenCalled();
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining("chunk-000.ogg"),
        data,
      );
      expect(filePath).toContain("chunk-000.ogg");
    });

    it("pads chunk index to 3 digits", () => {
      const data = Buffer.from([5, 6]);
      const filePath = storage.saveChunk(VALID_UUID, 42, data);
      expect(filePath).toContain("chunk-042.ogg");
    });
  });

  describe("getChunkFiles", () => {
    it("returns sorted list of chunk files in session dir", () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        "chunk-002.ogg",
        "chunk-000.ogg",
        "chunk-001.ogg",
      ]);

      const files = storage.getChunkFiles(VALID_UUID);
      expect(files).toEqual([
        "chunk-000.ogg",
        "chunk-001.ogg",
        "chunk-002.ogg",
      ]);
    });

    it("returns empty array when session dir does not exist", () => {
      mockExistsSync.mockReturnValue(false);
      const files = storage.getChunkFiles(VALID_UUID_2);
      expect(files).toEqual([]);
    });
  });

  describe("pruneOldChunks", () => {
    it("deletes oldest chunks when exceeding 50 files (skips chunk-000 header)", () => {
      const chunks = Array.from({ length: 52 }, (_, i) =>
        `chunk-${String(i).padStart(3, "0")}.ogg`,
      );
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(chunks);

      storage.saveChunk(VALID_UUID, 52, Buffer.from([1]));

      // chunk-000 is protected (contains WebM header), so only chunk-001 is deleted
      expect(mockUnlinkSync).toHaveBeenCalledTimes(1);
      expect(mockUnlinkSync).toHaveBeenCalledWith(
        expect.stringContaining("chunk-001.ogg"),
      );
    });

    it("does not delete when at or below 50 files", () => {
      const chunks = Array.from({ length: 50 }, (_, i) =>
        `chunk-${String(i).padStart(3, "0")}.ogg`,
      );
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(chunks);

      storage.saveChunk(VALID_UUID, 50, Buffer.from([1]));

      expect(mockUnlinkSync).not.toHaveBeenCalled();
    });
  });

  describe("getRecordingPath", () => {
    it("returns path for the final recording file", () => {
      const path = storage.getRecordingPath(VALID_UUID, "recording-abc.ogg");
      expect(path).toContain(VALID_UUID);
      expect(path).toContain("recording-abc.ogg");
    });
  });
});
