/**
 * Download Service Tests
 *
 * These tests document and reproduce OBSERVED bugs in the download service:
 *
 * BUG-DS-001: retryFailed() method does not exist - "Retry Failed Downloads" button does nothing
 *   OBSERVED: Device.tsx:496 calls (electronAPI.downloadService as any).retryFailed()
 *   RESULT: Returns undefined, shows "No failed downloads" even when there ARE failed downloads
 *
 * BUG-DS-002: cancelAll() does not cancel in-progress downloads
 *   OBSERVED: Only marks 'pending' items as failed, items with status 'downloading' continue
 *
 * BUG-DS-003: No progress throttling - emitStateUpdate() fires for every chunk
 *   OBSERVED: Every call to updateProgress() immediately broadcasts full state to all windows
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock electron modules BEFORE importing the service
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [])
  },
  ipcMain: {
    handle: vi.fn()
  }
}))

// Mock database functions
vi.mock('../database', () => ({
  markRecordingDownloaded: vi.fn(),
  addSyncedFile: vi.fn(),
  isFileSynced: vi.fn(() => false),
  getRecordingByFilename: vi.fn(() => null),
  getSyncedFilenames: vi.fn(() => new Set())
}))

// Mock file-storage
vi.mock('../file-storage', () => ({
  saveRecording: vi.fn().mockResolvedValue('/mock/path/file.wav'),
  getRecordingsPath: vi.fn(() => '/mock/recordings')
}))

// Mock fs - needs default export for CJS interop
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    default: { ...actual, existsSync: vi.fn(() => false) },
    existsSync: vi.fn(() => false)
  }
})

// Need to import AFTER mocks
import { getDownloadService, type DownloadQueueItem } from '../download-service'

describe('DownloadService', () => {
  let service: ReturnType<typeof getDownloadService>

  beforeEach(() => {
    vi.clearAllMocks()
    // Get a fresh service instance - need to reset the singleton
    // The singleton pattern means we need to clear internal state
    service = getDownloadService()
    // Clear the queue manually for test isolation
    const state = service.getState()
    if (state.queue.length > 0) {
      service.clearCompleted()
      service.cancelAll()
      service.clearCompleted()
    }
  })

  describe('basic queue operations', () => {
    it('should queue downloads and return queued IDs', () => {
      const ids = service.queueDownloads([
        { filename: 'test1.hda', size: 1024 },
        { filename: 'test2.hda', size: 2048 }
      ])

      expect(ids).toHaveLength(2)
      expect(ids).toContain('test1.hda')
      expect(ids).toContain('test2.hda')

      const state = service.getState()
      expect(state.queue).toHaveLength(2)
      expect(state.queue[0].status).toBe('pending')
    })

    it('should not queue duplicate files', () => {
      service.queueDownloads([{ filename: 'test.hda', size: 1024 }])
      service.queueDownloads([{ filename: 'test.hda', size: 1024 }])

      const state = service.getState()
      expect(state.queue).toHaveLength(1)
    })
  })

  describe('BUG-DS-001: retryFailed() is missing', () => {
    it('retryFailed method should exist on the service', () => {
      // OBSERVED: Device.tsx:496 calls retryFailed() but the method doesn't exist
      // The UI button "Retry 7 Failed Downloads" does NOTHING
      expect(typeof (service as any).retryFailed).toBe('function')
    })

    it('retryFailed should re-queue failed downloads as pending', () => {
      // Set up: queue files and mark some as failed
      service.queueDownloads([
        { filename: 'fail1.hda', size: 1024 },
        { filename: 'fail2.hda', size: 2048 },
        { filename: 'ok.hda', size: 512 }
      ])

      // Simulate failures
      service.markFailed('fail1.hda', 'Download stalled')
      service.markFailed('fail2.hda', 'Connection lost')

      // Verify they are failed
      let state = service.getState()
      const failedBefore = state.queue.filter((i: DownloadQueueItem) => i.status === 'failed')
      expect(failedBefore).toHaveLength(2)

      // CRITICAL: retryFailed() should reset failed items back to 'pending'
      const retryCount = (service as any).retryFailed()

      expect(retryCount).toBe(2)

      state = service.getState()
      const failedAfter = state.queue.filter((i: DownloadQueueItem) => i.status === 'failed')
      const pendingAfter = state.queue.filter((i: DownloadQueueItem) => i.status === 'pending')
      expect(failedAfter).toHaveLength(0)
      expect(pendingAfter).toHaveLength(3) // 2 retried + 1 original pending
    })
  })

  describe('BUG-DS-002: cancelAll() does not cancel in-progress downloads', () => {
    it('cancelAll should also cancel downloading items, not just pending', () => {
      // Queue and simulate one actively downloading
      service.queueDownloads([
        { filename: 'downloading.hda', size: 10000 },
        { filename: 'pending1.hda', size: 5000 },
        { filename: 'pending2.hda', size: 5000 }
      ])

      // Simulate the first item being actively downloaded
      service.updateProgress('downloading.hda', 5000) // 50% downloaded

      // Cancel all
      service.cancelAll()

      // CRITICAL: ALL items should be cancelled regardless of status
      const state = service.getState()
      const allFailed = state.queue.every((i: DownloadQueueItem) => i.status === 'failed')
      expect(allFailed).toBe(true)
    })
  })

  describe('BUG-DS-003: updateProgress never sets status to downloading', () => {
    it('updateProgress should set status to downloading when progress starts', () => {
      // OBSERVED: The status field never transitions from 'pending' to 'downloading'
      // This means the UI can never show which file is actively being transferred
      service.queueDownloads([{ filename: 'test.hda', size: 10000 }])

      let state = service.getState()
      expect(state.queue[0].status).toBe('pending')

      // When progress is reported, status should change to 'downloading'
      service.updateProgress('test.hda', 1000)

      state = service.getState()
      expect(state.queue[0].status).toBe('downloading')
    })
  })

  describe('cancelAll marks pending as failed', () => {
    it('should mark pending items as failed', () => {
      service.queueDownloads([
        { filename: 'test1.hda', size: 1024 },
        { filename: 'test2.hda', size: 2048 }
      ])

      service.cancelAll()

      const state = service.getState()
      expect(state.queue.every((i: DownloadQueueItem) => i.status === 'failed')).toBe(true)
    })
  })

  describe('markFailed', () => {
    it('should mark a specific file as failed with error message', () => {
      service.queueDownloads([{ filename: 'test.hda', size: 1024 }])

      service.markFailed('test.hda', 'Download stalled after 30s')

      const state = service.getState()
      const item = state.queue.find((i: DownloadQueueItem) => i.filename === 'test.hda')
      expect(item?.status).toBe('failed')
      expect(item?.error).toBe('Download stalled after 30s')
    })
  })

  describe('updateProgress', () => {
    it('should update progress percentage for a queued item', () => {
      service.queueDownloads([{ filename: 'test.hda', size: 10000 }])

      service.updateProgress('test.hda', 5000)

      const state = service.getState()
      const item = state.queue.find((i: DownloadQueueItem) => i.filename === 'test.hda')
      // Note: progress stores percentage (0-100), not bytes
      expect(item?.progress).toBe(50)
    })

    it('should handle 0% and 100% progress correctly', () => {
      service.queueDownloads([{ filename: 'test.hda', size: 10000 }])

      service.updateProgress('test.hda', 0)
      let state = service.getState()
      expect(state.queue[0].progress).toBe(0)

      service.updateProgress('test.hda', 10000)
      state = service.getState()
      expect(state.queue[0].progress).toBe(100)
    })
  })

  describe('getState serialization', () => {
    it('should return queue as array, not Map', () => {
      service.queueDownloads([{ filename: 'test.hda', size: 1024 }])

      const state = service.getState()
      expect(Array.isArray(state.queue)).toBe(true)
    })
  })
})
