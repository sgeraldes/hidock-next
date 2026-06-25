/**
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'
import { registerStorageHandlers } from '../storage-handlers'
import * as db from '../../services/database'
import * as config from '../../services/config'

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
  addToQueue: vi.fn(),
  getMeetings: vi.fn(() => []),
  linkRecordingToMeeting: vi.fn(),
  addSyncedFile: vi.fn()
}))

vi.mock('../../services/config', () => ({
  getConfig: vi.fn()
}))

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

    expect(res.success).toBe(true)
    expect(db.addToQueue).not.toHaveBeenCalled()
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

    expect(res.success).toBe(true)
    expect(db.addToQueue).toHaveBeenCalledTimes(1)
    const inserted = (db.insertRecording as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(inserted.transcription_status).toBe('pending')
  })
})
