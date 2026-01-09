/**
 * Download Queue Store (Feature)
 *
 * Manages download queue for files being synced from the HiDock device.
 * Tracks progress, handles retries, and persists across page navigation.
 * Uses subscribeWithSelector middleware for fine-grained subscriptions.
 */

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

export type DownloadStatus = 'pending' | 'downloading' | 'completed' | 'failed'

export interface DownloadItem {
  id: string
  filename: string
  size: number
  progress: number // 0-100
  status: DownloadStatus
  error?: string
  startedAt?: Date
  completedAt?: Date
  retryCount: number
}

export interface DownloadQueueStore {
  // State
  queue: Map<string, DownloadItem>
  activeDownloads: Set<string>
  maxConcurrent: number

  // Actions
  addToQueue: (id: string, filename: string, size: number) => void
  updateProgress: (id: string, progress: number) => void
  markCompleted: (id: string) => void
  markFailed: (id: string, error: string) => void
  retryFailed: (id: string) => void
  remove: (id: string) => void
  clear: () => void

  // Queries
  isDownloading: (id: string) => boolean
  getProgress: (id: string) => number | null
  getStatus: (id: string) => DownloadStatus | null
}

export const useDownloadQueueStore = create<DownloadQueueStore>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    queue: new Map(),
    activeDownloads: new Set(),
    maxConcurrent: 3,

    // Actions
    addToQueue: (id, filename, size) => {
      set((state) => {
        const queue = new Map(state.queue)
        queue.set(id, {
          id,
          filename,
          size,
          progress: 0,
          status: 'pending',
          retryCount: 0
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
          status: 'downloading',
          startedAt: item.startedAt || new Date()
        })

        const activeDownloads = new Set(state.activeDownloads)
        activeDownloads.add(id)

        return { queue, activeDownloads }
      })
    },

    markCompleted: (id) => {
      set((state) => {
        const item = state.queue.get(id)
        if (!item) return state

        const queue = new Map(state.queue)
        queue.set(id, {
          ...item,
          progress: 100,
          status: 'completed',
          completedAt: new Date()
        })

        const activeDownloads = new Set(state.activeDownloads)
        activeDownloads.delete(id)

        return { queue, activeDownloads }
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

        const activeDownloads = new Set(state.activeDownloads)
        activeDownloads.delete(id)

        return { queue, activeDownloads }
      })
    },

    retryFailed: (id) => {
      set((state) => {
        const item = state.queue.get(id)
        if (!item || item.status !== 'failed') return state

        const queue = new Map(state.queue)
        queue.set(id, {
          ...item,
          status: 'pending',
          progress: 0,
          error: undefined,
          retryCount: item.retryCount + 1
        })

        return { queue }
      })
    },

    remove: (id) => {
      set((state) => {
        const queue = new Map(state.queue)
        queue.delete(id)

        const activeDownloads = new Set(state.activeDownloads)
        activeDownloads.delete(id)

        return { queue, activeDownloads }
      })
    },

    clear: () => {
      set({ queue: new Map(), activeDownloads: new Set() })
    },

    // Queries
    isDownloading: (id) => {
      return get().activeDownloads.has(id)
    },

    getProgress: (id) => {
      const item = get().queue.get(id)
      return item ? item.progress : null
    },

    getStatus: (id) => {
      const item = get().queue.get(id)
      return item ? item.status : null
    }
  }))
)

// =============================================================================
// Selector Hooks
// =============================================================================

/**
 * Get download progress for a specific item
 */
export const useDownloadProgress = (id: string | null) => {
  return useDownloadQueueStore((state) => (id ? state.queue.get(id)?.progress ?? null : null))
}

/**
 * Get all failed downloads
 */
export const useFailedDownloads = () => {
  return useDownloadQueueStore((state) => {
    const failed: DownloadItem[] = []
    state.queue.forEach((item) => {
      if (item.status === 'failed') {
        failed.push(item)
      }
    })
    return failed
  })
}

/**
 * Get all active downloads
 */
export const useActiveDownloads = () => {
  return useDownloadQueueStore((state) => {
    const active: DownloadItem[] = []
    state.queue.forEach((item) => {
      if (item.status === 'downloading') {
        active.push(item)
      }
    })
    return active
  })
}

/**
 * Get all pending downloads
 */
export const usePendingDownloads = () => {
  return useDownloadQueueStore((state) => {
    const pending: DownloadItem[] = []
    state.queue.forEach((item) => {
      if (item.status === 'pending') {
        pending.push(item)
      }
    })
    return pending
  })
}

/**
 * Get queue statistics
 */
export const useQueueStats = () => {
  return useDownloadQueueStore((state) => {
    let total = 0
    let completed = 0
    let failed = 0
    let downloading = 0
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
        case 'downloading':
          downloading++
          break
        case 'pending':
          pending++
          break
      }
    })

    return { total, completed, failed, downloading, pending }
  })
}
