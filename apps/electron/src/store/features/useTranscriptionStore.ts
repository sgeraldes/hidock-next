/**
 * Transcription Store (Feature)
 *
 * Manages transcription queue for recordings.
 * Tracks processing status, handles retries, and manages AI transcription workflow.
 * Uses subscribeWithSelector middleware for fine-grained subscriptions.
 */

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import { useShallow } from 'zustand/react/shallow'

export type TranscriptionStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface TranscriptionItem {
  id: string // Queue item ID
  recordingId: string
  filename: string
  status: TranscriptionStatus
  progress: number // 0-100 (estimated)
  error?: string
  retryCount: number
  attempts: number
  startedAt?: Date
  completedAt?: Date
  provider?: string // 'gemini', etc.
}

export interface TranscriptionQueueStore {
  // State
  queue: Map<string, TranscriptionItem>
  processing: Set<string>
  maxConcurrent: number

  // Actions
  addToQueue: (id: string, recordingId: string, filename: string) => void
  updateProgress: (id: string, progress: number) => void
  markCompleted: (id: string, provider: string) => void
  markFailed: (id: string, error: string) => void
  retry: (id: string) => void
  remove: (id: string) => void
  clear: () => void

  // Queries
  isProcessing: (recordingId: string) => boolean
  getStatus: (recordingId: string) => TranscriptionStatus | null
  getProgress: (recordingId: string) => number | null
}

export const useTranscriptionStore = create<TranscriptionQueueStore>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    queue: new Map(),
    processing: new Set(),
    maxConcurrent: 2,

    // Actions
    addToQueue: (id, recordingId, filename) => {
      set((state) => {
        const queue = new Map(state.queue)
        queue.set(id, {
          id,
          recordingId,
          filename,
          status: 'pending',
          progress: 0,
          retryCount: 0,
          attempts: 0
        })
        return { queue }
      })
    },

    updateProgress: (id, progress) => {
      set((state) => {
        const item = state.queue.get(id)
        if (!item) return state

        const queue = new Map(state.queue)
        queue.set(id, {
          ...item,
          progress,
          status: 'processing',
          startedAt: item.startedAt || new Date(),
          attempts: item.attempts + (item.startedAt ? 0 : 1)
        })

        const processing = new Set(state.processing)
        processing.add(item.recordingId)

        return { queue, processing }
      })
    },

    markCompleted: (id, provider) => {
      set((state) => {
        const item = state.queue.get(id)
        if (!item) return state

        const queue = new Map(state.queue)
        queue.set(id, {
          ...item,
          progress: 100,
          status: 'completed',
          provider,
          completedAt: new Date()
        })

        const processing = new Set(state.processing)
        processing.delete(item.recordingId)

        return { queue, processing }
      })
    },

    markFailed: (id, error) => {
      set((state) => {
        const item = state.queue.get(id)
        if (!item) return state

        const queue = new Map(state.queue)
        queue.set(id, {
          ...item,
          status: 'failed',
          error
        })

        const processing = new Set(state.processing)
        processing.delete(item.recordingId)

        return { queue, processing }
      })
    },

    retry: (id) => {
      const item = get().queue.get(id)
      if (!item || item.status !== 'failed') return

      // B-TXN-004: Make store retry contingent on IPC success
      // Only update local store state AFTER the IPC call succeeds
      window.electronAPI?.recordings?.updateQueueItem?.(id, 'pending').then((success) => {
        if (!success) {
          console.error('IPC updateQueueItem returned failure for retry:', id)
          return
        }

        // IPC succeeded - now update local store state
        set((state) => {
          const currentItem = state.queue.get(id)
          if (!currentItem) return state

          const queue = new Map(state.queue)
          queue.set(id, {
            ...currentItem,
            status: 'pending',
            progress: 0,
            error: undefined,
            retryCount: currentItem.retryCount + 1
          })

          return { queue }
        })

        // Ensure transcription processor is running after retry
        window.electronAPI?.recordings?.processQueue?.().catch((e) => {
          console.error('Failed to start transcription processor after retry:', e)
        })
      }).catch((e) => {
        console.error('Failed to update queue item in DB for retry:', e)
      })
    },

    remove: (id) => {
      set((state) => {
        const item = state.queue.get(id)
        if (!item) return state

        const queue = new Map(state.queue)
        queue.delete(id)

        const processing = new Set(state.processing)
        processing.delete(item.recordingId)

        return { queue, processing }
      })
    },

    clear: () => {
      set({ queue: new Map(), processing: new Set() })
    },

    // Queries
    isProcessing: (recordingId) => {
      return get().processing.has(recordingId)
    },

    getStatus: (recordingId) => {
      const items = Array.from(get().queue.values())
      const item = items.find((i) => i.recordingId === recordingId)
      return item ? item.status : null
    },

    getProgress: (recordingId) => {
      const items = Array.from(get().queue.values())
      const item = items.find((i) => i.recordingId === recordingId)
      return item ? item.progress : null
    }
  }))
)

// =============================================================================
// Selector Hooks
// =============================================================================

/**
 * Get all pending transcriptions
 */
export const usePendingTranscriptions = () => {
  return useTranscriptionStore(useShallow((state) => {
    const pending: TranscriptionItem[] = []
    state.queue.forEach((item) => {
      if (item.status === 'pending') {
        pending.push(item)
      }
    })
    return pending
  }))
}

/**
 * Get all processing transcriptions
 */
export const useProcessingTranscriptions = () => {
  return useTranscriptionStore(useShallow((state) => {
    const processing: TranscriptionItem[] = []
    state.queue.forEach((item) => {
      if (item.status === 'processing') {
        processing.push(item)
      }
    })
    return processing
  }))
}

/**
 * Get all failed transcriptions
 */
export const useFailedTranscriptions = () => {
  return useTranscriptionStore(useShallow((state) => {
    const failed: TranscriptionItem[] = []
    state.queue.forEach((item) => {
      if (item.status === 'failed') {
        failed.push(item)
      }
    })
    return failed
  }))
}

/**
 * Get queue statistics
 */
export const useTranscriptionStats = () => {
  return useTranscriptionStore(useShallow((state) => {
    let total = 0
    let completed = 0
    let failed = 0
    let processing = 0
    let pending = 0

    state.queue.forEach((item) => {
      total++
      switch (item.status) {
        case 'completed':
          completed++
          break
        case 'failed':
          failed++
          break
        case 'processing':
          processing++
          break
        case 'pending':
          pending++
          break
      }
    })

    return { total, completed, failed, processing, pending }
  }))
}
