export interface ChunkRecorderOptions {
  timesliceMs?: number               // default 3000
  mimeType?: string                  // default 'audio/webm;codecs=opus'
  backpressureHighWaterMark?: number // default 15
  backpressureLowWaterMark?: number  // default 10
}

export interface AudioChunk {
  index: number
  data: Blob
  timestamp: number
  durationMs: number
  source: 'mic' | 'system' | 'mixed'
}

export type ChunkRecorderEventMap = {
  chunk: AudioChunk
  error: Error
  stop: void
}

type Listener<K extends keyof ChunkRecorderEventMap> = (data: ChunkRecorderEventMap[K]) => void

const CANDIDATE_MIME_TYPES = [
  'audio/ogg;codecs=opus',
  'audio/webm;codecs=opus',
  'audio/webm',
]

export class ChunkRecorder {
  static readonly DEFAULT_TIMESLICE_MS = 3000
  static readonly DEFAULT_MIME_TYPE = 'audio/webm;codecs=opus'
  static readonly DEFAULT_BACKPRESSURE_HIGH_WATER_MARK = 15
  static readonly DEFAULT_BACKPRESSURE_LOW_WATER_MARK = 10

  private recorder: MediaRecorder | null = null
  private chunkIndex = 0
  private lastChunkTimestamp = 0
  private pendingChunks = 0
  private paused = false
  private disposed = false
  private listeners: { [K in keyof ChunkRecorderEventMap]?: Set<Listener<K>> } = {}
  private source: 'mic' | 'system' | 'mixed' = 'mixed'
  private stopResolve: (() => void) | null = null

  constructor(private readonly options: ChunkRecorderOptions = {}) {}

  async start(mediaStream: MediaStream, source: 'mic' | 'system' | 'mixed' = 'mixed'): Promise<void> {
    if (this.disposed) {
      throw new Error('ChunkRecorder has been disposed')
    }
    if (this.recorder) {
      throw new Error('ChunkRecorder is already recording')
    }

    this.source = source
    this.chunkIndex = 0
    this.pendingChunks = 0
    this.paused = false

    const mimeType = this.options.mimeType ?? this.selectMimeType()
    const timeslice = this.options.timesliceMs ?? ChunkRecorder.DEFAULT_TIMESLICE_MS

    this.recorder = new MediaRecorder(mediaStream, { mimeType })
    this.lastChunkTimestamp = Date.now()

    this.recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size === 0) return

      const now = Date.now()
      const chunk: AudioChunk = {
        index: this.chunkIndex++,
        data: event.data,
        timestamp: now,
        durationMs: now - this.lastChunkTimestamp,
        source: this.source,
      }
      this.lastChunkTimestamp = now
      this.pendingChunks++

      this.emit('chunk', chunk)

      // Backpressure: pause if too many pending chunks
      const highWaterMark = this.options.backpressureHighWaterMark
        ?? ChunkRecorder.DEFAULT_BACKPRESSURE_HIGH_WATER_MARK
      if (this.pendingChunks >= highWaterMark && this.recorder?.state === 'recording') {
        this.recorder.pause()
        this.paused = true
      }
    }

    this.recorder.onerror = (event: Event) => {
      const error = (event as ErrorEvent).error ?? new Error('MediaRecorder error')
      this.emit('error', error)
    }

    this.recorder.onstop = () => {
      this.emit('stop', undefined as unknown as void)
      if (this.stopResolve) {
        this.stopResolve()
        this.stopResolve = null
      }
    }

    this.recorder.start(timeslice)
  }

  stop(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this.recorder || this.recorder.state === 'inactive') {
        resolve()
        return
      }

      this.stopResolve = resolve
      this.recorder.stop()
    })
  }

  acknowledgeChunk(): void {
    if (this.pendingChunks > 0) {
      this.pendingChunks--
    }

    const lowWaterMark = this.options.backpressureLowWaterMark
      ?? ChunkRecorder.DEFAULT_BACKPRESSURE_LOW_WATER_MARK
    if (this.paused && this.pendingChunks <= lowWaterMark && this.recorder?.state === 'paused') {
      this.recorder.resume()
      this.paused = false
    }
  }

  dispose(): void {
    this.disposed = true
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.stop()
    }
    this.recorder = null
    this.listeners = {}
  }

  on<K extends keyof ChunkRecorderEventMap>(
    event: K,
    listener: Listener<K>,
  ): this {
    if (!this.listeners[event]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.listeners as any)[event] = new Set()
    }
    this.listeners[event]!.add(listener)
    return this
  }

  off<K extends keyof ChunkRecorderEventMap>(
    event: K,
    listener: Listener<K>,
  ): this {
    this.listeners[event]?.delete(listener)
    return this
  }

  private emit<K extends keyof ChunkRecorderEventMap>(
    event: K,
    data: ChunkRecorderEventMap[K],
  ): void {
    const listeners = this.listeners[event]
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(data)
        } catch {
          // Don't let listener errors break the recorder
        }
      }
    }
  }

  private selectMimeType(): string {
    for (const mime of CANDIDATE_MIME_TYPES) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) {
        return mime
      }
    }
    return ChunkRecorder.DEFAULT_MIME_TYPE
  }
}
