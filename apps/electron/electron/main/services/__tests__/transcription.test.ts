/**
 * Transcription Service Tests
 *
 * BUG-TX-001: recordings.status stays 'transcribing' forever after transcription failure
 *   OBSERVED: User sees "Transcription in progress..." badge on recordings that failed
 *   ROOT CAUSE: processQueue() catch block updates queue item to 'failed' but did NOT
 *   update recordings.status back from 'transcribing' to 'failed'
 *   FIX: Added updateRecordingStatus(recordingId, 'failed') in the catch block
 *
 * @vitest-environment node
 */

// This test runs in node environment, so we must define mocks BEFORE imports
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Track calls to updateRecordingStatus
const mockUpdateRecordingStatus = vi.fn()
const mockUpdateQueueItem = vi.fn()
const mockGetQueueItems = vi.fn()
const mockGetRecordingById = vi.fn()
const mockInsertTranscript = vi.fn()
const mockExecFile = vi.fn()

// spawnStreaming uses `spawn`, not `execFile`. We create a helper that manufactures
// a fake ChildProcess whose stdout/stderr are minimal EventEmitters so spawnStreaming
// can wire up its data / close listeners correctly.
function makeFakeChildProcess(stdout: string, code: number = 0) {
  const listeners: Record<string, ((...args: any[]) => void)[]> = {}

  function on(event: string, cb: (...args: any[]) => void) {
    if (!listeners[event]) listeners[event] = []
    listeners[event].push(cb)
    return fakeChild
  }

  function emit(event: string, ...args: any[]) {
    (listeners[event] || []).forEach(fn => fn(...args))
  }

  const fakeStdout = {
    on(event: string, cb: (...args: any[]) => void) {
      if (event === 'data') {
        // defer so spawnStreaming can finish wiring listeners
        Promise.resolve().then(() => cb(Buffer.from(stdout)))
      }
      return fakeStdout
    }
  }

  const fakeStderr = {
    setEncoding(_enc: string) { return fakeStderr },
    on(_event: string, _cb: (...args: any[]) => void) { return fakeStderr }
  }

  const fakeChild = { stdout: fakeStdout, stderr: fakeStderr, on }

  // Emit close after data has been delivered
  Promise.resolve().then(() => Promise.resolve()).then(() => emit('close', code))

  return fakeChild
}

let mockConfig = {
  transcription: {
    provider: 'gemini',
    geminiApiKey: 'test-api-key',
    geminiModel: 'gemini-2.0-flash',
    language: 'es',
    localAsrPath: 'G:\\Code\\claude-plugins\\plugins\\mcp-asr',
    localAsrVocabularyFile: 'vocabulary.json',
    localAsrDiarize: true,
    localAsrNumBeams: 5
  }
}

// Mock database
vi.mock('../database', () => ({
  getRecordingById: (...args: any[]) => mockGetRecordingById(...args),
  updateRecordingStatus: (...args: any[]) => mockUpdateRecordingStatus(...args),
  updateRecordingTranscriptionStatus: (...args: any[]) => mockUpdateRecordingStatus(...args),
  insertTranscript: (...args: any[]) => mockInsertTranscript(...args),
  getQueueItems: (...args: any[]) => mockGetQueueItems(...args),
  updateQueueItem: (...args: any[]) => mockUpdateQueueItem(...args),
  updateQueueProgress: vi.fn(),
  getMeetingById: vi.fn(),
  findCandidateMeetingsForRecording: vi.fn(() => []),
  addRecordingMeetingCandidate: vi.fn(),
  linkRecordingToMeeting: vi.fn(),
  updateKnowledgeCaptureTitle: vi.fn(),
  removeFromQueueByRecordingId: vi.fn(),
  cancelPendingTranscriptions: vi.fn(() => 0),
  acquireTranscriptionLock: vi.fn().mockReturnValue(true),
  releaseTranscriptionLock: vi.fn().mockReturnValue(true),
  clearStaleTranscriptionLock: vi.fn(), // Called on startTranscriptionProcessor()
  resetStuckTranscriptions: vi.fn().mockReturnValue({ recordingsReset: 0, queueItemsReset: 0 }), // Called on startTranscriptionProcessor()
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
  getConfig: vi.fn(() => mockConfig)
}))

