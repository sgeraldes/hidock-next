/**
 * Download Service B-007 Bug Fix Tests
 *
 * Tests for the 9 download/sync bugs fixed in spec B-007:
 * - B-DWN-001: Stall detection cleans up queue after marking failed
 * - B-DWN-002: Prune threshold reduced to 10, auto-prune failed items older than 24h
 * - B-DWN-003: .hda files normalized to .mp3
 * - B-DWN-004: clearCompleted also removes from database
 * - B-DWN-005: cancelAll persists cancelled state
 * - B-DWN-006: cancelDownload has delayed cleanup
 * - B-DWN-007: Retry checks if file already synced first
 * - B-DWN-009: getState() uses dirty-flag caching
 *
 * @vitest-environment node
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

const mockRun = vi.fn()
const mockIsFileSynced = vi.fn(() => false)

// Mock database functions
vi.mock('../database', () => ({
  markRecordingDownloaded: vi.fn(),
  addSyncedFile: vi.fn(),
  isFileSynced: (...args: any[]) => mockIsFileSynced(...args),
  getRecordingByFilename: vi.fn(() => null),
  getSyncedFilenames: vi.fn(() => new Set()),
  queryOne: vi.fn(() => null),
  queryAll: vi.fn(() => []),
  run: (...args: any[]) => mockRun(...args),
  runInTransaction: vi.fn((fn: () => void) => fn()), // Execute callback immediately
  getDatabase: vi.fn(() => ({
    exec: vi.fn(() => []),
    run: vi.fn()
  }))
}))

// Mock file-storage
vi.mock('../file-storage', () => ({
  saveRecording: vi.fn().mockResolvedValue('/mock/path/file.wav'),
  getRecordingsPath: vi.fn(() => '/mock/recordings')
}))

// Mock fs - use importOriginal to avoid vite-browser-external conflicts
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    default: { ...actual, existsSync: vi.fn(() => false) },
    existsSync: vi.fn(() => false)
  }
})

// Need to import AFTER mocks
import { getDownloadService, normalizeHdaFilename, type DownloadQueueItem } from '../download-service'

describe('DownloadService B-007 Fixes', () => {
  let service: ReturnType<typeof getDownloadService>

  beforeEach(() => {
    vi.clearAllMocks()
    mockIsFileSynced.mockReturnValue(false)
    service = getDownloadService()
    // Clear the queue for test isolation
    const state = service.getState()
    if (state.queue.length > 0) {
      service.clearCompleted()
      service.cancelAll()
      service.clearCompleted()
    }
  })

  describe('B-DWN-003: .hda filename normalization', () => {
    it('should normalize .hda to .mp3', () => {
      expect(normalizeHdaFilename('recording.hda')).toBe('recording.mp3')
    })

    it('should normalize .HDA (case-insensitive) to .mp3', () => {
      expect(normalizeHdaFilename('recording.HDA')).toBe('recording.mp3')
    })

    it('should not change .wav filenames', () => {
      expect(normalizeHdaFilename('recording.wav')).toBe('recording.wav')
    })

    it('should not change .mp3 filenames', () => {
      expect(normalizeHdaFilename('recording.mp3')).toBe('recording.mp3')
    })

    it('should not affect filenames without extensions', () => {
      expect(normalizeHdaFilename('recording')).toBe('recording')
    })

    it('should only replace the last .hda extension', () => {
      expect(normalizeHdaFilename('file.hda.backup.hda')).toBe('file.hda.backup.mp3')
    })
  })

  describe('B-DWN-004: clearCompleted removes from database', () => {
    it('should call removeFromDatabase for cleared items', () => {
      service.queueDownloads([
        { filename: 'test1.wav', size: 1024 },
        { filename: 'test2.wav', size: 2048 }
      ])

      // Mark one as failed
      service.markFailed('test1.wav', 'test error')

      // Clear completed/failed
      service.clearCompleted()

      // Should have called run (which is the database function) for deletion
      const deleteCalls = mockRun.mock.calls.filter(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('DELETE FROM download_queue')
      )
      expect(deleteCalls.length).toBeGreaterThan(0)
    })
  })

  describe('B-DWN-005: cancelAll persists state', () => {
    it('should call persistQueueItem for each cancelled item', () => {
      service.queueDownloads([
        { filename: 'test1.wav', size: 1024 },
        { filename: 'test2.wav', size: 2048 }
      ])

      // Reset mock to only track cancelAll calls
      mockRun.mockClear()

      service.cancelAll()

      // Should have persisted each cancelled item (INSERT OR REPLACE calls)
      const persistCalls = mockRun.mock.calls.filter(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('INSERT OR REPLACE INTO download_queue')
      )
      expect(persistCalls.length).toBe(2)
    })
  })

  describe('B-DWN-006: cancelDownload has delayed cleanup', () => {
    it('should mark as cancelled and schedule cleanup', () => {
      vi.useFakeTimers()

      service.queueDownloads([{ filename: 'test.wav', size: 1024 }])

      const result = service.cancelDownload('test.wav')
      expect(result.success).toBe(true)

      // C-004: Item should be marked as cancelled (not failed) immediately
      let state = service.getState()
      expect(state.queue[0]?.status).toBe('cancelled')
      expect(state.queue[0]?.error).toBe('Cancelled by user')

      // After 5s, item should be removed
      vi.advanceTimersByTime(5000)
      state = service.getState()
      expect(state.queue).toHaveLength(0)

      vi.useRealTimers()
    })
  })

  describe('B-DWN-007: Retry checks if file already synced', () => {
    it('should skip retry for files that are already synced', () => {
      service.queueDownloads([
        { filename: 'synced.wav', size: 1024 },
        { filename: 'notsynced.wav', size: 2048 }
      ])

      service.markFailed('synced.wav', 'test error')
      service.markFailed('notsynced.wav', 'test error')

      // Mock isFileSynced to return true for one file
      mockIsFileSynced.mockImplementation((filename: string) => {
        return filename === 'synced.wav'
      })

      const result = service.retryFailed()

      // Only 1 should be retried (notsynced.wav)
      expect(result.count).toBe(1)

      const state = service.getState()
      const pending = state.queue.filter((i: DownloadQueueItem) => i.status === 'pending')
      expect(pending).toHaveLength(1)
      expect(pending[0].filename).toBe('notsynced.wav')
    })
  })

  describe('B-DWN-009: getState() dirty-flag caching', () => {
    it('should return same array reference when no changes made', () => {
      service.queueDownloads([{ filename: 'test.wav', size: 1024 }])

      const state1 = service.getState()
      const state2 = service.getState()

      // Same array reference = no new array allocation
      expect(state1.queue).toBe(state2.queue)
    })

    it('should return new array reference after queue modification', () => {
      service.queueDownloads([{ filename: 'test.wav', size: 1024 }])

      const state1 = service.getState()

      // Modify the queue
      service.updateProgress('test.wav', 500)

      const state2 = service.getState()

      // Different array reference because queue was modified
      expect(state1.queue).not.toBe(state2.queue)
    })
  })

  describe('B-DWN-001: Stall detection cleanup', () => {
    it('should schedule cleanup after detecting stalled downloads', () => {
      vi.useFakeTimers()

      service.queueDownloads([{ filename: 'stalled.wav', size: 10000 }])

      // C-004: Stall detection now uses 60s timeout (was 30s) and checks
      // lastProgressAt if available. We need to set startedAt on the internal
      // Map item (not the serialized state snapshot) past the 60s threshold.
      service.updateProgress('stalled.wav', 1000)

      // Access the internal queue item directly via getState and modify the internal Map
      // The getState() returns serialized array, but we need to modify the actual Map entry
      // To do this properly, we advance fake timers by 61 seconds to trigger the timeout
      vi.advanceTimersByTime(61000)

      const stalledCount = service.checkForStalledDownloads()
      expect(stalledCount).toBe(1)

      // Item should be marked as failed immediately
      let state = service.getState()
      const failedItem = state.queue.find((i: DownloadQueueItem) => i.filename === 'stalled.wav')
      expect(failedItem?.status).toBe('failed')

      // After 5s cleanup delay, item should be removed
      vi.advanceTimersByTime(5000)
      state = service.getState()
      expect(state.queue).toHaveLength(0)

      vi.useRealTimers()
    })
  })
})
