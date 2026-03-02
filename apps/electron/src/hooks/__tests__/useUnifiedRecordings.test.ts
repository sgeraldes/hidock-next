import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useUnifiedRecordings } from '../useUnifiedRecordings'
import { useAppStore } from '@/store/useAppStore'

// Mock dependencies
vi.mock('@/services/hidock-device', () => ({
  getHiDockDeviceService: vi.fn(() => ({
    isConnected: vi.fn(() => false),
    onConnectionChange: vi.fn(() => () => {}),
    onStatusChange: vi.fn(() => () => {}),
    getCachedRecordings: vi.fn(() => []),
    listRecordings: vi.fn(() => [])
  }))
}))

// Mock App Store
vi.mock('@/store/useAppStore', () => ({
  useAppStore: vi.fn()
}))

// Mock toaster to avoid circular dependency issues
vi.mock('@/components/ui/toaster', () => ({
  toast: {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  }
}))

// Mock Electron API
function createMockElectronAPI() {
  return {
    recordings: { getAll: vi.fn().mockResolvedValue([]) },
    syncedFiles: { getAll: vi.fn().mockResolvedValue([]) },
    deviceCache: { getAll: vi.fn().mockResolvedValue([]), saveAll: vi.fn().mockResolvedValue(undefined) },
    knowledge: { getAll: vi.fn().mockResolvedValue([]) },
    onRecordingAdded: vi.fn(() => vi.fn())
  } as any
}

global.window.electronAPI = createMockElectronAPI()

