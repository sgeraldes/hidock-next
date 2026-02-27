import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'
import { registerRecordingHandlers } from '../recording-handlers'

// Mock electron
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  BrowserWindow: {
    getFocusedWindow: vi.fn(),
    getAllWindows: vi.fn(() => [{}])
  }
}))

// Mock database service
vi.mock('../../services/database', () => ({
  getRecordings: vi.fn(),
  getRecordingById: vi.fn(),
  getRecordingsForMeeting: vi.fn(),
  updateRecordingStatus: vi.fn(),
  updateRecordingTranscriptionStatus: vi.fn(),
  linkRecordingToMeeting: vi.fn(),
  getTranscriptByRecordingId: vi.fn(),
  getCandidatesForRecordingWithDetails: vi.fn(),
  getMeetingsNearDate: vi.fn(),
  insertRecording: vi.fn(),
  getQueueItems: vi.fn(),
  addToQueue: vi.fn(),
  updateQueueItem: vi.fn()
}))

// Mock file-storage service
vi.mock('../../services/file-storage', () => ({
  getRecordingFiles: vi.fn(),
  deleteRecording: vi.fn(),
  getRecordingsPath: vi.fn(() => '/mock/recordings')
}))

// Mock node:fs - must include default export for jsdom environment
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    default: actual,
    ...actual,
    copyFileSync: vi.fn(),
    existsSync: vi.fn(),
    statSync: vi.fn()
  }
})

// Mock node:path - must include default export for jsdom environment
vi.mock('path', async () => {
  const actual = await vi.importActual<typeof import('path')>('path')
  return {
    default: actual,
    ...actual
  }
})

// Mock node:crypto - must include default export for jsdom environment
vi.mock('crypto', async () => {
  const actual = await vi.importActual<typeof import('crypto')>('crypto')
  return {
    default: actual,
    ...actual,
    randomUUID: vi.fn(() => 'generated-uuid-1234')
  }
})

// Mock validation schemas
vi.mock('../validation', () => ({
  GetRecordingByIdSchema: {
    safeParse: vi.fn((data) => ({ success: true, data }))
  },
  DeleteRecordingSchema: {
    safeParse: vi.fn((data) => ({ success: true, data }))
  },
  LinkRecordingToMeetingSchema: {
    safeParse: vi.fn((data) => ({ success: true, data }))
  },
  UnlinkRecordingFromMeetingSchema: {
    safeParse: vi.fn((data) => ({ success: true, data }))
  },
  TranscribeRecordingSchema: {
    safeParse: vi.fn((data) => ({ success: true, data }))
  }
}))

// Mock recording-watcher service
vi.mock('../../services/recording-watcher', () => ({
  startRecordingWatcher: vi.fn(),
  stopRecordingWatcher: vi.fn(),
  getWatcherStatus: vi.fn(() => ({ isWatching: false, path: '/mock/recordings' }))
}))

// Mock transcription service
vi.mock('../../services/transcription', () => ({
  transcribeManually: vi.fn(),
  getTranscriptionStatus: vi.fn(() => ({ isProcessing: false, pendingCount: 0, processingCount: 0 })),
  startTranscriptionProcessor: vi.fn(),
  stopTranscriptionProcessor: vi.fn(),
  cancelTranscription: vi.fn(),
  cancelAllTranscriptions: vi.fn(() => 0)
}))

// Mock config service
vi.mock('../../services/config', () => ({
  getConfig: vi.fn(() => ({
    transcription: {
      geminiApiKey: 'mock-api-key'
    }
  }))
}))

// Mock recording-watcher
vi.mock('../../services/recording-watcher', () => ({
  startRecordingWatcher: vi.fn(),
  stopRecordingWatcher: vi.fn(),
  getWatcherStatus: vi.fn()
}))

