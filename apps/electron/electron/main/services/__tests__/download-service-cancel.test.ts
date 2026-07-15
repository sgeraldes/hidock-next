// @vitest-environment node

/**
 * Phase-1 download cancellation — DownloadService state machine tests.
 *
 * Covers the main-process half of the cancel feature:
 *  - cancelDownload composes queue-state cancellation with an in-flight USB abort and
 *    resolves only after settlement; a pending item skips straight to 'cancelled'
 *  - the active transfer briefly shows 'cancelling' before settling to 'cancelled'
 *  - cancelAll marks pending + downloading 'cancelled' AND aborts the active transfer
 *  - the late-completion-vs-cancelled race: processDownload never overwrites a
 *    cancelled item, never saves the file, never writes synced_files/recordings
 *  - markFailed never downgrades a 'cancelling'/'cancelled' item to 'failed'
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  ipcMain: { handle: vi.fn() },
  Notification: class {
    static isSupported() { return false }
    show() { /* no-op in tests */ }
  },
}))

vi.mock('../database', () => ({
  markRecordingDownloaded: vi.fn(),
  addSyncedFile: vi.fn(),
  isFileSynced: vi.fn(() => false),
  getRecordingByFilename: vi.fn(() => null),
  getSyncedFilenames: vi.fn(() => new Set()),
  queryOne: vi.fn(() => null),
  queryAll: vi.fn(() => []),
  run: vi.fn(),
  runInTransaction: vi.fn((fn: () => void) => fn()),
  getDatabase: vi.fn(() => ({ exec: vi.fn(() => []), run: vi.fn() })),
}))

vi.mock('../file-storage', () => ({
  saveRecording: vi.fn().mockResolvedValue('/mock/recordings/file.wav'),
  getRecordingsPath: vi.fn(() => '/mock/recordings'),
}))

vi.mock('../activity-log', () => ({ emitActivityLog: vi.fn() }))

// Controllable transfer-controller mock so we can drive the "active transfer" state.
const controllerState: {
  activeFilename: string | null
  cancelByNameResolvers: Array<() => void>
} = { activeFilename: null, cancelByNameResolvers: [] }

vi.mock('../download-transfer-controller', () => ({
  getActiveTransferFilename: () => controllerState.activeFilename,
  cancelActiveTransferByName: vi.fn((_filename: string) => {
    // Simulate USB settlement completing after a microtask; clears the active pointer.
    return new Promise<boolean>((resolve) => {
      controllerState.cancelByNameResolvers.push(() => {
        controllerState.activeFilename = null
        resolve(true)
      })
    })
  }),
  cancelActiveTransfer: vi.fn(() => {
    controllerState.activeFilename = null
    return Promise.resolve(true)
  }),
}))

// existsSync → false so isFileAlreadySynced never treats a queued file as synced;
// mkdirSync → no-op so processDownload's recordings-dir ensure has no disk side effect.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  const overrides = { existsSync: vi.fn(() => false), mkdirSync: vi.fn() }
  return { ...actual, default: { ...actual, ...overrides }, ...overrides }
})

import { DownloadService } from '../download-service'
import { saveRecording } from '../file-storage'
import { addSyncedFile, markRecordingDownloaded } from '../database'
import { cancelActiveTransferByName, cancelActiveTransfer } from '../download-transfer-controller'

const mockSaveRecording = vi.mocked(saveRecording)
const mockAddSyncedFile = vi.mocked(addSyncedFile)
const mockMarkRecordingDownloaded = vi.mocked(markRecordingDownloaded)
const mockCancelByName = vi.mocked(cancelActiveTransferByName)
const mockCancelActive = vi.mocked(cancelActiveTransfer)

function statusOf(service: DownloadService, filename: string): string | undefined {
  return service.getState().queue.find((i) => i.filename === filename)?.status
}

