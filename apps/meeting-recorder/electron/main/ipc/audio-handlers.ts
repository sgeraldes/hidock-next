import { IpcMainEvent, ipcMain } from "electron";
import { execFile } from "child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { promisify } from "util";
// @ts-ignore - ffmpeg-static has no types
import ffmpegPath from "ffmpeg-static";
import { AudioStorage } from "../services/audio-storage";
import { AudioConcatenation } from "../services/audio-concatenation";
import { MicDetector, MicStatus } from "../services/mic-detector";
import { getSetting, updateSession, getSession } from "../services/database";
import { getPipeline } from "./transcription-handlers";
import { getSessionManager } from "./session-handlers";
import { PerformanceMonitor } from "../services/performance-monitor";
import { isSilent } from "../services/silence-detector";

const execFileAsync = promisify(execFile);

const audioStorage = new AudioStorage();
const audioConcatenation = new AudioConcatenation(audioStorage);
const micDetector = new MicDetector();

/**
 * Cumulative audio buffers per session. As chunks arrive, they're appended
 * to build a valid WebM stream. For transcription of chunk N > 0, we extract
 * just the last timeslice from the cumulative stream via ffmpeg.
 *
 * Why: WebM timeslice chunks are NOT standalone files. Only chunk 0 has the
 * EBML header + Segment + Tracks. Chunks 1+ are raw byte-stream continuations
 * that don't even start at element boundaries. Prepending the init segment
 * does NOT work. The only way to get valid audio for chunk N is to reconstruct
 * the full stream (chunks 0..N) and extract the tail via ffmpeg.
 */
const cumulativeBuffers = new Map<string, Buffer>();

/**
 * Tracks session IDs that have been stopped/ended. Used to guard against the
 * race condition where an async chunk-processing IIFE is still in-flight when
 * session:end fires — the pipeline gets destroyed but the IIFE still holds a
 * stale reference and would try to write segments to a finished session.
 *
 * Entries are cleaned up after 30 seconds to prevent unbounded growth.
 */
const stoppedSessions = new Set<string>();
const STOPPED_SESSION_CLEANUP_MS = 30_000;

/** Must match AudioRecorder.timesliceMs (default 3000). */
const TIMESLICE_MS = 3000;

// Silence detection moved to ../services/silence-detector.ts (SPEC-002)

/**
 * Extract the last timeslice of audio from the cumulative WebM stream.
 * Writes the cumulative buffer to a temp file, uses ffmpeg to seek to
 * the chunk's start time and copy packets from there, producing a valid
 * standalone audio file for the AI to transcribe.
 */
async function extractChunkAudio(
  cumulativeBuffer: Buffer,
  chunkIndex: number,
  sessionDir: string,
): Promise<Buffer | null> {
  const tempInput = join(sessionDir, `_transc-in-${chunkIndex}.webm`);
  const tempOutput = join(sessionDir, `_transc-out-${chunkIndex}.webm`);

  try {
    writeFileSync(tempInput, cumulativeBuffer);

    const startSeconds = (chunkIndex * TIMESLICE_MS) / 1000;

    await execFileAsync(ffmpegPath as string, [
      "-i", tempInput,
      "-ss", String(startSeconds),
      "-c", "copy",
      "-y",
      tempOutput,
    ]);

    if (!existsSync(tempOutput)) {
      console.warn(`[AudioHandlers] ffmpeg produced no output for chunk ${chunkIndex}`);
      return null;
    }

    const extracted = readFileSync(tempOutput);
    if (extracted.length === 0) {
      console.warn(`[AudioHandlers] ffmpeg produced empty output for chunk ${chunkIndex}`);
      return null;
    }

    console.log(
      `[AudioHandlers] Extracted ${extracted.length} bytes for chunk ${chunkIndex} ` +
      `transcription (from ${startSeconds}s onward)`,
    );
    return extracted;
  } catch (err) {
    console.error(`[AudioHandlers] Failed to extract chunk ${chunkIndex}:`, err);
    return null;
  } finally {
    try { if (existsSync(tempInput)) unlinkSync(tempInput); } catch { /* ignore */ }
    try { if (existsSync(tempOutput)) unlinkSync(tempOutput); } catch { /* ignore */ }
  }
}

