// TODO: W1-HS-08: This store is not consumed by any component. Wire it to the Library page or remove it.
/**
 * Quality Store (Feature)
 *
 * Manages quality assessments for knowledge captures (recordings).
 * Supports filtering by quality ratings: valuable, archived, low-value, garbage, unrated.
 * Uses subscribeWithSelector middleware for fine-grained subscriptions.
 */

import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { subscribeWithSelector } from 'zustand/middleware'

export type QualityRating = 'valuable' | 'archived' | 'low-value' | 'garbage' | 'unrated'

export interface QualityAssessment {
  recordingId: string
  rating: QualityRating
  notes?: string
  assessedAt: Date
}

export interface QualityStore {
  // State
  assessments: Map<string, QualityAssessment>
  loading: boolean

  // Actions
  setQuality: (recordingId: string, rating: QualityRating, notes?: string) => void
  getQuality: (recordingId: string) => QualityRating
  removeQuality: (recordingId: string) => void
  bulkSetQuality: (recordingIds: string[], rating: QualityRating) => void

  // Async Actions
  loadAssessments: () => Promise<void>
  saveAssessment: (recordingId: string, rating: QualityRating, notes?: string) => Promise<void>
}

export const useQualityStore = create<QualityStore>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    assessments: new Map(),
    loading: false,

    // Actions
    setQuality: (recordingId, rating, notes) => {
      set((state) => {
        const assessments = new Map(state.assessments)
        assessments.set(recordingId, {
          recordingId,
          rating,
          notes,
          assessedAt: new Date()
        })
        return { assessments }
      })
    },

    getQuality: (recordingId) => {
      const assessment = get().assessments.get(recordingId)
      return assessment ? assessment.rating : 'unrated'
    },

    removeQuality: (recordingId) => {
      set((state) => {
        const assessments = new Map(state.assessments)
        assessments.delete(recordingId)
        return { assessments }
      })
    },

    bulkSetQuality: (recordingIds, rating) => {
      set((state) => {
        const assessments = new Map(state.assessments)
        recordingIds.forEach((id) => {
          assessments.set(id, {
            recordingId: id,
            rating,
            assessedAt: new Date()
          })
        })
        return { assessments }
      })
    },

    // Async Actions
    loadAssessments: async () => {
      set({ loading: true })
      try {
        // ACTION ITEM: No bulk quality assessment API exists yet.
        // The quality API (window.electronAPI.quality) only supports per-recording
        // queries and uses a different rating scale ('high'|'medium'|'low') than
        // this store's QualityRating ('valuable'|'archived'|'low-value'|'garbage'|'unrated').
        // Needs: 1) Backend bulk getter endpoint  2) Rating system alignment
        console.warn('[useQualityStore] loadAssessments: No bulk API available yet')
        set({ loading: false })
      } catch (error) {
        console.error('Failed to load quality assessments:', error)
        set({ loading: false })
      }
    },

    saveAssessment: async (recordingId, rating, notes) => {
      try {
        // Update local state immediately
        get().setQuality(recordingId, rating, notes)

        // ACTION ITEM: Quality API uses different rating scale ('high'|'medium'|'low')
        // than this store's QualityRating ('valuable'|'archived'|'low-value'|'garbage'|'unrated').
        // Persisting to backend requires rating system alignment.
        // Backend API: window.electronAPI.quality.set(recordingId, quality, reason, assessedBy)
        console.warn(`[useQualityStore] saveAssessment: Backend persistence skipped (rating mismatch)`)
      } catch (error) {
        console.error(`Failed to save quality assessment for ${recordingId}:`, error)
      }
    }
  }))
)

// =============================================================================
// Selector Hooks
// =============================================================================

/**
 * Get quality rating for a specific recording
 */
export const useRecordingQuality = (recordingId: string | null) => {
  return useQualityStore((state) => (recordingId ? state.getQuality(recordingId) : 'unrated'))
}

/**
 * Get all recordings with a specific quality rating
 */
export const useRecordingsByQuality = (rating: QualityRating) => {
  return useQualityStore(useShallow((state) => {
    const recordingIds: string[] = []
    state.assessments.forEach((assessment) => {
      if (assessment.rating === rating) {
        recordingIds.push(assessment.recordingId)
      }
    })
    return recordingIds
  }))
}

/**
 * Get quality statistics
 */
export const useQualityStats = () => {
  return useQualityStore(useShallow((state) => {
    const stats = {
      valuable: 0,
      archived: 0,
      'low-value': 0,
      garbage: 0,
      unrated: 0,
      total: 0
    }

    state.assessments.forEach((assessment) => {
      stats[assessment.rating]++
      stats.total++
    })

    return stats
  }))
}

/**
 * Check if a recording has been rated
 */
export const useIsRecordingRated = (recordingId: string | null) => {
  return useQualityStore((state) => (recordingId ? state.assessments.has(recordingId) : false))
}
