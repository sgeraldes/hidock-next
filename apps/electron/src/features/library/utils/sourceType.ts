/**
 * Source-type derivation for the Knowledge Library.
 *
 * The Library renders `UnifiedRecording` items which do not carry an explicit
 * artifact kind. Until the data model grows a first-class `type` column, we
 * derive the kind from the filename extension (imported artifacts keep their
 * real extension: .pdf/.png/.md/…). Device recordings and audio files fall back
 * to `audio`, which keeps the app's audio-primary behaviour intact.
 *
 * This kind drives:
 *  - the small type glyph on each row,
 *  - the per-type metadata line (audio shows duration, images/pdfs/notes do not),
 *  - the source-type segmented filter (All / Audio / Images / PDFs / Notes).
 */

import type { UnifiedRecording } from '@/types/unified-recording'

export type LibrarySourceType = 'audio' | 'image' | 'pdf' | 'note' | 'data' | 'unknown'

const AUDIO_EXTS = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'webm', 'hda', 'opus', 'wma'])
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif', 'tiff'])
const NOTE_EXTS = new Set(['md', 'markdown', 'txt', 'text', 'rtf'])
const DATA_EXTS = new Set(['json', 'csv', 'tsv', 'yaml', 'yml'])

/** Lowercased extension without the dot, or '' when there is none. */
export function getExtension(filename: string | undefined | null): string {
  if (!filename) return ''
  const idx = filename.lastIndexOf('.')
  if (idx <= 0 || idx === filename.length - 1) return ''
  return filename.slice(idx + 1).toLowerCase()
}

/**
 * Derive the library source type for a recording.
 *
 * Priority:
 *  1. A device file (device-only or synced) is always audio — HiDock captures.
 *  2. Otherwise classify by filename extension.
 *  3. No/unknown extension falls back to `audio` (the app's primary kind), so
 *     legacy rows keep their current appearance.
 */
export function getSourceType(recording: Pick<UnifiedRecording, 'filename' | 'location'>): LibrarySourceType {
  // Device-backed rows are audio recordings regardless of the stored extension.
  if (recording.location === 'device-only' || recording.location === 'both') return 'audio'

  const ext = getExtension(recording.filename)
  if (!ext) return 'audio'
  if (AUDIO_EXTS.has(ext)) return 'audio'
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (NOTE_EXTS.has(ext)) return 'note'
  if (DATA_EXTS.has(ext)) return 'data'
  return 'unknown'
}

/** True when the type has a meaningful playback/duration dimension. */
export function sourceTypeHasDuration(type: LibrarySourceType): boolean {
  return type === 'audio'
}

/** Human label for the type (used in filters and aria text). */
export function sourceTypeLabel(type: LibrarySourceType): string {
  switch (type) {
    case 'audio':
      return 'Audio'
    case 'image':
      return 'Image'
    case 'pdf':
      return 'PDF'
    case 'note':
      return 'Note'
    case 'data':
      return 'Data'
    default:
      return 'File'
  }
}

/**
 * Segmented-control filter values. `all` matches everything; the rest map to a
 * set of concrete source types (Notes folds text + data together).
 */
export type SourceTypeFilter = 'all' | 'audio' | 'image' | 'pdf' | 'note'

export function matchesSourceTypeFilter(type: LibrarySourceType, filter: SourceTypeFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'note') return type === 'note' || type === 'data'
  return type === filter
}
