/**
 * Transcription Service Tests
 *
 * BUG-TX-001: recordings.status stays 'transcribing' forever after transcription failure
 *   OBSERVED: User sees "Transcription in progress..." badge on recordings that failed
 *   ROOT CAUSE: processQueue() catch block updates queue item to 'failed' but did NOT
 *   update recordings.status back from 'transcribing' to 'failed'
 *   FIX: Added updateRecordingStatus(recordingId, 'failed') in the catch block
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Track calls to updateRecordingStatus
const mockUpdateRecordingStatus = vi.fn()
const mockUpdateQueueItem = vi.fn()
const mockGetQueueItems = vi.fn()
const mockGetRecordingById = vi.fn()

// Mock database
vi.mock('../database', () => ({
  getRecordingById: (...args: any[]) => mockGetRecordingById(...args),
  updateRecordingStatus: (...args: any[]) => mockUpdateRecordingStatus(...args),
  updateRecordingTranscriptionStatus: (...args: any[]) => mockUpdateRecordingStatus(...args),
  insertTranscript: vi.fn(),
  getQueueItems: (...args: any[]) => mockGetQueueItems(...args),
  updateQueueItem: (...args: any[]) => mockUpdateQueueItem(...args),
  getMeetingById: vi.fn(),
  findCandidateMeetingsForRecording: vi.fn(() => []),
  addRecordingMeetingCandidate: vi.fn(),
  linkRecordingToMeeting: vi.fn(),
  updateKnowledgeCaptureTitle: vi.fn(),
  removeFromQueueByRecordingId: vi.fn(),
  cancelPendingTranscriptions: vi.fn(() => 0),
  run: vi.fn(),
  queryOne: vi.fn()
}))

// Mock electron
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [])
  },
  ipcMain: { handle: vi.fn() }
}))

// Mock config
vi.mock('../config', () => ({
  getConfig: vi.fn(() => ({
    transcription: {
      geminiApiKey: 'test-api-key',
      geminiModel: 'gemini-2.0-flash'
    }
  }))
}))

// Mock google generative AI - make it fail
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn(() => ({
    getGenerativeModel: vi.fn(() => ({
      generateContent: vi.fn().mockRejectedValue(new Error('API rate limit exceeded'))
    }))
  }))
}))

// Mock fs with working existsSync and readFile (callback-based, used by promisify)
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    default: { ...actual, existsSync: vi.fn(() => true), readFileSync: vi.fn(() => Buffer.from('fake audio')), readFile: vi.fn((_path: string, cb: (err: null, data: Buffer) => void) => cb(null, Buffer.from('fake audio data'))) },
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => Buffer.from('fake audio data')),
    readFile: vi.fn((_path: string, cb: (err: null, data: Buffer) => void) => cb(null, Buffer.from('fake audio data')))
  }
})

// Mock vector store
vi.mock('../vector-store', () => ({
  getVectorStore: vi.fn(() => null)
}))

describe('Transcription Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('BUG-TX-001: recordings.status stuck at transcribing after failure', () => {
    it('should update recordings.status to failed when transcription fails', async () => {
      const mockQueueItem = {
        id: 'queue-1',
        recording_id: 'rec-123',
        filename: 'test.wav',
        status: 'pending',
        attempts: 0
      }
      mockGetQueueItems.mockReturnValue([mockQueueItem])
      mockGetRecordingById.mockReturnValue({
        id: 'rec-123',
        filename: 'test.wav',
        file_path: '/recordings/test.wav',
        status: 'complete'
      })

      const { startTranscriptionProcessor, stopTranscriptionProcessor } = await import('../transcription')

      startTranscriptionProcessor()
      await new Promise(resolve => setTimeout(resolve, 500))
      stopTranscriptionProcessor()

      // The key assertion: when transcription fails, the recording status
      // must be updated to indicate failure so the UI stops showing "In Progress"
      const statusCalls = mockUpdateRecordingStatus.mock.calls

      // After the fix, we expect:
      // 1. updateRecordingTranscriptionStatus(rec-123, 'processing') - before attempt
      // 2. updateRecordingTranscriptionStatus(rec-123, 'error') - after failure
      // Even if the exact flow varies due to mocking, the FAILURE status call must exist
      const hasFailureCall = statusCalls.some(
        (call: any[]) => call[0] === 'rec-123' && call[1] === 'error'
      )

      // Also verify the queue item was marked as failed
      const queueUpdateCalls = mockUpdateQueueItem.mock.calls
      const hasQueueFailure = queueUpdateCalls.some(
        (call: any[]) => call[0] === 'queue-1' && call[1] === 'failed'
      )

      expect(hasQueueFailure).toBe(true)
      expect(hasFailureCall).toBe(true)
    })
  })
})
