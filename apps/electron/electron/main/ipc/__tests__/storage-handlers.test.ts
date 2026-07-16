/**
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain, shell } from 'electron'
import { registerStorageHandlers } from '../storage-handlers'
import * as db from '../../services/database'
import * as fileStorage from '../../services/file-storage'
import * as config from '../../services/config'
import * as transcription from '../../services/transcription'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn() },
  BrowserWindow: { getFocusedWindow: vi.fn(), getAllWindows: vi.fn(() => [{}]) }
}))

vi.mock('../../services/file-storage', () => ({
  getStorageInfo: vi.fn(),
  getRecordingsPath: vi.fn(() => '/mock/recordings'),
  getTranscriptsPath: vi.fn(() => '/mock/transcripts'),
  readRecordingFile: vi.fn(),
  deleteRecording: vi.fn(),
  saveRecording: vi.fn(async () => '/mock/recordings/file.hda')
}))

vi.mock('../../services/database', () => ({
  insertRecording: vi.fn(),
  getMeetings: vi.fn(() => []),
  linkRecordingToMeeting: vi.fn(),
  addSyncedFile: vi.fn(),
  // ADV45-2 (round-47) — raw-file IPCs resolve the path to a canonical recording
  // row (existence-scoped owner gate). Default: resolves (owner's own file);
  // gate tests override to null for orphan / hard-purged / arbitrary paths.
  getRecordingIdByFilePath: vi.fn(() => 'rec-owner')
}))

vi.mock('../../services/config', () => ({
  getConfig: vi.fn()
}))

// storage:save-recording now delegates the auto-transcribe gate to the single
// funnel in the transcription service (loaded via dynamic import).
vi.mock('../../services/transcription', () => ({
  queueTranscriptionIfEnabled: vi.fn()
}))

// Flush the microtask queue so the handler's fire-and-forget dynamic import
// of the transcription service resolves before assertions run.
const flushMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0))

function getHandler(channel: string): (...args: unknown[]) => Promise<{ success: boolean; error?: string }> {
  const call = (ipcMain.handle as unknown as { mock: { calls: unknown[][] } }).mock.calls.find(
    (c) => c[0] === channel
  )
  return call?.[1] as (...args: unknown[]) => Promise<{ success: boolean; error?: string }>
}

describe('storage:save-recording — auto-transcribe gating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does NOT queue transcription when autoTranscribe is off', async () => {
    ;(config.getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      transcription: { autoTranscribe: false }
    })
    registerStorageHandlers()
    const handler = getHandler('storage:save-recording')

    const res = await handler({}, '2026Jun24-180500-Rec78.hda', [1, 2, 3])
    await flushMicrotasks()

    expect(res.success).toBe(true)
    // The funnel itself is the no-op when autoTranscribe is off; it is still
    // invoked, but with autoTranscribe false it does not queue. The handler must
    // record transcription_status 'none' for the inserted recording.
    const inserted = (db.insertRecording as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(inserted.transcription_status).toBe('none')
  })

  it('queues transcription when autoTranscribe is on', async () => {
    ;(config.getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      transcription: { autoTranscribe: true }
    })
    registerStorageHandlers()
    const handler = getHandler('storage:save-recording')

    const res = await handler({}, '2026Jun24-180500-Rec78.hda', [1, 2, 3])
    await flushMicrotasks()

    expect(res.success).toBe(true)
    // Handler delegates queuing to the single transcription funnel.
    expect(transcription.queueTranscriptionIfEnabled).toHaveBeenCalledTimes(1)
    const inserted = (db.insertRecording as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const recordingId = inserted.id
    expect(transcription.queueTranscriptionIfEnabled).toHaveBeenCalledWith(recordingId)
    expect(inserted.transcription_status).toBe('pending')
  })

  it('records transcription_status "none" when the transcription FEATURE is disabled, even with autoTranscribe on', async () => {
    // Adversarial round-2 [HIGH]: storage:save-recording is a core channel, but
    // its transcription side effect must respect the feature gate. With the
    // feature disabled the inserted row must not claim a pending transcription
    // (the funnel itself refuses to queue — covered by
    // transcription-funnel-gate.test.ts against the REAL funnel).
    ;(config.getConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      features: { preset: 'full', flags: { transcription: false } },
      transcription: { autoTranscribe: true }
    })
    registerStorageHandlers()
    const handler = getHandler('storage:save-recording')

    const res = await handler({}, '2026Jun24-180500-Rec78.hda', [1, 2, 3])
    await flushMicrotasks()

    expect(res.success).toBe(true)
    const inserted = (db.insertRecording as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(inserted.transcription_status).toBe('none')
  })
})

/**
 * ADV45-2 (round-47) — the raw-file IPCs (read audio / open / reveal) must
 * resolve the requested path to a canonical recording ROW and refuse anything
 * that does not (hard-purged / orphan / arbitrary path), while still serving the
 * owner's own recording in ANY state (trashed / personal / low-value —
 * existence-scoped, not the full eligibility allowlist). There is NO
 * non-owner/assistant caller of these IPCs, so the existence-scoped owner gate
 * is the complete policy.
 */
describe('storage raw-file IPCs — existence-scoped owner gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(db.getRecordingIdByFilePath as ReturnType<typeof vi.fn>).mockReturnValue('rec-owner')
  })

  it('read-recording serves bytes when the path resolves to a real recording (any state)', async () => {
    ;(fileStorage.readRecordingFile as ReturnType<typeof vi.fn>).mockReturnValue(Buffer.from([1, 2, 3]))
    registerStorageHandlers()
    const res = await getHandler('storage:read-recording')({}, '/mock/recordings/owned.hda')
    expect(res.success).toBe(true)
    expect((res as { data?: string }).data).toBe(Buffer.from([1, 2, 3]).toString('base64'))
  })

  it('read-recording REFUSES (no bytes) a hard-purged / orphan / arbitrary path', async () => {
    ;(db.getRecordingIdByFilePath as ReturnType<typeof vi.fn>).mockReturnValue(null)
    registerStorageHandlers()
    const res = await getHandler('storage:read-recording')({}, '/etc/passwd')
    expect(res.success).toBe(false)
    // The file must never be read when no recording owns the path.
    expect(fileStorage.readRecordingFile).not.toHaveBeenCalled()
  })

  it('read-recording fails closed when the lookup cannot resolve (null)', async () => {
    ;(db.getRecordingIdByFilePath as ReturnType<typeof vi.fn>).mockReturnValue(null)
    registerStorageHandlers()
    const res = await getHandler('storage:read-recording')({}, '/mock/recordings/gone.hda')
    expect(res.success).toBe(false)
    expect(fileStorage.readRecordingFile).not.toHaveBeenCalled()
  })

  it('open-file REFUSES an orphan / arbitrary path (never calls shell.openPath)', async () => {
    ;(db.getRecordingIdByFilePath as ReturnType<typeof vi.fn>).mockReturnValue(null)
    registerStorageHandlers()
    const res = await getHandler('storage:open-file')({}, '/etc/hosts')
    expect(res.success).toBe(false)
    expect(shell.openPath).not.toHaveBeenCalled()
  })

  it('reveal-in-folder REFUSES an orphan / arbitrary path (never calls shell.showItemInFolder)', async () => {
    ;(db.getRecordingIdByFilePath as ReturnType<typeof vi.fn>).mockReturnValue(null)
    registerStorageHandlers()
    const res = await getHandler('storage:reveal-in-folder')({}, '/etc/hosts')
    expect(res.success).toBe(false)
    expect(shell.showItemInFolder).not.toHaveBeenCalled()
  })
})