// Mock transcription service
vi.mock('../../services/transcription', () => ({
  transcribeManually: vi.fn(),
  getTranscriptionStatus: vi.fn(),
  startTranscriptionProcessor: vi.fn(),
  stopTranscriptionProcessor: vi.fn(),
  cancelTranscription: vi.fn(),
  cancelAllTranscriptions: vi.fn()
}))

// Mock config service
vi.mock('../../services/config', () => ({
  getConfig: vi.fn(() => ({
    transcription: {
      provider: 'gemini',
      geminiApiKey: 'test-api-key',
      geminiModel: 'gemini-3-pro-preview',
      autoTranscribe: true,
      language: 'es'
    }
  })),
  setConfig: vi.fn()
}))

describe('Recording IPC Handlers', () => {
  let handlers: Record<string, Function> = {}

  beforeEach(async () => {
    vi.clearAllMocks()
    handlers = {}
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: Function) => {
      handlers[channel] = handler
      return undefined as any
    })
    registerRecordingHandlers()
  })

  it('should register all expected handlers', () => {
    const expectedChannels = [
      'recordings:getAll',
      'recordings:getById',
      'recordings:getForMeeting',
      'recordings:getAllWithTranscripts',
      'recordings:delete',
      'recordings:linkToMeeting',
      'recordings:unlinkFromMeeting',
      'recordings:getTranscript',
      'recordings:transcribe',
      'recordings:getWatcherStatus',
      'recordings:startWatcher',
      'recordings:stopWatcher',
      'recordings:getTranscriptionStatus',
      'recordings:startTranscriptionProcessor',
      'recordings:stopTranscriptionProcessor',
      'transcription:cancel',
      'transcription:cancelAll',
      'transcription:getQueue',
      'transcription:updateQueueItem',
      'recordings:scanFolder',
      'recordings:getCandidates',
      'recordings:getMeetingsNearDate',
      'recordings:addExternal',
      'recordings:selectMeeting',
      'recordings:addToQueue',
      'recordings:processQueue'
    ]

    for (const channel of expectedChannels) {
      expect(ipcMain.handle).toHaveBeenCalledWith(channel, expect.any(Function))
    }
  })

  describe('recordings:getAll', () => {
    it('should return all recordings from the database', async () => {
      const { getRecordings } = await import('../../services/database')
      const mockRecordings = [
        { id: 'rec-1', filename: 'meeting-01.wav', status: 'ready' },
        { id: 'rec-2', filename: 'meeting-02.wav', status: 'ready' }
      ]
      vi.mocked(getRecordings).mockReturnValue(mockRecordings as any)

      const result = await handlers['recordings:getAll'](null)

      expect(getRecordings).toHaveBeenCalled()
      expect(result).toEqual(mockRecordings)
    })

    it('should return empty array on error', async () => {
      const { getRecordings } = await import('../../services/database')
      vi.mocked(getRecordings).mockImplementation(() => {
        throw new Error('Database error')
      })

      const result = await handlers['recordings:getAll'](null)

      expect(result).toEqual([])
    })
  })

  describe('recordings:getById', () => {
    it('should return a recording by valid UUID', async () => {
      const { getRecordingById } = await import('../../services/database')
      const mockRecording = { id: '550e8400-e29b-41d4-a716-446655440000', filename: 'test.wav' }
      vi.mocked(getRecordingById).mockReturnValue(mockRecording as any)

      const result = await handlers['recordings:getById'](null, '550e8400-e29b-41d4-a716-446655440000')

      expect(getRecordingById).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440000')
      expect(result).toEqual(mockRecording)
    })

    it('should return undefined for invalid ID format', async () => {
      const { getRecordingById } = await import('../../services/database')

      const result = await handlers['recordings:getById'](null, 'not-a-uuid')

      expect(getRecordingById).not.toHaveBeenCalled()
      expect(result).toBeUndefined()
    })

    it('should return undefined on database error', async () => {
      const { getRecordingById } = await import('../../services/database')
      vi.mocked(getRecordingById).mockImplementation(() => {
        throw new Error('Database error')
      })

      const result = await handlers['recordings:getById'](null, '550e8400-e29b-41d4-a716-446655440000')

      expect(result).toBeUndefined()
    })
  })

  describe('recordings:getForMeeting', () => {
    it('should return recordings with transcripts for a meeting', async () => {
      const { getRecordingsForMeeting, getTranscriptByRecordingId } = await import('../../services/database')
      const meetingId = '550e8400-e29b-41d4-a716-446655440000'
      const mockRecordings = [
        { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', filename: 'rec1.wav' }
      ]
      const mockTranscript = { id: 't-1', recording_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', full_text: 'Hello' }

      vi.mocked(getRecordingsForMeeting).mockReturnValue(mockRecordings as any)
      vi.mocked(getTranscriptByRecordingId).mockReturnValue(mockTranscript as any)

      const result = await handlers['recordings:getForMeeting'](null, meetingId)

      expect(getRecordingsForMeeting).toHaveBeenCalledWith(meetingId)
      expect(result).toHaveLength(1)
      expect(result[0].transcript).toEqual(mockTranscript)
    })

    it('should return empty array for invalid meeting ID', async () => {
      const result = await handlers['recordings:getForMeeting'](null, 'invalid')

      expect(result).toEqual([])
    })
  })

  describe('recordings:getAllWithTranscripts', () => {
    it('should return all recordings with their transcripts', async () => {
      const { getRecordings, getTranscriptByRecordingId } = await import('../../services/database')
      const mockRecordings = [
        { id: 'r1', filename: 'a.wav' },
        { id: 'r2', filename: 'b.wav' }
      ]
      vi.mocked(getRecordings).mockReturnValue(mockRecordings as any)
      vi.mocked(getTranscriptByRecordingId)
        .mockReturnValueOnce({ id: 't1', full_text: 'Text 1' } as any)
        .mockReturnValueOnce(undefined)

      const result = await handlers['recordings:getAllWithTranscripts'](null)

      expect(result).toHaveLength(2)
      expect(result[0].transcript).toEqual({ id: 't1', full_text: 'Text 1' })
      expect(result[1].transcript).toBeUndefined()
    })

    it('should return empty array on error', async () => {
      const { getRecordings } = await import('../../services/database')
      vi.mocked(getRecordings).mockImplementation(() => {
        throw new Error('DB failure')
      })

      const result = await handlers['recordings:getAllWithTranscripts'](null)

      expect(result).toEqual([])
    })
  })

  describe('recordings:delete', () => {
    it('should delete a recording file and update its status', async () => {
      const { getRecordingById, updateRecordingStatus } = await import('../../services/database')
      const { deleteRecording } = await import('../../services/file-storage')
      const id = '550e8400-e29b-41d4-a716-446655440000'
      vi.mocked(getRecordingById).mockReturnValue({
        id,
        file_path: '/path/to/file.wav',
        filename: 'file.wav'
      } as any)
      vi.mocked(deleteRecording).mockReturnValue(true)

      const result = await handlers['recordings:delete'](null, id)

      expect(deleteRecording).toHaveBeenCalledWith('/path/to/file.wav')
      expect(updateRecordingStatus).toHaveBeenCalledWith(id, 'deleted')
      expect(result).toBe(true)
    })

    it('should return false if recording not found', async () => {
      const { getRecordingById } = await import('../../services/database')
      const id = '550e8400-e29b-41d4-a716-446655440000'
      vi.mocked(getRecordingById).mockReturnValue(undefined)

      const result = await handlers['recordings:delete'](null, id)

      expect(result).toBe(false)
    })

    it('should not update status if file deletion fails', async () => {
      const { getRecordingById, updateRecordingStatus } = await import('../../services/database')
      const { deleteRecording } = await import('../../services/file-storage')
      const id = '550e8400-e29b-41d4-a716-446655440000'
      vi.mocked(getRecordingById).mockReturnValue({
        id,
        file_path: '/path/to/file.wav',
        filename: 'file.wav'
      } as any)
      vi.mocked(deleteRecording).mockReturnValue(false)

      const result = await handlers['recordings:delete'](null, id)

      expect(updateRecordingStatus).not.toHaveBeenCalled()
      expect(result).toBe(false)
    })

    it('should return false for invalid ID format', async () => {
      const result = await handlers['recordings:delete'](null, 'not-a-uuid')

      expect(result).toBe(false)
    })

    it('should return false on error', async () => {
      const { getRecordingById } = await import('../../services/database')
      const id = '550e8400-e29b-41d4-a716-446655440000'
      vi.mocked(getRecordingById).mockImplementation(() => {
        throw new Error('DB error')
      })

      const result = await handlers['recordings:delete'](null, id)

      expect(result).toBe(false)
    })
  })

  describe('recordings:linkToMeeting', () => {
    it('should link a recording to a meeting with manual method', async () => {
      const { linkRecordingToMeeting } = await import('../../services/database')
      const recId = '550e8400-e29b-41d4-a716-446655440000'
      const meetId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'

      await handlers['recordings:linkToMeeting'](null, recId, meetId)

      expect(linkRecordingToMeeting).toHaveBeenCalledWith(recId, meetId, 1.0, 'manual')
    })

    it('should throw on validation error for invalid recording ID', async () => {
      await expect(
        handlers['recordings:linkToMeeting'](null, 'bad-id', '550e8400-e29b-41d4-a716-446655440000')
      ).rejects.toThrow()
    })

    it('should throw on validation error for invalid meeting ID', async () => {
      await expect(
        handlers['recordings:linkToMeeting'](null, '550e8400-e29b-41d4-a716-446655440000', 'bad-id')
      ).rejects.toThrow()
    })
  })

  describe('recordings:unlinkFromMeeting', () => {
    it('should unlink a recording from its meeting', async () => {
      const { linkRecordingToMeeting } = await import('../../services/database')
      const recId = '550e8400-e29b-41d4-a716-446655440000'

      await handlers['recordings:unlinkFromMeeting'](null, recId)

      expect(linkRecordingToMeeting).toHaveBeenCalledWith(recId, '', 0, '')
    })

    it('should throw on validation error for invalid recording ID', async () => {
      await expect(
        handlers['recordings:unlinkFromMeeting'](null, 'bad-id')
      ).rejects.toThrow()
    })
  })

  describe('recordings:getTranscript', () => {
    it('should return transcript for a valid recording ID', async () => {
      const { getTranscriptByRecordingId } = await import('../../services/database')
      const recId = '550e8400-e29b-41d4-a716-446655440000'
      const mockTranscript = { id: 't-1', recording_id: recId, full_text: 'Hello world' }
      vi.mocked(getTranscriptByRecordingId).mockReturnValue(mockTranscript as any)

      const result = await handlers['recordings:getTranscript'](null, recId)

      expect(getTranscriptByRecordingId).toHaveBeenCalledWith(recId)
      expect(result).toEqual(mockTranscript)
    })

    it('should return undefined for invalid recording ID', async () => {
      const result = await handlers['recordings:getTranscript'](null, 'invalid')

      expect(result).toBeUndefined()
    })
  })

  describe('recordings:transcribe', () => {
    it('should call transcribeManually with valid recording ID', async () => {
      const { transcribeManually } = await import('../../services/transcription')
      const recId = '550e8400-e29b-41d4-a716-446655440000'
      vi.mocked(transcribeManually).mockResolvedValue(undefined)

      await handlers['recordings:transcribe'](null, recId)

      expect(transcribeManually).toHaveBeenCalledWith(recId)
    })

    it('should throw on validation error for invalid ID', async () => {
      await expect(
        handlers['recordings:transcribe'](null, 'bad-id')
      ).rejects.toThrow()
    })

    it('should propagate transcription errors', async () => {
      const { transcribeManually } = await import('../../services/transcription')
      const recId = '550e8400-e29b-41d4-a716-446655440000'
      vi.mocked(transcribeManually).mockRejectedValue(new Error('Transcription failed'))

      await expect(
        handlers['recordings:transcribe'](null, recId)
      ).rejects.toThrow('Transcription failed')
    })
  })

  describe('recordings:getWatcherStatus', () => {
    it('should return watcher status', async () => {
      const { getWatcherStatus } = await import('../../services/recording-watcher')
      vi.mocked(getWatcherStatus).mockReturnValue({ isWatching: true, path: '/recordings' })

      const result = await handlers['recordings:getWatcherStatus'](null)

      expect(result).toEqual({ isWatching: true, path: '/recordings' })
    })
  })

  describe('recordings:startWatcher', () => {
    it('should call startRecordingWatcher', async () => {
      const { startRecordingWatcher } = await import('../../services/recording-watcher')

      await handlers['recordings:startWatcher'](null)

      expect(startRecordingWatcher).toHaveBeenCalled()
    })
  })

  describe('recordings:stopWatcher', () => {
    it('should call stopRecordingWatcher', async () => {
      const { stopRecordingWatcher } = await import('../../services/recording-watcher')

      await handlers['recordings:stopWatcher'](null)

      expect(stopRecordingWatcher).toHaveBeenCalled()
    })
  })

  describe('recordings:getTranscriptionStatus', () => {
    it('should return transcription processing status', async () => {
      const { getTranscriptionStatus } = await import('../../services/transcription')
      const mockStatus = { isProcessing: true, pendingCount: 3, processingCount: 1 }
      vi.mocked(getTranscriptionStatus).mockReturnValue(mockStatus)

      const result = await handlers['recordings:getTranscriptionStatus'](null)

      expect(result).toEqual(mockStatus)
    })
  })

  describe('recordings:startTranscriptionProcessor', () => {
    it('should call startTranscriptionProcessor', async () => {
      const { startTranscriptionProcessor } = await import('../../services/transcription')

      await handlers['recordings:startTranscriptionProcessor'](null)

      expect(startTranscriptionProcessor).toHaveBeenCalled()
    })
  })

  describe('recordings:stopTranscriptionProcessor', () => {
    it('should call stopTranscriptionProcessor', async () => {
      const { stopTranscriptionProcessor } = await import('../../services/transcription')

      await handlers['recordings:stopTranscriptionProcessor'](null)

      expect(stopTranscriptionProcessor).toHaveBeenCalled()
    })
  })

  describe('transcription:cancel', () => {
    it('should cancel transcription and return success', async () => {
      const { cancelTranscription } = await import('../../services/transcription')
      vi.mocked(cancelTranscription).mockReturnValue(undefined)

      const result = await handlers['transcription:cancel'](null, 'rec-1')

      expect(cancelTranscription).toHaveBeenCalledWith('rec-1')
      expect(result).toEqual({ success: true })
    })

    it('should return failure on error', async () => {
      const { cancelTranscription } = await import('../../services/transcription')
      vi.mocked(cancelTranscription).mockImplementation(() => {
        throw new Error('Cancel failed')
      })

      const result = await handlers['transcription:cancel'](null, 'rec-1')

      expect(result).toEqual({ success: false })
    })
  })

  describe('transcription:cancelAll', () => {
    it('should cancel all and return count', async () => {
      const { cancelAllTranscriptions } = await import('../../services/transcription')
      vi.mocked(cancelAllTranscriptions).mockReturnValue(5)

      const result = await handlers['transcription:cancelAll'](null)

      expect(result).toEqual({ success: true, count: 5 })
    })

    it('should return failure with zero count on error', async () => {
      const { cancelAllTranscriptions } = await import('../../services/transcription')
      vi.mocked(cancelAllTranscriptions).mockImplementation(() => {
        throw new Error('Cancel all failed')
      })

      const result = await handlers['transcription:cancelAll'](null)

      expect(result).toEqual({ success: false, count: 0 })
    })
  })

  describe('transcription:getQueue', () => {
    it('should return queue items', async () => {
      const { getQueueItems } = await import('../../services/database')
      const mockQueue = [
        { id: 'q1', recording_id: 'r1', status: 'pending' },
        { id: 'q2', recording_id: 'r2', status: 'processing' }
      ]
      vi.mocked(getQueueItems).mockReturnValue(mockQueue as any)

      const result = await handlers['transcription:getQueue'](null)

      expect(result).toEqual(mockQueue)
    })

    it('should return empty array on error', async () => {
      const { getQueueItems } = await import('../../services/database')
      vi.mocked(getQueueItems).mockImplementation(() => {
        throw new Error('DB error')
      })

      const result = await handlers['transcription:getQueue'](null)

      expect(result).toEqual([])
    })
  })

  describe('transcription:updateQueueItem', () => {
    it('should update queue item and return true', async () => {
      const { updateQueueItem } = await import('../../services/database')

      const result = await handlers['transcription:updateQueueItem'](null, 'q1', 'processing')

      expect(updateQueueItem).toHaveBeenCalledWith('q1', 'processing', undefined)
      expect(result).toBe(true)
    })

    it('should pass error message when provided', async () => {
      const { updateQueueItem } = await import('../../services/database')

      const result = await handlers['transcription:updateQueueItem'](null, 'q1', 'error', 'Something broke')

      expect(updateQueueItem).toHaveBeenCalledWith('q1', 'error', 'Something broke')
      expect(result).toBe(true)
    })

    it('should return false on error', async () => {
      const { updateQueueItem } = await import('../../services/database')
      vi.mocked(updateQueueItem).mockImplementation(() => {
        throw new Error('Update failed')
      })

      const result = await handlers['transcription:updateQueueItem'](null, 'q1', 'processing')

      expect(result).toBe(false)
    })
  })

  describe('recordings:scanFolder', () => {
    it('should return list of recording files', async () => {
      const { getRecordingFiles } = await import('../../services/file-storage')
      vi.mocked(getRecordingFiles).mockReturnValue(['file1.wav', 'file2.mp3'])

      const result = await handlers['recordings:scanFolder'](null)

      expect(result).toEqual(['file1.wav', 'file2.mp3'])
    })
  })

  describe('recordings:getCandidates', () => {
    it('should return meeting candidates for a valid recording ID', async () => {
      const { getCandidatesForRecordingWithDetails } = await import('../../services/database')
      const recId = '550e8400-e29b-41d4-a716-446655440000'
      const mockCandidates = [
        { recording_id: recId, meeting_id: 'm-1', confidence_score: 0.9 }
      ]
      vi.mocked(getCandidatesForRecordingWithDetails).mockReturnValue(mockCandidates as any)

      const result = await handlers['recordings:getCandidates'](null, recId)

      expect(getCandidatesForRecordingWithDetails).toHaveBeenCalledWith(recId)
      expect(result).toEqual(mockCandidates)
    })

    it('should return empty array for invalid recording ID', async () => {
      const result = await handlers['recordings:getCandidates'](null, 'bad-id')

      expect(result).toEqual([])
    })
  })

  describe('recordings:getMeetingsNearDate', () => {
    it('should return meetings near a valid date string', async () => {
      const { getMeetingsNearDate } = await import('../../services/database')
      const mockMeetings = [{ id: 'm-1', subject: 'Standup' }]
      vi.mocked(getMeetingsNearDate).mockReturnValue(mockMeetings as any)

      const result = await handlers['recordings:getMeetingsNearDate'](null, '2025-06-15T10:00:00Z')

      expect(getMeetingsNearDate).toHaveBeenCalledWith('2025-06-15T10:00:00Z')
      expect(result).toEqual(mockMeetings)
    })

    it('should return empty array for non-string date input', async () => {
      const result = await handlers['recordings:getMeetingsNearDate'](null, 12345)

      expect(result).toEqual([])
    })

    it('should return empty array on error', async () => {
      const { getMeetingsNearDate } = await import('../../services/database')
      vi.mocked(getMeetingsNearDate).mockImplementation(() => {
        throw new Error('DB error')
      })

      const result = await handlers['recordings:getMeetingsNearDate'](null, '2025-06-15')

      expect(result).toEqual([])
    })
  })

  describe('recordings:selectMeeting', () => {
    it('should link recording to meeting when meetingId is provided', async () => {
      const { linkRecordingToMeeting } = await import('../../services/database')

      const result = await handlers['recordings:selectMeeting'](null, 'rec-1', 'meet-1')

      expect(linkRecordingToMeeting).toHaveBeenCalledWith('rec-1', 'meet-1', 1.0, 'manual')
      expect(result).toEqual({ success: true })
    })

    it('should unlink recording when meetingId is null', async () => {
      const { linkRecordingToMeeting } = await import('../../services/database')

      const result = await handlers['recordings:selectMeeting'](null, 'rec-1', null)

      expect(linkRecordingToMeeting).toHaveBeenCalledWith('rec-1', '', 0, '')
      expect(result).toEqual({ success: true })
    })

    it('should return error on failure', async () => {
      const { linkRecordingToMeeting } = await import('../../services/database')
      vi.mocked(linkRecordingToMeeting).mockImplementation(() => {
        throw new Error('Link failed')
      })

      const result = await handlers['recordings:selectMeeting'](null, 'rec-1', 'meet-1')

      expect(result).toEqual({ success: false, error: 'Link failed' })
    })
  })

  describe('recordings:addToQueue', () => {
    it('should add recording to queue and update transcription status', async () => {
      const { addToQueue, updateRecordingTranscriptionStatus } = await import('../../services/database')
      vi.mocked(addToQueue).mockReturnValue('queue-item-id')

      const result = await handlers['recordings:addToQueue'](null, 'rec-1')

      expect(addToQueue).toHaveBeenCalledWith('rec-1')
      expect(updateRecordingTranscriptionStatus).toHaveBeenCalledWith('rec-1', 'queued')
      expect(result).toBe('queue-item-id')
    })

    it('should return false on error', async () => {
      const { addToQueue } = await import('../../services/database')
      vi.mocked(addToQueue).mockImplementation(() => {
        throw new Error('Queue full')
      })

      const result = await handlers['recordings:addToQueue'](null, 'rec-1')

      expect(result).toBe(false)
    })

    it('should reject when API key is not configured', async () => {
      const { getConfig } = await import('../../services/config')
      vi.mocked(getConfig).mockReturnValue({
        transcription: {
          provider: 'gemini',
          geminiApiKey: '', // Empty API key
          geminiModel: 'gemini-3-pro-preview',
          autoTranscribe: true,
          language: 'es'
        }
      } as any)

      const result = await handlers['recordings:addToQueue'](null, 'rec-1')

      expect(result).toEqual({
        success: false,
        error: 'Transcription API key not configured. Please add your API key in Settings.'
      })
    })
  })

  describe('recordings:processQueue', () => {
    it('should start the transcription processor and return true', async () => {
      const { startTranscriptionProcessor } = await import('../../services/transcription')

      const result = await handlers['recordings:processQueue'](null)

      expect(startTranscriptionProcessor).toHaveBeenCalled()
      expect(result).toBe(true)
    })

    it('should return false on error', async () => {
      const { startTranscriptionProcessor } = await import('../../services/transcription')
      vi.mocked(startTranscriptionProcessor).mockImplementation(() => {
        throw new Error('Processor error')
      })

      const result = await handlers['recordings:processQueue'](null)

      expect(result).toBe(false)
    })
  })
})
