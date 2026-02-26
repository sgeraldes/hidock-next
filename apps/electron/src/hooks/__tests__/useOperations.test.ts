import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useOperations } from '../useOperations'

// Mock toast
vi.mock('@/components/ui/toaster', () => ({
  toast: vi.fn()
}))

// Mock transcription store
const mockAddToQueue = vi.fn()
const mockRemove = vi.fn()
const mockClear = vi.fn()
vi.mock('@/store/features/useTranscriptionStore', () => ({
  useTranscriptionStore: vi.fn((selector) => {
    const state = {
      addToQueue: mockAddToQueue,
      remove: mockRemove,
      clear: mockClear,
      queue: new Map()
    }
    if (typeof selector === 'function') return selector(state)
    return state
  })
}))

// Need to also mock the static getState method
import { useTranscriptionStore } from '@/store/features/useTranscriptionStore'
;(useTranscriptionStore as any).getState = vi.fn(() => ({
  remove: mockRemove,
  clear: mockClear
}))

// Mock electronAPI
const mockUpdateStatus = vi.fn().mockResolvedValue(undefined)
const mockCancelTranscription = vi.fn().mockResolvedValue(undefined)
const mockCancelAllTranscriptions = vi.fn().mockResolvedValue({ count: 3 })
const mockQueueDownloads = vi.fn().mockResolvedValue(undefined)
const mockCancelAllDownloads = vi.fn().mockResolvedValue(undefined)

const mockAddToQueueIPC = vi.fn().mockResolvedValue('queue-item-1')

global.window.electronAPI = {
  recordings: {
    updateStatus: mockUpdateStatus,
    addToQueue: mockAddToQueueIPC,
    cancelTranscription: mockCancelTranscription,
    cancelAllTranscriptions: mockCancelAllTranscriptions
  },
  downloadService: {
    queueDownloads: mockQueueDownloads,
    cancelAll: mockCancelAllDownloads
  }
} as any

describe('useOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('queueTranscription', () => {
    it('returns false for device-only recordings without local path', async () => {
      const { result } = renderHook(() => useOperations())

      const deviceOnly = {
        id: 'rec-1',
        filename: 'REC0001.WAV',
        location: 'device-only' as const,
        deviceFilename: 'REC0001.WAV',
        syncStatus: 'not-synced' as const,
        transcriptionStatus: 'none' as const,
        size: 1024,
        duration: 60,
        dateRecorded: new Date()
      }

      let success: boolean | undefined
      await act(async () => {
        success = await result.current.queueTranscription(deviceOnly as any)
      })

      expect(success).toBe(false)
      expect(mockUpdateStatus).not.toHaveBeenCalled()
    })

    it('returns false for already processing recordings', async () => {
      const { result } = renderHook(() => useOperations())

      const processing = {
        id: 'rec-2',
        filename: 'test.wav',
        location: 'local-only' as const,
        localPath: '/path/test.wav',
        syncStatus: 'synced' as const,
        transcriptionStatus: 'processing' as const,
        size: 1024,
        duration: 60,
        dateRecorded: new Date()
      }

      let success: boolean | undefined
      await act(async () => {
        success = await result.current.queueTranscription(processing as any)
      })

      expect(success).toBe(false)
    })

    it('queues transcription for eligible local recording', async () => {
      const { result } = renderHook(() => useOperations())

      const eligible = {
        id: 'rec-3',
        filename: 'eligible.wav',
        location: 'local-only' as const,
        localPath: '/path/eligible.wav',
        syncStatus: 'synced' as const,
        transcriptionStatus: 'none' as const,
        size: 1024,
        duration: 60,
        dateRecorded: new Date()
      }

      let success: boolean | undefined
      await act(async () => {
        success = await result.current.queueTranscription(eligible as any)
      })

      expect(success).toBe(true)
      expect(mockUpdateStatus).toHaveBeenCalledWith('rec-3', 'pending')
      expect(mockAddToQueueIPC).toHaveBeenCalledWith('rec-3')
      expect(mockAddToQueue).toHaveBeenCalledWith('queue-item-1', 'rec-3', 'eligible.wav')
    })
  })

  describe('queueDownload', () => {
    it('returns false for non-device-only recordings', async () => {
      const { result } = renderHook(() => useOperations())

      const localOnly = {
        id: 'rec-4',
        location: 'local-only' as const,
        localPath: '/path/test.wav',
        syncStatus: 'synced' as const,
        transcriptionStatus: 'none' as const,
        filename: 'test.wav',
        size: 1024,
        duration: 60,
        dateRecorded: new Date()
      }

      let success: boolean | undefined
      await act(async () => {
        success = await result.current.queueDownload(localOnly as any)
      })

      expect(success).toBe(false)
      expect(mockQueueDownloads).not.toHaveBeenCalled()
    })

    it('queues download for device-only recording', async () => {
      const { result } = renderHook(() => useOperations())

      const deviceOnly = {
        id: 'rec-5',
        filename: 'REC0005.WAV',
        location: 'device-only' as const,
        deviceFilename: 'REC0005.WAV',
        syncStatus: 'not-synced' as const,
        transcriptionStatus: 'none' as const,
        size: 2048,
        duration: 120,
        dateRecorded: new Date('2026-01-15')
      }

      let success: boolean | undefined
      await act(async () => {
        success = await result.current.queueDownload(deviceOnly as any)
      })

      expect(success).toBe(true)
      expect(mockQueueDownloads).toHaveBeenCalledWith([{
        filename: 'REC0005.WAV',
        size: 2048,
        dateCreated: expect.any(String)
      }])
    })
  })

  describe('cancelAllTranscriptions', () => {
    it('calls IPC and clears store', async () => {
      const { result } = renderHook(() => useOperations())

      await act(async () => {
        await result.current.cancelAllTranscriptions()
      })

      expect(mockCancelAllTranscriptions).toHaveBeenCalled()
      expect(mockClear).toHaveBeenCalled()
    })
  })

  describe('cancelAllDownloads', () => {
    it('calls IPC cancel', async () => {
      const { result } = renderHook(() => useOperations())

      await act(async () => {
        await result.current.cancelAllDownloads()
      })

      expect(mockCancelAllDownloads).toHaveBeenCalled()
    })
  })
})
