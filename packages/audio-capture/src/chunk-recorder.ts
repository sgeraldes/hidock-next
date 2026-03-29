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

export class ChunkRecorder {
  static readonly DEFAULT_TIMESLICE_MS = 3000
  static readonly DEFAULT_MIME_TYPE = 'audio/webm;codecs=opus'
  static readonly DEFAULT_BACKPRESSURE_HIGH_WATER_MARK = 15
  static readonly DEFAULT_BACKPRESSURE_LOW_WATER_MARK = 10

  constructor(private readonly options: ChunkRecorderOptions = {}) {}

  start(_source: unknown): Promise<void> {
    throw new Error('not implemented')
  }

  stop(): Promise<void> {
    throw new Error('not implemented')
  }

  on<K extends keyof ChunkRecorderEventMap>(
    _event: K,
    _listener: (data: ChunkRecorderEventMap[K]) => void
  ): this {
    throw new Error('not implemented')
  }

  off<K extends keyof ChunkRecorderEventMap>(
    _event: K,
    _listener: (data: ChunkRecorderEventMap[K]) => void
  ): this {
    throw new Error('not implemented')
  }
}
