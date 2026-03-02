export enum AudioRecorderState {
  Idle = "idle",
  Recording = "recording",
  Paused = "paused",
}

export interface AudioRecorderOptions {
  onChunk?: (blob: Blob, chunkIndex: number) => void;
  onError?: (error: Error) => void;
  maxQueueSize?: number;
  timesliceMs?: number;
}

const PREFERRED_MIME_TYPES = [
  "audio/ogg;codecs=opus",
  "audio/webm;codecs=opus",
  "audio/webm",
];

export class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private state: AudioRecorderState = AudioRecorderState.Idle;
  private chunkIndex = 0;
  private pendingChunks = 0;
  private mimeType: string = "";
  private onChunk?: (blob: Blob, chunkIndex: number) => void;
  private onError?: (error: Error) => void;
  private maxQueueSize: number;
  private pauseThreshold: number;
  private resumeThreshold: number;
  private timesliceMs: number;
  /** Set to true when dispose() is called; prevents async getUserMedia from starting a zombie recorder. */
  private disposed = false;
  /** Resolves when MediaRecorder's onstop event fires (after final ondataavailable). */
  private stoppedPromise: Promise<void> | null = null;
  private stoppedResolve: (() => void) | null = null;

  constructor(options: AudioRecorderOptions = {}) {
    this.onChunk = options.onChunk;
    this.onError = options.onError;
    this.maxQueueSize = options.maxQueueSize ?? 20;
    this.pauseThreshold = 15;
    this.resumeThreshold = 10;
    this.timesliceMs = options.timesliceMs ?? 3000;
  }

  async startRecording(): Promise<void> {
    if (this.state !== AudioRecorderState.Idle) {
      throw new Error(`Cannot start recording in state: ${this.state}`);
    }
    if (this.disposed) {
      console.warn('[AudioRecorder] startRecording called on disposed recorder, ignoring');
      return;
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    // After the async getUserMedia, check if we were disposed during the await
    // (React Strict Mode unmounts between mount and remount, so the first
    // recorder's getUserMedia resolves after dispose() was called)
    if (this.disposed) {
      console.warn('[AudioRecorder] Disposed during getUserMedia, releasing stream and aborting');
      this.releaseStream();
      return;
    }

    this.mimeType = this.selectMimeType();
    this.chunkIndex = 0;
    this.pendingChunks = 0;

    // Create a promise that resolves when onstop fires (after final ondataavailable)
    this.stoppedPromise = new Promise<void>((resolve) => {
      this.stoppedResolve = resolve;
    });

    this.mediaRecorder = new MediaRecorder(this.stream, {
      mimeType: this.mimeType,
    });

    this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
      console.log(`[AudioRecorder] ondataavailable fired: size=${event.data.size}, type=${event.data.type}`);
      if (event.data.size === 0) {
        console.warn('[AudioRecorder] Empty chunk, skipping');
        return;
      }

      if (this.pendingChunks >= this.maxQueueSize) {
        console.warn(
          `[AudioRecorder] Queue full (${this.pendingChunks}/${this.maxQueueSize}), dropping chunk`,
        );
        return;
      }

      const idx = this.chunkIndex++;
      this.pendingChunks++;
      console.log(`[AudioRecorder] Sending chunk ${idx} (${event.data.size} bytes) to onChunk callback`);
      this.onChunk?.(event.data, idx);

      if (
        this.pendingChunks >= this.pauseThreshold &&
        this.mediaRecorder?.state === "recording"
      ) {
        console.warn(
          `[AudioRecorder] Backpressure: pausing at ${this.pendingChunks} pending chunks`,
        );
        this.mediaRecorder.pause();
        this.state = AudioRecorderState.Paused;
      }
    };

    this.mediaRecorder.onerror = (event: Event) => {
      console.error('[AudioRecorder] MediaRecorder error event:', event);
      const error =
        event instanceof ErrorEvent
          ? event.error
          : new Error("MediaRecorder error");
      this.onError?.(error);
    };

    this.mediaRecorder.onstop = () => {
      console.log('[AudioRecorder] MediaRecorder stopped, releasing stream');
      this.releaseStream();
      // Resolve the stoppedPromise so waitForAllChunksAcked knows the final
      // ondataavailable has already fired (onstop fires AFTER it)
      this.stoppedResolve?.();
      this.stoppedResolve = null;
    };

    console.log(`[AudioRecorder] Starting MediaRecorder with timeslice=${this.timesliceMs}ms, mimeType=${this.mimeType}`);
    this.mediaRecorder.start(this.timesliceMs);
    this.state = AudioRecorderState.Recording;
    console.log(`[AudioRecorder] MediaRecorder state: ${this.mediaRecorder.state}`);
  }

  stopRecording(): void {
    console.log(`[AudioRecorder] stopRecording() called. mediaRecorder state: ${this.mediaRecorder?.state}, our state: ${this.state}`);
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      console.log('[AudioRecorder] Calling mediaRecorder.stop() - this should trigger final ondataavailable');
      this.mediaRecorder.stop();
    } else {
      console.warn('[AudioRecorder] mediaRecorder already inactive or null, no final chunk will be produced');
    }
    this.state = AudioRecorderState.Idle;
  }

  /**
   * Returns a Promise that resolves when all pending chunks have been ACK'd.
   * First waits for MediaRecorder's onstop event (which fires AFTER the final
   * ondataavailable), ensuring pendingChunks reflects the true final count.
   * Has a safety timeout to prevent hanging forever.
   */
  async waitForAllChunksAcked(timeoutMs: number = 5000): Promise<void> {
    // Step 1: Wait for MediaRecorder to fully stop. The onstop event fires
    // AFTER the final ondataavailable, so once this resolves we know
    // pendingChunks includes the final chunk.
    if (this.stoppedPromise) {
      console.log('[AudioRecorder] waitForAllChunksAcked: waiting for MediaRecorder onstop...');
      await Promise.race([
        this.stoppedPromise,
        new Promise<void>((r) => setTimeout(r, Math.min(timeoutMs, 3000))),
      ]);
      console.log(`[AudioRecorder] waitForAllChunksAcked: onstop resolved, pendingChunks=${this.pendingChunks}`);
    }

    // Step 2: Poll until all chunks are ACK'd by the main process
    if (this.pendingChunks <= 0) {
      console.log('[AudioRecorder] waitForAllChunksAcked: no pending chunks, done');
      return;
    }

    console.log(`[AudioRecorder] waitForAllChunksAcked: polling for ${this.pendingChunks} pending chunks...`);
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.pendingChunks <= 0) {
          clearInterval(checkInterval);
          clearTimeout(timeout);
          console.log('[AudioRecorder] waitForAllChunksAcked: all chunks ACK\'d');
          resolve();
        }
      }, 50);

      const timeout = setTimeout(() => {
        clearInterval(checkInterval);
        console.warn(`[AudioRecorder] waitForAllChunksAcked timed out after ${timeoutMs}ms with ${this.pendingChunks} pending`);
        resolve();
      }, timeoutMs);
    });
  }

  /**
   * Permanently dispose this recorder instance. Used by React cleanup to prevent
   * a zombie recorder from starting after an async getUserMedia resolves.
   */
  dispose(): void {
    console.log(`[AudioRecorder] dispose() called, state=${this.state}, disposed=${this.disposed}`);
    this.disposed = true;
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop();
    } else {
      // No active MediaRecorder - release stream directly and resolve promise
      this.releaseStream();
      this.stoppedResolve?.();
      this.stoppedResolve = null;
    }
    this.state = AudioRecorderState.Idle;
  }

  getState(): AudioRecorderState {
    return this.state;
  }

  getMimeType(): string {
    return this.mimeType;
  }

  getPendingChunkCount(): number {
    return this.pendingChunks;
  }

  acknowledgeChunk(): void {
    if (this.pendingChunks > 0) {
      this.pendingChunks--;
    }

    if (
      this.state === AudioRecorderState.Paused &&
      this.pendingChunks <= this.resumeThreshold &&
      this.mediaRecorder?.state === "paused"
    ) {
      console.log(
        `[AudioRecorder] Backpressure relieved: resuming at ${this.pendingChunks} pending chunks`,
      );
      this.mediaRecorder.resume();
      this.state = AudioRecorderState.Recording;
    }
  }

  private selectMimeType(): string {
    for (const mime of PREFERRED_MIME_TYPES) {
      if (MediaRecorder.isTypeSupported(mime)) {
        return mime;
      }
    }
    return "audio/webm";
  }

  private releaseStream(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
  }
}
