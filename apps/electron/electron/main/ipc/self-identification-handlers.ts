/**
 * Self-identification IPC handlers.
 *
 * Maintenance surface for the speaker self-identification pass:
 *   - scan            READ-ONLY dry run: how many transcripts still need work.
 *   - runForRecording Run the pass for one recording (force optional).
 *   - backfill        Kick the lowest-priority backfill over existing transcripts.
 *   - getStatus       Scan counts + backfill status + merge-suspected total.
 *   - getMergeSuspected  All recorded diarization-merge suspicions.
 */

import { ipcMain } from 'electron'
import { z } from 'zod'
import { success, error, Result } from '../types/api'
import {
  scanSelfIdentifications,
  runSelfIdentificationForRecording,
  backfillSelfIdentifications,
  getSelfIdStatus,
  getMergeSuspectedMarkers,
  type SelfIdScanResult,
  type SelfIdStatus,
  type SelfIdRunResult,
  type MergeSuspected
} from '../services/self-identification'

const RunForRecordingSchema = z.object({
  recordingId: z.string().min(1).max(200),
  force: z.boolean().optional()
})

export function registerSelfIdentificationHandlers(): void {
  ipcMain.handle('self-id:scan', async (): Promise<Result<SelfIdScanResult>> => {
    try {
      return success(scanSelfIdentifications())
    } catch (err) {
      console.error('self-id:scan error:', err)
      return error('DATABASE_ERROR', 'Failed to scan self-identifications', err)
    }
  })

  ipcMain.handle('self-id:runForRecording', async (_, request: unknown): Promise<Result<SelfIdRunResult>> => {
    try {
      const parsed = RunForRecordingSchema.safeParse(request)
      if (!parsed.success) {
        return error('VALIDATION_ERROR', 'Invalid runForRecording request', parsed.error.format())
      }
      const { recordingId, force } = parsed.data
      return success(await runSelfIdentificationForRecording(recordingId, { force }))
    } catch (err) {
      console.error('self-id:runForRecording error:', err)
      return error('DATABASE_ERROR', 'Failed to run self-identification', err)
    }
  })

  ipcMain.handle('self-id:backfill', async (): Promise<Result<SelfIdStatus>> => {
    try {
      // Fire-and-forget: the drain yields to the audio queue and can run for a
      // long time, so we kick it and return the current status immediately. The
      // renderer polls getStatus for progress; a second call is a no-op while a
      // drain is already in flight (reentrancy-guarded in the service).
      void backfillSelfIdentifications()
      return success(getSelfIdStatus())
    } catch (err) {
      console.error('self-id:backfill error:', err)
      return error('DATABASE_ERROR', 'Failed to backfill self-identifications', err)
    }
  })

  ipcMain.handle('self-id:getStatus', async (): Promise<Result<SelfIdStatus>> => {
    try {
      return success(getSelfIdStatus())
    } catch (err) {
      console.error('self-id:getStatus error:', err)
      return error('DATABASE_ERROR', 'Failed to get self-identification status', err)
    }
  })

  ipcMain.handle('self-id:getMergeSuspected', async (): Promise<Result<MergeSuspected[]>> => {
    try {
      return success(getMergeSuspectedMarkers())
    } catch (err) {
      console.error('self-id:getMergeSuspected error:', err)
      return error('DATABASE_ERROR', 'Failed to get merge-suspected markers', err)
    }
  })
}
