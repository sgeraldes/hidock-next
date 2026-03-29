import type { TranscriptSegment } from './engines/engine-interface.js'

/**
 * Diarizer maps audio source labels to human-readable speaker names.
 * mic   → "you"
 * system → "them"
 */
export class Diarizer {
  tagSpeaker(source: TranscriptSegment['source']): string {
    switch (source) {
      case 'mic':
        return 'you'
      case 'system':
        return 'them'
    }
  }

  tag(segment: TranscriptSegment): TranscriptSegment {
    return { ...segment, speaker: this.tagSpeaker(segment.source) }
  }
}