import { broadcastToAllWindows } from "../services/broadcast";

export function registerAudioHandlers(): void {
  // Provide audio concatenation to session manager for automatic finalization
  const sessionManager = getSessionManager();
  sessionManager.setAudioConcatenation(audioConcatenation);

  ipcMain.on(
    "audio:chunk",
    (
      event: IpcMainEvent,
      data: ArrayBuffer,
      sessionId: string,
      chunkIndex: number,
      mimeType: string,
    ) => {
      const perfMonitor = new PerformanceMonitor(sessionId, chunkIndex);
      perfMonitor.mark('chunk-arrival');

      console.log(`[AudioHandlers] Received chunk ${chunkIndex} for session ${sessionId}: ${data?.byteLength ?? 0} bytes, mime=${mimeType}`);
      try {
        const buffer = Buffer.from(data);
        audioStorage.saveChunk(sessionId, chunkIndex, buffer);

        perfMonitor.mark('chunk-saved');
        perfMonitor.logStage('Chunk save', 'chunk-arrival', 'chunk-saved');

        event.sender.send("audio:chunkAck", { sessionId, chunkIndex });

        const pipeline = getPipeline(sessionId);
        if (pipeline) {
          if (pipeline.isStreaming()) {
            // Streaming mode: feed audio directly to the pipeline.
            // No cumulative buffer, no ffmpeg extraction, no silence detection needed.
            // The Chirp 3 stream handles all of this internally.
            pipeline.feedAudioStream(buffer, mimeType);
          } else {
            // Batch mode: existing cumulative buffer + ffmpeg extraction logic
            // Transcription: each chunk sent to the AI must be a valid, decodable audio file.
            // Chunk 0 is a complete WebM (EBML header + Segment + Tracks + Cluster) — send directly.
            // Chunks 1+ are raw byte-stream continuations with NO headers and NO element boundary
            // alignment. We cumulative-concat chunks 0..N, then ffmpeg-extract from N*3s onward
            // to produce a valid standalone audio clip for the AI.
            (async () => {
            try {
              let transcriptionBuffer: Buffer;

              if (chunkIndex === 0) {
                cumulativeBuffers.set(sessionId, buffer);
                transcriptionBuffer = buffer;
                perfMonitor.mark('chunk-direct-ready');
                perfMonitor.logStage('Chunk 0 direct ready', 'chunk-saved', 'chunk-direct-ready');
                console.log(`[AudioHandlers] Chunk 0: sending ${buffer.length} bytes directly for transcription`);
              } else {
                const prev = cumulativeBuffers.get(sessionId);
                const cumulative = prev
                  ? Buffer.concat([prev, buffer])
                  : buffer;
                cumulativeBuffers.set(sessionId, cumulative);

                const sessionDir = audioStorage.getSessionDir(sessionId);
                perfMonitor.mark('extract-start');
                const extracted = await extractChunkAudio(cumulative, chunkIndex, sessionDir);
                perfMonitor.mark('extract-end');
                perfMonitor.logStage('FFmpeg extraction', 'extract-start', 'extract-end');

                if (!extracted) {
                  console.warn(`[AudioHandlers] Skipping transcription for chunk ${chunkIndex} (extraction failed)`);
                  return;
                }
                transcriptionBuffer = extracted;
              }

              // Silence detection: skip transcription if audio is silent
              // This prevents wasting API tokens and avoids AI hallucinations on silent chunks
              const sessionDir = audioStorage.getSessionDir(sessionId);
              perfMonitor.mark('silence-check-start');
              const silent = await isSilent(transcriptionBuffer, sessionDir, chunkIndex);
              perfMonitor.mark('silence-check-end');
              perfMonitor.logStage('Silence detection', 'silence-check-start', 'silence-check-end');

              if (silent) {
                console.log(`[AudioHandlers] Skipping transcription for chunk ${chunkIndex} (silent audio detected)`);
                return;
              }

              // Guard: session may have ended while extraction/silence-detection was in-flight
              if (stoppedSessions.has(sessionId)) {
                console.log(
                  `[AudioHandlers] Session ${sessionId} was stopped during async chunk processing — ` +
                  `skipping transcription for chunk ${chunkIndex}`,
                );
                return;
              }

              perfMonitor.mark('pipeline-start');
              await pipeline.processAudioChunk(transcriptionBuffer, mimeType, chunkIndex);
              perfMonitor.mark('pipeline-end');
              perfMonitor.logStage('Pipeline processing', 'pipeline-start', 'pipeline-end');

              // Total end-to-end timing
              perfMonitor.logTotal();
            } catch (err: unknown) {
              console.error("[AudioHandlers] Pipeline error:", err);
              // Propagate pipeline errors to renderer (ERR-003)
              event.sender.send("audio:chunkError", {
                sessionId,
                chunkIndex,
                error: err instanceof Error ? err.message : "Pipeline error",
              });
            }
            })();
          }
        }
      } catch (err) {
        console.error("[AudioHandlers] Failed to save chunk:", err);
        // Propagate storage errors to renderer (ERR-003)
        event.sender.send("audio:chunkError", {
          sessionId,
          chunkIndex,
          error: err instanceof Error ? err.message : "Failed to save audio chunk",
        });
      }
    },
  );

  // FIX PLY-001: Get audio path for playback
  ipcMain.handle("audio:getPath", async (_, sessionId: string) => {
    try {
      // First check if session already has audio_path stored
      const session = getSession(sessionId);

      if (session?.audio_path) {
        // Return existing path if file still exists
        if (existsSync(session.audio_path)) {
          return session.audio_path;
        }
      }

      // Otherwise, concatenate chunks now
      const audioPath = await audioConcatenation.concatenateSession(sessionId);
      if (audioPath) {
        // Update database with audio path
        updateSession(sessionId, { audio_path: audioPath });
      }
      return audioPath;
    } catch (err) {
      console.error("[AudioHandlers] Failed to get audio path:", err);
      return null;
    }
  });

  // FIX PLY-002: Read audio file as buffer for renderer playback
  // Electron blocks file:// URLs in the renderer, so we serve audio data via IPC
  ipcMain.handle("audio:readFile", async (_, sessionId: string) => {
    try {
      const session = getSession(sessionId);

      let audioPath = session?.audio_path;

      // If no audio_path or file doesn't exist, try to (re)concatenate
      if (!audioPath || !existsSync(audioPath)) {
        audioPath = await audioConcatenation.concatenateSession(sessionId);
        if (audioPath) {
          updateSession(sessionId, { audio_path: audioPath });
        }
      }

      if (!audioPath || !existsSync(audioPath)) {
        return null;
      }

      const buffer = readFileSync(audioPath);
      // Determine mime type from extension
      const ext = audioPath.split('.').pop()?.toLowerCase();
      const mimeType = ext === 'ogg' ? 'audio/ogg'
        : ext === 'webm' ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      return { data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), mimeType };
    } catch (err) {
      console.error("[AudioHandlers] Failed to read audio file:", err);
      return null;
    }
  });

  micDetector.start(async (status: MicStatus) => {
    broadcastToAllWindows("audio:micStatus", status);
    const autoRecordSetting = getSetting("recording.autoRecord");
    const autoRecordEnabled = autoRecordSetting !== "false";
    if (autoRecordEnabled) {
      await getSessionManager().onMicStatusChange(status);
    }
  });
}

export function stopMicDetector(): void {
  micDetector.stop();
}

export function getAudioStorage(): AudioStorage {
  return audioStorage;
}

/**
 * Mark a session as stopped so in-flight async chunk processing can bail out
 * before calling pipeline.processAudioChunk() on a destroyed pipeline.
 * Call this from the session-ending lifecycle callback BEFORE stopping the pipeline.
 */
export function markSessionStopped(sessionId: string): void {
  stoppedSessions.add(sessionId);
  setTimeout(() => {
    stoppedSessions.delete(sessionId);
  }, STOPPED_SESSION_CLEANUP_MS);
}

/** Clean up audio caches when a session ends. */
export function clearSessionInitSegment(sessionId: string): void {
  cumulativeBuffers.delete(sessionId);
}
