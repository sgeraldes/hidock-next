import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useUnifiedRecordings } from '../useUnifiedRecordings'
import { useAppStore } from '@/store/useAppStore'

// Controllable device service — connected, empty cache, and a listRecordings()
// that NEVER resolves so we can prove the timeout path unblocks loading.
const deviceService = {
  isConnected: vi.fn(() => true),
  onConnectionChange: vi.fn(() => () => {}),
  onStatusChange: vi.fn(() => () => {}),
  getCachedRecordings: vi.fn(() => []),
  // Never resolves — simulates a hung USB read while the main process is starved.
  listRecordings: vi.fn(() => new Promise<never>(() => {}))
}

vi.mock('@/services/hidock-device', () => ({
  getHiDockDeviceService: vi.fn(() => deviceService)
}))

vi.mock('@/store/useAppStore', () => ({
  useAppStore: vi.fn()
}))

vi.mock('@/components/ui/toaster', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() }
}))

function createMockElectronAPI() {
  return {
    recordings: { getAll: vi.fn().mockResolvedValue([]) },
    syncedFiles: { getAll: vi.fn().mockResolvedValue([]) },
    deviceCache: { getAll: vi.fn().mockResolvedValue([]), saveAll: vi.fn().mockResolvedValue(undefined) },
    // ROUND-15 RESIDUAL — hook now calls getAllOwner; alias to the same fn.
    knowledge: (() => { const c = vi.fn().mockResolvedValue([]); return { getAll: c, getAllOwner: c } })(),
    onRecordingAdded: vi.fn(() => vi.fn())
  } as any
}

describe('useUnifiedRecordings (H7 — device fetch cannot hang forever)', () => {
  let storeState: any

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
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
    // @ts-ignore vitest mock — useAppStore is mocked as a plain vi.fn
    useAppStore.mockImplementation((selector: any) => selector(storeState))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('decrements the loading counter after the device fetch times out', async () => {
    renderHook(() => useUnifiedRecordings())

    // Let the Phase 1 local-data promises settle so the hook reaches the device fetch.
    await vi.advanceTimersByTimeAsync(0)

    // The device fetch is hung and the loading counter is still elevated.
    expect(deviceService.listRecordings).toHaveBeenCalled()
    expect(storeState.decrementUnifiedRecordingsLoading).not.toHaveBeenCalled()

    // Advance past the 60s device-fetch timeout — loading MUST resolve.
    await vi.advanceTimersByTimeAsync(60000)

    expect(storeState.decrementUnifiedRecordingsLoading).toHaveBeenCalled()
  })
})
