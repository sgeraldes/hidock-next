/**
 * Re-diarization service.
 *
 * The diarizer sometimes splits ONE person's voice across two speaker labels
 * (the owner's own voice gets a second "Speaker N"), or merges two people onto
 * one label. No amount of renaming fixes a bad segmentation — the SEGMENTATION
 * itself has to be redone. This service re-runs speaker segmentation for a
 * single recording on demand.
 *
 * Implementation (OPTION A — pragmatic, ship-now): Gemini couples transcription
 * and diarization in one pass, so "re-diarize" re-runs that pass with the
 * current (improved) diarization prompt and regenerates the speaker turns. It
 * reuses the existing transcription queue (same path as `recordings:reprocessWith`)
 * so it emits the normal `transcription:*` progress events for free, and the
 * completion path overwrites the transcript's `speakers` JSON in place
 * (`INSERT OR REPLACE` on `transcripts`). A true audio-only re-segmentation
 * (WhisperX + pyannote, from docs/experiments/diarization-spike.md) is a
 * documented follow-up — it needs a GPU + HF token + a Python worker subprocess
 * and is not readily runnable in-process, so it is deferred.
 *
 * Stale-name safety: fresh segmentation must NOT inherit the AUTO speaker names
 * the self-identification pass bound to the OLD labels (a new "Speaker 3" may be
 * a different person than the old "Speaker 3"). So before re-queueing we clear
 * the AUTOMATIC bindings and the self-id markers, while PRESERVING every MANUAL
 * correction the user made (per-turn overrides, speaker splits, and manual
 * label assignments). The transcription pipeline re-runs self-identification at
 * the end, so cleared auto names are regenerated fresh against the new turns.
 *
 * Idempotent: clearing is a no-op when there is nothing to clear, and the
 * operation is safe to run repeatedly.
 *
 * NO new tables and NO schema migration: it reads/deletes existing rows only.
 */

import { queryAll, run, addToQueue, updateRecordingTranscriptionStatus } from './database'

// Config-KV marker prefixes written by the self-identification pass
// (self-identification.ts SCANNED_KEY_PREFIX / MERGE_KEY_PREFIX). Clearing the
// 'scanned' marker lets that pass re-run against the fresh diarization; clearing
// the 'merge_suspected' markers drops suspicions tied to the old segmentation.
const SELF_ID_SCANNED_PREFIX = 'self_id:scanned:'
const SELF_ID_MERGE_PREFIX = 'self_id:merge_suspected:'

// Marks an attribution the self-identification pass produced automatically
// (mention_resolutions.method). Manual attributions use other method values and
// are left untouched.
const SELF_ID_METHOD = 'self-identification'

export interface ClearedAutoBindings {
  /** transcript_speakers rows (label→contact) removed because they were auto-bound. */
  clearedLabelBindings: number
  /** self-identification mention_resolutions rows removed. */
  clearedMentions: number
  /** self-id config markers (scanned + merge-suspected) removed. */
  clearedMarkers: number
}

/**
 * Clear the AUTOMATIC speaker-name bindings + self-identification markers for a
 * recording, preserving every MANUAL correction. Used right before a re-diarize
 * so the regenerated segmentation is not stuck with names bound to the old
 * labels.
 *
 * PRESERVED (manual, never touched here):
 *   - turn_speaker_overrides   (always a user action — "Just this turn")
 *   - speaker_splits           (always a user action — forking a merged label)
 *   - transcript_speakers rows the user assigned manually
 *   - transcript_speakers rows on a split-derived label (manual by construction)
 *   - mention_resolutions with any method other than 'self-identification'
 *
 * CLEARED (automatic):
 *   - transcript_speakers rows whose contact was bound by the self-id pass
 *   - mention_resolutions with method='self-identification'
 *   - config markers self_id:scanned:<id> and self_id:merge_suspected:<id>:*
 *
 * Idempotent: returns zero counts when there is nothing to clear.
 */
