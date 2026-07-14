/**
 * Recording deletion + privacy IPC handlers (v38).
 *
 * Exposes the two user intents to the renderer:
 *   - recordings:markPersonal   Reversible "ignore" flag (kept on disk, pulled
 *                               from AI + default surfaces).
 *   - recordings:deletionImpact Read-only count of what a hard purge removes,
 *                               so the confirm dialog can state it plainly.
 *   - recordings:deleteCascade  Soft (restorable) or hard (irreversible privacy
 *                               purge of ALL derived data + files).
 *   - recordings:restore        Undo a soft-delete.
 *
 * Ids arriving from the renderer's unified view may be synced_files ids — every
 * handler resolves through resolveRecordingId first, mirroring recording-handlers.
 */

import { ipcMain } from 'electron'
import { z } from 'zod'
import { resolveRecordingId, setKnowledgeCaptureRatingByRecording } from '../services/database'
import {
  markRecordingPersonal,
  getDeletionImpact,
  deleteRecording as deleteRecordingCascadeService,
  restoreDeletedRecording
} from '../services/recording-deletion-service'

const RecordingIdSchema = z.string().min(1).max(200)
const MarkPersonalSchema = z.object({ id: RecordingIdSchema, personal: z.boolean() })
const DeleteCascadeSchema = z.object({ id: RecordingIdSchema, hard: z.boolean() })
// F16/spec-003: manual per-row value-rating override. Validated + capture-scoped
// (resolved from the recording id) — distinct from the unvalidated knowledge:update
// handler, and distinct from quality:set (the separate quality_assessments system).
const SetValueRatingSchema = z.object({
  id: RecordingIdSchema,
  rating: z.enum(['valuable', 'archived', 'low-value', 'garbage', 'unrated'])
})

export function registerRecordingDeletionHandlers(): void {
  // Mark / unmark a recording personal ("ignore").
  ipcMain.handle('recordings:markPersonal', async (_, id: unknown, personal: unknown) => {
    try {
      const parsed = MarkPersonalSchema.safeParse({ id, personal })
      if (!parsed.success) {
        return { success: false, error: parsed.error.issues[0]?.message || 'Invalid request' }
      }
      const rec = resolveRecordingId(parsed.data.id)
      if (!rec) return { success: false, error: 'Recording not found' }
      return markRecordingPersonal(rec.id, parsed.data.personal)
    } catch (e) {
      console.error('recordings:markPersonal error:', e)
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' }
    }
  })

  // Manual value-rating override (F16/spec-003) — explicit user action always
  // applies (no never-downgrade guard; that guard only protects a user rating
  // FROM the AI classifier, never the other way around). Capture-scoped via
  // resolveRecordingId, so it cannot mutate an arbitrary knowledge_captures row.
  ipcMain.handle('recordings:setValueRating', async (_, id: unknown, rating: unknown) => {
    try {
      const parsed = SetValueRatingSchema.safeParse({ id, rating })
      if (!parsed.success) {
        return { success: false, error: parsed.error.issues[0]?.message || 'Invalid request' }
      }
      const rec = resolveRecordingId(parsed.data.id)
      if (!rec) return { success: false, error: 'Recording not found' }
      const result = setKnowledgeCaptureRatingByRecording(rec.id, parsed.data.rating)
      if (!result.success) return { success: false, error: 'No knowledge capture for this recording' }
      return { success: true, rating: result.rating }
    } catch (e) {
      console.error('recordings:setValueRating error:', e)
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' }
    }
  })

  // Read-only impact for the confirm dialog.
  ipcMain.handle('recordings:deletionImpact', async (_, id: unknown) => {
    try {
      const parsed = RecordingIdSchema.safeParse(id)
      if (!parsed.success) return { success: false, error: 'Invalid recording id' }
      const rec = resolveRecordingId(parsed.data)
      if (!rec) return { success: false, error: 'Recording not found' }
      const data = getDeletionImpact(rec.id)
      if (!data) return { success: false, error: 'Recording not found' }
      return { success: true, data }
    } catch (e) {
      console.error('recordings:deletionImpact error:', e)
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' }
    }
  })

  // Soft (default) or hard cascade delete.
  ipcMain.handle('recordings:deleteCascade', async (_, id: unknown, hard: unknown) => {
    try {
      const parsed = DeleteCascadeSchema.safeParse({ id, hard })
      if (!parsed.success) {
        return { success: false, error: parsed.error.issues[0]?.message || 'Invalid request' }
      }
      const rec = resolveRecordingId(parsed.data.id)
      if (!rec) return { success: false, error: 'Recording not found' }
      return await deleteRecordingCascadeService(rec.id, { hard: parsed.data.hard })
    } catch (e) {
      console.error('recordings:deleteCascade error:', e)
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' }
    }
  })

  // Undo a soft-delete.
  ipcMain.handle('recordings:restore', async (_, id: unknown) => {
    try {
      const parsed = RecordingIdSchema.safeParse(id)
      if (!parsed.success) return { success: false }
      // A soft-deleted recording is excluded from resolveRecordingId's happy path
      // only via synced_files fallback; direct id lookup still resolves it.
      return restoreDeletedRecording(parsed.data)
    } catch (e) {
      console.error('recordings:restore error:', e)
      return { success: false }
    }
  })

  console.log('Recording deletion IPC handlers registered')
}
