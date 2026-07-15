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
 *
 * F17/T6 (spec-006) additions:
 *   - Wires the graph-provenance cleanup DI seam (D1) at registration time —
 *     see main/index.ts's post-registration startup tripwire for the loud
 *     "unwired" guard.
 *   - recordings:deletionImpact merges a graph dry-run estimate (D5/AR3-8).
 *   - recordings:deleteCascade runs the AR3-3(a) ensureGraphReady() pre-flight
 *     before a hard purge (outside the delete transaction) and accepts the
 *     AR3-3(c) skipGraphCleanup escape hatch as an explicit third argument.
 *   - recordings:markNotOnDevice (AR3-6b) and recordings:retryPendingCleanups
 *     (AR3-2) are new, small, deletion-domain-adjacent handlers.
 */

import { ipcMain } from 'electron'
import { z } from 'zod'
import {
  resolveRecordingId,
  setKnowledgeCaptureRatingByRecording,
  setGraphProvenanceCleanup,
  markRecordingNotOnDeviceById,
  removeDeviceFileCacheEntry,
  retryPendingGraphCleanups
} from '../services/database'
import {
  removeRecordingProvenanceCore,
  removeRecordingFromGraph,
  ensureGraphReady
} from '../services/knowledge-graph-service'
import {
  markRecordingPersonal,
  getDeletionImpact,
  deleteRecording as deleteRecordingCascadeService,
  restoreDeletedRecording,
  retryPendingFileCleanups
} from '../services/recording-deletion-service'

const RecordingIdSchema = z.string().min(1).max(200)
const MarkPersonalSchema = z.object({ id: RecordingIdSchema, personal: z.boolean() })
// T6 fix round (CX-T6-1): the id may no longer resolve after a hard purge
// (the recordings row is gone by design), so the caller can pass the device
// filename it just deleted as a fallback reconciliation key for the offline
// device cache.
const MarkNotOnDeviceSchema = z.object({
  id: RecordingIdSchema,
  deviceFilename: z.string().min(1).max(200).optional()
})
const DeleteCascadeSchema = z.object({
  id: RecordingIdSchema,
  hard: z.boolean(),
  // spec-006/F17 T6 AR3-3(c) — escape hatch, optional so every prior call
  // shape (id, hard) keeps working unchanged.
  skipGraphCleanup: z.boolean().optional()
})
// F16/spec-003: manual per-row value-rating override. Validated + capture-scoped
// (resolved from the recording id) — distinct from the unvalidated knowledge:update
// handler, and distinct from quality:set (the separate quality_assessments system).
const SetValueRatingSchema = z.object({
  id: RecordingIdSchema,
  rating: z.enum(['valuable', 'archived', 'low-value', 'garbage', 'unrated'])
})