// Mock google generative AI - make it fail
// Used by analyzeTranscriptWithGemini and detectActionables which still call the SDK directly.
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn(() => ({
    getGenerativeModel: vi.fn(() => ({
      generateContent: vi.fn().mockRejectedValue(new Error('API rate limit exceeded'))
    }))
  }))
}))

// Mock @hidock/transcription so GeminiEngine throws fast (avoids real network calls
// in tests). GeminiEngine moved the transcription provider dispatch from inline
// @google/generative-ai calls into the package; mocking it here keeps the
// orchestration tests fast and deterministic.
vi.mock('@hidock/transcription', () => {
  const mockGeminiTranscribe = async function* () {
    throw new Error('API rate limit exceeded')
  }
  function GeminiEngine(_options: { apiKey: string; model?: string; language?: string }) {
    return {
      isAvailable: async () => true,
      isStreaming: false,
      isLocal: false,
      transcribe: mockGeminiTranscribe
    }
  }
  return { GeminiEngine }
})

// Mock fs - simple approach that works in jsdom environment
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    readFile: vi.fn((_path: string, cb: (err: null, data: Buffer) => void) => {
      cb(null, Buffer.from('fake audio data'))
    })
  }
})

// Mock vector store
vi.mock('../vector-store', () => ({
  getVectorStore: vi.fn(() => null)
}))

vi.mock('child_process', () => ({
  execFile: (...args: any[]) => mockExecFile(...args),
  // spawnStreaming calls spawn() — delegate to mockExecFile so tests can intercept
  spawn: (...args: any[]) => mockExecFile(...args)
}))

