
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
  beforeEach(() => {
    vi.clearAllMocks()
    const storeMock = {
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
    useAppStore.mockImplementation((selector) => selector(storeMock))
  })

  it('should call knowledge.getAll', async () => {
    renderHook(() => useUnifiedRecordings())
    
    await waitFor(() => {
        expect(window.electronAPI.knowledge.getAll).toHaveBeenCalled()
    })
  })
})
