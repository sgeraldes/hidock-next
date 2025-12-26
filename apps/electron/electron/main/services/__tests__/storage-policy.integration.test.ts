/**
 * Integration tests for storage policy service
 *
 * Tests quality-based storage tier mapping and event emission
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Storage tiers based on quality
 */
type StorageTier = 'premium' | 'standard' | 'archive'
type Quality = 'high' | 'medium' | 'low' | 'unrated'

interface QualityAssessment {
  id: string
  recording_id: string
  quality: Quality
  confidence_score?: number
  word_count?: number
  has_summary: boolean
  has_action_items: boolean
  assessed_at: string
  reason?: string
}

interface StoragePolicy {
  recording_id: string
  tier: StorageTier
  retention_days: number
  auto_delete_enabled: boolean
  last_accessed?: string
}

interface DomainEvent {
  type: string
  timestamp: string
  payload: any
}

/**
 * Map quality to storage tier
 *
 * - High quality -> Premium tier (unlimited retention)
 * - Medium quality -> Standard tier (180 days retention)
 * - Low quality -> Archive tier (30 days retention)
 * - Unrated -> Standard tier (90 days retention, until assessed)
 */
function mapQualityToTier(quality: Quality): { tier: StorageTier; retention_days: number } {
  switch (quality) {
    case 'high':
      return { tier: 'premium', retention_days: -1 } // -1 = unlimited
    case 'medium':
      return { tier: 'standard', retention_days: 180 }
    case 'low':
      return { tier: 'archive', retention_days: 30 }
    case 'unrated':
      return { tier: 'standard', retention_days: 90 }
  }
}

/**
 * Storage Policy Service
 */
class StoragePolicyService {
  constructor(
    private db: any,
    private eventBus: any
  ) {}

  /**
   * Apply storage policy based on quality assessment
   */
  async applyPolicyForRecording(recordingId: string): Promise<StoragePolicy> {
    // Get quality assessment
    const assessment: QualityAssessment | null = await this.db.getQualityAssessment(recordingId)

    if (!assessment) {
      throw new Error(`No quality assessment found for recording ${recordingId}`)
    }

    // Map quality to tier
    const { tier, retention_days } = mapQualityToTier(assessment.quality)

    // Create or update storage policy
    const policy: StoragePolicy = {
      recording_id: recordingId,
      tier,
      retention_days,
      auto_delete_enabled: tier === 'archive' // Auto-delete only for archive tier
    }

    await this.db.saveStoragePolicy(policy)

    // Emit event
    const event: DomainEvent = {
      type: 'StoragePolicyApplied',
      timestamp: new Date().toISOString(),
      payload: {
        recordingId,
        tier,
        retention_days,
        quality: assessment.quality
      }
    }
    this.eventBus.emit('domain-event', event)

    return policy
  }

  /**
   * Execute cleanup for recordings past retention period
   */
  async executeCleanup(): Promise<{ deletedCount: number; freedSpace: number }> {
    const policies = await this.db.getExpiredPolicies()
    let deletedCount = 0
    let freedSpace = 0

    for (const policy of policies) {
      if (policy.auto_delete_enabled) {
        try {
          const recording = await this.db.getRecording(policy.recording_id)
          if (recording) {
            await this.db.deleteRecording(policy.recording_id)
            await this.db.deleteStoragePolicy(policy.recording_id)
            deletedCount++
            freedSpace += recording.file_size || 0
          }
        } catch (error) {
          console.error(`Failed to delete recording ${policy.recording_id}:`, error)
        }
      }
    }

    // Emit cleanup event
    const event: DomainEvent = {
      type: 'CleanupExecuted',
      timestamp: new Date().toISOString(),
      payload: {
        deletedCount,
        freedSpace
      }
    }
    this.eventBus.emit('domain-event', event)

    return { deletedCount, freedSpace }
  }
}

describe('mapQualityToTier', () => {
  it('should map high quality to premium tier with unlimited retention', () => {
    const result = mapQualityToTier('high')
    expect(result.tier).toBe('premium')
    expect(result.retention_days).toBe(-1)
  })

  it('should map medium quality to standard tier with 180 days retention', () => {
    const result = mapQualityToTier('medium')
    expect(result.tier).toBe('standard')
    expect(result.retention_days).toBe(180)
  })

  it('should map low quality to archive tier with 30 days retention', () => {
    const result = mapQualityToTier('low')
    expect(result.tier).toBe('archive')
    expect(result.retention_days).toBe(30)
  })

  it('should map unrated to standard tier with 90 days retention', () => {
    const result = mapQualityToTier('unrated')
    expect(result.tier).toBe('standard')
    expect(result.retention_days).toBe(90)
  })
})

