import { ipcMain } from 'electron'
import { getQualityAssessmentService } from '../services/quality-assessment'
import { getStoragePolicyService } from '../services/storage-policy'
import {
  validateRecordingId,
  validateRecordingIds,
  validateQualityLevel,
  validateStorageTier,
  validateOptionalString,
  validateNumber,
  validateMinAgeOverride
} from './validation'

/**
 * Register IPC handlers for quality assessment and storage policy operations
 */
export function registerQualityHandlers(): void {
  const qualityService = getQualityAssessmentService()
  const storageService = getStoragePolicyService()

  // =========================================================================
  // Quality Assessment Handlers
  // =========================================================================

  /**
   * Get quality assessment for a recording
   */
  ipcMain.handle('quality:get', async (_, recordingId: unknown) => {
    try {
      const validId = validateRecordingId(recordingId)
      const assessment = qualityService.getQuality(validId)
      return { success: true, data: assessment }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  /**
   * Manually set quality for a recording
   */
  ipcMain.handle(
    'quality:set',
    async (
      _,
      recordingId: unknown,
      quality: unknown,
      reason?: unknown,
      assessedBy?: unknown
    ) => {
      try {
        const validId = validateRecordingId(recordingId)
        const validQuality = validateQualityLevel(quality)
        const validReason = validateOptionalString(reason, 1000)
        const validAssessedBy = validateOptionalString(assessedBy, 200)

        const assessment = await qualityService.assessQuality(
          validId,
          validQuality,
          validReason,
          validAssessedBy
        )
        return { success: true, data: assessment }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  /**
   * Auto-assess quality for a recording
   */
  ipcMain.handle('quality:auto-assess', async (_, recordingId: unknown) => {
    try {
      const validId = validateRecordingId(recordingId)
      const assessment = await qualityService.autoAssess(validId)
      return { success: true, data: assessment }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  /**
   * Get all recordings with a specific quality level
   */
  ipcMain.handle('quality:get-by-quality', async (_, quality: unknown) => {
    try {
      const validQuality = validateQualityLevel(quality)
      const recordings = qualityService.getByQuality(validQuality)
      return { success: true, data: recordings }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  /**
   * Batch auto-assess multiple recordings
   */
  ipcMain.handle('quality:batch-auto-assess', async (_, recordingIds: unknown) => {
    try {
      const validIds = validateRecordingIds(recordingIds)
      const assessments = await qualityService.batchAutoAssess(validIds)
      return { success: true, data: assessments }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  /**
   * Assess all unassessed recordings
   */
  ipcMain.handle('quality:assess-unassessed', async () => {
    try {
      const count = await qualityService.assessUnassessed()
      return { success: true, data: { assessed: count } }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  // =========================================================================
  // Storage Policy Handlers
  // =========================================================================

  /**
   * Get recordings by storage tier
   */
  ipcMain.handle('storage:get-by-tier', async (_, tier: unknown) => {
    try {
      const validTier = validateStorageTier(tier)
      const recordings = storageService.getByTier(validTier)
      return { success: true, data: recordings }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  /**
   * Get cleanup suggestions
   */
  ipcMain.handle(
    'storage:get-cleanup-suggestions',
    async (_, minAgeOverride?: unknown) => {
      try {
        const validOverride = validateMinAgeOverride(minAgeOverride)
        const suggestions = storageService.getCleanupSuggestions(validOverride)
        return { success: true, data: suggestions }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  /**
   * Get cleanup suggestions for a specific tier
   */
  ipcMain.handle(
    'storage:get-cleanup-suggestions-for-tier',
    async (_, tier: unknown, minAgeDays?: unknown) => {
      try {
        const validTier = validateStorageTier(tier)
        const validMinAgeDays = minAgeDays !== undefined
          ? validateNumber(minAgeDays, 0, 36500)
          : undefined

        const suggestions = storageService.getCleanupSuggestionsForTier(validTier, validMinAgeDays)
        return { success: true, data: suggestions }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  /**
   * Execute cleanup for recordings
   */
  ipcMain.handle(
    'storage:execute-cleanup',
    async (_, recordingIds: unknown) => {
      try {
        const validIds = validateRecordingIds(recordingIds)
        const result = await storageService.executeCleanup(validIds)
        return { success: true, data: result }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return { success: false, error: message }
      }
    }
  )

  /**
   * Get storage statistics by tier
   */
  ipcMain.handle('storage:get-stats', async () => {
    try {
      const stats = storageService.getStorageStats()
      return { success: true, data: stats }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  /**
   * Initialize storage tiers for untiered recordings
   */
  ipcMain.handle('storage:initialize-untiered', async () => {
    try {
      const count = await storageService.initializeUntieredRecordings()
      return { success: true, data: { initialized: count } }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  /**
   * Manually assign tier to a recording
   */
  ipcMain.handle('storage:assign-tier', async (_, recordingId: unknown, quality: unknown) => {
    try {
      const validId = validateRecordingId(recordingId)
      const validQuality = validateQualityLevel(quality)

      storageService.assignTier(validId, validQuality)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  console.log('[IPC] Quality and Storage handlers registered')
}
