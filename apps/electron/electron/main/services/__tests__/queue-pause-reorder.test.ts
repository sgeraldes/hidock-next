/**
 * Queue-level pause/resume + explicit processing-order reorder (main process).
 *
 * These cover the backend that makes the Operations dock's Pause and
 * prioritize/deprioritize controls real:
 *   - pauseQueue stops DEQUEUING new items; resumeQueue continues.
 *   - reorderQueueItem changes the ACTUAL pick order (via orderPendingForProcessing).
 *   - getQueueState reflects paused + processing id + counts.
 *
 * Fully mocked so importing the transcription service pulls in nothing heavy.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockGetQueueItems = vi.fn((_status?: string): any[] => [])
const mockUpdateQueueItem = vi.fn((_id?: string, _status?: string, _err?: string) => {})
const mockGetRecordingById = vi.fn((_id?: string): any => undefined)

vi.mock('../database', () => ({
  addToQueue: vi.fn(),
  getRecordingById: (id?: string) => mockGetRecordingById(id),
  resolveRecordingId: vi.fn(),
  updateRecordingTranscriptionStatus: vi.fn(),
  updateRecordingStatus: vi.fn(),
  insertTranscript: vi.fn(),
  getQueueItems: (status?: string) => mockGetQueueItems(status),
  updateQueueItem: (id?: string, status?: string, err?: string) => mockUpdateQueueItem(id, status, err),
  updateQueueProgress: vi.fn(),
  getMeetingById: vi.fn(),
  findCandidateMeetingsForRecording: vi.fn(() => []),
  addRecordingMeetingCandidate: vi.fn(),
  linkRecordingToMeeting: vi.fn(),
  updateKnowledgeCaptureTitle: vi.fn(),
  removeFromQueueByRecordingId: vi.fn(),
  cancelPendingTranscriptions: vi.fn(() => 0),
  run: vi.fn(),
  runInTransaction: vi.fn((fn: () => void) => fn()),
  saveDatabase: vi.fn(),
  queryOne: vi.fn(),
  queryAll: vi.fn(() => []),
  acquireTranscriptionLock: vi.fn(() => true),
  releaseTranscriptionLock: vi.fn(),
  clearStaleTranscriptionLock: vi.fn(),
  resetStuckTranscriptions: vi.fn()
}))

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../activity-log', () => ({ emitActivityLog: vi.fn() }))
vi.mock('../config', () => ({ getConfig: vi.fn(() => ({ transcription: { provider: 'gemini', geminiApiKey: 'k' } })) }))
vi.mock('@google/generative-ai', () => ({ GoogleGenerativeAI: class {} }))
vi.mock('@hidock/transcription', () => ({ GeminiEngine: class {} }))
vi.mock('../vector-store', () => ({ getVectorStore: vi.fn(() => null) }))
vi.mock('../knowledge-capture-backfill', () => ({ ensureKnowledgeCaptureForRecording: vi.fn() }))

const qItem = (recording_id: string, date_recorded: string | null, created_at: string) =>
  ({ id: `q_${recording_id}`, recording_id, date_recorded, created_at, status: 'pending' })

describe('transcription queue — pause/resume + reorder (main process)', () => {
  beforeEach(() => {
    mockGetQueueItems.mockReset()
    mockGetQueueItems.mockReturnValue([])
    mockUpdateQueueItem.mockReset()
    mockGetRecordingById.mockReset()
  })

  afterEach(async () => {
    // Reset module state so `paused` doesn't leak across tests. Empty the queue
    // first so resumeQueue's processor kick is a guaranteed no-op.
    mockGetQueueItems.mockReturnValue([])
    const { resumeQueue } = await import('../transcription')
    resumeQueue()
  })

  it('getQueueState reflects paused flag and pending/processing counts', async () => {
    const { getQueueState, pauseQueue, resumeQueue } = await import('../transcription')
    mockGetQueueItems.mockImplementation((status?: string) =>
      status === 'pending' ? [qItem('a', null, '1'), qItem('b', null, '2')] : []
    )

    expect(getQueueState().paused).toBe(false)
    expect(getQueueState().pendingCount).toBe(2)
    expect(getQueueState().processingCount).toBe(0)

    const paused = pauseQueue()
    expect(paused.paused).toBe(true)
    expect(getQueueState().paused).toBe(true)

    const resumed = resumeQueue()
    expect(resumed.paused).toBe(false)
    expect(getQueueState().paused).toBe(false)
  })

  it('reorderQueueItem("up") makes an item win the pick order over recency', async () => {
    const { reorderQueueItem, orderPendingForProcessing } = await import('../transcription')
    // 'backlog-new' has the newest date, so recency would pick it first.
    const pending = [
      qItem('backlog-new', '2026-07-06T09:00:00Z', '2026-07-01T00:00:02Z'),
      qItem('old', '2026-04-01T09:00:00Z', '2026-07-01T00:00:01Z')
    ]
    mockGetQueueItems.mockReturnValue(pending)

    // User prioritizes 'old' → it must now be dequeued first.
    reorderQueueItem('old', 'up')
    const ordered = orderPendingForProcessing(pending).map((i) => i.recording_id)
    expect(ordered).toEqual(['old', 'backlog-new'])
  })

  it('reorderQueueItem("down") pushes an item to the back of the pick order', async () => {
    const { reorderQueueItem, orderPendingForProcessing } = await import('../transcription')
    const pending = [
      qItem('newest', '2026-07-06T09:00:00Z', '2026-07-01T00:00:02Z'),
      qItem('older', '2026-06-01T09:00:00Z', '2026-07-01T00:00:01Z')
    ]
    mockGetQueueItems.mockReturnValue(pending)

    // Deprioritize the newest → older (by recency) now leads.
    reorderQueueItem('newest', 'down')
    const ordered = orderPendingForProcessing(pending).map((i) => i.recording_id)
    expect(ordered).toEqual(['older', 'newest'])
  })

  it('paused queue does NOT dequeue new items; resume processes them', async () => {
    const { pauseQueue, resumeQueue, processQueueManually } = await import('../transcription')
    const pending = [qItem('rec-1', null, '2026-07-01T00:00:01Z')]
    // While paused, only 'pending' is queried by getQueueState; processQueue returns early.
    mockGetQueueItems.mockImplementation((status?: string) => (status === 'pending' ? [...pending] : []))
    mockGetRecordingById.mockReturnValue(undefined) // makes transcribeRecording throw fast if reached

    pauseQueue()
    await processQueueManually()
    // Nothing dequeued: no item was moved to 'processing'.
    expect(mockUpdateQueueItem).not.toHaveBeenCalledWith('q_rec-1', 'processing')

    // Resume kicks the processor: the item is now picked (moved to 'processing')
    // before its transcription fails against the (deliberately) missing recording.
    resumeQueue()
    await new Promise((r) => setTimeout(r, 50)) // let the async processor settle
    const movedToProcessing = mockUpdateQueueItem.mock.calls.some(
      (c) => c[0] === 'q_rec-1' && c[1] === 'processing'
    )
    expect(movedToProcessing).toBe(true)
  })
})
