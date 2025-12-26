import { ipcMain } from 'electron'
import { getQualityAssessmentService } from '../services/quality-assessment'
import { getStoragePolicyService } from '../services/storage-policy'
import type { QualityLevel, AssessmentMethod } from '../services/quality-assessment'
import type { StorageTier, CleanupSuggestion } from '../services/storage-policy'

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
  ipcMain.handle('quality:get', async (_, recordingId: string) => {
    try {
      const assessment = qualityService.getQuality(recordingId)
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
      recordingId: string,
      quality: QualityLevel,
      reason?: string,
      assessedBy?: string
    ) => {
      try {
        const assessment = await qualityService.assessQuality(recordingId, quality, reason, assessedBy)
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
  ipcMain.handle('quality:auto-assess', async (_, recordingId: string) => {
    try {
      const assessment = await qualityService.autoAssess(recordingId)
      return { success: true, data: assessment }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  /**
   * Get all recordings with a specific quality level
   */
  ipcMain.handle('quality:get-by-quality', async (_, quality: QualityLevel) => {
    try {
      const recordings = qualityService.getByQuality(quality)
      return { success: true, data: recordings }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  /**
   * Batch auto-assess multiple recordings
   */
  ipcMain.handle('quality:batch-auto-assess', async (_, recordingIds: string[]) => {
    try {
      const assessments = await qualityService.batchAutoAssess(recordingIds)
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
  ipcMain.handle('storage:get-by-tier', async (_, tier: StorageTier) => {
    try {
      const recordings = storageService.getByTier(tier)
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
    async (_, minAgeOverride?: Partial<Record<StorageTier, number>>) => {
      try {
        const suggestions = storageService.getCleanupSuggestions(minAgeOverride)
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
    async (_, tier: StorageTier, minAgeDays?: number) => {
      try {
        const suggestions = storageService.getCleanupSuggestionsForTier(tier, minAgeDays)
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
    async (_, recordingIds: string[], archive: boolean = false) => {
      try {
        const result = await storageService.executeCleanup(recordingIds, archive)
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
  ipcMain.handle('storage:assign-tier', async (_, recordingId: string, quality: QualityLevel) => {
    try {
      storageService.assignTier(recordingId, quality)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  console.log('[IPC] Quality and Storage handlers registered')
}
