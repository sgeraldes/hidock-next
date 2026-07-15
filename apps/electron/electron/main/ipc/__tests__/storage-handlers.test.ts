/**
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'
import { registerStorageHandlers } from '../storage-handlers'
import * as db from '../../services/database'
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
  addSyncedFile: vi.fn()
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
