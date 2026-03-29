import type { TranscriptSegment } from './engines/engine-interface.js'

/**
 * VocabularyCorrector applies domain-specific vocabulary corrections to transcript text.
 * Stub implementation: returns segments unchanged until a correction table is provided.
 */
export class VocabularyCorrector {
  private readonly corrections: Map<string, string>

  constructor(corrections: Record<string, string> = {}) {
    this.corrections = new Map(Object.entries(corrections))
  }

  correct(segment: TranscriptSegment): TranscriptSegment {
    if (this.corrections.size === 0) {
      return segment
    }

    let { text } = segment
    for (const [from, to] of this.corrections) {
      text = text.replaceAll(from, to)
    }

    return { ...segment, text }
  }

  correctAll(segments: TranscriptSegment[]): TranscriptSegment[] {
    return segments.map((s) => this.correct(s))
  }
}
