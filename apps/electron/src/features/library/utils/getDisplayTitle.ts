import type { Meeting, Transcript } from '@/types'
import type { UnifiedRecording } from '@/types/unified-recording'

export type DisplayTitleSource =
  | 'meeting-subject'
  | 'recording-title'
  | 'transcript-title'
  | 'transcript-summary'
  | 'meeting-subject-denormalized'
  | 'filename'

export interface DisplayTitle {
  primaryText: string
  source: DisplayTitleSource
}

/**
 * Smart title priority chain for SourceRow display.
 *
 * Priority:
 * 1. meeting.subject (linked calendar meeting)
 * 2. recording.title (user-set or AI title)
 * 3. transcript.title_suggestion (AI-suggested from transcription)
 * 4. First sentence of transcript.summary
 * 5. recording.meetingSubject (denormalized field)
 * 6. Fallback: recording.filename
 */
export function getDisplayTitle(
  recording: UnifiedRecording,
  meeting?: Meeting,
  transcript?: Transcript
): DisplayTitle {
  // 1. Linked calendar meeting subject
  if (meeting?.subject) {
    return { primaryText: meeting.subject, source: 'meeting-subject' }
  }

  // 2. User-set or AI title on the recording
  if (recording.title) {
    return { primaryText: recording.title, source: 'recording-title' }
  }

  // 3. AI-suggested title from transcription
  if (transcript?.title_suggestion) {
    return { primaryText: transcript.title_suggestion, source: 'transcript-title' }
  }

  // 4. First sentence of transcript summary
  if (transcript?.summary) {
    const firstSentence = extractFirstSentence(transcript.summary)
    if (firstSentence) {
      return { primaryText: firstSentence, source: 'transcript-summary' }
    }
  }

  // 5. Denormalized meeting subject on recording
  if (recording.meetingSubject) {
    return { primaryText: recording.meetingSubject, source: 'meeting-subject-denormalized' }
  }

  // 6. Fallback: filename
  return { primaryText: recording.filename, source: 'filename' }
}

/**
 * Extract the first sentence from a text block.
 * Returns the sentence without trailing period, or null if empty.
 */
function extractFirstSentence(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  // Match up to the first sentence-ending punctuation followed by a space or end of string
  const match = trimmed.match(/^(.+?[.!?])(?:\s|$)/)
  if (match) {
    return match[1]
  }

  // If no sentence boundary found, take up to 80 chars with ellipsis
  if (trimmed.length > 80) {
    const breakPoint = trimmed.lastIndexOf(' ', 80)
    return trimmed.slice(0, breakPoint > 0 ? breakPoint : 80) + '...'
  }

  return trimmed
}
