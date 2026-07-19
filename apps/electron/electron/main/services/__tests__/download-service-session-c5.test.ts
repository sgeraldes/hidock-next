// CHARACTERIZATION (C5 Phase 0) — pins current behavior, not desired behavior; see device-pipeline-spec §1, §2
/**
 * Pins DownloadService session/queue/reconciliation gap behaviors not already
 * covered by the sibling suites (download-service.test.ts, download-service-c004.test.ts,
 * download-service-r4-logspam.test.ts):
 *   1. startSyncSession() folds ALL pending/downloading queue entries into the
 *      session, not merely the files passed to this specific call.
 *   2. getFilesToSync()'s 4-layer reconciliation (synced_files exact, normalized
 *      wav/mp3 match, disk self-heal, recordings-table self-heal) propagates the
 *      right skipReason per layer, plus a genuinely-new file passes through.
 *   3. queueDownloads() dedups against a normalized (.hda -> .mp3) filename
 *      already in the queue, not just an exact filename match.
 *   4. processDownload()'s integrity gates: no-op for an unqueued filename, and
 *      byte-size mismatch fails without marking the file synced.
 *   5. checkForStalledDownloads()'s adaptive per-size timeout (AUD4-005): the
 *      same "no progress for 70s" item stalls a default-size file but NOT a
 *      large (>10MB) file, which gets a longer 120s allowance.
 *
 * See docs/specs/2026-07-11-device-pipeline-spec.md §1 (DownloadService gate
 * inventory rows) and §2 (bug catalog) for why these behaviors are frozen
 * before the DevicePipeline coordinator migration begins.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock electron modules BEFORE importing the service
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  ipcMain: { handle: vi.fn() },
  Notification: vi.fn(() => ({ show: vi.fn() }))
}))

// Configurable mocks so each test can control the 4-layer reconciliation independently.
const mockIsFileSynced = vi.fn((_filename: string) => false)
const mockExistsSync = vi.fn((_p: string) => false)
const mockGetRecordingByFilename = vi.fn((_f: string) => null as null | { file_path: string })
const mockAddSyncedFile = vi.fn()
const mockMarkRecordingDownloaded = vi.fn(() => 'recording-id')

vi.mock('../database', () => ({
  markRecordingDownloaded: (...args: unknown[]) => mockMarkRecordingDownloaded(...(args as [])),
  addSyncedFile: (...args: unknown[]) => mockAddSyncedFile(...args),
  isFileSynced: (filename: string) => mockIsFileSynced(filename),
  getRecordingByFilename: (filename: string) => mockGetRecordingByFilename(filename),
  getSyncedFilenames: vi.fn(() => new Set()),
  queryOne: vi.fn(() => null),
  queryAll: vi.fn(() => []),
  run: vi.fn(),
  runInTransaction: vi.fn((fn: () => void) => fn()),
  getDatabase: vi.fn(() => ({ exec: vi.fn(() => []), run: vi.fn() }))
}))

vi.mock('../file-storage', () => ({
  saveRecording: vi.fn().mockResolvedValue('/mock/recordings/saved.mp3'),
  getRecordingsPath: vi.fn(() => '/mock/recordings')
}))

vi.mock('../activity-log', () => ({
  emitActivityLog: vi.fn()
}))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    default: { ...actual, existsSync: (p: string) => mockExistsSync(p) },
    existsSync: (p: string) => mockExistsSync(p)
  }
})

import { getDownloadService, type DownloadQueueItem } from '../download-service'

describe('DownloadService — C5 Phase 0 session/queue/reconciliation gaps', () => {
  let service: ReturnType<typeof getDownloadService>

  beforeEach(() => {
    vi.clearAllMocks()
    mockIsFileSynced.mockReturnValue(false)
    mockExistsSync.mockReturnValue(false)
    mockGetRecordingByFilename.mockReturnValue(null)
    mockMarkRecordingDownloaded.mockReturnValue('recording-id')
    service = getDownloadService()
    // Same isolation pattern as sibling suites: drain the shared singleton's queue.
    const state = service.getState()
    if (state.queue.length > 0) {
      service.clearCompleted()
      service.cancelAll()
      service.clearCompleted()
    }
  })

  describe('startSyncSession: session covers ALL pending/downloading entries after enqueue, not just this call', () => {
    it('totalFiles counts a pre-existing pending item plus the newly queued file', () => {
      service.queueDownloads([{ filename: 'pre-existing.hda', size: 1000 }])

      const session = service.startSyncSession([{ filename: 'new-file.hda', size: 2000 }])

      expect(session.totalFiles).toBe(2)
      const filenames = service.getState().queue.map((i: DownloadQueueItem) => i.filename)
      expect(filenames).toEqual(expect.arrayContaining(['pre-existing.hda', 'new-file.hda']))
    })
  })

  describe('getFilesToSync: 4-layer reconciliation propagates the right skipReason per layer', () => {
    it('pins (a) synced_files exact, (b) normalized wav match, (c) disk self-heal, (d) recordings-table self-heal, and a genuinely new file', () => {
      // (a) 'a.hda' is directly in synced_files.
      // (b) 'b.hda' is not itself synced, but its .wav variant is.
      // (c) 'c.hda' is not in synced_files at all, but its .wav variant exists on disk — self-heals.
      // (d) 'd.hda' is not in synced_files or on disk, but the recordings table has a valid file_path — self-heals.
      // (e) 'e.hda' matches nothing anywhere — genuinely new.
      mockIsFileSynced.mockImplementation((fn: string) => fn === 'a.hda' || fn === 'b.wav')
      mockExistsSync.mockImplementation((p: string) => String(p).includes('c.wav') || String(p).includes('healed-d.mp3'))
      mockGetRecordingByFilename.mockImplementation((fn: string) =>
        fn === 'd.hda' ? { file_path: '/somewhere/healed-d.mp3' } : null
      )

      const files = ['a.hda', 'b.hda', 'c.hda', 'd.hda', 'e.hda'].map((filename) => ({
        filename,
        size: 1024,
        duration: 10,
        dateCreated: new Date(0)
      }))
      const results = service.getFilesToSync(files)

      const byName = Object.fromEntries(results.map((r) => [r.filename, r.skipReason]))
      expect(byName['a.hda']).toBe('In synced_files table')
      expect(byName['b.hda']).toBe('WAV version in synced_files')
      expect(byName['c.hda']).toBe('File exists on disk (reconciled)')
      expect(byName['d.hda']).toBe('In recordings table with valid file')
      expect(byName['e.hda']).toBeUndefined() // genuinely new — no skip reason, returned for sync

      // (c) and (d) heal synced_files as a side effect; (a)/(b) don't need to (already recorded).
      expect(mockAddSyncedFile).toHaveBeenCalledWith('c.hda', 'c.wav', expect.stringContaining('c.wav'))
      expect(mockAddSyncedFile).toHaveBeenCalledWith('d.hda', 'healed-d.mp3', '/somewhere/healed-d.mp3')
    })
  })

  describe('queueDownloads: dedups against a normalized (.hda -> .mp3) filename already in the queue', () => {
    it('does not add a duplicate when the normalized equivalent is already queued', () => {
      const first = service.queueDownloads([{ filename: 'song.mp3', size: 1000 }])
      expect(first).toEqual(['song.mp3'])

      // 'song.hda' normalizes to 'song.mp3', which is already queued.
      const second = service.queueDownloads([{ filename: 'song.hda', size: 1000 }])
      expect(second).toEqual([])
      expect(service.getState().queue).toHaveLength(1)
    })
  })

  describe('processDownload: integrity gates', () => {
    it('is a no-op when the filename has no existing queue item', async () => {
      const result = await service.processDownload('never-queued.hda', Buffer.from('data'))
      expect(result).toEqual({ success: false, error: 'File not in queue' })
      expect(mockAddSyncedFile).not.toHaveBeenCalled()
    })

    it('fails on byte-size mismatch and does not mark the file synced', async () => {
      service.queueDownloads([{ filename: 'mismatch.hda', size: 100 }])

      const result = await service.processDownload('mismatch.hda', Buffer.alloc(50))

      expect(result.success).toBe(false)
      expect(result.error).toContain('size mismatch')
      expect(mockAddSyncedFile).not.toHaveBeenCalled()
      const item = service.getState().queue.find((i: DownloadQueueItem) => i.filename === 'mismatch.hda')
      expect(item?.status).toBe('failed')
    })

    it('marks synced on an exact byte-size match', async () => {
      service.queueDownloads([{ filename: 'exact.hda', size: 100 }])

      const result = await service.processDownload('exact.hda', Buffer.alloc(100))

      expect(result.success).toBe(true)
      expect(mockAddSyncedFile).toHaveBeenCalled()
      const item = service.getState().queue.find((i: DownloadQueueItem) => i.filename === 'exact.hda')
      expect(item?.status).toBe('completed')
    })
  })

  describe('checkForStalledDownloads: adaptive per-size stall threshold (AUD4-005)', () => {
    it('fails a downloading item whose progress is older than the default 60s threshold; a fresh item is untouched', () => {
      service.queueDownloads([
        { filename: 'default-size.hda', size: 1024 }, // small file -> 60s default threshold
        { filename: 'fresh.hda', size: 1024 }
      ])
      service.updateProgress('default-size.hda', 100)
      service.updateProgress('fresh.hda', 100)

      // Backdate only the first item's last-activity timestamp past the 60s default.
      const internal = (service as any).state.queue.get('default-size.hda')
      internal.lastProgressAt = new Date(Date.now() - 70000)

      const stalledCount = service.checkForStalledDownloads()

      expect(stalledCount).toBe(1)
      const state = service.getState().queue
      expect(state.find((i: DownloadQueueItem) => i.filename === 'default-size.hda')?.status).toBe('failed')
      expect(state.find((i: DownloadQueueItem) => i.filename === 'fresh.hda')?.status).toBe('downloading')
    })

    it('does NOT stall a large (>10MB) file at the same 70s-stale mark — it gets a 120s allowance', () => {
      service.queueDownloads([{ filename: 'large.hda', size: 11 * 1024 * 1024 }])
      service.updateProgress('large.hda', 100)

      const internal = (service as any).state.queue.get('large.hda')
      internal.lastProgressAt = new Date(Date.now() - 70000) // stale enough for a small file, not for a large one

      const stalledCount = service.checkForStalledDownloads()

      expect(stalledCount).toBe(0)
      expect(service.getState().queue.find((i: DownloadQueueItem) => i.filename === 'large.hda')?.status).toBe('downloading')
    })
  })
})
