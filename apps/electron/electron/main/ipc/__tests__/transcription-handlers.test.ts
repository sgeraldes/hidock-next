/**
 * IPC handlers for the transcription queue-control channels (pause/resume/
 * reorder/queueState). Verifies each channel is registered and delegates to the
 * main-process queue processor.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'
import { registerTranscriptionHandlers } from '../transcription-handlers'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() }
}))

const mockPauseQueue = vi.fn()
const mockResumeQueue = vi.fn()
const mockReorderQueueItem = vi.fn()
const mockGetQueueState = vi.fn()

vi.mock('../../services/transcription', () => ({
  pauseQueue: (...a: any[]) => mockPauseQueue(...a),
  resumeQueue: (...a: any[]) => mockResumeQueue(...a),
  reorderQueueItem: (...a: any[]) => mockReorderQueueItem(...a),
  getQueueState: (...a: any[]) => mockGetQueueState(...a)
}))

const STATE = { paused: false, isProcessing: false, processingId: null, pendingCount: 0, processingCount: 0 }

describe('transcription-handlers', () => {
  let handlers: Record<string, (...args: any[]) => any> = {}

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = {}
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: any) => {
      handlers[channel] = handler
      return undefined as any
    })
    mockPauseQueue.mockReturnValue({ ...STATE, paused: true })
    mockResumeQueue.mockReturnValue({ ...STATE, paused: false })
    mockGetQueueState.mockReturnValue({ ...STATE, pendingCount: 3 })
    registerTranscriptionHandlers()
  })

  it('registers all four queue-control channels', () => {
    expect(Object.keys(handlers).sort()).toEqual([
      'transcription:pause',
      'transcription:queueState',
      'transcription:reorder',
      'transcription:resume'
    ])
  })

  it('transcription:pause delegates to pauseQueue and returns its state', async () => {
    const result = await handlers['transcription:pause'](null)
    expect(mockPauseQueue).toHaveBeenCalledTimes(1)
    expect(result.paused).toBe(true)
  })

  it('transcription:resume delegates to resumeQueue', async () => {
    const result = await handlers['transcription:resume'](null)
    expect(mockResumeQueue).toHaveBeenCalledTimes(1)
    expect(result.paused).toBe(false)
  })

  it('transcription:reorder validates input and forwards recordingId + direction', async () => {
    await handlers['transcription:reorder'](null, { recordingId: 'rec-1', direction: 'up' })
    expect(mockReorderQueueItem).toHaveBeenCalledWith('rec-1', 'up')
  })

  it('transcription:reorder ignores an invalid direction (no reorder call)', async () => {
    const result = await handlers['transcription:reorder'](null, { recordingId: 'rec-1', direction: 'sideways' })
    expect(mockReorderQueueItem).not.toHaveBeenCalled()
    // Falls back to the current queue state rather than throwing.
    expect(result.pendingCount).toBe(3)
  })

  it('transcription:queueState returns the current snapshot', async () => {
    const result = await handlers['transcription:queueState'](null)
    expect(mockGetQueueState).toHaveBeenCalled()
    expect(result.pendingCount).toBe(3)
  })
})
