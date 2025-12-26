import {
  getRecordingById,
  getRecordingsByStorageTier,
  updateRecordingStorageTier,
  getQualityAssessment,
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
    eventBus.onDomainEvent<QualityAssessedEvent>('quality:assessed', (event) => {
      const { recordingId, quality } = event.payload
      this.assignTier(recordingId, quality)
    })

    console.log('[StoragePolicyService] Event subscriptions initialized')
  }

  /**
   * Assign storage tier based on quality level
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

    // Check each tier
    const tiers: StorageTier[] = ['archive', 'cold', 'warm', 'hot']

    for (const tier of tiers) {
      const recordings = this.getByTier(tier)
      const maxAge = retentionDays[tier]

      for (const recording of recordings) {
        const recordedDate = new Date(recording.date_recorded)
        const ageMs = now.getTime() - recordedDate.getTime()
        const ageInDays = Math.floor(ageMs / (1000 * 60 * 60 * 24))

        if (ageInDays > maxAge) {
          const qualityAssessment = getQualityAssessment(recording.id)

          suggestions.push({
            recordingId: recording.id,
            filename: recording.filename,
            dateRecorded: recording.date_recorded,
            tier,
            quality: qualityAssessment?.quality,
            ageInDays,
            sizeBytes: recording.file_size,
            reason: `Exceeds ${tier} tier retention (${maxAge} days) by ${ageInDays - maxAge} days`,
            hasTranscript: recording.transcription_status === 'complete',
            hasMeeting: !!recording.meeting_id
          })
        }
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

    for (const tier of tiers) {
      const recordings = this.getByTier(tier)
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
      const quality = getQualityAssessment(recording.id)

      if (quality) {
        // Use quality-based tier
        this.assignTier(recording.id, quality.quality)
      } else {
        // Default to 'warm' tier for unassessed recordings
        updateRecordingStorageTier(recording.id, 'warm')
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
