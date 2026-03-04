import { existsSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { promisify } from "util";
import { execFile } from "child_process";
// @ts-ignore - ffmpeg-static has no types
import ffmpegPath from "ffmpeg-static";

const execFileAsync = promisify(execFile);

/**
 * Silence detection thresholds (SPEC-002).
 *
 * MAX_SILENCE_THRESHOLD_DB: If peak volume is below this, chunk is definitely silent.
 * MEAN_SILENCE_THRESHOLD_DB: If average energy is below this, no sustained speech present.
 *
 * A chunk is classified as silent if EITHER condition is met:
 *   maxVolume < MAX_SILENCE_THRESHOLD_DB   (-45 dB: no peaks at all)
 *   OR meanVolume < MEAN_SILENCE_THRESHOLD_DB  (-40 dB: low average energy)
 */
export const MAX_SILENCE_THRESHOLD_DB = -45;
export const MEAN_SILENCE_THRESHOLD_DB = -40;

/**
 * Detect if an audio buffer is silent (below threshold).
 * Uses ffmpeg's volumedetect filter to analyze peak and mean volume levels.
 * Returns true if audio is silent (should skip transcription).
 *
 * SPEC-002 REQ-2: Combined detection using both max and mean volume.
 */
export async function isSilent(
  audioBuffer: Buffer,
  sessionDir: string,
  chunkIndex: number,
): Promise<boolean> {
  const tempAnalyze = join(sessionDir, `_silence-${chunkIndex}.webm`);

  try {
    writeFileSync(tempAnalyze, audioBuffer);

    const { stderr } = await execFileAsync(ffmpegPath as string, [
      "-i", tempAnalyze,
      "-af", "volumedetect",
      "-f", "null",
      "-",
    ]);

    const maxVolumeMatch = stderr.match(/max_volume:\s*(-?\d+\.?\d*)\s*dB/);
    const meanVolumeMatch = stderr.match(/mean_volume:\s*(-?\d+\.?\d*|-inf)\s*dB/);

    if (!maxVolumeMatch) {
      console.warn(`[SilenceDetector] Could not parse max_volume for chunk ${chunkIndex}`);
      return false; // If we can't determine, send it anyway (fail open)
    }

    const maxVolume = parseFloat(maxVolumeMatch[1]);
    const meanVolume = meanVolumeMatch?.[1] === "-inf"
      ? -Infinity
      : parseFloat(meanVolumeMatch?.[1] ?? "-Infinity");

    // SPEC-002 REQ-2: Combined silence detection
    // Silent if peak is very low (no audio at all) OR mean energy is low (no sustained speech)
    const isSilentChunk =
      maxVolume < MAX_SILENCE_THRESHOLD_DB ||
      meanVolume < MEAN_SILENCE_THRESHOLD_DB;

    if (isSilentChunk) {
      console.log(
        `[SilenceDetector] Chunk ${chunkIndex} is SILENT (max: ${maxVolume.toFixed(1)}dB, ` +
        `mean: ${meanVolume === -Infinity ? "-inf" : meanVolume.toFixed(1)}dB) — skipping transcription`,
      );
    } else {
      console.log(
        `[SilenceDetector] Chunk ${chunkIndex} has audio (max: ${maxVolume.toFixed(1)}dB, ` +
        `mean: ${meanVolume === -Infinity ? "-inf" : meanVolume.toFixed(1)}dB)`,
      );
    }

    return isSilentChunk;
  } catch (err) {
    console.error(`[SilenceDetector] Failed to analyze silence for chunk ${chunkIndex}:`, err);
    return false; // If analysis fails, send it anyway (fail open)
  } finally {
    try { if (existsSync(tempAnalyze)) unlinkSync(tempAnalyze); } catch { /* ignore */ }
  }
}
