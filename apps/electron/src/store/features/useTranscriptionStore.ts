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
  createdAt?: Date
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

export interface TranscriptionQueueSnapshotItem {
  id: string
  recording_id: string
  filename?: string
  status: TranscriptionStatus
  progress?: number
  error_message?: string
  retry_count?: number
  attempts?: number
  created_at?: string
  started_at?: string
  completed_at?: string
  provider?: string
}

/** SQLite CURRENT_TIMESTAMP is UTC but omits the `Z` suffix. Parse it as UTC so
 * operation history renders the actual attempt time in the user's locale. */
function parseQueueTimestamp(value?: string): Date | undefined {
  if (!value) return undefined
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
  const normalized = hasZone ? value : `${value.replace(' ', 'T')}Z`
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
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
  /** Replace the renderer projection from one bounded main-process snapshot. */
  reconcileQueue: (items: TranscriptionQueueSnapshotItem[]) => void
  updateProgress: (id: string, progress: number) => void
  markCompleted: (id: string, provider: string) => void
  markFailed: (id: string, error: string) => void
  retry: (id: string) => Promise<boolean>
  /** Dismiss one terminal failure from the actionable Operations history. */
  dismiss: (id: string) => Promise<boolean>
  /** Dismiss every terminal failure and return the number removed. */
  dismissFailed: () => Promise<number>
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
          createdAt: new Date(),
          priority: 0
        })
        return { queue }
      })
    },

    reconcileQueue: (items) => {
      set((state) => {
        const queue = new Map<string, TranscriptionItem>()
        const processing = new Set<string>()

        for (const snapshot of items) {
          if (snapshot.status !== 'pending' && snapshot.status !== 'processing' && snapshot.status !== 'failed') {
            continue
          }
          const previous = state.queue.get(snapshot.id)
          const item: TranscriptionItem = {
            id: snapshot.id,
            recordingId: snapshot.recording_id,
            filename: snapshot.filename || previous?.filename || 'Unknown',
            status: snapshot.status,
            progress: snapshot.progress ?? previous?.progress ?? 0,
            error: snapshot.error_message,
            retryCount: snapshot.retry_count ?? previous?.retryCount ?? 0,
            attempts: snapshot.attempts ?? previous?.attempts ?? 0,
            createdAt: parseQueueTimestamp(snapshot.created_at) ?? previous?.createdAt,
            startedAt: parseQueueTimestamp(snapshot.started_at) ?? previous?.startedAt,
            completedAt:
              snapshot.status === 'failed' ? parseQueueTimestamp(snapshot.completed_at) : undefined,
            provider: snapshot.provider ?? previous?.provider,
            priority: previous?.priority ?? 0
          }
          queue.set(item.id, item)
          if (item.status === 'processing') processing.add(item.recordingId)
        }

        return { queue, processing }
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
          error,
          completedAt: new Date()
        })

        const processing = new Set(state.processing)
        processing.delete(item.recordingId)

        return { queue, processing }
      })
    },

    retry: async (id) => {
      const item = get().queue.get(id)
      if (!item || item.status !== 'failed') return false

      // B-TXN-004: Make store retry contingent on IPC success
      // Only update local store state AFTER the IPC call succeeds
      try {
        const success = await window.electronAPI?.recordings?.updateQueueItem?.(id, 'pending')
        if (!success) {
          console.error('IPC updateQueueItem returned failure for retry:', id)
          return false
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
            startedAt: undefined,
            completedAt: undefined
          })

          return { queue }
        })

        // Ensure transcription processor is running after retry
        await window.electronAPI?.recordings?.processQueue?.()
        return true
      } catch (e) {
        console.error('Failed to update queue item in DB for retry:', e)
        return false
      }
    },

    dismiss: async (id) => {
      const item = get().queue.get(id)
      if (!item || item.status !== 'failed') return false
      try {
        // `cancelled` is a terminal, non-actionable queue state already supported
        // by the durable schema. Dismissal removes only the operation notice; it
        // does not erase the source or falsify its transcription result.
        const success = await window.electronAPI?.recordings?.updateQueueItem?.(id, 'cancelled')
        if (!success) return false
        get().remove(id)
        return true
      } catch (e) {
        console.error('Failed to dismiss transcription failure:', e)
        return false
      }
    },

    dismissFailed: async () => {
      const failedIds = Array.from(get().queue.values())
        .filter((item) => item.status === 'failed')
        .map((item) => item.id)
      let removed = 0
      for (const id of failedIds) {
        if (await get().dismiss(id)) removed++
      }
      return removed
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
