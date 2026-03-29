import type { TranscriptionEngine, TranscriptSegment, TranscribeOptions } from './engine-interface.js'

/**
 * Chirp3Engine — cloud-based, streaming transcription engine.
 * Stub implementation: yields segments as they would arrive from the cloud API.
 */
export class Chirp3Engine implements TranscriptionEngine {
  readonly isStreaming = true
  readonly isLocal = false

  async *transcribe(audio: Buffer, options: TranscribeOptions): AsyncIterable<TranscriptSegment> {
    // Stub: simulate streaming by yielding one segment per 5-second chunk
    const bytesPerSecond = 16000 * 2 // 16 kHz 16-bit mono
    const chunkDuration = 5
    const chunkSize = bytesPerSecond * chunkDuration
    const timeOffset = options.timeOffset ?? 0

    let offset = 0
    let chunkIndex = 0

    while (offset < audio.length) {
      const end = Math.min(offset + chunkSize, audio.length)
      const chunkSeconds = (end - offset) / bytesPerSecond

      yield {
        speaker: options.source === 'mic' ? 'you' : 'them',
        text: '',
        startTime: timeOffset + chunkIndex * chunkDuration,
        endTime: timeOffset + chunkIndex * chunkDuration + chunkSeconds,
        confidence: 1,
        source: options.source
      }

      offset = end
      chunkIndex++
    }
  }
}
