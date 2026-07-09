/**
 * Transcript-upgrade IPC handlers.
 *
 * Maintenance surface for triaging + reformatting old flat transcripts:
 *   - scan          READ-ONLY dry run: detect + triage, return counts.
 *   - run           Persist triage, flag the important band, queue reformats.
 *   - getStatus     Counts + reformat-status breakdown.
 *   - getRecommended  Recording ids flagged for user-initiated re-transcription.
 */

import { ipcMain } from 'electron'
import { z } from 'zod'
import { success, error, Result } from '../types/api'
import {
  scanOldTranscripts,
  runUpgrade,
  getUpgradeStatus,
  getRecommendedRecordingIds,
  DEFAULT_TRIAGE_THRESHOLD,
  type ScanResult,
  type UpgradeStatus
} from '../services/transcript-upgrade'

const ThresholdSchema = z.object({ threshold: z.number().min(0).max(100).optional() }).optional()

function resolveThreshold(request: unknown): number {
  const parsed = ThresholdSchema.safeParse(request)
  return parsed.success && parsed.data?.threshold != null ? parsed.data.threshold : DEFAULT_TRIAGE_THRESHOLD
}

export function registerTranscriptUpgradeHandlers(): void {
  ipcMain.handle('transcript-upgrade:scan', async (_, request: unknown): Promise<Result<ScanResult>> => {
    try {
      return success(scanOldTranscripts(resolveThreshold(request)))
    } catch (err) {
      console.error('transcript-upgrade:scan error:', err)
      return error('DATABASE_ERROR', 'Failed to scan transcripts', err)
    }
  })

  ipcMain.handle('transcript-upgrade:run', async (_, request: unknown): Promise<Result<ScanResult>> => {
    try {
      return success(runUpgrade(resolveThreshold(request)))
    } catch (err) {
      console.error('transcript-upgrade:run error:', err)
      return error('DATABASE_ERROR', 'Failed to run transcript upgrade', err)
    }
  })

  ipcMain.handle('transcript-upgrade:getStatus', async (_, request: unknown): Promise<Result<UpgradeStatus>> => {
    try {
      return success(getUpgradeStatus(resolveThreshold(request)))
    } catch (err) {
      console.error('transcript-upgrade:getStatus error:', err)
      return error('DATABASE_ERROR', 'Failed to get upgrade status', err)
    }
  })

  ipcMain.handle('transcript-upgrade:getRecommended', async (_, request: unknown): Promise<Result<string[]>> => {
    try {
      return success(getRecommendedRecordingIds(resolveThreshold(request)))
    } catch (err) {
      console.error('transcript-upgrade:getRecommended error:', err)
      return error('DATABASE_ERROR', 'Failed to get recommended recordings', err)
    }
  })
}