describe('DownloadService — Phase-1 cancellation', () => {
  let service: DownloadService

  beforeEach(() => {
    vi.clearAllMocks()
    controllerState.activeFilename = null
    controllerState.cancelByNameResolvers = []
    // Fresh instance per test (simulates a clean process) — avoids singleton bleed.
    service = new DownloadService()
  })

  afterEach(() => {
    service.destroy() // stop the periodic timers so they don't leak across tests
  })

  describe('cancelDownload', () => {
    it('cancels a PENDING item straight to cancelled (no active transfer involved)', async () => {
      service.queueDownloads([{ filename: 'a.hda', size: 1024 }])

      const result = await service.cancelDownload('a.hda')

      expect(result).toEqual({ success: true })
      expect(statusOf(service, 'a.hda')).toBe('cancelled')
      const item = service.getState().queue.find((i) => i.filename === 'a.hda')
      expect(item?.cancelReason).toBe('user')
      // Pending item is not on the bus → no USB abort.
      expect(mockCancelByName).not.toHaveBeenCalled()
    })

    it('aborts the in-flight USB transfer and shows a transient "cancelling" state', async () => {
      service.queueDownloads([{ filename: 'a.hda', size: 1024 }])
      service.updateProgress('a.hda', 100) // pending → downloading
      controllerState.activeFilename = 'a.hda' // this file is streaming on the bus

      const cancelPromise = service.cancelDownload('a.hda')
      await Promise.resolve() // let cancelDownload run up to the settlement await

      // Transient state emitted while the USB abort settles.
      expect(statusOf(service, 'a.hda')).toBe('cancelling')
      expect(mockCancelByName).toHaveBeenCalledWith('a.hda', 'user-cancel')

      // Settle the USB transfer.
      controllerState.cancelByNameResolvers.forEach((r) => r())
      const result = await cancelPromise

      expect(result).toEqual({ success: true })
      expect(statusOf(service, 'a.hda')).toBe('cancelled')
    })

    it('returns an error for an unknown file', async () => {
      const result = await service.cancelDownload('missing.hda')
      expect(result).toEqual({ success: false, error: 'Download not found in queue' })
    })

    it('refuses to cancel an already-terminal item', async () => {
      service.queueDownloads([{ filename: 'a.hda', size: 1024 }])
      await service.cancelDownload('a.hda') // → cancelled
      const result = await service.cancelDownload('a.hda')
      expect(result.success).toBe(false)
      expect(result.error).toContain('cancelled')
    })
  })

  describe('cancelAll', () => {
    it('marks pending + downloading cancelled and aborts the active transfer', async () => {
      service.queueDownloads([
        { filename: 'a.hda', size: 1024 },
        { filename: 'b.hda', size: 2048 },
      ])
      service.updateProgress('a.hda', 100) // a → downloading
      controllerState.activeFilename = 'a.hda'

      await service.cancelAll()

      expect(statusOf(service, 'a.hda')).toBe('cancelled')
      expect(statusOf(service, 'b.hda')).toBe('cancelled')
      expect(mockCancelActive).toHaveBeenCalledWith('user-cancel')
      const items = service.getState().queue
      expect(items.every((i) => i.cancelReason === 'user')).toBe(true)
    })

    it('does not abort the bus when nothing is actively transferring', async () => {
      service.queueDownloads([{ filename: 'a.hda', size: 1024 }]) // pending only
      controllerState.activeFilename = null

      await service.cancelAll()

      expect(statusOf(service, 'a.hda')).toBe('cancelled')
      expect(mockCancelActive).not.toHaveBeenCalled()
    })
  })

  describe('late-completion vs cancelled race (processDownload)', () => {
    it('does not save or write DB rows when the item was already cancelled', async () => {
      service.queueDownloads([{ filename: 'a.hda', size: 3 }])
      await service.cancelDownload('a.hda') // user cancels first

      const result = await service.processDownload('a.hda', Buffer.from('abc'))

      expect(result.success).toBe(false)
      expect(result.error).toBe('Download cancelled')
      expect(mockSaveRecording).not.toHaveBeenCalled()
      expect(mockAddSyncedFile).not.toHaveBeenCalled()
      expect(mockMarkRecordingDownloaded).not.toHaveBeenCalled()
      // The cancel is preserved — NOT flipped to downloading/completed.
      expect(statusOf(service, 'a.hda')).toBe('cancelled')
    })

    it('honors a cancel that lands during the save (saveRecording returns null)', async () => {
      service.queueDownloads([{ filename: 'a.hda', size: 3 }])
      // Simulate the isCancelled predicate firing inside saveRecording.
      mockSaveRecording.mockResolvedValueOnce(null as unknown as string)

      const result = await service.processDownload('a.hda', Buffer.from('abc'))

      expect(result.success).toBe(false)
      expect(result.error).toBe('Download cancelled')
      // No synced_files / recordings rows written for a cancelled save.
      expect(mockAddSyncedFile).not.toHaveBeenCalled()
      expect(mockMarkRecordingDownloaded).not.toHaveBeenCalled()
    })

    it('passes an isCancelled predicate to saveRecording', async () => {
      service.queueDownloads([{ filename: 'a.hda', size: 3 }])
      await service.processDownload('a.hda', Buffer.from('abc'))

      expect(mockSaveRecording).toHaveBeenCalledTimes(1)
      const opts = mockSaveRecording.mock.calls[0][4] as { isCancelled?: () => boolean }
      expect(typeof opts?.isCancelled).toBe('function')
    })
  })

  describe('markFailed guard', () => {
    it('does not downgrade a cancelled item to failed', async () => {
      service.queueDownloads([{ filename: 'a.hda', size: 1024 }])
      await service.cancelDownload('a.hda')

      service.markFailed('a.hda', 'USB transfer failed')

      expect(statusOf(service, 'a.hda')).toBe('cancelled')
    })

    it('does not downgrade a cancelling item to failed', async () => {
      service.queueDownloads([{ filename: 'a.hda', size: 1024 }])
      service.updateProgress('a.hda', 100)
      controllerState.activeFilename = 'a.hda'
      const cancelPromise = service.cancelDownload('a.hda')
      await Promise.resolve()
      expect(statusOf(service, 'a.hda')).toBe('cancelling')

      // Renderer's abort-triggered error path races in here.
      service.markFailed('a.hda', 'USB transfer failed')
      expect(statusOf(service, 'a.hda')).toBe('cancelling')

      controllerState.cancelByNameResolvers.forEach((r) => r())
      await cancelPromise
      expect(statusOf(service, 'a.hda')).toBe('cancelled')
    })

    it('still fails a genuinely downloading item', () => {
      service.queueDownloads([{ filename: 'a.hda', size: 1024 }])
      service.updateProgress('a.hda', 100) // downloading
      service.markFailed('a.hda', 'stalled')
      expect(statusOf(service, 'a.hda')).toBe('failed')
    })
  })
})