describe('StoragePolicyService', () => {
  let service: StoragePolicyService
  let mockDb: any
  let mockEventBus: any

  beforeEach(() => {
    mockDb = {
      getQualityAssessment: vi.fn(),
      saveStoragePolicy: vi.fn(),
      getExpiredPolicies: vi.fn(),
      getRecording: vi.fn(),
      deleteRecording: vi.fn(),
      deleteStoragePolicy: vi.fn()
    }

    mockEventBus = {
      emit: vi.fn()
    }

    service = new StoragePolicyService(mockDb, mockEventBus)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('applyPolicyForRecording', () => {
    it('should apply premium tier for high quality recording', async () => {
      const assessment: QualityAssessment = {
        id: 'qa-1',
        recording_id: 'rec-1',
        quality: 'high',
        confidence_score: 0.9,
        word_count: 1000,
        has_summary: true,
        has_action_items: true,
        assessed_at: new Date().toISOString()
      }

      mockDb.getQualityAssessment.mockResolvedValue(assessment)

      const policy = await service.applyPolicyForRecording('rec-1')

      expect(policy.tier).toBe('premium')
      expect(policy.retention_days).toBe(-1)
      expect(policy.auto_delete_enabled).toBe(false)

      expect(mockDb.saveStoragePolicy).toHaveBeenCalledWith(
        expect.objectContaining({
          recording_id: 'rec-1',
          tier: 'premium'
        })
      )

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'domain-event',
        expect.objectContaining({
          type: 'StoragePolicyApplied',
          payload: expect.objectContaining({
            recordingId: 'rec-1',
            tier: 'premium',
            quality: 'high'
          })
        })
      )
    })

    it('should apply archive tier for low quality recording with auto-delete', async () => {
      const assessment: QualityAssessment = {
        id: 'qa-2',
        recording_id: 'rec-2',
        quality: 'low',
        confidence_score: 0.4,
        word_count: 50,
        has_summary: false,
        has_action_items: false,
        assessed_at: new Date().toISOString()
      }

      mockDb.getQualityAssessment.mockResolvedValue(assessment)

      const policy = await service.applyPolicyForRecording('rec-2')

      expect(policy.tier).toBe('archive')
      expect(policy.retention_days).toBe(30)
      expect(policy.auto_delete_enabled).toBe(true)
    })

    it('should apply standard tier for medium quality recording', async () => {
      const assessment: QualityAssessment = {
        id: 'qa-3',
        recording_id: 'rec-3',
        quality: 'medium',
        confidence_score: 0.7,
        word_count: 300,
        has_summary: true,
        has_action_items: false,
        assessed_at: new Date().toISOString()
      }

      mockDb.getQualityAssessment.mockResolvedValue(assessment)

      const policy = await service.applyPolicyForRecording('rec-3')

      expect(policy.tier).toBe('standard')
      expect(policy.retention_days).toBe(180)
      expect(policy.auto_delete_enabled).toBe(false)
    })

    it('should throw error if no quality assessment exists', async () => {
      mockDb.getQualityAssessment.mockResolvedValue(null)

      await expect(service.applyPolicyForRecording('rec-999')).rejects.toThrow(
        'No quality assessment found'
      )
    })
  })

  describe('executeCleanup', () => {
    it('should delete expired recordings and emit cleanup event', async () => {
      const expiredPolicies: StoragePolicy[] = [
        {
          recording_id: 'rec-old-1',
          tier: 'archive',
          retention_days: 30,
          auto_delete_enabled: true
        },
        {
          recording_id: 'rec-old-2',
          tier: 'archive',
          retention_days: 30,
          auto_delete_enabled: true
        }
      ]

      mockDb.getExpiredPolicies.mockResolvedValue(expiredPolicies)
      mockDb.getRecording.mockImplementation((id: string) => {
        return Promise.resolve({
          id,
          filename: `${id}.hda`,
          file_size: 1024 * 1024 // 1 MB
        })
      })

      const result = await service.executeCleanup()

      expect(result.deletedCount).toBe(2)
      expect(result.freedSpace).toBe(2 * 1024 * 1024) // 2 MB

      expect(mockDb.deleteRecording).toHaveBeenCalledTimes(2)
      expect(mockDb.deleteStoragePolicy).toHaveBeenCalledTimes(2)

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'domain-event',
        expect.objectContaining({
          type: 'CleanupExecuted',
          payload: {
            deletedCount: 2,
            freedSpace: 2 * 1024 * 1024
          }
        })
      )
    })

    it('should skip recordings with auto_delete_enabled=false', async () => {
      const expiredPolicies: StoragePolicy[] = [
        {
          recording_id: 'rec-keep',
          tier: 'standard',
          retention_days: 180,
          auto_delete_enabled: false
        }
      ]

      mockDb.getExpiredPolicies.mockResolvedValue(expiredPolicies)

      const result = await service.executeCleanup()

      expect(result.deletedCount).toBe(0)
      expect(result.freedSpace).toBe(0)
      expect(mockDb.deleteRecording).not.toHaveBeenCalled()
    })

    it('should handle deletion errors gracefully', async () => {
      const expiredPolicies: StoragePolicy[] = [
        {
          recording_id: 'rec-error',
          tier: 'archive',
          retention_days: 30,
          auto_delete_enabled: true
        }
      ]

      mockDb.getExpiredPolicies.mockResolvedValue(expiredPolicies)
      mockDb.getRecording.mockRejectedValue(new Error('Database error'))

      const result = await service.executeCleanup()

      expect(result.deletedCount).toBe(0)
      expect(result.freedSpace).toBe(0)
      // Should still emit event even if no deletions occurred
      expect(mockEventBus.emit).toHaveBeenCalled()
    })

    it('should return zero counts when no expired policies exist', async () => {
      mockDb.getExpiredPolicies.mockResolvedValue([])

      const result = await service.executeCleanup()

      expect(result.deletedCount).toBe(0)
      expect(result.freedSpace).toBe(0)
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'domain-event',
        expect.objectContaining({
          type: 'CleanupExecuted',
          payload: {
            deletedCount: 0,
            freedSpace: 0
          }
        })
      )
    })
  })
})
