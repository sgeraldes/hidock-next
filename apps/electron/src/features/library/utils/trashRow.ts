/**
 * Trash-row mapper (spec-005/F17 T5 §D5).
 *
 * Maps a soft-deleted `recordings` row (as returned by the main-process
 * `getTrashedRecordings()` via the `recordings:getTrash` IPC) into the
 * `LocalOnlyRecording`-shaped `UnifiedRecording` the Trash-mode list reuses
 * `SourceRow` to render.
 *
 * `LocalOnlyRecording` REQUIRES `localPath: string` and `syncStatus: 'synced'`
 * (types/unified-recording.ts) — both are set explicitly below so this stays
 * type-complete. `getBestDate`'s 2nd argument is `Date | null | undefined`; the
 * DB's `date_recorded` is a *string*, so it is converted to a `Date` first.
 *
 * Input is the renderer's `DatabaseRecording` shape (useUnifiedRecordings.ts).
 * That interface has NO `original_filename` (it lives on synced_files / the
 * main-process Recording row) — `getTrashedRecordings()` does `SELECT *` so the
 * field IS present at runtime, but we deliberately keep the type honest and use
 * `filename` for date parsing instead of widening the type (see spec-005 §D5).
 */

import type { LocalOnlyRecording } from '@/types/unified-recording'
import { getBestDate, UNKNOWN_DATE, mapTranscriptionStatus, type DatabaseRecording } from '@/hooks/useUnifiedRecordings'

export function trashRowToUnified(rec: DatabaseRecording): LocalOnlyRecording {
  const dbDate = rec.date_recorded ? new Date(rec.date_recorded) : null
  return {
    id: rec.id,
    filename: rec.filename,
    size: rec.file_size ?? 0,
    duration: rec.duration_seconds ?? 0,
    dateRecorded: getBestDate(rec.filename, dbDate, UNKNOWN_DATE),
    transcriptionStatus: mapTranscriptionStatus(rec.transcription_status ?? rec.status, undefined),
    // CX-T5-3: every trash row comes from the recordings TABLE by construction
    // (getTrashedRecordings), so it is ALWAYS recording-backed — even when its
    // nullable file_path is empty. Stamped explicitly, never inferred from path
    // shape; without this an empty-path tombstone would lose its Restore /
    // Delete-permanently menu and be stranded in Trash.
    sourceKind: 'recording',
    location: 'local-only',
    localPath: rec.file_path ?? '', // REQUIRED by the type; soft-delete keeps the file on disk
    syncStatus: 'synced', // REQUIRED by the type
    personal: false // Trash bypasses the personal filter; value is display-only here
  }
}
