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
  /**
   * Renderer-side priority for the queue view. Higher = the user wants it sooner.
   * Default 0. `prioritize`/`deprioritize` bump it above/below the current
   * pending set so the dock reorders immediately. NOTE: this reorders the
   * renderer's view/intent of the pending queue — actual main-process processing
   * order is driven by transcription.ts and would need a backend reorder IPC to
   * honor this exactly (deferred follow-up).
   */
  priority: number
}

/** Queue-processor state mirrored from the main process (source of truth). */
export interface QueueProcessorState {
  paused: boolean
  isProcessing: boolean
  processingId: string | null
  pendingCount: number
  processingCount: number
}

export interface TranscriptionQueueStore {
  // State
  queue: Map<string, TranscriptionItem>
  processing: Set<string>
  maxConcurrent: number
  /**
   * Whether the MAIN-PROCESS queue processor is paused. Mirrored from main via
   * getTranscriptionQueueState() + the transcription:queueState push event —
   * main owns the truth; this is a reflection so the dock can flip Pause↔Resume.
   */
  paused: boolean
  /** recording_id currently being transcribed in main (null when idle). */
  processingId: string | null

  // Actions
  addToQueue: (id: string, recordingId: string, filename: string) => void
  updateProgress: (id: string, progress: number) => void
  markCompleted: (id: string, provider: string) => void
  markFailed: (id: string, error: string) => void
  retry: (id: string) => void
  /**
   * Bump a pending item sooner. Updates the local view optimistically AND sends
   * the reorder intent to main (which owns the authoritative processing order).
   */
  prioritize: (id: string) => void
  /** Push a pending item later (local view + main reorder intent). */
  deprioritize: (id: string) => void
  remove: (id: string) => void
  clear: () => void
  /** Pause/resume the main-process queue (stops/continues dequeuing new items). */
  pauseQueue: () => void
  resumeQueue: () => void
  /** Reflect a queue-processor snapshot pushed/pulled from main. */
  applyQueueState: (state: QueueProcessorState) => void

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
    paused: false,
    processingId: null,

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
          attempts: 0,
          priority: 0
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

      // C-005: Enforce max retry limit on frontend to prevent unlimited retries
      const MAX_FRONTEND_RETRIES = 3
      if (item.retryCount >= MAX_FRONTEND_RETRIES) {
        console.warn(`[TranscriptionStore] Max retries (${MAX_FRONTEND_RETRIES}) reached for ${id}, not retrying`)
        return
      }

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
            retryCount: currentItem.retryCount + 1,
            // C-005: Reset startedAt so next updateProgress sets a fresh timestamp
            startedAt: undefined
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

    prioritize: (id) => {
      const recordingId = get().queue.get(id)?.recordingId
      set((state) => {
        const item = state.queue.get(id)
        if (!item) return state
        let max = 0
        state.queue.forEach((i) => { if (i.priority > max) max = i.priority })
        const queue = new Map(state.queue)
        queue.set(id, { ...item, priority: max + 1 })
        return { queue }
      })
      // Tell main to honor this in the ACTUAL processing order (not just the view).
      if (recordingId) {
        window.electronAPI?.recordings?.reorderTranscription?.(recordingId, 'up').catch((e) => {
          console.error('[TranscriptionStore] reorder up IPC failed:', e)
        })
      }
    },

    deprioritize: (id) => {
      const recordingId = get().queue.get(id)?.recordingId
      set((state) => {
        const item = state.queue.get(id)
        if (!item) return state
        let min = 0
        state.queue.forEach((i) => { if (i.priority < min) min = i.priority })
        const queue = new Map(state.queue)
        queue.set(id, { ...item, priority: min - 1 })
        return { queue }
      })
      if (recordingId) {
        window.electronAPI?.recordings?.reorderTranscription?.(recordingId, 'down').catch((e) => {
          console.error('[TranscriptionStore] reorder down IPC failed:', e)
        })
      }
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

    pauseQueue: () => {
      // Optimistic flip; the queueState echo from main confirms/corrects it.
      set({ paused: true })
      window.electronAPI?.recordings?.pauseTranscriptionQueue?.()
        .then((state) => { if (state) get().applyQueueState(state) })
        .catch((e) => {
          console.error('[TranscriptionStore] pause IPC failed:', e)
          set({ paused: false }) // revert optimistic flip on failure
        })
    },

    resumeQueue: () => {
      set({ paused: false })
      window.electronAPI?.recordings?.resumeTranscriptionQueue?.()
        .then((state) => { if (state) get().applyQueueState(state) })
        .catch((e) => {
          console.error('[TranscriptionStore] resume IPC failed:', e)
          set({ paused: true }) // revert optimistic flip on failure
        })
    },

    applyQueueState: (state) => {
      set({ paused: state.paused, processingId: state.processingId })
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
 * Get all pending transcriptions, sorted by priority:
 * - Lower retry count first (fresh items processed before retried ones)
 * - Earlier startedAt first (FIFO within same retry count)
 */
export const usePendingTranscriptions = () => {
  return useTranscriptionStore(useShallow((state) => {
    const pending: TranscriptionItem[] = []
    state.queue.forEach((item) => {
      if (item.status === 'pending') {
        pending.push(item)
      }
    })
    // Sort by: explicit user priority (higher first), then lower retryCount, then FIFO
    pending.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority
      if (a.retryCount !== b.retryCount) return a.retryCount - b.retryCount
      // FIFO: items without startedAt come before those with
      const aTime = a.startedAt ? a.startedAt.getTime() : 0
      const bTime = b.startedAt ? b.startedAt.getTime() : 0
      return aTime - bTime
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

/** Whether the main-process queue processor is currently paused. */
export const useTranscriptionPaused = () => useTranscriptionStore((s) => s.paused)

/**
 * Get queue statistics with aggregate progress
 */
export const useTranscriptionStats = () => {
  return useTranscriptionStore(useShallow((state) => {
    let total = 0
    let completed = 0
    let failed = 0
    let processing = 0
    let pending = 0
    let totalProgress = 0

    state.queue.forEach((item) => {
      total++
      totalProgress += item.progress
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

    // Aggregate progress percentage across all queue items (0-100)
    const aggregateProgress = total > 0 ? Math.round(totalProgress / total) : 0

    return { total, completed, failed, processing, pending, aggregateProgress }
  }))
}
