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

// Mock electron modules BEFORE importing the service
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  ipcMain: { handle: vi.fn() },
  Notification: vi.fn(() => ({ show: vi.fn() }))
}))

const mockIsFileSynced = vi.fn((_filename: string) => false)
const mockExistsSync = vi.fn((_p: string) => false)
const mockGetRecordingByFilename = vi.fn((_f: string) => null as null | { file_path: string })

vi.mock('../database', () => ({
  markRecordingDownloaded: vi.fn(),
  addSyncedFile: vi.fn(),
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
})
