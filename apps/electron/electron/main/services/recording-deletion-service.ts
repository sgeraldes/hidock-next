/**
 * Recording deletion service (privacy source-deletion, v38).
 *
 * Coordinates the two user intents from the DB cascade with the on-disk side
 * effects the database layer cannot do itself:
 *
 *  - "Mark personal" (markPersonal): a reversible, non-destructive flag. The DB
 *    layer pulls the recording out of every AI pipeline + default surface; no
 *    file is touched.
 *  - Delete (deleteRecording): soft by default (hide + restorable) or hard
 *    ({ hard: true }, the privacy case) which removes ALL derived DB rows via
 *    deleteRecordingCascade, then unlinks the on-disk files here — the audio,
 *    the exported wiki .md, and any artifact blobs — and clears the in-memory
 *    vector store so nothing survives.
 *
 * The DEVICE copy is intentionally never touched (USB safety); removing it is a
 * separate, explicit action out of scope here.
 */

import { existsSync, unlinkSync } from 'fs'
import {
  deleteRecordingCascade,
  restoreRecording,
  setRecordingPersonal,
  getRecordingDeletionImpact,
  type RecordingDeletionResult,
  type RecordingDeletionImpact
} from './database'
import { deleteRecording as deleteRecordingFile } from './file-storage'
import { removeMeetingWiki } from './meeting-wiki'
import { getVectorStore } from './vector-store'

export interface DeleteRecordingOutcome extends RecordingDeletionResult {
  success: true
  filesRemoved: {
    audio: boolean
    wikiPages: number
    artifactBlobs: number
  }
}

export interface DeletionServiceError {
  success: false
  error: string
}

/**
 * Mark / unmark a recording personal ("ignore"). Reversible. Returns the new
 * flag state, or an error if the recording is unknown. No files are touched —
 * the recording simply drops out of AI processing and default surfaces, and its
 * chunks stop appearing in RAG answers (filtered at query time).
 */
export function markRecordingPersonal(
  recordingId: string,
  personal: boolean
): { success: true; personal: boolean } | DeletionServiceError {
  const result = setRecordingPersonal(recordingId, personal)
  if (result === undefined) {
    return { success: false, error: `Recording ${recordingId} not found` }
  }
  return { success: true, personal: result }
}

/** Read-only impact of a hard purge, for the confirm dialog. */
export function getDeletionImpact(recordingId: string): RecordingDeletionImpact | undefined {
  return getRecordingDeletionImpact(recordingId)
}

/**
 * Delete a recording and everything derived from it. Soft by default (restorable
 * tombstone, no files removed); hard purge irreversibly removes derived rows +
 * files. Returns a summary of exactly what was removed.
 */
export async function deleteRecording(
  recordingId: string,
  opts: { hard?: boolean } = {}
): Promise<DeleteRecordingOutcome | DeletionServiceError> {
  let cascade: RecordingDeletionResult | undefined
  try {
    cascade = deleteRecordingCascade(recordingId, opts)
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Cascade delete failed' }
  }
  if (!cascade) {
    return { success: false, error: `Recording ${recordingId} not found` }
  }

  const filesRemoved = { audio: false, wikiPages: 0, artifactBlobs: 0 }

  if (cascade.mode === 'hard') {
    // Sync the in-memory vector store (its DB rows are already gone).
    try {
      await getVectorStore().deleteByRecording(recordingId)
    } catch (e) {
      console.warn('[RecordingDeletion] vector store sync failed:', e)
    }

    // Audio file on disk (data path). Never the device copy.
    if (cascade.filePath) {
      try {
        filesRemoved.audio = deleteRecordingFile(cascade.filePath)
      } catch (e) {
        console.warn('[RecordingDeletion] audio unlink failed:', e)
      }
    }

    // Exported wiki markdown.
    try {
      filesRemoved.wikiPages = removeMeetingWiki(recordingId)
    } catch (e) {
      console.warn('[RecordingDeletion] wiki purge failed:', e)
    }

    // Artifact blobs.
    for (const path of cascade.artifactPaths) {
      try {
        if (existsSync(path)) {
          unlinkSync(path)
          filesRemoved.artifactBlobs++
        }
      } catch (e) {
        console.warn(`[RecordingDeletion] artifact blob unlink failed for ${path}:`, e)
      }
    }
  }

  return { success: true, ...cascade, filesRemoved }
}

/**
 * Restore a soft-deleted recording (undo). Returns success=false if there is no
 * soft-deleted recording with this id (e.g. it was hard-purged).
 */
export function restoreDeletedRecording(
  recordingId: string
): { success: boolean } {
  return { success: restoreRecording(recordingId) }
}
