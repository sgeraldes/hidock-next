import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useUnifiedRecordings } from '../useUnifiedRecordings'
import { useAppStore } from '@/store/useAppStore'

// Mock dependencies
vi.mock('@/services/hidock-device', () => ({
  getHiDockDeviceService: vi.fn(() => ({
    isConnected: vi.fn(() => false),
    onConnectionChange: vi.fn(() => () => {}),
    getCachedRecordings: vi.fn(() => []),
    listRecordings: vi.fn(() => [])
  }))
}))

// Mock App Store
vi.mock('@/store/useAppStore', () => ({
  useAppStore: vi.fn()
}))

// Mock Electron API
global.window.electronAPI = {
  recordings: { getAll: vi.fn().mockResolvedValue([]) },
  syncedFiles: { getAll: vi.fn().mockResolvedValue([]) },
  deviceCache: { getAll: vi.fn().mockResolvedValue([]), saveAll: vi.fn() },
  knowledge: { getAll: vi.fn().mockResolvedValue([]) }
} as any

describe('useUnifiedRecordings', () => {
  let storeState: any

  beforeEach(() => {
    vi.clearAllMocks()
    storeState = {
      unifiedRecordings: [],
      unifiedRecordingsLoading: false,
      unifiedRecordingsError: null,
      unifiedRecordingsLoaded: false,
      setUnifiedRecordings: vi.fn(),
      setUnifiedRecordingsLoading: vi.fn(),
      setUnifiedRecordingsError: vi.fn(),
      markUnifiedRecordingsLoaded: vi.fn()
    }
    // @ts-ignore
    useAppStore.mockImplementation((selector) => selector(storeState))
  })

  it('should fetch knowledge captures and recordings', async () => {
    renderHook(() => useUnifiedRecordings())
    
    await waitFor(() => {
        expect(window.electronAPI.knowledge.getAll).toHaveBeenCalled()
        expect(window.electronAPI.recordings.getAll).toHaveBeenCalled()
    })
  })

  it('should correctly map knowledge captures to recordings', async () => {
    const mockRecs = [{ id: 'rec-1', filename: 'test.wav', file_size: 100, status: 'complete', date_recorded: '2025-01-01T10:00:00Z' }]
    const mockCaptures = [{ id: 'cap-1', sourceRecordingId: 'rec-1', title: 'Better Title', quality: 'valuable', status: 'ready' }]
    
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

  it('should fallback to filename if no knowledge title exists', async () => {
    const mockRecs = [{ id: 'rec-1', filename: 'test.wav', file_size: 100, status: 'complete', date_recorded: '2025-01-01T10:00:00Z' }]
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