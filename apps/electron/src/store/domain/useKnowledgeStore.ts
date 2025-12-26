/**
 * Knowledge Store (Domain)
 *
 * Manages KnowledgeCapture entities - the core knowledge items in the system.
 * KnowledgeCapture represents transcribed conversations, meetings, and insights.
 * Uses subscribeWithSelector middleware for fine-grained subscriptions.
 */

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { RecordingWithTranscript } from '@/types'

// Type alias for clarity - Recording is the current name, but conceptually it's KnowledgeCapture
export type KnowledgeCapture = RecordingWithTranscript

export interface KnowledgeStore {
  // State
  items: KnowledgeCapture[]
  byId: Map<string, KnowledgeCapture>
  loading: boolean
  error: string | null

  // CRUD Actions
  setItems: (items: KnowledgeCapture[]) => void
  addItem: (item: KnowledgeCapture) => void
  updateItem: (id: string, updates: Partial<KnowledgeCapture>) => void
  removeItem: (id: string) => void

  // Async Actions
  loadItems: () => Promise<void>
  refreshItem: (id: string) => Promise<void>
}

export const useKnowledgeStore = create<KnowledgeStore>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    items: [],
    byId: new Map(),
    loading: false,
    error: null,

    // CRUD Actions
    setItems: (items) => {
      const byId = new Map<string, KnowledgeCapture>()
      items.forEach((item) => byId.set(item.id, item))
      set({ items, byId })
    },

    addItem: (item) => {
      set((state) => {
        const byId = new Map(state.byId)
        byId.set(item.id, item)
        return {
          items: [...state.items, item],
          byId
        }
      })
    },

    updateItem: (id, updates) => {
      set((state) => {
        const existing = state.byId.get(id)
        if (!existing) return state

        const updated = { ...existing, ...updates }
        const byId = new Map(state.byId)
        byId.set(id, updated)

        return {
          items: state.items.map((item) => (item.id === id ? updated : item)),
          byId
        }
      })
    },

    removeItem: (id) => {
      set((state) => {
        const byId = new Map(state.byId)
        byId.delete(id)
        return {
          items: state.items.filter((item) => item.id !== id),
          byId
        }
      })
    },

    // Async Actions
    loadItems: async () => {
      set({ loading: true, error: null })
      try {
        const recordings = await window.electronAPI.recordings.getAll()
        get().setItems(recordings)
        set({ loading: false })
      } catch (error) {
        console.error('Failed to load knowledge items:', error)
        set({ loading: false, error: String(error) })
      }
    },

    refreshItem: async (id) => {
      try {
        const result = await window.electronAPI.recordings.getById(id)
        if (result.success) {
          get().updateItem(id, result.data)
        }
      } catch (error) {
        console.error(`Failed to refresh knowledge item ${id}:`, error)
      }
    }
  }))
)

// =============================================================================
// Selector Hooks
// =============================================================================

/**
 * Get a knowledge item by ID
 */
export const useKnowledgeById = (id: string | null) => {
  return useKnowledgeStore((state) => (id ? state.byId.get(id) : null))
}

/**
 * Get knowledge items by meeting ID
 */
export const useKnowledgeByMeeting = (meetingId: string | null) => {
  return useKnowledgeStore((state) =>
    meetingId ? state.items.filter((item) => item.meeting_id === meetingId) : []
  )
}

/**
 * Get knowledge items by location (proximity match)
 */
export const useKnowledgeByLocation = (location: string | null) => {
  return useKnowledgeStore((state) =>
    location
      ? state.items.filter((item) => {
          // Simple substring match for now - could be enhanced with fuzzy matching
          const itemLocation = item.filename?.toLowerCase() || ''
          return itemLocation.includes(location.toLowerCase())
        })
      : []
  )
}

/**
 * Get knowledge items by status
 */
export const useKnowledgeByStatus = (
  status: 'pending' | 'transcribing' | 'transcribed' | 'error'
) => {
  return useKnowledgeStore((state) => state.items.filter((item) => item.status === status))
}

/**
 * Get all transcribed knowledge items
 */
export const useTranscribedKnowledge = () => {
  return useKnowledgeStore((state) =>
    state.items.filter((item) => item.status === 'transcribed' && item.transcript)
  )
}
