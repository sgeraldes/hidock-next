/**
 * Per-type row metadata for the Knowledge Library.
 *
 * The always-visible secondary line adapts to the source TYPE so we never show
 * a "duration" for a thing that has none:
 *  - audio → date · time · duration (unchanged from the audio-only design)
 *  - image → "Image" · date added   (no duration)
 *  - pdf   → "PDF" · date added      (no duration; page count TBD)
 *  - note  → "Note" · date added     (no duration; word count TBD)
 *  - data  → "Data" · date added
 * Each type also carries a small glyph so the list scans by kind at a glance.
 */

import { AudioLines, Image, FileText, StickyNote, Braces, File, type LucideIcon } from 'lucide-react'
import { formatDuration } from '@/lib/utils'
import { formatSmartDate, formatRelativeDate } from '@/lib/smartDate'
import type { UnifiedRecording } from '@/types/unified-recording'
import { getSourceType, sourceTypeLabel, type LibrarySourceType } from './sourceType'

export interface RowMeta {
  type: LibrarySourceType
  Icon: LucideIcon
  /** Ordered fragments joined by "·" on the row's secondary line. */
  parts: string[]
}

const TYPE_ICON: Record<LibrarySourceType, LucideIcon> = {
  audio: AudioLines,
  image: Image,
  pdf: FileText,
  note: StickyNote,
  data: Braces,
  unknown: File
}

export function getRowMeta(recording: UnifiedRecording): RowMeta {
  const type = getSourceType(recording)
  const Icon = TYPE_ICON[type]
  // Relative hint ("2 days ago", "3 mo ago", "2 yr ago") complements the absolute
  // date so recency reads at a glance. Null for missing/invalid dates.
  const relative = formatRelativeDate(recording.dateRecorded)

  if (type === 'audio') {
    // Absolute date WITH THE YEAR + start time (a year-old capture must not read
    // like this week's), then the real duration when known, then the relative hint.
    const parts = [formatSmartDate(recording.dateRecorded, { time: true })]
    if (recording.duration && recording.duration > 0) {
      parts.push(formatDuration(recording.duration))
    }
    if (relative) parts.push(relative)
    return { type, Icon, parts }
  }

  // Non-audio artifacts: no duration. Lead with the human type label, then the
  // date-with-year the item entered the library (dateRecorded doubles as "added"),
  // then the relative hint.
  const parts = [sourceTypeLabel(type), formatSmartDate(recording.dateRecorded, { time: false })]
  if (relative) parts.push(relative)
  return { type, Icon, parts }
}
