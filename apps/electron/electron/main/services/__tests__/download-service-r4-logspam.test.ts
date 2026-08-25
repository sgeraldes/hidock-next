/**
 * BUG-R4: DownloadService reconciliation log-spam regression tests
 *
 * Reconciliation used to log one line PER already-synced file (1300+ lines per
 * sync). These tests assert the reconciliation emits a SINGLE summary line for a
 * mocked N-file sync — never per-file spam.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  send: vi.fn(),
  windows: [] as Array<{ isDestroyed: () => boolean; webContents: { send: (...args: unknown[]) => void } }>
}))

// Mock electron modules BEFORE importing the service
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
  BrowserWindow: { getAllWindows: vi.fn(() => electronMocks.windows) },
  ipcMain: { handle: vi.fn() },
  Notification: vi.fn(() => ({ show: vi.fn() }))
}))

const mockIsFileSynced = vi.fn((_filename: string) => false)
const mockExistsSync = vi.fn((_p: string) => false)
const mockGetRecordingByFilename = vi.fn((_f: string) => null as null | { file_path: string })
const mockEnrichRecordingScheduleMetadata = vi.fn()

vi.mock('../database', () => ({
  markRecordingDownloaded: vi.fn(),
  addSyncedFile: vi.fn(),
  isFileSynced: (filename: string) => mockIsFileSynced(filename),
  isFilePurged: () => false,
  getRecordingByFilename: (filename: string) => mockGetRecordingByFilename(filename),
  upsertRecordingFromDevice: vi.fn((file: DeviceFile) => ({
    id: `id:${file.filename}`,
    filename: file.filename,
    original_filename: file.filename,
    file_path: null,
    file_size: file.size,
    duration_seconds: file.duration,
    date_recorded: file.dateCreated.toISOString(),
    status: 'none',
    location: 'device-only',
    transcription_status: 'none',
    on_device: 1,
    on_local: 0,
    source: 'hidock',
    is_imported: 0,
    created_at: file.dateCreated.toISOString()
  })),
  enrichRecordingScheduleMetadata: (...args: unknown[]) => mockEnrichRecordingScheduleMetadata(...args),
  createProcessingRun: vi.fn(() => ({ id: 'metadata-run' })),
  completeProcessingRun: vi.fn(),
  getSyncedFilenames: vi.fn(() => new Set()),
  queryOne: vi.fn(() => null),
  queryAll: vi.fn(() => []),
  run: vi.fn(),
  runInTransaction: vi.fn((fn: () => void) => fn()),
  getDatabase: vi.fn(() => ({ exec: vi.fn(() => []), run: vi.fn() }))
}))

vi.mock('../file-storage', () => ({
  saveRecording: vi.fn().mockResolvedValue('/mock/path/file.wav'),
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

import { getDownloadService } from '../download-service'

type DeviceFile = { filename: string; size: number; duration: number; dateCreated: Date }

function makeFiles(n: number): DeviceFile[] {
  return Array.from({ length: n }, (_, i) => ({
    filename: `rec_${i}.hda`,
    size: 1024,
    duration: 10,
    dateCreated: new Date(0)
  }))
}

describe('BUG-R4: reconciliation emits ONE summary line, not per-file spam', () => {
  let service: ReturnType<typeof getDownloadService>
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockIsFileSynced.mockReturnValue(false)
    mockExistsSync.mockReturnValue(false)
    mockGetRecordingByFilename.mockReturnValue(null)
    electronMocks.windows = []
    service = getDownloadService()
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
  })

  it('logs exactly one summary line for 1300 already-synced files (no per-file lines)', () => {
    const N = 1300
    mockIsFileSynced.mockReturnValue(true) // every file already in synced_files

    const results = service.getFilesToSync(makeFiles(N))

    expect(results).toHaveLength(N)
    expect(results.every((r) => r.skipReason)).toBe(true)

    // Exactly ONE log line from the whole reconciliation — the summary.
    expect(logSpy).toHaveBeenCalledTimes(1)
    const line = logSpy.mock.calls[0][0] as string
    expect(line).toContain('[DownloadService] Reconciliation:')
    expect(line).toContain(`${N} files skipped (already synced)`)
    expect(line).toContain('0 files queued')

    // No per-file spam of any kind.
    const perFile = logSpy.mock.calls.filter((c) =>
      /Found orphaned|Found in recordings|already synced, skipping|Skipping/.test(String(c[0]))
    )
    expect(perFile).toHaveLength(0)
  })

  it('folds a reconciled count into the single summary line (files healed from disk)', () => {
    const N = 500
    mockIsFileSynced.mockReturnValue(false) // not in synced_files...
    mockExistsSync.mockReturnValue(true) // ...but present on disk -> reconciled

    const results = service.getFilesToSync(makeFiles(N))

    expect(results).toHaveLength(N)
    // Still exactly one line despite 500 files being reconciled.
    expect(logSpy).toHaveBeenCalledTimes(1)
    const line = logSpy.mock.calls[0][0] as string
    expect(line).toContain(`${N} files skipped (already synced)`)
    expect(line).toContain('reconciled from disk/recordings')
    expect(line).toContain('0 files queued')
  })

  it('keeps steady-state summary format unchanged when nothing is reconciled', () => {
    mockIsFileSynced.mockReturnValue(true) // straight synced_files hits, no reconcile

    service.getFilesToSync(makeFiles(3))

    const line = logSpy.mock.calls[0][0] as string
    // No parenthetical reconciled note when reconciledCount === 0.
    expect(line).toBe('[DownloadService] Reconciliation: 3 files skipped (already synced), 0 files queued')
  })

  it('publishes one coalesced discovery event for a snapshot of new files', () => {
    electronMocks.windows = [{
      isDestroyed: () => false,
      webContents: { send: electronMocks.send }
    }]

    const results = service.getFilesToSync(makeFiles(500))

    expect(results).toHaveLength(500)
    expect(results.every((result) => !result.skipReason)).toBe(true)
    expect(electronMocks.send).toHaveBeenCalledTimes(1)
    expect(electronMocks.send).toHaveBeenCalledWith(
      'recording:new',
      expect.objectContaining({ count: 500 })
    )
    expect(mockEnrichRecordingScheduleMetadata).toHaveBeenCalledTimes(500)
  })

  it('does not announce or enrich a historical snapshot that is already synced', () => {
    mockIsFileSynced.mockReturnValue(true)
    electronMocks.windows = [{
      isDestroyed: () => false,
      webContents: { send: electronMocks.send }
    }]

    service.getFilesToSync(makeFiles(500))

    expect(electronMocks.send).not.toHaveBeenCalled()
    expect(mockEnrichRecordingScheduleMetadata).not.toHaveBeenCalled()
  })
})
