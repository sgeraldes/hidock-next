/**
 * Renderer cancel-path regression: a user cancellation must surface as 'cancelled',
 * never downgraded to 'failed'. Before the fix, processDownload's catch/`!success`
 * paths called downloadService.markFailed() BEFORE checking signal.aborted, which
 * clobbered the main process's 'cancelling'/'cancelled' state to 'failed' — making a
 * deliberate cancel look retryable and resurrect on reconnect.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useDownloadOrchestrator, cancelDownloads } from '../useDownloadOrchestrator'
import { useAppStore } from '@/store/useAppStore'

vi.mock('@/services/qa-monitor', () => ({ shouldLogQa: () => false }))
vi.mock('@/components/ui/toaster', () => ({ toast: vi.fn() }))
vi.mock('@/features/library/utils/errorHandling', () => ({
  parseError: (e: unknown) => ({ type: 'unknown', message: e instanceof Error ? e.message : 'err' }),
  getErrorMessage: () => 'error'
}))

const mockLog = vi.fn()
const mockDownloadRecording = vi.fn()
let stateUpdateCb: ((state: unknown) => void) | null = null

const fakeDevice = {
  isConnected: () => true,
  log: mockLog,
  downloadRecording: mockDownloadRecording,
  cancelAllDownloads: vi.fn(() => 0),
  onStatusChange: vi.fn(() => vi.fn())
}
vi.mock('@/services/hidock-device', () => ({
  getHiDockDeviceService: () => fakeDevice
}))

const mockMarkFailed = vi.fn().mockResolvedValue(undefined)

const pending = { id: 'q1', filename: 'REC0001.WAV', fileSize: 3, progress: 0, status: 'pending' as const }

beforeEach(() => {
  vi.clearAllMocks()
  stateUpdateCb = null
  useAppStore.getState().clearDownloadQueue()
  useAppStore.setState((s) => ({ connectionStatus: { ...s.connectionStatus, step: 'ready' } }))

  global.window.electronAPI = {
    downloadService: {
      onStateUpdate: vi.fn((cb: (state: unknown) => void) => {
        stateUpdateCb = cb
        return () => {}
      }),
      getState: vi.fn().mockResolvedValue({ queue: [pending], session: null, isProcessing: false, isPaused: false }),
      markFailed: mockMarkFailed,
      updateProgress: vi.fn().mockResolvedValue(undefined),
      processDownload: vi.fn().mockResolvedValue({ success: true }),
      notifyCompletion: vi.fn().mockResolvedValue(undefined),
      retryFailed: vi.fn().mockResolvedValue({ count: 0 })
    },
    config: {
      get: vi.fn().mockResolvedValue({ success: true, data: { device: { autoDownload: true } } })
    }
  } as unknown as typeof window.electronAPI
})

describe('useDownloadOrchestrator cancel path', () => {
  it('does NOT markFailed when the transfer is aborted mid-flight (cancel ≠ fail)', async () => {
    // Abort the in-flight transfer the moment the first chunk arrives, exactly like a
    // user cancel racing the USB stream.
    mockDownloadRecording.mockImplementation(async (_name: string, _size: number, onChunk: (c: Uint8Array) => void) => {
      cancelDownloads() // aborts the orchestrator's AbortController (the signal onChunk observes)
      onChunk(new Uint8Array([1, 2, 3])) // onChunk sees signal.aborted → throws 'Download cancelled'
      return true
    })

    renderHook(() => useDownloadOrchestrator())

    // Kick the download loop the way the real subscription does.
    expect(stateUpdateCb).toBeTypeOf('function')
    stateUpdateCb!({ queue: [pending], session: null, isProcessing: false, isPaused: false })

    // Wait until the cancel branch has run (logged as info, not error).
    await waitFor(() =>
      expect(mockLog).toHaveBeenCalledWith('info', 'Download cancelled', expect.stringContaining('REC0001.WAV'))
    )

    // The core assertion: the cancel was never downgraded to a failure.
    expect(mockMarkFailed).not.toHaveBeenCalled()
    // And the renderer Map entry was deterministically cleaned up.
    expect(useAppStore.getState().downloadQueue.has('REC0001.WAV')).toBe(false)
  })
})