export function clearAutoSpeakerBindingsForReDiarize(recordingId: string): ClearedAutoBindings {
  // Contacts the AUTOMATIC self-identification pass bound for this recording.
  // These are the only label bindings we are allowed to clear; a contact NOT in
  // this set was bound by the user and is preserved.
  const autoContactIds = new Set(
    queryAll<{ resolved_contact_id: string }>(
      `SELECT DISTINCT resolved_contact_id FROM mention_resolutions
       WHERE recording_id = ? AND method = ? AND resolved_contact_id IS NOT NULL`,
      [recordingId, SELF_ID_METHOD]
    ).map((r) => r.resolved_contact_id)
  )

  // Split-derived labels are MANUAL (the user forked a merged label). Even if a
  // derived label's contact coincides with an auto-bound one, never clear it.
  const derivedLabels = new Set(
    queryAll<{ derived_label: string }>('SELECT derived_label FROM speaker_splits WHERE recording_id = ?', [
      recordingId
    ]).map((r) => r.derived_label)
  )

  let clearedLabelBindings = 0
  if (autoContactIds.size > 0) {
    const rows = queryAll<{ id: string; speaker_label: string; contact_id: string }>(
      'SELECT id, speaker_label, contact_id FROM transcript_speakers WHERE recording_id = ?',
      [recordingId]
    )
    for (const row of rows) {
      if (autoContactIds.has(row.contact_id) && !derivedLabels.has(row.speaker_label)) {
        run('DELETE FROM transcript_speakers WHERE id = ?', [row.id])
        clearedLabelBindings++
      }
    }
  }

  // Auto attributions from the self-identification pass — stale after re-diarize.
  const mentionRows = queryAll<{ id: string }>(
    'SELECT id FROM mention_resolutions WHERE recording_id = ? AND method = ?',
    [recordingId, SELF_ID_METHOD]
  )
  for (const m of mentionRows) {
    run('DELETE FROM mention_resolutions WHERE id = ?', [m.id])
  }

  // Self-id config markers: the 'scanned' idempotency marker (so the pass
  // re-runs) and any per-label 'merge_suspected' markers (tied to old labels).
  const markerRows = queryAll<{ key: string }>('SELECT key FROM config WHERE key = ? OR key LIKE ?', [
    `${SELF_ID_SCANNED_PREFIX}${recordingId}`,
    `${SELF_ID_MERGE_PREFIX}${recordingId}:%`
  ])
  for (const mk of markerRows) {
    run('DELETE FROM config WHERE key = ?', [mk.key])
  }

  return {
    clearedLabelBindings,
    clearedMentions: mentionRows.length,
    clearedMarkers: markerRows.length
  }
}

export interface ReDiarizeResult {
  queueItemId: string
  cleared: ClearedAutoBindings
}

/**
 * Re-diarize one recording: clear its automatic speaker names, then re-queue the
 * recording for (re)transcription with the given provider so segmentation is
 * regenerated. The caller (IPC handler) is responsible for resolving the id to a
 * canonical recording and validating provider prerequisites.
 *
 * `recordingId` MUST already be the canonical recordings.id.
 * `provider` is passed straight through to the queue (undefined → global default).
 *
 * Emits progress through the normal transcription queue events. Idempotent /
 * safe to run repeatedly.
 */
export async function reDiarizeRecording(recordingId: string, provider?: string): Promise<ReDiarizeResult> {
  const cleared = clearAutoSpeakerBindingsForReDiarize(recordingId)

  const queueItemId = addToQueue(recordingId, provider)
  updateRecordingTranscriptionStatus(recordingId, 'queued')

  // Lazy-import the transcription service so this module stays light for unit
  // tests of the clearing logic (mirrors self-identification's lazy imports).
  const { markUserPriority, processQueueManually } = await import('./transcription')
  markUserPriority(recordingId) // explicit single-recording request — jump the backlog
  void processQueueManually()

  return { queueItemId, cleared }
}
