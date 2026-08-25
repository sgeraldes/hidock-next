import type { Meeting, Transcript } from '@/types'
import type { UnifiedRecording } from '@/types/unified-recording'

export type DisplayTitleSource =
  | 'meeting-subject'
  | 'filename'

export interface DisplayTitle {
  primaryText: string
  source: DisplayTitleSource
}

/**
 * Source identity title for the Library and reader.
 *
 * The immutable filename identifies an unassigned source. Once a calendar event
 * is assigned, its official subject becomes the source title. User/AI content
 * titles remain independent descriptive metadata and never replace either one.
 */
export function getDisplayTitle(
  recording: UnifiedRecording,
  meeting?: Meeting,
  transcript?: Transcript
): DisplayTitle {
  void transcript
  const officialMeetingSubject = meeting?.subject?.trim() || recording.meetingSubject?.trim()
  if (officialMeetingSubject) {
    return { primaryText: officialMeetingSubject, source: 'meeting-subject' }
  }

  return { primaryText: recording.filename, source: 'filename' }
}
