import { execFile } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { promisify } from "util";
import type { AudioStorage } from "./audio-storage";

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
   */
  async concatenateSession(sessionId: string): Promise<string | null> {
    const chunkFiles = this.audioStorage.getChunkFiles(sessionId);
    if (chunkFiles.length === 0) {
      console.warn(`[AudioConcatenation] No chunks found for session ${sessionId}`);
      return null;
    }

    const sessionDir = this.audioStorage.getSessionDir(sessionId);
    const outputPath = join(sessionDir, "recording.ogg");

    // If output already exists and is newer than all chunks, return it
    if (existsSync(outputPath)) {
      // TODO: Add timestamp comparison to avoid re-concatenating
      return outputPath;
    }

    // Build list of chunk paths
    const chunkPaths = chunkFiles.map((f) => join(sessionDir, f));

    try {
      // Use ffmpeg to concatenate without re-encoding (fastest)
      // Create concat list file
      const concatListPath = join(sessionDir, "concat-list.txt");
      const concatList = chunkPaths.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n");

      const fs = await import("fs/promises");
      await fs.writeFile(concatListPath, concatList, "utf-8");

      // Run ffmpeg concat
      await execFileAsync("ffmpeg", [
        "-f", "concat",
        "-safe", "0",
        "-i", concatListPath,
        "-c", "copy",
        "-y",
        outputPath,
      ]);

      console.log(`[AudioConcatenation] Concatenated ${chunkFiles.length} chunks for session ${sessionId}`);
      return outputPath;
    } catch (err) {
      console.error(`[AudioConcatenation] Failed to concatenate session ${sessionId}:`, err);
      return null;
    }
  }
}
