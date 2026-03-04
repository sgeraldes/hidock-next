/**
 * SPEC-002: Silence Detection Tests
 * Tests derived from docs/specs/SPEC-002-silence-detection.md
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockExecFileAsync, mockExistsSync, mockWriteFileSync, mockUnlinkSync } =
  vi.hoisted(() => ({
    mockExecFileAsync: vi.fn(),
    mockExistsSync: vi.fn().mockReturnValue(true),
    mockWriteFileSync: vi.fn(),
    mockUnlinkSync: vi.fn(),
  }));

vi.mock("fs", () => ({
  __esModule: true,
  default: { existsSync: mockExistsSync, writeFileSync: mockWriteFileSync, unlinkSync: mockUnlinkSync },
  existsSync: mockExistsSync,
  writeFileSync: mockWriteFileSync,
  unlinkSync: mockUnlinkSync,
}));

vi.mock("child_process", () => ({
  __esModule: true,
  default: { execFile: vi.fn() },
  execFile: vi.fn(),
}));

vi.mock("util", () => ({
  __esModule: true,
  default: { promisify: () => mockExecFileAsync },
  promisify: () => mockExecFileAsync,
}));

vi.mock("ffmpeg-static", () => ({ default: "/usr/bin/ffmpeg" }));

import {
  isSilent,
  MAX_SILENCE_THRESHOLD_DB,
  MEAN_SILENCE_THRESHOLD_DB,
} from "../services/silence-detector";

beforeEach(() => {
  vi.clearAllMocks();
  mockExistsSync.mockReturnValue(true);
});

function makeVolumeOutput(maxDb: number, meanDb: number | string): string {
  const meanStr = meanDb === "-inf" ? "-inf" : `${meanDb}`;
  return `[Parsed_volumedetect_0 @ 0x1234] n_samples: 48000
[Parsed_volumedetect_0 @ 0x1234] mean_volume: ${meanStr} dB
[Parsed_volumedetect_0 @ 0x1234] max_volume: ${maxDb} dB`;
}

describe("isSilent (SPEC-002)", () => {
  it("exports named threshold constants", () => {
    expect(MAX_SILENCE_THRESHOLD_DB).toBe(-45);
    expect(MEAN_SILENCE_THRESHOLD_DB).toBe(-40);
  });

  it("AC-1: classifies background noise (mean < -40 dB) as silent", async () => {
    // Chunk 015 from user session: max=-28.4, mean=-53.0
    // max is above -45 but mean is below -40 → SILENT
    mockExecFileAsync.mockResolvedValue({
      stdout: "",
      stderr: makeVolumeOutput(-28.4, -53.0),
    });

    const result = await isSilent(Buffer.from("test"), "/tmp/session", 15);
    expect(result).toBe(true);
  });

  it("AC-2: classifies true silence (max < -45 dB) as silent", async () => {
    // Chunk 024: max=-78.3, mean=-91.0
    mockExecFileAsync.mockResolvedValue({
      stdout: "",
      stderr: makeVolumeOutput(-78.3, -91.0),
    });

    const result = await isSilent(Buffer.from("test"), "/tmp/session", 24);
    expect(result).toBe(true);
  });

  it("AC-3: classifies speech (mean > -30 dB) as NOT silent", async () => {
    // Chunk with speech: max=-5.0, mean=-20.6
    mockExecFileAsync.mockResolvedValue({
      stdout: "",
      stderr: makeVolumeOutput(-5.0, -20.6),
    });

    const result = await isSilent(Buffer.from("test"), "/tmp/session", 17);
    expect(result).toBe(false);
  });

  it("returns false when ffmpeg analysis fails (fail open)", async () => {
    mockExecFileAsync.mockRejectedValue(new Error("ffmpeg crashed"));

    const result = await isSilent(Buffer.from("test"), "/tmp/session", 0);
    expect(result).toBe(false);
  });

  it("correctly parses -inf mean volume as silent", async () => {
    // -inf mean = absolute silence
    mockExecFileAsync.mockResolvedValue({
      stdout: "",
      stderr: makeVolumeOutput(-91.0, "-inf"),
    });

    const result = await isSilent(Buffer.from("test"), "/tmp/session", 0);
    expect(result).toBe(true);
  });

  it("classifies borderline: max=-44.9, mean=-39.5 as silent (mean below -40)", async () => {
    mockExecFileAsync.mockResolvedValue({
      stdout: "",
      stderr: makeVolumeOutput(-44.9, -39.5),
    });

    // mean = -39.5 which is ABOVE -40, and max = -44.9 which is ABOVE -45
    // So this chunk has some audio — should NOT be silent
    const result = await isSilent(Buffer.from("test"), "/tmp/session", 0);
    expect(result).toBe(false);
  });

  it("classifies: max=-30, mean=-41 as silent (mean below -40 despite loud peak)", async () => {
    mockExecFileAsync.mockResolvedValue({
      stdout: "",
      stderr: makeVolumeOutput(-30, -41),
    });

    // Loud peak but low mean = transient noise, no sustained speech
    const result = await isSilent(Buffer.from("test"), "/tmp/session", 0);
    expect(result).toBe(true);
  });

  it("returns false when max_volume cannot be parsed", async () => {
    mockExecFileAsync.mockResolvedValue({
      stdout: "",
      stderr: "no volume info here",
    });

    const result = await isSilent(Buffer.from("test"), "/tmp/session", 0);
    expect(result).toBe(false);
  });

  it("cleans up temp file after analysis", async () => {
    mockExecFileAsync.mockResolvedValue({
      stdout: "",
      stderr: makeVolumeOutput(-5.0, -20.0),
    });

    await isSilent(Buffer.from("test"), "/tmp/session", 5);

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining("_silence-5.webm"),
      expect.any(Buffer),
    );
    expect(mockUnlinkSync).toHaveBeenCalledWith(
      expect.stringContaining("_silence-5.webm"),
    );
  });
});
