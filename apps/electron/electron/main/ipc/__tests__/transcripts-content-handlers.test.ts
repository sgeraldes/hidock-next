import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'
import { registerTranscriptsHandlers } from '../transcripts-handlers'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const db = vi.hoisted(() => ({
  getRecordingById: vi.fn(),
  resolveRecordingId: vi.fn(),
  queryOne: vi.fn(),
  runInTransaction: vi.fn((fn: () => unknown) => fn()),
  runNoSave: vi.fn(),
  run: vi.fn(),
  assignSpeaker: vi.fn(),
  getSpeakerMap: vi.fn(),
  unassignSpeaker: vi.fn(),
  getActiveProcessingRunsForRecording: vi.fn()
}))

const vectorStore = vi.hoisted(() => ({
  ensureSchema: vi.fn(),
  dropByRecordingFromMemory: vi.fn(),
  deleteByRecording: vi.fn(),
  indexTranscript: vi.fn()
}))

const isRecordingEligible = vi.hoisted(() => vi.fn())
const exportMeetingWiki = vi.hoisted(() => vi.fn())

vi.mock('../../services/database', () => db)
vi.mock('../../services/vector-store', () => ({ getVectorStore: () => vectorStore }))
vi.mock('../../services/recording-eligibility', () => ({ isRecordingEligible }))
vi.mock('../../services/meeting-wiki', () => ({ exportMeetingWiki }))

function handlerFor(channel: string) {
  return vi.mocked(ipcMain.handle).mock.calls.find((call) => call[0] === channel)?.[1]
}

const request = {
  recordingId: 'rec-1',
  expectedFullText: 'Voice ABC: wrong words',
  segments: [{ speaker: 'Voice ABC', start: 23, end: 35, text: 'Aló Aló, Sorry recién te leo' }]
}

describe('transcript content editing IPC', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isRecordingEligible.mockReturnValue(true)
    db.getRecordingById.mockReturnValue({
      id: 'rec-1',
      meeting_id: null,
      date_recorded: '2026-08-27T18:00:00.000Z',
      created_at: '2026-08-27T18:00:00.000Z'
    })
    db.queryOne.mockReturnValue({ full_text: request.expectedFullText })
    vectorStore.indexTranscript.mockResolvedValue(3)
    vectorStore.deleteByRecording.mockResolvedValue(3)
  })

  it('registers the edit and retry channels', () => {
    registerTranscriptsHandlers()
    expect(ipcMain.handle).toHaveBeenCalledWith('transcripts:updateContent', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('transcripts:reindex', expect.any(Function))
  })

  it('atomically saves both transcript forms, invalidates stale vectors, and reindexes', async () => {
    registerTranscriptsHandlers()
    const result = await handlerFor('transcripts:updateContent')?.({} as never, request) as any

    expect(result).toMatchObject({ success: true, data: { ragStatus: 'indexed', indexedChunks: 3 } })
    expect(db.runNoSave).toHaveBeenNthCalledWith(
      1,
      'UPDATE transcripts SET full_text = ?, speakers = ?, word_count = ? WHERE recording_id = ?',
      [
        'Voice ABC: Aló Aló, Sorry recién te leo',
        JSON.stringify(request.segments),
        8,
        'rec-1'
      ]
    )
    expect(db.runNoSave).toHaveBeenNthCalledWith(
      2,
      'DELETE FROM vector_embeddings WHERE recording_id = ?',
      ['rec-1']
    )
    expect(vectorStore.dropByRecordingFromMemory).toHaveBeenCalledWith('rec-1')
    expect(vectorStore.indexTranscript).toHaveBeenCalledWith(
      'Voice ABC: Aló Aló, Sorry recién te leo',
      expect.objectContaining({ recordingId: 'rec-1' })
    )
  })

  it('saves the correction but reports RAG pending when embeddings fail', async () => {
    vectorStore.indexTranscript.mockRejectedValueOnce(new Error('Embedding provider unavailable'))
    registerTranscriptsHandlers()
    const result = await handlerFor('transcripts:updateContent')?.({} as never, request) as any

    expect(result).toMatchObject({
      success: true,
      data: { ragStatus: 'pending', indexedChunks: 0, ragError: 'Embedding provider unavailable' }
    })
    expect(db.runNoSave).toHaveBeenCalledWith(
      'DELETE FROM vector_embeddings WHERE recording_id = ?',
      ['rec-1']
    )
  })

  it('refuses to overwrite a concurrently replaced transcript', async () => {
    db.queryOne.mockReturnValueOnce({ full_text: 'A newer transcription won the race' })
    registerTranscriptsHandlers()
    const result = await handlerFor('transcripts:updateContent')?.({} as never, request) as any

    expect(result).toMatchObject({ success: false, error: { code: 'RETRYABLE_ERROR' } })
    expect(db.runNoSave).not.toHaveBeenCalled()
    expect(vectorStore.indexTranscript).not.toHaveBeenCalled()
  })
})