export function registerRecordingDeletionHandlers(): void {
  // spec-006/F17 T6 D1 — wire the graph-provenance cleanup seam. Runs once at
  // registration time (app startup); main/index.ts's post-registration
  // tripwire (AR3-1) logs a loud console.error if this is ever skipped by a
  // future refactor. removeRecordingProvenanceCore does no DDL of its own
  // beyond the already-initialized store (AR3-3a — the DDL/readiness check
  // itself is the deleteCascade handler's ensureGraphReady() pre-flight below).
  setGraphProvenanceCleanup((recordingId, opts) => removeRecordingProvenanceCore(recordingId, opts))

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

  // Read-only impact for the confirm dialog. spec-006/F17 T6 D5/AR3-8: merges
  // a graph dry-run estimate — number is a point-in-time ESTIMATE ("~N graph
  // links"); null means the dry-run explicitly failed (UNKNOWN — the dialog
  // renders a warning, never a silent omission). Computed HERE (not in
  // database.ts) so database.ts stays graph-free except for the cleanup seam.
  ipcMain.handle('recordings:deletionImpact', async (_, id: unknown) => {
    try {
      const parsed = RecordingIdSchema.safeParse(id)
      if (!parsed.success) return { success: false, error: 'Invalid recording id' }
      const rec = resolveRecordingId(parsed.data)
      if (!rec) return { success: false, error: 'Recording not found' }
      const data = getDeletionImpact(rec.id)
      if (!data) return { success: false, error: 'Recording not found' }

      let graphEstimate: number | null = null
      try {
        const g = removeRecordingFromGraph(rec.id, { dryRun: true })
        if (g?.ok) {
          graphEstimate = g.edgesRemoved + g.meetingNodesRemoved + g.orphanNodesRemoved
        }
      } catch (e) {
        console.error('recordings:deletionImpact graph dry-run failed:', e)
        graphEstimate = null
      }

      return { success: true, data: { ...data, graphEstimate } }
    } catch (e) {
      console.error('recordings:deletionImpact error:', e)
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' }
    }
  })

  // Soft (default) or hard cascade delete. spec-006/F17 T6 AR3-3(a): a hard
  // delete (unless the skipGraphCleanup escape hatch is set) runs a graph
  // readiness pre-flight BEFORE calling the service — an honest, fast
  // "graph cleanup unavailable" failure outside the delete transaction,
  // rather than only discovering it via the fail-closed throw deep inside
  // deleteRecordingCascade's own transaction (AR3-1, still the ultimate
  // backstop if this pre-flight is ever bypassed).
  ipcMain.handle('recordings:deleteCascade', async (_, id: unknown, hard: unknown, opts: unknown) => {
    try {
      const skipGraphCleanup = (opts as { skipGraphCleanup?: unknown } | undefined)?.skipGraphCleanup
      const parsed = DeleteCascadeSchema.safeParse({ id, hard, skipGraphCleanup })
      if (!parsed.success) {
        return { success: false, error: parsed.error.issues[0]?.message || 'Invalid request' }
      }
      const rec = resolveRecordingId(parsed.data.id)
      if (!rec) return { success: false, error: 'Recording not found' }

      if (parsed.data.hard && !parsed.data.skipGraphCleanup) {
        const ready = ensureGraphReady()
        if (!ready.ok) {
          return {
            success: false,
            error: `Graph cleanup unavailable: ${ready.error ?? 'unknown error'}`,
            graphUnavailable: true
          }
        }
      }

      return await deleteRecordingCascadeService(rec.id, {
        hard: parsed.data.hard,
        ...(parsed.data.skipGraphCleanup ? { skipGraphCleanup: true } : {})
      })
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

  // spec-006/F17 T6 AR3-6(b) — immediately reconcile a single recording's
  // device presence after a CONFIRMED device delete, so the UI doesn't show
  // a stale on-device row until the next authoritative scan.
  //
  // T6 fix round (CX-T6-1): in the PERMANENT flow the hard cascade has
  // already deleted the recordings row by the time the device delete
  // confirms, so the id no longer resolves — previously that made this whole
  // call a dead no-op ("Recording not found", ignored by the caller) while
  // the offline device cache (`device_file_cache`) still held the filename
  // and resurrected the deleted file as a ghost device-only row. The handler
  // now ALSO reconciles by filename: the caller passes the device filename it
  // just deleted, and the cache entry is removed for it. Unresolvable id + a
  // filename is therefore a SUCCESS, not an error.
  //
  // Honest caller inventory (phase-3 integration-review C1): the ONLY
  // renderer caller today is the permanent-delete device checkbox
  // (executeDeletePermanent, Library.tsx), invoked AFTER the hard cascade
  // has already deleted the recordings row — so `rec` below always resolves
  // to null in production, and only the filename-cache-key branch
  // (`removeDeviceFileCacheEntry`) ever actually runs. The `if (rec)` id
  // branch below (and the `rec?.filename`/`rec?.original_filename` extra
  // cache keys) is exercised only by this file's own unit tests, not by any
  // live caller — it is kept, rather than deleted, as the honest
  // reconciliation contract for a future caller that still has a resolvable
  // row at call time. The synced-row "Delete from device" flow
  // (executeDeleteFromDevice, Library.tsx) does NOT call this handler at
  // all today; it relies on the next ~90s device scan to self-heal.
  ipcMain.handle('recordings:markNotOnDevice', async (_, id: unknown, deviceFilename: unknown) => {
    try {
      const parsed = MarkNotOnDeviceSchema.safeParse({ id, deviceFilename: deviceFilename ?? undefined })
      if (!parsed.success) return { success: false, error: 'Invalid recording id' }
      const rec = resolveRecordingId(parsed.data.id)
      if (rec) {
        markRecordingNotOnDeviceById(rec.id)
      }
      // Clear every plausible device-cache key: the explicit filename the
      // caller just deleted from the device, plus (when the row still exists)
      // its own filename variants. Deleting an uncached name is a no-op.
      const cacheKeys = new Set<string>()
      if (parsed.data.deviceFilename) cacheKeys.add(parsed.data.deviceFilename)
      if (rec?.filename) cacheKeys.add(rec.filename)
      if (rec?.original_filename) cacheKeys.add(rec.original_filename)
      for (const key of cacheKeys) {
        removeDeviceFileCacheEntry(key)
      }
      if (!rec && !parsed.data.deviceFilename) {
        return { success: false, error: 'Recording not found' }
      }
      return { success: true }
    } catch (e) {
      console.error('recordings:markNotOnDevice error:', e)
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' }
    }
  })

  // spec-006/F17 T6 AR3-2 — bounded, non-fatal sweep of any post-commit
  // file-cleanup backlog from an earlier hard purge. The renderer calls this
  // on Trash-view entry, in addition to it running on every hard purge.
  ipcMain.handle('recordings:retryPendingCleanups', async () => {
    try {
      // ARF-4 — also retry any DEFERRED graph cleanup left by a
      // skipGraphCleanup escape-hatch purge (the graph seam may now be ready).
      // Non-fatal; the file sweep's outcome is what the caller acts on.
      let graph
      try {
        graph = retryPendingGraphCleanups()
      } catch (e) {
        console.warn('recordings:retryPendingCleanups graph sweep failed (non-fatal):', e)
      }
      const result = await retryPendingFileCleanups()
      return { success: true, ...result, graph }
    } catch (e) {
      console.error('recordings:retryPendingCleanups error:', e)
      return { success: false, error: e instanceof Error ? e.message : 'Unknown error' }
    }
  })

  console.log('Recording deletion IPC handlers registered')
}
