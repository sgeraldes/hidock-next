import {
  getRecordingById,
  getRecordingsByStorageTier,
  updateRecordingStorageTier,
  getQualityAssessment,
  getRecordingByIdAsync,
  updateRecordingStorageTierAsync,
  getQualityAssessmentAsync,
  type Recording,
  queryAll
} from './database'
import { getEventBus } from './event-bus'
import type { StorageTierAssignedEvent, RecordingCleanupSuggestedEvent, QualityAssessedEvent } from './event-bus'

export type StorageTier = 'hot' | 'warm' | 'cold' | 'archive'
export type QualityLevel = 'high' | 'medium' | 'low'

/**
 * Storage Policy - Maps quality levels to storage tiers
 * This defines the business rules for where recordings should be stored
 */
export const STORAGE_POLICIES: Record<QualityLevel, StorageTier> = {
  high: 'hot', // High-quality: keep readily accessible
  medium: 'warm', // Medium-quality: accessible but can be slower
  low: 'cold' // Low-quality: archive or cleanup candidate
}

/**
 * Tier Retention Policies - Days before suggesting cleanup
 */
export const TIER_RETENTION_DAYS: Record<StorageTier, number> = {
  hot: 365, // Keep high-quality for 1 year
  warm: 180, // Medium-quality for 6 months
  cold: 90, // Low-quality for 3 months
  archive: 30 // Archive for 1 month before suggesting deletion
}

export interface CleanupSuggestion {
  recordingId: string
  filename: string
  dateRecorded: string
  tier: StorageTier
  quality?: QualityLevel
  ageInDays: number
  sizeBytes?: number
  reason: string
  hasTranscript: boolean
  hasMeeting: boolean
}

/**
 * StoragePolicyService - Manages storage tier assignment and cleanup policies
 * Subscribes to QualityAssessed events and automatically assigns tiers
 */
export class StoragePolicyService {
  constructor() {
    // Subscribe to quality assessment events
    this.setupEventSubscriptions()
  }

  /**
   * Setup event subscriptions for reactive tier assignment
   */
  private setupEventSubscriptions(): void {
    const eventBus = getEventBus()

    // When quality is assessed, automatically assign storage tier
    eventBus.onDomainEvent<QualityAssessedEvent>('quality:assessed', async (event) => {
      const { recordingId, quality } = event.payload
      await this.assignTierAsync(recordingId, quality)
    })

    console.log('[StoragePolicyService] Event subscriptions initialized')
  }

  /**
   * Assign storage tier based on quality level (async version - prevents main thread blocking)
   */
  async assignTierAsync(recordingId: string, quality: QualityLevel): Promise<void> {
    const recording = await getRecordingByIdAsync(recordingId)
    if (!recording) {
      console.error(`[StoragePolicy] Recording not found: ${recordingId}`)
      return
    }

    const tier = STORAGE_POLICIES[quality]
    const previousTier = recording.storage_tier

    // Update database
    await updateRecordingStorageTierAsync(recordingId, tier)

    // Emit domain event
    const event: StorageTierAssignedEvent = {
      type: 'storage:tier-assigned',
      timestamp: new Date().toISOString(),
      payload: {
        recordingId,
        tier,
        previousTier: previousTier || undefined,
        reason: `Quality-based tier assignment: ${quality} -> ${tier}`
      }
    }
    getEventBus().emitDomainEvent(event)

    console.log(`[StoragePolicy] Assigned tier ${tier} to recording ${recordingId} (quality: ${quality})`)
  }

  /**
   * Assign storage tier based on quality level (sync version - use assignTierAsync for non-blocking)
   */
  assignTier(recordingId: string, quality: QualityLevel): void {
    const recording = getRecordingById(recordingId)
    if (!recording) {
      console.error(`[StoragePolicy] Recording not found: ${recordingId}`)
      return
    }

    const tier = STORAGE_POLICIES[quality]
    const previousTier = recording.storage_tier

    // Update database
    updateRecordingStorageTier(recordingId, tier)

    // Emit domain event
    const event: StorageTierAssignedEvent = {
      type: 'storage:tier-assigned',
      timestamp: new Date().toISOString(),
      payload: {
        recordingId,
        tier,
        previousTier: previousTier || undefined,
        reason: `Quality-based tier assignment: ${quality} -> ${tier}`
      }
    }
    getEventBus().emitDomainEvent(event)

    console.log(`[StoragePolicy] Assigned tier ${tier} to recording ${recordingId} (quality: ${quality})`)
  }

