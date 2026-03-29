import type { TranscriptionEngine, TranscriptSegment, TranscribeOptions } from './engine-interface.js'

/**
 * CohereEngine — local, non-streaming transcription engine.
 * Stub implementation: yields a single placeholder segment.
 */
export class CohereEngine implements TranscriptionEngine {
  readonly isStreaming = false
  readonly isLocal = true

  async *transcribe(audio: Buffer, options: TranscribeOptions): AsyncIterable<TranscriptSegment> {
    // Stub: resolve the full buffer then yield one segment
    const durationSeconds = audio.length / (16000 * 2) // assume 16 kHz 16-bit mono
    const timeOffset = options.timeOffset ?? 0

    yield {
      speaker: options.source === 'mic' ? 'you' : 'them',
      text: '',
      startTime: timeOffset,
      endTime: timeOffset + durationSeconds,
      confidence: 1,
      source: options.source
    }
  }
}
