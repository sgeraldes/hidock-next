import { ChildProcess, spawn } from "child_process";
// @ts-ignore - ffmpeg-static has no types
import ffmpegPath from "ffmpeg-static";

/** Timeout (ms) to wait for ffmpeg to exit after stdin.end() before force-killing. */
const FFMPEG_EXIT_TIMEOUT_MS = 3000;

/**
 * Persistent ffmpeg process that converts incoming WebM/Opus audio to
 * raw LINEAR16 PCM suitable for Google Cloud Speech-to-Text streaming.
 *
 * Input: WebM/Opus chunks written to stdin
 * Output: 16kHz mono 16-bit LE PCM on stdout in ~100ms frames
 */
export class AudioConverter {
  private process: ChildProcess | null = null;
  private onPcmData: ((data: Buffer) => void) | null = null;
  private onError: ((error: Error) => void) | null = null;
  private started = false;
  private killTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Start the ffmpeg conversion process.
   *
   * @param _inputMimeType - MIME type of the input audio (reserved for future use;
   *   currently ffmpeg auto-detects from stream headers, which is more robust for pipes)
   * @param onPcmData - Callback fired with each chunk of PCM output
   * @param onError - Callback fired on process errors
   */
  start(
    _inputMimeType: string,
    onPcmData: (data: Buffer) => void,
    onError?: (error: Error) => void,
  ): void {
    if (this.started) return;

    // Guard: ensure ffmpeg binary is available
    if (!ffmpegPath) {
      const err = new Error(
        "ffmpeg binary not found (ffmpeg-static resolved to null). " +
          "Streaming transcription requires ffmpeg. " +
          "Reinstall: npm install ffmpeg-static",
      );
      console.error("[AudioConverter]", err.message);
      onError?.(err);
      return;
    }

    this.onPcmData = onPcmData;
    this.onError = onError ?? null;

    // ffmpeg auto-detects input format from stream headers (WebM/Matroska).
    // Omitting -f for input is the most robust approach for piped input.
    this.process = spawn(ffmpegPath, [
      "-i", "pipe:0",           // Read from stdin (auto-detect format from stream headers)
      "-acodec", "pcm_s16le",   // Output: signed 16-bit little-endian PCM
      "-ar", "16000",           // Output sample rate: 16kHz
      "-ac", "1",               // Output channels: mono
      "-f", "s16le",            // Output format: raw PCM (no container)
      "pipe:1",                 // Write to stdout
    ]);

    this.process.stdout?.on("data", (chunk: Buffer) => {
      this.onPcmData?.(chunk);
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      // ffmpeg writes progress/info to stderr; only log errors
      const msg = data.toString();
      if (msg.includes("Error") || msg.includes("error")) {
        console.error("[AudioConverter] ffmpeg stderr:", msg);
      }
    });

    this.process.on("error", (err) => {
      console.error("[AudioConverter] Process error:", err);
      this.onError?.(err);
    });

    this.process.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        console.warn(`[AudioConverter] ffmpeg exited with code ${code}`);
      }
      this.started = false;
      // Clear the kill timer if ffmpeg exited naturally
      if (this.killTimer) {
        clearTimeout(this.killTimer);
        this.killTimer = null;
      }
    });

    this.started = true;
    console.log(
      "[AudioConverter] Started ffmpeg (input: auto-detect, output: s16le 16kHz mono)",
    );
  }

  /**
   * Write a WebM/Opus chunk to the converter.
   * PCM output will arrive via the onPcmData callback.
   */
  write(data: Buffer): void {
    if (!this.process || !this.started) {
      console.warn("[AudioConverter] Cannot write: process not started");
      return;
    }

    try {
      this.process.stdin?.write(data);
    } catch (err) {
      console.error("[AudioConverter] Write error:", err);
      this.onError?.(
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }

  /**
   * Signal end of input and stop the converter.
   *
   * Cross-platform strategy:
   * 1. Close stdin — ffmpeg will flush remaining output and exit naturally.
   * 2. Set a timeout: if ffmpeg hasn't exited after FFMPEG_EXIT_TIMEOUT_MS,
   *    force-kill it. On Windows, SIGTERM is equivalent to TerminateProcess()
   *    so there's no graceful intermediate signal; we rely on stdin.end()
   *    for the graceful path.
   */
  stop(): void {
    if (!this.process) return;

    try {
      this.process.stdin?.end();
    } catch {
      /* ignore */
    }

    // Safety net: force kill if ffmpeg hasn't exited after timeout
    const proc = this.process;
    this.killTimer = setTimeout(() => {
      if (proc && !proc.killed) {
        console.warn("[AudioConverter] Force-killing ffmpeg (did not exit after stdin.end())");
        proc.kill("SIGKILL");
      }
      this.process = null;
      this.started = false;
    }, FFMPEG_EXIT_TIMEOUT_MS);
  }

  isStarted(): boolean {
    return this.started;
  }
}
