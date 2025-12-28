/**
 * StoragePolicyService - Manages storage tier assignment and cleanup policies
 * Subscribes to QualityAssessed events and automatically assigns tiers
 */

import {
  getRecordingById,
  getRecordingByIdAsync,
  updateRecordingStorageTier,
  updateRecordingStorageTierAsync,
  getRecordingsByStorageTier,
  queryAll,
  getQualityAssessmentAsync,
  Recording,
  deleteRecordingLocal
} from './database'
import { 
  getEventBus,
  QualityAssessedEvent,
  StorageTierAssignedEvent,
  RecordingCleanupSuggestedEvent
} from './event-bus'
import { QualityLevel } from './quality-assessment'

// Define storage tiers
export type StorageTier = 'hot' | 'warm' | 'cold' | 'archive'

// Retention policies (in days)
const TIER_RETENTION_DAYS: Record<StorageTier, number> = {
  hot: 30, // Keep locally for 30 days
  warm: 90, // Keep for 90 days
  cold: 180, // Keep for 180 days
  archive: 365 // Keep indefinitely (or until manual cleanup)
}

// Map quality to initial storage tier
const STORAGE_POLICIES: Record<QualityLevel, StorageTier> = {
  high: 'hot',
  medium: 'warm',
  low: 'cold'
}

export interface CleanupSuggestion {
  recordingId: string
  filename: string
  dateRecorded: string
  currentTier: StorageTier
  suggestedTier: StorageTier | null
  quality?: QualityLevel
  ageInDays: number
  sizeBytes: number | null
  reason: string
  hasTranscript: boolean
  hasMeeting: boolean
  actionableId?: string
}

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
        const quality = qualityMap.get(recording.id)

        suggestions.push({
          recordingId: recording.id,
          filename: recording.filename,
          dateRecorded: recording.date_recorded,
          currentTier: tier,
          suggestedTier: this.getNextLowerTier(tier),
          quality,
          ageInDays,
          sizeBytes: recording.file_size ?? null,
          reason: `Exceeds ${tier} tier retention (${maxAge} days) by ${ageInDays - maxAge} days`,
          hasTranscript: recording.transcription_status === 'complete',
          hasMeeting: !!recording.meeting_id,
          actionableId: (recording as any).actionable_id // If linked
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
    return allSuggestions.filter((s) => s.currentTier === tier)
  }

  /**
   * Execute cleanup for a list of recording IDs
   */
  async executeCleanup(recordingIds: string[]): Promise<{
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

        // Check if quality assessment exists
        const quality = await getQualityAssessmentAsync(recording.id)

        if (quality) {
          const currentTier = recording.storage_tier || 'hot'
          const nextTier = this.getNextLowerTier(currentTier as StorageTier)
          if (nextTier) {
            updateRecordingStorageTier(recordingId, nextTier)
            archived.push(recordingId)
            console.log(`[StoragePolicy] Archived ${recordingId} from ${currentTier} to ${nextTier}`)
          } else {
            failed.push({ id: recordingId, reason: 'Already at lowest tier' })
          }
        } else {
          // Delete local file
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
    const stats: {
      tier: StorageTier
      count: number
      totalSizeBytes: number
      avgAgeDays: number
    }[] = []
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