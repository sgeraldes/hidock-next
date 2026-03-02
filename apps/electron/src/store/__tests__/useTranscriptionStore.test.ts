/**
 * Comprehensive tests for useTranscriptionStore
 *
 * Tests cover all store functionality:
 * - Initial state verification
 * - Queue operations: addToQueue, remove, clear
 * - Progress and status: updateProgress, markCompleted, markFailed
 * - Retry logic: retry resets status/progress, increments retryCount
 * - Query methods: isProcessing, getStatus, getProgress
 * - Selector hooks: useTranscriptionStats, usePendingTranscriptions,
 *   useProcessingTranscriptions, useFailedTranscriptions
 * - Map/Set operations integrity
 * - Edge cases and state isolation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  useTranscriptionStore,
  useTranscriptionStats,
  usePendingTranscriptions,
  useProcessingTranscriptions,
  useFailedTranscriptions
} from '@/store/features/useTranscriptionStore'

// Mock window.electronAPI to prevent errors in retry()
// B-TXN-004: updateQueueItem must return true for retry to update local store state
beforeEach(() => {
  ;(window as any).electronAPI = {
    recordings: {
      updateQueueItem: vi.fn().mockResolvedValue(true),
      processQueue: vi.fn().mockResolvedValue(true)
    }
  }
})

// Reset store before each test
beforeEach(() => {
  useTranscriptionStore.getState().clear()
})

describe('useTranscriptionStore', () => {
  describe('Initial State', () => {
    it('has an empty queue', () => {
      const state = useTranscriptionStore.getState()
      expect(state.queue.size).toBe(0)
    })

    it('has an empty processing set', () => {
      const state = useTranscriptionStore.getState()
      expect(state.processing.size).toBe(0)
    })

    it('has maxConcurrent set to 2', () => {
      const state = useTranscriptionStore.getState()
      expect(state.maxConcurrent).toBe(2)
    })
  })

  describe('addToQueue', () => {
    it('adds a new item with pending status', () => {
      const { addToQueue } = useTranscriptionStore.getState()

      addToQueue('q-1', 'rec-1', 'meeting.wav')

      const item = useTranscriptionStore.getState().queue.get('q-1')
      expect(item).toBeDefined()
      expect(item!.id).toBe('q-1')
      expect(item!.recordingId).toBe('rec-1')
      expect(item!.filename).toBe('meeting.wav')
      expect(item!.status).toBe('pending')
      expect(item!.progress).toBe(0)
      expect(item!.retryCount).toBe(0)
      expect(item!.attempts).toBe(0)
      expect(item!.error).toBeUndefined()
      expect(item!.startedAt).toBeUndefined()
      expect(item!.completedAt).toBeUndefined()
      expect(item!.provider).toBeUndefined()
    })

    it('adds multiple items independently', () => {
      const { addToQueue } = useTranscriptionStore.getState()

      addToQueue('q-1', 'rec-1', 'meeting1.wav')
      addToQueue('q-2', 'rec-2', 'meeting2.wav')
      addToQueue('q-3', 'rec-3', 'meeting3.wav')

      expect(useTranscriptionStore.getState().queue.size).toBe(3)
    })

    it('overwrites existing item with same id', () => {
      const { addToQueue } = useTranscriptionStore.getState()

      addToQueue('q-1', 'rec-1', 'original.wav')
      addToQueue('q-1', 'rec-2', 'replacement.wav')

      const queue = useTranscriptionStore.getState().queue
      expect(queue.size).toBe(1)
      expect(queue.get('q-1')!.recordingId).toBe('rec-2')
      expect(queue.get('q-1')!.filename).toBe('replacement.wav')
    })
  })

  describe('updateProgress', () => {
    it('updates progress and sets status to processing', () => {
      const { addToQueue, updateProgress } = useTranscriptionStore.getState()

      addToQueue('q-1', 'rec-1', 'meeting.wav')
      updateProgress('q-1', 50)

      const item = useTranscriptionStore.getState().queue.get('q-1')
      expect(item!.progress).toBe(50)
      expect(item!.status).toBe('processing')
    })

    it('sets startedAt on first progress update', () => {
      const { addToQueue, updateProgress } = useTranscriptionStore.getState()

      addToQueue('q-1', 'rec-1', 'meeting.wav')
      updateProgress('q-1', 10)

      const item = useTranscriptionStore.getState().queue.get('q-1')
      expect(item!.startedAt).toBeInstanceOf(Date)
    })

    it('increments attempts on first progress update', () => {
      const { addToQueue, updateProgress } = useTranscriptionStore.getState()

      addToQueue('q-1', 'rec-1', 'meeting.wav')
      updateProgress('q-1', 10)

      const item = useTranscriptionStore.getState().queue.get('q-1')
      expect(item!.attempts).toBe(1)
    })

    it('does not increment attempts on subsequent progress updates', () => {
      const { addToQueue, updateProgress } = useTranscriptionStore.getState()

      addToQueue('q-1', 'rec-1', 'meeting.wav')
      updateProgress('q-1', 10)
      updateProgress('q-1', 50)
      updateProgress('q-1', 80)

      const item = useTranscriptionStore.getState().queue.get('q-1')
      expect(item!.attempts).toBe(1)
    })

    it('adds recordingId to processing set', () => {
      const { addToQueue, updateProgress } = useTranscriptionStore.getState()

      addToQueue('q-1', 'rec-1', 'meeting.wav')
      updateProgress('q-1', 10)

      expect(useTranscriptionStore.getState().processing.has('rec-1')).toBe(true)
    })

    it('does nothing for non-existent item', () => {
      const { updateProgress } = useTranscriptionStore.getState()

      updateProgress('non-existent', 50)

      expect(useTranscriptionStore.getState().queue.size).toBe(0)
    })
  })

  describe('markCompleted', () => {
    it('sets status to completed and progress to 100', () => {
      const { addToQueue, updateProgress, markCompleted } = useTranscriptionStore.getState()

      addToQueue('q-1', 'rec-1', 'meeting.wav')
      updateProgress('q-1', 50)
      markCompleted('q-1', 'gemini')

      const item = useTranscriptionStore.getState().queue.get('q-1')
      expect(item!.status).toBe('completed')
      expect(item!.progress).toBe(100)
      expect(item!.provider).toBe('gemini')
      expect(item!.completedAt).toBeInstanceOf(Date)
    })

    it('removes recordingId from processing set', () => {
      const { addToQueue, updateProgress, markCompleted } = useTranscriptionStore.getState()

      addToQueue('q-1', 'rec-1', 'meeting.wav')
      updateProgress('q-1', 50)
      expect(useTranscriptionStore.getState().processing.has('rec-1')).toBe(true)

      markCompleted('q-1', 'gemini')
      expect(useTranscriptionStore.getState().processing.has('rec-1')).toBe(false)
    })

    it('does nothing for non-existent item', () => {
      const { markCompleted } = useTranscriptionStore.getState()

      markCompleted('non-existent', 'gemini')

      expect(useTranscriptionStore.getState().queue.size).toBe(0)
    })
  })

  describe('markFailed', () => {
    it('sets status to failed with error message', () => {
      const { addToQueue, updateProgress, markFailed } = useTranscriptionStore.getState()

      addToQueue('q-1', 'rec-1', 'meeting.wav')
      updateProgress('q-1', 30)
      markFailed('q-1', 'API rate limit exceeded')

      const item = useTranscriptionStore.getState().queue.get('q-1')
      expect(item!.status).toBe('failed')
      expect(item!.error).toBe('API rate limit exceeded')
    })

    it('removes recordingId from processing set', () => {
      const { addToQueue, updateProgress, markFailed } = useTranscriptionStore.getState()

      addToQueue('q-1', 'rec-1', 'meeting.wav')
      updateProgress('q-1', 30)
      markFailed('q-1', 'Error')

      expect(useTranscriptionStore.getState().processing.has('rec-1')).toBe(false)
    })

    it('does nothing for non-existent item', () => {
      const { markFailed } = useTranscriptionStore.getState()

      markFailed('non-existent', 'Error')

      expect(useTranscriptionStore.getState().queue.size).toBe(0)
    })
  })

  describe('retry', () => {
    // B-TXN-004: retry is now async (waits for IPC success before updating local state)
    // Tests must await microtasks to observe the state change.
    const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0))

    it('resets failed item to pending with incremented retryCount', async () => {
      const { addToQueue, updateProgress, markFailed } = useTranscriptionStore.getState()

      addToQueue('q-1', 'rec-1', 'meeting.wav')
      updateProgress('q-1', 50)
      markFailed('q-1', 'Network error')

      useTranscriptionStore.getState().retry('q-1')
      await flushPromises()

      const item = useTranscriptionStore.getState().queue.get('q-1')
      expect(item!.status).toBe('pending')
      expect(item!.progress).toBe(0)
      expect(item!.error).toBeUndefined()
      expect(item!.retryCount).toBe(1)
    })

    it('increments retryCount on each retry', async () => {
      const { addToQueue, updateProgress, markFailed } = useTranscriptionStore.getState()

      addToQueue('q-1', 'rec-1', 'meeting.wav')

      // Fail and retry multiple times
      updateProgress('q-1', 50)
      markFailed('q-1', 'Error 1')
      useTranscriptionStore.getState().retry('q-1')
      await flushPromises()

      updateProgress('q-1', 30)
      markFailed('q-1', 'Error 2')
      useTranscriptionStore.getState().retry('q-1')
      await flushPromises()

      const item = useTranscriptionStore.getState().queue.get('q-1')
      expect(item!.retryCount).toBe(2)
    })

    it('calls electronAPI to update DB queue item', () => {
      const { addToQueue, updateProgress, markFailed } = useTranscriptionStore.getState()

      addToQueue('q-1', 'rec-1', 'meeting.wav')
      updateProgress('q-1', 50)
      markFailed('q-1', 'Error')

      useTranscriptionStore.getState().retry('q-1')

      expect(window.electronAPI.recordings.updateQueueItem).toHaveBeenCalledWith('q-1', 'pending')
    })

    it('does nothing for non-existent item', () => {
      const { retry } = useTranscriptionStore.getState()

      retry('non-existent')

      expect(useTranscriptionStore.getState().queue.size).toBe(0)
    })

    it('does nothing for item that is not failed', () => {
      const { addToQueue, updateProgress } = useTranscriptionStore.getState()

      addToQueue('q-1', 'rec-1', 'meeting.wav')
      updateProgress('q-1', 50)

      useTranscriptionStore.getState().retry('q-1')

      const item = useTranscriptionStore.getState().queue.get('q-1')
      expect(item!.status).toBe('processing')
      expect(item!.retryCount).toBe(0)
    })
  })

  describe('remove', () => {
    it('removes item from queue', () => {
      const { addToQueue, remove } = useTranscriptionStore.getState()

      addToQueue('q-1', 'rec-1', 'meeting.wav')
      remove('q-1')

      expect(useTranscriptionStore.getState().queue.has('q-1')).toBe(false)
      expect(useTranscriptionStore.getState().queue.size).toBe(0)
    })

    it('removes recordingId from processing set', () => {
      const { addToQueue, updateProgress, remove } = useTranscriptionStore.getState()

      addToQueue('q-1', 'rec-1', 'meeting.wav')
      updateProgress('q-1', 50)
      expect(useTranscriptionStore.getState().processing.has('rec-1')).toBe(true)

      remove('q-1')
      expect(useTranscriptionStore.getState().processing.has('rec-1')).toBe(false)
    })

    it('does not affect other items', () => {
      const { addToQueue, remove } = useTranscriptionStore.getState()

      addToQueue('q-1', 'rec-1', 'meeting1.wav')
      addToQueue('q-2', 'rec-2', 'meeting2.wav')

      remove('q-1')

      expect(useTranscriptionStore.getState().queue.size).toBe(1)
      expect(useTranscriptionStore.getState().queue.has('q-2')).toBe(true)
    })

    it('does nothing for non-existent item', () => {
      const { addToQueue, remove } = useTranscriptionStore.getState()

      addToQueue('q-1', 'rec-1', 'meeting.wav')
      remove('non-existent')

      expect(useTranscriptionStore.getState().queue.size).toBe(1)
    })
  })

  describe('clear', () => {
    it('removes all items from queue', () => {
      const { addToQueue, clear } = useTranscriptionStore.getState()

      addToQueue('q-1', 'rec-1', 'meeting1.wav')
      addToQueue('q-2', 'rec-2', 'meeting2.wav')
      addToQueue('q-3', 'rec-3', 'meeting3.wav')

      clear()

      expect(useTranscriptionStore.getState().queue.size).toBe(0)
    })

    it('clears processing set', () => {
      const { addToQueue, updateProgress, clear } = useTranscriptionStore.getState()

      addToQueue('q-1', 'rec-1', 'meeting.wav')
      updateProgress('q-1', 50)

      clear()

      expect(useTranscriptionStore.getState().processing.size).toBe(0)
    })

    it('is safe to call when already empty', () => {
      const { clear } = useTranscriptionStore.getState()

      clear()

      expect(useTranscriptionStore.getState().queue.size).toBe(0)
      expect(useTranscriptionStore.getState().processing.size).toBe(0)
    })
  })

  describe('Query Methods', () => {
    describe('isProcessing', () => {
      it('returns true for processing recordingId', () => {
        const { addToQueue, updateProgress } = useTranscriptionStore.getState()

        addToQueue('q-1', 'rec-1', 'meeting.wav')
        updateProgress('q-1', 50)

        expect(useTranscriptionStore.getState().isProcessing('rec-1')).toBe(true)
      })

      it('returns false for non-processing recordingId', () => {
        const { addToQueue } = useTranscriptionStore.getState()

        addToQueue('q-1', 'rec-1', 'meeting.wav')

        expect(useTranscriptionStore.getState().isProcessing('rec-1')).toBe(false)
      })

      it('returns false for unknown recordingId', () => {
        expect(useTranscriptionStore.getState().isProcessing('unknown')).toBe(false)
      })
    })

    describe('getStatus', () => {
      it('returns status for known recordingId', () => {
        const { addToQueue } = useTranscriptionStore.getState()

        addToQueue('q-1', 'rec-1', 'meeting.wav')

        expect(useTranscriptionStore.getState().getStatus('rec-1')).toBe('pending')
      })

      it('returns processing status after updateProgress', () => {
        const { addToQueue, updateProgress } = useTranscriptionStore.getState()

        addToQueue('q-1', 'rec-1', 'meeting.wav')
        updateProgress('q-1', 50)

        expect(useTranscriptionStore.getState().getStatus('rec-1')).toBe('processing')
      })

      it('returns completed status after markCompleted', () => {
        const { addToQueue, markCompleted } = useTranscriptionStore.getState()

        addToQueue('q-1', 'rec-1', 'meeting.wav')
        markCompleted('q-1', 'gemini')

        expect(useTranscriptionStore.getState().getStatus('rec-1')).toBe('completed')
      })

      it('returns failed status after markFailed', () => {
        const { addToQueue, markFailed } = useTranscriptionStore.getState()

        addToQueue('q-1', 'rec-1', 'meeting.wav')
        markFailed('q-1', 'Error')

        expect(useTranscriptionStore.getState().getStatus('rec-1')).toBe('failed')
      })

      it('returns null for unknown recordingId', () => {
        expect(useTranscriptionStore.getState().getStatus('unknown')).toBeNull()
      })
    })

    describe('getProgress', () => {
      it('returns 0 for newly added item', () => {
        const { addToQueue } = useTranscriptionStore.getState()

        addToQueue('q-1', 'rec-1', 'meeting.wav')

        expect(useTranscriptionStore.getState().getProgress('rec-1')).toBe(0)
      })

      it('returns current progress value', () => {
        const { addToQueue, updateProgress } = useTranscriptionStore.getState()

        addToQueue('q-1', 'rec-1', 'meeting.wav')
        updateProgress('q-1', 75)

        expect(useTranscriptionStore.getState().getProgress('rec-1')).toBe(75)
      })

      it('returns 100 for completed item', () => {
        const { addToQueue, markCompleted } = useTranscriptionStore.getState()

        addToQueue('q-1', 'rec-1', 'meeting.wav')
        markCompleted('q-1', 'gemini')

        expect(useTranscriptionStore.getState().getProgress('rec-1')).toBe(100)
      })

      it('returns null for unknown recordingId', () => {
        expect(useTranscriptionStore.getState().getProgress('unknown')).toBeNull()
      })
    })
  })

  describe('Selector Hooks', () => {
    describe('useTranscriptionStats', () => {
      it('returns zero counts when queue is empty', () => {
        const { result } = renderHook(() => useTranscriptionStats())

        expect(result.current).toEqual({
          total: 0,
          completed: 0,
          failed: 0,
          processing: 0,
          pending: 0,
          aggregateProgress: 0
        })
      })

      it('returns correct counts for mixed statuses', () => {
        const store = useTranscriptionStore.getState()

        // Add items with different statuses
        store.addToQueue('q-1', 'rec-1', 'pending.wav')
        store.addToQueue('q-2', 'rec-2', 'processing.wav')
        store.addToQueue('q-3', 'rec-3', 'completed.wav')
        store.addToQueue('q-4', 'rec-4', 'failed.wav')
        store.addToQueue('q-5', 'rec-5', 'pending2.wav')

        store.updateProgress('q-2', 50)
        store.markCompleted('q-3', 'gemini')
        store.markFailed('q-4', 'Error')

        const { result } = renderHook(() => useTranscriptionStats())

        // aggregateProgress = (0 + 50 + 100 + 0 + 0) / 5 = 30
        expect(result.current).toEqual({
          total: 5,
          completed: 1,
          failed: 1,
          processing: 1,
          pending: 2,
          aggregateProgress: 30
        })
      })

      it('calculates aggregate progress correctly', () => {
        const store = useTranscriptionStore.getState()

        store.addToQueue('q-1', 'rec-1', 'file1.wav')
        store.addToQueue('q-2', 'rec-2', 'file2.wav')
        store.updateProgress('q-1', 80)
        store.updateProgress('q-2', 40)

        const { result } = renderHook(() => useTranscriptionStats())

        // (80 + 40) / 2 = 60
        expect(result.current.aggregateProgress).toBe(60)
      })

      it('updates when queue changes', () => {
        const { result } = renderHook(() => useTranscriptionStats())

        expect(result.current.total).toBe(0)

        act(() => {
          useTranscriptionStore.getState().addToQueue('q-1', 'rec-1', 'file.wav')
        })

        expect(result.current.total).toBe(1)
        expect(result.current.pending).toBe(1)
      })
    })

    describe('usePendingTranscriptions', () => {
      it('returns empty array when no pending items', () => {
        const { result } = renderHook(() => usePendingTranscriptions())

        expect(result.current).toEqual([])
      })

      it('returns only pending items', () => {
        const store = useTranscriptionStore.getState()
        store.addToQueue('q-1', 'rec-1', 'pending.wav')
        store.addToQueue('q-2', 'rec-2', 'processing.wav')
        store.updateProgress('q-2', 50)

        const { result } = renderHook(() => usePendingTranscriptions())

        expect(result.current.length).toBe(1)
        expect(result.current[0].id).toBe('q-1')
      })

      it('sorts pending items by priority: lower retryCount first', async () => {
        const store = useTranscriptionStore.getState()
        store.addToQueue('q-1', 'rec-1', 'fresh.wav')
        store.addToQueue('q-2', 'rec-2', 'retried.wav')

        // Simulate q-2 having failed and been retried (retryCount=1)
        store.markFailed('q-2', 'Error')

        // Wait for the retry IPC mock to complete
        await vi.waitFor(() => {
          store.retry('q-2')
        })

        // Allow the async retry promise to resolve
        await vi.waitFor(() => {
          const item = store.queue.get('q-2')
          return item?.status === 'pending' && item?.retryCount === 1
        })

        const { result } = renderHook(() => usePendingTranscriptions())

        // Fresh item (retryCount=0) should come before retried item (retryCount=1)
        expect(result.current.length).toBe(2)
        expect(result.current[0].id).toBe('q-1')
        expect(result.current[0].retryCount).toBe(0)
        expect(result.current[1].id).toBe('q-2')
        expect(result.current[1].retryCount).toBe(1)
      })
    })

    describe('useProcessingTranscriptions', () => {
      it('returns empty array when no processing items', () => {
        const { result } = renderHook(() => useProcessingTranscriptions())

        expect(result.current).toEqual([])
      })

      it('returns only processing items', () => {
        const store = useTranscriptionStore.getState()
        store.addToQueue('q-1', 'rec-1', 'pending.wav')
        store.addToQueue('q-2', 'rec-2', 'processing.wav')
        store.updateProgress('q-2', 50)

        const { result } = renderHook(() => useProcessingTranscriptions())

        expect(result.current.length).toBe(1)
        expect(result.current[0].id).toBe('q-2')
      })
    })

    describe('useFailedTranscriptions', () => {
      it('returns empty array when no failed items', () => {
        const { result } = renderHook(() => useFailedTranscriptions())

        expect(result.current).toEqual([])
      })

      it('returns only failed items', () => {
        const store = useTranscriptionStore.getState()
        store.addToQueue('q-1', 'rec-1', 'ok.wav')
        store.addToQueue('q-2', 'rec-2', 'bad.wav')
        store.markFailed('q-2', 'Timeout')

        const { result } = renderHook(() => useFailedTranscriptions())

        expect(result.current.length).toBe(1)
        expect(result.current[0].id).toBe('q-2')
        expect(result.current[0].error).toBe('Timeout')
      })
    })
  })

  describe('Map/Set Integrity', () => {
    it('queue is always a Map instance after operations', () => {
      const store = useTranscriptionStore.getState()

      store.addToQueue('q-1', 'rec-1', 'file.wav')
      expect(useTranscriptionStore.getState().queue).toBeInstanceOf(Map)

      store.updateProgress('q-1', 50)
      expect(useTranscriptionStore.getState().queue).toBeInstanceOf(Map)

      store.markCompleted('q-1', 'gemini')
      expect(useTranscriptionStore.getState().queue).toBeInstanceOf(Map)

      store.remove('q-1')
      expect(useTranscriptionStore.getState().queue).toBeInstanceOf(Map)
    })

    it('processing is always a Set instance after operations', () => {
      const store = useTranscriptionStore.getState()

      store.addToQueue('q-1', 'rec-1', 'file.wav')
      expect(useTranscriptionStore.getState().processing).toBeInstanceOf(Set)

      store.updateProgress('q-1', 50)
      expect(useTranscriptionStore.getState().processing).toBeInstanceOf(Set)

      store.markCompleted('q-1', 'gemini')
      expect(useTranscriptionStore.getState().processing).toBeInstanceOf(Set)
    })

    it('operations create new Map/Set instances (immutability)', () => {
      const store = useTranscriptionStore.getState()

      store.addToQueue('q-1', 'rec-1', 'file.wav')
      const queueAfterAdd = useTranscriptionStore.getState().queue

      store.addToQueue('q-2', 'rec-2', 'file2.wav')
      const queueAfterSecondAdd = useTranscriptionStore.getState().queue

      // Each mutation should produce a new Map reference
      expect(queueAfterAdd).not.toBe(queueAfterSecondAdd)
    })
  })

  describe('Full Lifecycle', () => {
    it('follows complete transcription lifecycle: add -> process -> complete', () => {
      const store = useTranscriptionStore.getState()

      // Step 1: Add to queue
      store.addToQueue('q-1', 'rec-1', 'meeting.wav')
      expect(store.getStatus('rec-1')).toBe('pending')
      expect(store.getProgress('rec-1')).toBe(0)

      // Step 2: Start processing
      store.updateProgress('q-1', 10)
      expect(useTranscriptionStore.getState().getStatus('rec-1')).toBe('processing')
      expect(useTranscriptionStore.getState().isProcessing('rec-1')).toBe(true)

      // Step 3: Progress updates
      store.updateProgress('q-1', 50)
      expect(useTranscriptionStore.getState().getProgress('rec-1')).toBe(50)

      store.updateProgress('q-1', 90)
      expect(useTranscriptionStore.getState().getProgress('rec-1')).toBe(90)

      // Step 4: Complete
      store.markCompleted('q-1', 'gemini')
      expect(useTranscriptionStore.getState().getStatus('rec-1')).toBe('completed')
      expect(useTranscriptionStore.getState().getProgress('rec-1')).toBe(100)
      expect(useTranscriptionStore.getState().isProcessing('rec-1')).toBe(false)
    })

    it('follows failure and retry lifecycle: add -> process -> fail -> retry -> process -> complete', async () => {
      const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0))
      const store = useTranscriptionStore.getState()

      // Add and start processing
      store.addToQueue('q-1', 'rec-1', 'meeting.wav')
      store.updateProgress('q-1', 30)

      // Fail
      store.markFailed('q-1', 'Network timeout')
      expect(useTranscriptionStore.getState().getStatus('rec-1')).toBe('failed')

      // Retry (B-TXN-004: now async, must flush promises)
      useTranscriptionStore.getState().retry('q-1')
      await flushPromises()
      expect(useTranscriptionStore.getState().getStatus('rec-1')).toBe('pending')
      expect(useTranscriptionStore.getState().getProgress('rec-1')).toBe(0)

      // Re-process and complete
      useTranscriptionStore.getState().updateProgress('q-1', 50)
      useTranscriptionStore.getState().markCompleted('q-1', 'gemini')

      const item = useTranscriptionStore.getState().queue.get('q-1')
      expect(item!.status).toBe('completed')
      expect(item!.retryCount).toBe(1)
    })
  })

  describe('Edge Cases', () => {
    it('handles rapid sequential additions', () => {
      const { addToQueue } = useTranscriptionStore.getState()

      for (let i = 0; i < 50; i++) {
        addToQueue(`q-${i}`, `rec-${i}`, `file-${i}.wav`)
      }

      expect(useTranscriptionStore.getState().queue.size).toBe(50)
    })

    it('handles concurrent processing of multiple items', () => {
      const store = useTranscriptionStore.getState()

      store.addToQueue('q-1', 'rec-1', 'file1.wav')
      store.addToQueue('q-2', 'rec-2', 'file2.wav')

      store.updateProgress('q-1', 30)
      store.updateProgress('q-2', 60)

      const state = useTranscriptionStore.getState()
      expect(state.processing.size).toBe(2)
      expect(state.processing.has('rec-1')).toBe(true)
      expect(state.processing.has('rec-2')).toBe(true)
    })

    it('markFailed preserves progress from before failure', () => {
      const store = useTranscriptionStore.getState()

      store.addToQueue('q-1', 'rec-1', 'file.wav')
      store.updateProgress('q-1', 75)
      store.markFailed('q-1', 'Error at 75%')

      const item = useTranscriptionStore.getState().queue.get('q-1')
      // markFailed does not reset progress (retry does)
      expect(item!.progress).toBe(75)
      expect(item!.status).toBe('failed')
    })
  })
})
