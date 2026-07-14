import { TranscriptionPipeline } from '@hidock/transcription'
import { insertTranscriptSegment } from './database-queries'
import { saveDatabase } from './database'
import { broadcastToAllWindows } from '../ipc/broadcast'

/**
 * Maximum number of 5-second chunks to retain in the buffer (~60 seconds of audio).
 * When this limit is exceeded the oldest chunks are dropped to prevent unbounded memory growth.
 */
const MAX_BUFFER_CHUNKS = 12

/**
 * AudioTranscriptionBridge accumulates raw audio chunks from the renderer,
 * flushes them through the TranscriptionPipeline on a configurable interval,
 * writes resulting segments to the database, and broadcasts them to all windows.
 */
export class AudioTranscriptionBridge {
  private activeSessionId: string | null = null
  private sessionStartTime: number = 0
  private chunkBuffer: Buffer[] = []
  private firstChunkTimestamp: number = 0
  private flushTimer: NodeJS.Timeout | null = null
  private readonly flushIntervalMs: number
  private isTranscribing: boolean = false
  private pipeline: TranscriptionPipeline | null = null

  constructor(pipeline: TranscriptionPipeline | null, flushIntervalMs = 15_000) {
    this.pipeline = pipeline
    this.flushIntervalMs = flushIntervalMs
  }

  /**
   * Activate the bridge for a session. Starts the periodic flush timer.
   * Throws if the bridge is already active.
   */
  start(sessionId: string, sessionStartTime: number): void {
    if (this.activeSessionId !== null) {
      throw new Error(`AudioTranscriptionBridge already active for session ${this.activeSessionId}`)
    }

    this.activeSessionId = sessionId
    this.sessionStartTime = sessionStartTime
    this.chunkBuffer = []
    this.firstChunkTimestamp = 0
    this.isTranscribing = false

    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => {
        console.error('[AudioTranscriptionBridge] Periodic flush error:', err)
      })
    }, this.flushIntervalMs)

    console.log(`[AudioTranscriptionBridge] Started for session ${sessionId}`)
  }

  /**
   * Append an audio chunk to the buffer.
   * If this is the first chunk it records its timestamp as the window start.
   * Drops oldest chunks when MAX_BUFFER_CHUNKS is exceeded.
   */
  receiveChunk(data: Buffer, timestamp: number): void {
    if (this.activeSessionId === null) return

    if (this.chunkBuffer.length === 0) {
      this.firstChunkTimestamp = timestamp
    }

    this.chunkBuffer.push(data)

    // Max buffer guard: drop oldest chunk(s) to keep at most MAX_BUFFER_CHUNKS
    if (this.chunkBuffer.length > MAX_BUFFER_CHUNKS) {
      const dropped = this.chunkBuffer.length - MAX_BUFFER_CHUNKS
      this.chunkBuffer.splice(0, dropped)
      console.warn(
        `[AudioTranscriptionBridge] Buffer exceeded ${MAX_BUFFER_CHUNKS} chunks — dropped ${dropped} oldest chunk(s)`,
      )
    }
  }

  /**
   * Concatenate buffered chunks and send them through the transcription pipeline.
   * Inserts resulting segments into the database and broadcasts them.
   * Guards against concurrent calls with isTranscribing mutex.
   */
  async flush(): Promise<void> {
    if (this.chunkBuffer.length === 0 || this.isTranscribing) return
    if (!this.activeSessionId) return

    this.isTranscribing = true

    // Snapshot and reset the buffer atomically
    const snapshot = this.chunkBuffer.splice(0)
    const firstTs = this.firstChunkTimestamp
    this.firstChunkTimestamp = 0

    const sessionId = this.activeSessionId
    const sessionStartTime = this.sessionStartTime

    try {
      if (!this.pipeline) {
        console.warn('[AudioTranscriptionBridge] No pipeline configured — skipping flush')
        return
      }

      const audio = Buffer.concat(snapshot)
      const timeOffset = (firstTs - sessionStartTime) / 1000

      const segments = await this.pipeline.collect(audio, {
        source: 'mic',
        timeOffset,
      })

      const dbSegments = segments.map((seg) => {
        return insertTranscriptSegment({
          session_id: sessionId,
          speaker: seg.speaker || undefined,
          text: seg.text,
          start_time: sessionStartTime + seg.startTime * 1000,
          end_time: sessionStartTime + seg.endTime * 1000,
          confidence: seg.confidence,
          source: seg.source,
        })
      })

      if (dbSegments.length > 0) {
        saveDatabase()
        broadcastToAllWindows('transcript:newSegments', dbSegments)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[AudioTranscriptionBridge] Flush error:', message)
      broadcastToAllWindows('transcript:error', { message })
    } finally {
      this.isTranscribing = false
    }
  }

  /**
   * Stop the bridge: clear the periodic timer, perform a final flush, reset state.
   * If the bridge is not active this is a no-op.
   */
  async stop(): Promise<void> {
    if (this.activeSessionId === null) return

    this.clearTimer()

    // Final flush of remaining chunks
    await this.flush()

    this.activeSessionId = null
    this.sessionStartTime = 0
    this.chunkBuffer = []
    this.firstChunkTimestamp = 0

    console.log('[AudioTranscriptionBridge] Stopped')
  }

  /**
   * Full teardown: clear timer, drop buffered data, reset all state.
   * Does not perform a final flush — use stop() before dispose() if data must be saved.
   */
  dispose(): void {
    this.clearTimer()
    this.activeSessionId = null
    this.sessionStartTime = 0
    this.chunkBuffer = []
    this.firstChunkTimestamp = 0
    this.isTranscribing = false
    console.log('[AudioTranscriptionBridge] Disposed')
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private clearTimer(): void {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
  }
}