  /**
   * Get recordings by storage tier
   */
  getByTier(tier: StorageTier): Recording[] {
    return getRecordingsByStorageTier(tier)
  }

  /**
   * Get cleanup suggestions based on retention policies
   * Returns recordings that exceed their tier's retention period
   */
  getCleanupSuggestions(minAgeOverride?: Partial<Record<StorageTier, number>>): CleanupSuggestion[] {
    const suggestions: CleanupSuggestion[] = []
    const now = new Date()

    // Override retention days if provided
    const retentionDays = { ...TIER_RETENTION_DAYS, ...minAgeOverride }

    const tiers: StorageTier[] = ['archive', 'cold', 'warm', 'hot']

    for (const tier of tiers) {
      const maxAge = retentionDays[tier]
      const cutoffDate = new Date(now.getTime() - maxAge * 24 * 60 * 60 * 1000).toISOString()

      // Indexed query with date filter - much faster than full table scan
      const recordings = queryAll<Recording>(
        `SELECT * FROM recordings 
         WHERE storage_tier = ? AND date_recorded < ?
         ORDER BY date_recorded ASC
         LIMIT 1000`,
        [tier, cutoffDate]
      )

      if (recordings.length === 0) continue

      // Batch load quality assessments for this tier's recordings
      const recordingIds = recordings.map((r) => r.id)
      const placeholders = recordingIds.map(() => '?').join(',')
      const qualities = queryAll<{ recording_id: string; quality: QualityLevel }>(
        `SELECT recording_id, quality FROM quality_assessments WHERE recording_id IN (${placeholders})`,
        recordingIds
      )
      const qualityMap = new Map(qualities.map((q) => [q.recording_id, q.quality]))

      // Process recordings in memory
      for (const recording of recordings) {
        const recordedDate = new Date(recording.date_recorded)
        const ageMs = now.getTime() - recordedDate.getTime()
        const ageInDays = Math.floor(ageMs / (1000 * 60 * 60 * 24))

        suggestions.push({
          recordingId: recording.id,
          filename: recording.filename,
          dateRecorded: recording.date_recorded,
          tier,
          quality: qualityMap.get(recording.id),
          ageInDays,
          sizeBytes: recording.file_size,
          reason: `Exceeds ${tier} tier retention (${maxAge} days) by ${ageInDays - maxAge} days`,
          hasTranscript: recording.transcription_status === 'complete',
          hasMeeting: !!recording.meeting_id
        })
      }
    }

    // Sort by age (oldest first)
    suggestions.sort((a, b) => b.ageInDays - a.ageInDays)

    return suggestions
  }

  /**
   * Get cleanup suggestions for a specific tier
   */
  getCleanupSuggestionsForTier(tier: StorageTier, minAgeDays?: number): CleanupSuggestion[] {
    const override = minAgeDays ? { [tier]: minAgeDays } : undefined
    const allSuggestions = this.getCleanupSuggestions(override)
    return allSuggestions.filter((s) => s.tier === tier)
  }

