import type { TranscriptSegment } from './engines/engine-interface.js'

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * VocabularyCorrector applies domain-specific vocabulary corrections to transcript text.
 * Single-word corrections use case-insensitive word-boundary regex.
 * Multi-word corrections use exact string replacement.
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
      if (from.length === 0) continue

      const isSingleWord = !from.includes(' ')
      if (isSingleWord) {
        const pattern = new RegExp(`\\b${escapeRegex(from)}\\b`, 'gi')
        text = text.replace(pattern, to)
      } else {
        text = text.replaceAll(from, to)
      }
    }

    return { ...segment, text }
  }

  correctAll(segments: TranscriptSegment[]): TranscriptSegment[] {
    return segments.map((s) => this.correct(s))
  }
}

export { escapeRegex }