describe('Transcription Service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConfig = {
      transcription: {
        provider: 'gemini',
        geminiApiKey: 'test-api-key',
        geminiModel: 'gemini-2.0-flash',
        language: 'es',
        localAsrPath: 'G:\\Code\\claude-plugins\\plugins\\mcp-asr',
        localAsrVocabularyFile: 'vocabulary.json',
        localAsrDiarize: true,
        localAsrNumBeams: 5
      }
    }
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

  describe('local ASR provider', () => {
    it('should process local ASR transcripts without requiring a Gemini API key', async () => {
      mockConfig = {
        transcription: {
          provider: 'local-asr',
          geminiApiKey: '',
          geminiModel: 'gemini-2.0-flash',
          language: 'es',
          localAsrPath: 'G:\\Code\\claude-plugins\\plugins\\mcp-asr',
          localAsrVocabularyFile: 'vocabulary.json',
          localAsrDiarize: true,
          localAsrNumBeams: 5
        }
      }
      mockGetQueueItems.mockImplementation((status?: string) => {
        if (status === 'pending') {
          return [{
            id: 'queue-local',
            recording_id: 'rec-local',
            filename: 'local.wav',
            status: 'pending',
            attempts: 0
          }]
        }
        return []
      })
      mockGetRecordingById.mockReturnValue({
        id: 'rec-local',
        filename: 'local.wav',
        file_path: 'G:\\Recordings\\local.wav',
        status: 'complete'
      })
      mockExecFile.mockImplementation((_cmd: string, _args: string[]) => {
        return makeFakeChildProcess(JSON.stringify({
          text: 'Speaker 1: Hola equipo. Revisamos el plan.',
          language: 'es',
          duration_seconds: 12,
          processing_time_seconds: 1
        }))
      })

      const { startTranscriptionProcessor, stopTranscriptionProcessor } = await import('../transcription')

      startTranscriptionProcessor()
      await new Promise(resolve => setTimeout(resolve, 500))
      stopTranscriptionProcessor()

      expect(mockExecFile).toHaveBeenCalled()
      expect(mockInsertTranscript).toHaveBeenCalledWith(expect.objectContaining({
        recording_id: 'rec-local',
        full_text: 'Speaker 1: Hola equipo. Revisamos el plan.',
        transcription_provider: 'local-asr',
        transcription_model: 'CohereLabs/cohere-transcribe-03-2026'
      }))
      expect(mockUpdateRecordingStatus).toHaveBeenCalledWith('rec-local', 'complete')
    })
  })

  describe('vibevoice provider', () => {
    it('transcribes via the vibevoice backend and stores speaker-labelled segments', async () => {
      mockConfig = {
        transcription: {
          provider: 'vibevoice',
          geminiApiKey: '',
          geminiModel: 'gemini-2.0-flash',
          language: 'auto',
          localAsrPath: 'G:\\Code\\claude-plugins\\plugins\\mcp-asr',
          localAsrVocabularyFile: 'vocabulary.json',
          localAsrDiarize: true,
          localAsrNumBeams: 5
        }
      } as typeof mockConfig
      mockGetQueueItems.mockImplementation((status?: string) => {
        if (status === 'pending') {
          return [{
            id: 'queue-vv',
            recording_id: 'rec-vv',
            filename: 'vv.wav',
            status: 'pending',
            attempts: 0
          }]
        }
        return []
      })
      mockGetRecordingById.mockReturnValue({
        id: 'rec-vv',
        filename: 'vv.wav',
        file_path: 'G:\\Recordings\\vv.wav',
        status: 'complete'
      })
      let capturedArgs: string[] = []
      mockExecFile.mockImplementation((_cmd: string, args: string[]) => {
        capturedArgs = args
        return makeFakeChildProcess(JSON.stringify({
          segments: [
            { speaker: 'Speaker 0', start: 0, end: 2.5, text: 'Hola equipo.' },
            { speaker: 'Speaker 1', start: 2.5, end: 5, text: 'Revisamos el plan.' }
          ],
          language: 'es',
          num_speakers: 2,
          duration_seconds: 5,
          processing_time_seconds: 2
        }))
      })

      const { startTranscriptionProcessor, stopTranscriptionProcessor } = await import('../transcription')

      startTranscriptionProcessor()
      await new Promise(resolve => setTimeout(resolve, 500))
      stopTranscriptionProcessor()

      expect(mockExecFile).toHaveBeenCalled()
      expect(capturedArgs).toContain('--backend')
      expect(capturedArgs).toContain('vibevoice')
      expect(mockInsertTranscript).toHaveBeenCalledWith(expect.objectContaining({
        recording_id: 'rec-vv',
        full_text: 'Speaker 0: Hola equipo.\nSpeaker 1: Revisamos el plan.',
        transcription_provider: 'vibevoice',
        transcription_model: 'microsoft/VibeVoice-ASR'
      }))
      expect(mockUpdateRecordingStatus).toHaveBeenCalledWith('rec-vv', 'complete')
    })

    it('honours a per-queue-item provider override over the global default', async () => {
      // Global default is local-asr, but the queue item requests vibevoice.
      mockConfig = {
        transcription: {
          provider: 'local-asr',
          geminiApiKey: '',
          geminiModel: 'gemini-2.0-flash',
          language: 'auto',
          localAsrPath: 'G:\\Code\\claude-plugins\\plugins\\mcp-asr',
          localAsrVocabularyFile: 'vocabulary.json',
          localAsrDiarize: true,
          localAsrNumBeams: 5
        }
      } as typeof mockConfig
      mockGetQueueItems.mockImplementation((status?: string) => {
        if (status === 'pending') {
          return [{
            id: 'queue-ovr',
            recording_id: 'rec-ovr',
            filename: 'ovr.wav',
            status: 'pending',
            attempts: 0,
            provider: 'vibevoice'
          }]
        }
        return []
      })
      mockGetRecordingById.mockReturnValue({
        id: 'rec-ovr',
        filename: 'ovr.wav',
        file_path: 'G:\\Recordings\\ovr.wav',
        status: 'complete'
      })
      let capturedArgs: string[] = []
      mockExecFile.mockImplementation((_cmd: string, args: string[]) => {
        capturedArgs = args
        return makeFakeChildProcess(JSON.stringify({
          segments: [{ speaker: 'Speaker 0', start: 0, end: 1, text: 'Bonjour' }],
          language: 'fr'
        }))
      })

      const { startTranscriptionProcessor, stopTranscriptionProcessor } = await import('../transcription')
      startTranscriptionProcessor()
      await new Promise(resolve => setTimeout(resolve, 500))
      stopTranscriptionProcessor()

      expect(capturedArgs).toContain('--backend')
      expect(capturedArgs).toContain('vibevoice')
      expect(mockInsertTranscript).toHaveBeenCalledWith(expect.objectContaining({
        recording_id: 'rec-ovr',
        transcription_provider: 'vibevoice'
      }))
    })
  })
})