  /**
   * Execute cleanup for a list of recording IDs
   * This will:
   * - Delete local files
   * - Update recording location to 'deleted' or 'device-only'
   * - Optionally archive tier to next lower tier instead of deletion
   */
  async executeCleanup(recordingIds: string[], archive: boolean = false): Promise<{
    deleted: string[]
    archived: string[]
    failed: { id: string; reason: string }[]
  }> {
    const deleted: string[] = []
    const archived: string[] = []
    const failed: { id: string; reason: string }[] = []

    for (const recordingId of recordingIds) {
      try {
        const recording = getRecordingById(recordingId)
        if (!recording) {
          failed.push({ id: recordingId, reason: 'Recording not found' })
          continue
        }

        if (archive) {
          // Move to next lower tier
          const currentTier = recording.storage_tier
          const nextTier = this.getNextLowerTier(currentTier)

          if (nextTier) {
            updateRecordingStorageTier(recordingId, nextTier)
            archived.push(recordingId)
            console.log(`[StoragePolicy] Archived ${recordingId} from ${currentTier} to ${nextTier}`)
          } else {
            failed.push({ id: recordingId, reason: 'Already at lowest tier' })
          }
        } else {
          // Delete local file (implementation would call file-storage service)
          // For now, just mark as deleted
          const { deleteRecordingLocal } = await import('./database')
          deleteRecordingLocal(recordingId)
          deleted.push(recordingId)
          console.log(`[StoragePolicy] Deleted local file for ${recordingId}`)
        }
      } catch (error) {
        failed.push({
          id: recordingId,
          reason: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }

    // Emit cleanup event
    if (deleted.length > 0 || archived.length > 0) {
      const event: RecordingCleanupSuggestedEvent = {
        type: 'storage:cleanup-suggested',
        timestamp: new Date().toISOString(),
        payload: {
          recordingIds: [...deleted, ...archived],
          tier: 'archive',
          reason: `Cleanup executed: ${deleted.length} deleted, ${archived.length} archived`
        }
      }
      getEventBus().emitDomainEvent(event)
    }

    return { deleted, archived, failed }
  }

  /**
   * Get the next lower storage tier
   */
  private getNextLowerTier(currentTier: StorageTier | null): StorageTier | null {
    const tierOrder: StorageTier[] = ['hot', 'warm', 'cold', 'archive']
    const currentIndex = currentTier ? tierOrder.indexOf(currentTier) : -1

    if (currentIndex === -1 || currentIndex === tierOrder.length - 1) {
      return null // Already at lowest or invalid
    }

    return tierOrder[currentIndex + 1]
  }

  /**
   * Get storage statistics by tier
   */
  getStorageStats(): {
    tier: StorageTier
    count: number
    totalSizeBytes: number
    avgAgeDays: number
  }[] {
    const tiers: StorageTier[] = ['hot', 'warm', 'cold', 'archive']
    const stats = []
    const now = new Date()

    // OPTIMIZED: Query all tiered recordings once
    const allRecordings = queryAll<Recording>(
      'SELECT * FROM recordings WHERE storage_tier IS NOT NULL'
    )

    // Partition by tier in memory
    const recordingsByTier = new Map<StorageTier, Recording[]>()
    for (const recording of allRecordings) {
      const tier = recording.storage_tier as StorageTier
      if (!recordingsByTier.has(tier)) {
        recordingsByTier.set(tier, [])
      }
      recordingsByTier.get(tier)!.push(recording)
    }

    for (const tier of tiers) {
      const recordings = recordingsByTier.get(tier) || []
      const totalSize = recordings.reduce((sum, r) => sum + (r.file_size || 0), 0)

      const ages = recordings.map((r) => {
        const recordedDate = new Date(r.date_recorded)
        const ageMs = now.getTime() - recordedDate.getTime()
        return Math.floor(ageMs / (1000 * 60 * 60 * 24))
      })

      const avgAge = ages.length > 0 ? Math.floor(ages.reduce((sum, age) => sum + age, 0) / ages.length) : 0

      stats.push({
        tier,
        count: recordings.length,
        totalSizeBytes: totalSize,
        avgAgeDays: avgAge
      })
    }

    return stats
  }

  /**
   * Initialize storage tiers for recordings without quality assessments
   * Assigns default 'warm' tier to untiered recordings
   */
  async initializeUntieredRecordings(): Promise<number> {
    const untiered = queryAll<Recording>(`
      SELECT * FROM recordings WHERE storage_tier IS NULL
    `)

    console.log(`[StoragePolicy] Found ${untiered.length} untiered recordings`)

    for (const recording of untiered) {
      // Check if quality assessment exists
      const quality = await getQualityAssessmentAsync(recording.id)

      if (quality) {
        // Use quality-based tier (async to prevent blocking)
        await this.assignTierAsync(recording.id, quality.quality)
      } else {
        // Default to 'warm' tier for unassessed recordings
        await updateRecordingStorageTierAsync(recording.id, 'warm')
        console.log(`[StoragePolicy] Assigned default 'warm' tier to ${recording.id}`)
      }
    }

    return untiered.length
  }
}

// Singleton instance
let storagePolicyServiceInstance: StoragePolicyService | null = null

export function getStoragePolicyService(): StoragePolicyService {
  if (!storagePolicyServiceInstance) {
    storagePolicyServiceInstance = new StoragePolicyService()
  }
  return storagePolicyServiceInstance
}