describe('useUnifiedRecordings', () => {
  let storeState: any

  beforeEach(() => {
    vi.clearAllMocks()
    // Reset electronAPI mock
    global.window.electronAPI = createMockElectronAPI()

    storeState = {
      unifiedRecordings: [],
      unifiedRecordingsLoading: false,
      unifiedRecordingsLoadingCount: 0,
      unifiedRecordingsError: null,
      unifiedRecordingsLoaded: false,
      setUnifiedRecordings: vi.fn(),
      setUnifiedRecordingsLoading: vi.fn(),
      incrementUnifiedRecordingsLoading: vi.fn(),
      decrementUnifiedRecordingsLoading: vi.fn(),
      setUnifiedRecordingsError: vi.fn(),
      markUnifiedRecordingsLoaded: vi.fn()
    }
    // @ts-ignore
    useAppStore.mockImplementation((selector: any) => selector(storeState))
  })

  // ============================================================
  // Basic data fetching
  // ============================================================

  describe('data fetching', () => {
    it('fetches knowledge captures and recordings on mount', async () => {
      renderHook(() => useUnifiedRecordings())

      await waitFor(() => {
        expect(window.electronAPI.knowledge.getAll).toHaveBeenCalled()
        expect(window.electronAPI.recordings.getAll).toHaveBeenCalled()
      })
    })

    it('fetches synced files and device cache on mount', async () => {
      renderHook(() => useUnifiedRecordings())

      await waitFor(() => {
        expect(window.electronAPI.syncedFiles.getAll).toHaveBeenCalled()
        expect(window.electronAPI.deviceCache.getAll).toHaveBeenCalled()
      })
    })

    it('increments loading counter during fetch', async () => {
      renderHook(() => useUnifiedRecordings())

      await waitFor(() => {
        expect(storeState.incrementUnifiedRecordingsLoading).toHaveBeenCalled()
      })
    })

    it('marks loaded after successful fetch', async () => {
      renderHook(() => useUnifiedRecordings())

      await waitFor(() => {
        expect(storeState.markUnifiedRecordingsLoaded).toHaveBeenCalled()
      })
    })

    it('decrements loading counter after fetch completes', async () => {
      renderHook(() => useUnifiedRecordings())

      await waitFor(() => {
        expect(storeState.decrementUnifiedRecordingsLoading).toHaveBeenCalled()
      })
    })
  })

  // ============================================================
  // Knowledge capture mapping
  // ============================================================

  describe('knowledge capture mapping', () => {
    it('maps knowledge captures to recordings by sourceRecordingId', async () => {
      const mockRecs = [{
        id: 'rec-1',
        filename: 'test.wav',
        file_path: '/recordings/test.wav',
        file_size: 100,
        status: 'complete',
        date_recorded: '2025-01-01T10:00:00Z'
      }]
      const mockCaptures = [{
        id: 'cap-1',
        sourceRecordingId: 'rec-1',
        title: 'Better Title',
        quality: 'valuable',
        status: 'ready'
      }]

      // @ts-ignore
      window.electronAPI.recordings.getAll.mockResolvedValue(mockRecs)
      // @ts-ignore
      window.electronAPI.knowledge.getAll.mockResolvedValue(mockCaptures)

      renderHook(() => useUnifiedRecordings())

      await waitFor(() => {
        expect(storeState.setUnifiedRecordings).toHaveBeenCalledWith(expect.arrayContaining([
          expect.objectContaining({
            id: 'rec-1',
            title: 'Better Title',
            quality: 'valuable',
            transcriptionStatus: 'complete'
          })
        ]))
      })
    })

    it('leaves title undefined when no knowledge capture exists', async () => {
      const mockRecs = [{
        id: 'rec-1',
        filename: 'test.wav',
        file_path: '/recordings/test.wav',
        file_size: 100,
        status: 'complete',
        date_recorded: '2025-01-01T10:00:00Z'
      }]
      // @ts-ignore
      window.electronAPI.recordings.getAll.mockResolvedValue(mockRecs)
      // @ts-ignore
      window.electronAPI.knowledge.getAll.mockResolvedValue([])

      renderHook(() => useUnifiedRecordings())

      await waitFor(() => {
        const call = storeState.setUnifiedRecordings.mock.calls.find((c: any) => c[0].length > 0)
        if (call) {
          expect(call[0][0].filename).toBe('test.wav')
          expect(call[0][0].title).toBeUndefined()
        }
      })
    })
  })

  // ============================================================
  // Stats computation
  // ============================================================

  describe('stats computation', () => {
    it('returns zero stats when there are no recordings', () => {
      storeState.unifiedRecordings = []

      const { result } = renderHook(() => useUnifiedRecordings())

      expect(result.current.stats).toEqual({
        total: 0,
        deviceOnly: 0,
        localOnly: 0,
        both: 0,
        synced: 0,
        unsynced: 0,
        onSource: 0,
        locallyAvailable: 0,
      })
    })

    it('correctly counts recordings by location type', () => {
      storeState.unifiedRecordings = [
        { location: 'device-only', syncStatus: 'not-synced' },
        { location: 'device-only', syncStatus: 'not-synced' },
        { location: 'local-only', syncStatus: 'synced' },
        { location: 'both', syncStatus: 'synced' },
        { location: 'both', syncStatus: 'synced' },
        { location: 'both', syncStatus: 'synced' },
      ]
      storeState.unifiedRecordingsLoaded = true

      const { result } = renderHook(() => useUnifiedRecordings())

      expect(result.current.stats.total).toBe(6)
      expect(result.current.stats.deviceOnly).toBe(2)
      expect(result.current.stats.localOnly).toBe(1)
      expect(result.current.stats.both).toBe(3)
    })

    it('correctly counts sync status', () => {
      storeState.unifiedRecordings = [
        { location: 'device-only', syncStatus: 'not-synced' },
        { location: 'local-only', syncStatus: 'synced' },
        { location: 'both', syncStatus: 'synced' },
        { location: 'device-only', syncStatus: 'syncing' },
      ]
      storeState.unifiedRecordingsLoaded = true

      const { result } = renderHook(() => useUnifiedRecordings())

      expect(result.current.stats.synced).toBe(2)
      expect(result.current.stats.unsynced).toBe(2)
    })

    it('computes semantic onSource count (device-only + both)', () => {
      storeState.unifiedRecordings = [
        { location: 'device-only', syncStatus: 'not-synced' },
        { location: 'device-only', syncStatus: 'not-synced' },
        { location: 'both', syncStatus: 'synced' },
        { location: 'local-only', syncStatus: 'synced' },
      ]
      storeState.unifiedRecordingsLoaded = true

      const { result } = renderHook(() => useUnifiedRecordings())

      // onSource = device-only(2) + both(1) = 3
      expect(result.current.stats.onSource).toBe(3)
    })

    it('computes semantic locallyAvailable count (local-only + both)', () => {
      storeState.unifiedRecordings = [
        { location: 'device-only', syncStatus: 'not-synced' },
        { location: 'both', syncStatus: 'synced' },
        { location: 'both', syncStatus: 'synced' },
        { location: 'local-only', syncStatus: 'synced' },
        { location: 'local-only', syncStatus: 'synced' },
      ]
      storeState.unifiedRecordingsLoaded = true

      const { result } = renderHook(() => useUnifiedRecordings())

      // locallyAvailable = local-only(2) + both(2) = 4
      expect(result.current.stats.locallyAvailable).toBe(4)
    })
  })

  // ============================================================
  // Error handling
  // ============================================================

  describe('error handling', () => {
    it('sets error state when recordings fetch fails', async () => {
      // @ts-ignore
      window.electronAPI.recordings.getAll.mockRejectedValue(new Error('Database error'))

      renderHook(() => useUnifiedRecordings())

      await waitFor(() => {
        expect(storeState.setUnifiedRecordingsError).toHaveBeenCalledWith('Database error')
      })
    })

    it('sets error state with generic message for non-Error exceptions', async () => {
      // @ts-ignore
      window.electronAPI.recordings.getAll.mockRejectedValue('string error')

      renderHook(() => useUnifiedRecordings())

      await waitFor(() => {
        expect(storeState.setUnifiedRecordingsError).toHaveBeenCalledWith('Failed to load recordings')
      })
    })

    it('decrements loading counter on error', async () => {
      // @ts-ignore
      window.electronAPI.recordings.getAll.mockRejectedValue(new Error('Fetch failed'))

      renderHook(() => useUnifiedRecordings())

      await waitFor(() => {
        expect(storeState.decrementUnifiedRecordingsLoading).toHaveBeenCalled()
      })
    })

    it('clears error state before loading', async () => {
      renderHook(() => useUnifiedRecordings())

      await waitFor(() => {
        expect(storeState.setUnifiedRecordingsError).toHaveBeenCalledWith(null)
      })
    })
  })

  // ============================================================
  // electronAPI guard - crash prevention
  // ============================================================

  describe('electronAPI guard - crash prevention', () => {
    it('does not crash when window.electronAPI is undefined', () => {
      const savedAPI = window.electronAPI
      // @ts-ignore
      delete window.electronAPI

      try {
        expect(() => {
          renderHook(() => useUnifiedRecordings())
        }).not.toThrow()
      } finally {
        window.electronAPI = savedAPI
      }
    })

    it('returns empty recordings when electronAPI is undefined', async () => {
      const savedAPI = window.electronAPI
      // @ts-ignore
      delete window.electronAPI

      try {
        renderHook(() => useUnifiedRecordings())

        await waitFor(() => {
          expect(storeState.setUnifiedRecordings).toHaveBeenCalledWith([])
        })
      } finally {
        window.electronAPI = savedAPI
      }
    })

    it('does not crash when electronAPI.onRecordingAdded is undefined', () => {
      const savedAPI = window.electronAPI
      // @ts-ignore
      window.electronAPI = { recordings: { getAll: vi.fn().mockResolvedValue([]) } }

      try {
        expect(() => {
          renderHook(() => useUnifiedRecordings())
        }).not.toThrow()
      } finally {
        window.electronAPI = savedAPI
      }
    })

    it('does not crash when electronAPI.recordings is undefined', () => {
      const savedAPI = window.electronAPI
      // @ts-ignore
      window.electronAPI = { onRecordingAdded: vi.fn(() => vi.fn()) }

      try {
        expect(() => {
          renderHook(() => useUnifiedRecordings())
        }).not.toThrow()
      } finally {
        window.electronAPI = savedAPI
      }
    })
  })

  // ============================================================
  // Return value shape
  // ============================================================

  describe('return value shape', () => {
    it('returns all expected fields', () => {
      const { result } = renderHook(() => useUnifiedRecordings())

      expect(result.current).toHaveProperty('recordings')
      expect(result.current).toHaveProperty('loading')
      expect(result.current).toHaveProperty('error')
      expect(result.current).toHaveProperty('refresh')
      expect(result.current).toHaveProperty('deviceConnected')
      expect(result.current).toHaveProperty('stats')
    })

    it('returns recordings as an array', () => {
      const { result } = renderHook(() => useUnifiedRecordings())

      expect(Array.isArray(result.current.recordings)).toBe(true)
    })

    it('returns refresh as a function', () => {
      const { result } = renderHook(() => useUnifiedRecordings())

      expect(typeof result.current.refresh).toBe('function')
    })

    it('returns deviceConnected as boolean', () => {
      const { result } = renderHook(() => useUnifiedRecordings())

      expect(typeof result.current.deviceConnected).toBe('boolean')
    })

    it('stats has all expected numeric fields', () => {
      const { result } = renderHook(() => useUnifiedRecordings())
      const { stats } = result.current

      expect(typeof stats.total).toBe('number')
      expect(typeof stats.deviceOnly).toBe('number')
      expect(typeof stats.localOnly).toBe('number')
      expect(typeof stats.both).toBe('number')
      expect(typeof stats.synced).toBe('number')
      expect(typeof stats.unsynced).toBe('number')
      expect(typeof stats.onSource).toBe('number')
      expect(typeof stats.locallyAvailable).toBe('number')
    })
  })

  // ============================================================
  // Skip loading when already loaded
  // ============================================================

  describe('skip loading when already loaded', () => {
    it('does not re-fetch when already loaded', async () => {
      storeState.unifiedRecordingsLoaded = true

      renderHook(() => useUnifiedRecordings())

      // Wait a tick for effects to run
      await new Promise(resolve => setTimeout(resolve, 50))

      // Should NOT have called any API because data is already loaded
      expect(window.electronAPI.recordings.getAll).not.toHaveBeenCalled()
    })
  })

  // ============================================================
  // Recording watcher subscription
  // ============================================================

  describe('recording watcher subscription', () => {
    it('subscribes to onRecordingAdded events', () => {
      renderHook(() => useUnifiedRecordings())

      expect(window.electronAPI.onRecordingAdded).toHaveBeenCalled()
    })

    it('returns unsubscribe function from onRecordingAdded', () => {
      const unsubscribeFn = vi.fn()
      // @ts-ignore
      window.electronAPI.onRecordingAdded.mockReturnValue(unsubscribeFn)

      const { unmount } = renderHook(() => useUnifiedRecordings())
      unmount()

      // The unsubscribe function should be called on unmount
      expect(unsubscribeFn).toHaveBeenCalled()
    })
  })
})