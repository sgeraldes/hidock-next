/**
 * SPEC-001: Audio Concatenation & Chunk Cleanup Tests
 * Tests derived from docs/specs/SPEC-001-audio-player.md REQ-9, REQ-10
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted for mock references used in vi.mock factories
const {
  mockExistsSync,
  mockReadFileSync,
  mockWriteFileSync,
  mockUnlinkSync,
  mockReaddirSync,
  mockMkdirSync,
  mockExecFileAsync,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn().mockReturnValue(true),
  mockReadFileSync: vi.fn().mockReturnValue(Buffer.from("test-audio")),
  mockWriteFileSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
  mockReaddirSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockExecFileAsync: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
}));

// Must provide __esModule + default for fs and child_process to satisfy both ESM and CJS patterns
vi.mock("fs", () => ({
  __esModule: true,
  default: {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    unlinkSync: mockUnlinkSync,
    readdirSync: mockReaddirSync,
    mkdirSync: mockMkdirSync,
    renameSync: vi.fn(),
  },
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  unlinkSync: mockUnlinkSync,
  readdirSync: mockReaddirSync,
  mkdirSync: mockMkdirSync,
  renameSync: vi.fn(),
}));

vi.mock("child_process", () => ({
  __esModule: true,
  default: { execFile: vi.fn() },
  execFile: vi.fn(),
}));

vi.mock("util", () => {
  return {
    default: { promisify: () => mockExecFileAsync },
    promisify: () => mockExecFileAsync,
  };
});

vi.mock("ffmpeg-static", () => ({ default: "/usr/bin/ffmpeg" }));

vi.mock("electron", () => ({
  app: { getPath: vi.fn().mockReturnValue("/tmp/test") },
}));

import { AudioConcatenation } from "../services/audio-concatenation";
import { AudioStorage } from "../services/audio-storage";

beforeEach(() => {
  vi.clearAllMocks();
  mockExistsSync.mockReturnValue(true);
  mockReadFileSync.mockReturnValue(Buffer.from("test-audio"));
  mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });
});

describe("AudioConcatenation - Chunk Cleanup (REQ-9)", () => {
  it("AC-9: deletes chunk files after successful concatenation", async () => {
    const chunkFiles = ["chunk-000.ogg", "chunk-001.ogg", "chunk-002.ogg"];
    mockReaddirSync.mockReturnValue(chunkFiles);
    mockExistsSync.mockImplementation((p: string) => {
      // Stale files don't exist, chunks do
      if (typeof p === "string" && (p.includes("recording.webm") || p.includes("recording-raw") || p.includes("recording.ogg") || p.includes("concat-list"))) return false;
      return true;
    });

    const storage = new AudioStorage("/tmp/test/recordings");
    const concatenation = new AudioConcatenation(storage);

    await concatenation.concatenateSession("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");

    // Chunk files should have been deleted after successful concatenation
    const unlinkCalls = mockUnlinkSync.mock.calls.map((c: unknown[]) => String(c[0]));
    for (const chunk of chunkFiles) {
      expect(unlinkCalls.some((p: string) => p.endsWith(chunk))).toBe(true);
    }
  });

  it("does not delete chunks if concatenation fails", async () => {
    const chunkFiles = ["chunk-000.ogg", "chunk-001.ogg"];
    mockReaddirSync.mockReturnValue(chunkFiles);
    mockExistsSync.mockImplementation((p: string) => {
      if (typeof p === "string" && p.includes("recording-raw")) return false;
      if (typeof p === "string" && p.includes("recording.webm")) return false;
      if (typeof p === "string" && p.includes("recording.ogg")) return false;
      if (typeof p === "string" && p.includes("concat-list")) return false;
      return true;
    });

    // Make ffmpeg fail
    mockExecFileAsync.mockRejectedValue(new Error("ffmpeg crashed"));

    const storage = new AudioStorage("/tmp/test/recordings");
    const concatenation = new AudioConcatenation(storage);

    const result = await concatenation.concatenateSession("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");

    // Concatenation failed (returns null since raw file doesn't exist either)
    expect(result).toBeNull();

    // Chunk files should NOT have been deleted
    const unlinkCalls = mockUnlinkSync.mock.calls.map((c: unknown[]) => String(c[0]));
    const chunkDeletes = unlinkCalls.filter((p: string) => p.includes("chunk-"));
    expect(chunkDeletes.length).toBe(0);
  });

  it("logs warning if chunk deletion fails (REQ-9.3)", async () => {
    const chunkFiles = ["chunk-000.ogg", "chunk-001.ogg"];
    mockReaddirSync.mockReturnValue(chunkFiles);
    mockExistsSync.mockImplementation((p: string) => {
      if (typeof p === "string" && (p.includes("recording.webm") || p.includes("recording-raw") || p.includes("recording.ogg") || p.includes("concat-list"))) return false;
      return true;
    });

    // Make chunk deletion throw
    mockUnlinkSync.mockImplementation((p: string) => {
      if (typeof p === "string" && p.includes("chunk-")) {
        throw new Error("Permission denied");
      }
    });

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const storage = new AudioStorage("/tmp/test/recordings");
    const concatenation = new AudioConcatenation(storage);

    // Should NOT throw even though deletion fails
    const result = await concatenation.concatenateSession("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(result).toBeTruthy();

    // Should have logged warnings
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to delete chunk"),
    );

    consoleSpy.mockRestore();
  });
});

describe("AudioStorage - No Pruning During Recording (REQ-10)", () => {
  it("AC-12: does NOT delete chunks during active recording", () => {
    // Simulate many chunks already saved
    const existingChunks = Array.from(
      { length: 60 },
      (_, i) => `chunk-${String(i).padStart(3, "0")}.ogg`,
    );
    mockReaddirSync.mockReturnValue(existingChunks);

    const storage = new AudioStorage("/tmp/test/recordings");

    // Save chunk 60 — this used to trigger pruneOldChunks
    storage.saveChunk("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", Buffer.from("audio-data"), 60);

    // NO chunk files should have been deleted
    expect(mockUnlinkSync).not.toHaveBeenCalled();
  });
});
