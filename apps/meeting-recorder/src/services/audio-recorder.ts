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

  constructor(options: AudioRecorderOptions = {}) {
    this.onChunk = options.onChunk;
    this.onError = options.onError;
    this.maxQueueSize = options.maxQueueSize ?? 20;
    this.pauseThreshold = 15;
    this.resumeThreshold = 10;
    this.timesliceMs = options.timesliceMs ?? 15000;
  }

  async startRecording(): Promise<void> {
    if (this.state !== AudioRecorderState.Idle) {
      throw new Error(`Cannot start recording in state: ${this.state}`);
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    this.mimeType = this.selectMimeType();
    this.chunkIndex = 0;
    this.pendingChunks = 0;

    this.mediaRecorder = new MediaRecorder(this.stream, {
      mimeType: this.mimeType,
    });

    this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size === 0) return;

      if (this.pendingChunks >= this.maxQueueSize) {
        console.warn(
          `[AudioRecorder] Queue full (${this.pendingChunks}/${this.maxQueueSize}), dropping chunk`,
        );
        return;
      }

      const idx = this.chunkIndex++;
      this.pendingChunks++;
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
      const error =
        event instanceof ErrorEvent
          ? event.error
          : new Error("MediaRecorder error");
      this.onError?.(error);
    };

    this.mediaRecorder.onstop = () => {
      this.releaseStream();
    };

    this.mediaRecorder.start(this.timesliceMs);
    this.state = AudioRecorderState.Recording;
  }

  stopRecording(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop();
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
