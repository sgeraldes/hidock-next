import { execFile } from "child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { promisify } from "util";
import type { AudioStorage } from "./audio-storage";
// @ts-ignore - ffmpeg-static has no types
import ffmpegPath from "ffmpeg-static";

const execFileAsync = promisify(execFile);

// FIX PLY-002: Audio concatenation service
export class AudioConcatenation {
  private audioStorage: AudioStorage;

  constructor(audioStorage: AudioStorage) {
    this.audioStorage = audioStorage;
  }

  /**
   * Concatenate all audio chunks for a session into a single playable file.
   * Returns the path to the concatenated file, or null if no chunks exist.
   *
   * Two-step process:
   * 1. Binary-concatenate all timeslice chunks (they're fragments of one WebM stream)
   * 2. Re-mux with ffmpeg to add proper Duration metadata (required for seekable playback)
   *
   * Why: MediaRecorder timeslice chunks lack individual headers (only chunk 0 has EBML header),
   * and the Segment has "unknown" size (streaming mode). Without re-muxing, <audio> shows 0:00
   * because there's no Duration element in the header.
   */
  async concatenateSession(sessionId: string): Promise<string | null> {
    const chunkFiles = this.audioStorage.getChunkFiles(sessionId);
    if (chunkFiles.length === 0) {
      console.warn(`[AudioConcatenation] No chunks found for session ${sessionId}`);
      return null;
    }

    const sessionDir = this.audioStorage.getSessionDir(sessionId);
    const outputPath = join(sessionDir, "recording.webm");
    const rawPath = join(sessionDir, "recording-raw.webm");

    // Always re-concatenate: delete stale outputs
    for (const stale of [outputPath, rawPath, join(sessionDir, "recording.ogg"), join(sessionDir, "concat-list.txt")]) {
      if (existsSync(stale)) {
        try { unlinkSync(stale); } catch { /* ignore */ }
      }
    }

    const chunkPaths = chunkFiles.map((f) => join(sessionDir, f));

    try {
      // Step 1: Binary-concatenate all chunks into a raw WebM stream
      const buffers: Buffer[] = [];
      let totalBytes = 0;
      for (const chunkPath of chunkPaths) {
        const buf = readFileSync(chunkPath);
        buffers.push(buf);
        totalBytes += buf.length;
      }

      const combined = Buffer.concat(buffers, totalBytes);
      writeFileSync(rawPath, combined);
      console.log(
        `[AudioConcatenation] Binary-concatenated ${chunkFiles.length} chunks ` +
        `(${totalBytes} bytes) for session ${sessionId}`,
      );

      // Step 2: Re-mux with ffmpeg to add Duration metadata and fix Segment size
      // This makes the file seekable and gives <audio> a proper duration
      await execFileAsync(ffmpegPath, [
        "-i", rawPath,
        "-c", "copy",   // no re-encoding, just re-mux
        "-y",
        outputPath,
      ]);

      // Clean up raw temp file
      try { unlinkSync(rawPath); } catch { /* ignore */ }

      console.log(
        `[AudioConcatenation] Re-muxed recording.webm with duration metadata for session ${sessionId}`,
      );
      return outputPath;
    } catch (err) {
      console.error(`[AudioConcatenation] Failed to concatenate session ${sessionId}:`, err);
      // If ffmpeg re-mux failed but raw file exists, use it as fallback
      if (existsSync(rawPath) && !existsSync(outputPath)) {
        try {
          const { renameSync } = require("fs");
          renameSync(rawPath, outputPath);
          console.warn(`[AudioConcatenation] Using raw concatenation as fallback (no duration metadata)`);
          return outputPath;
        } catch { /* ignore */ }
      }
      return null;
    }
  }
}
