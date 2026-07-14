/**
 * Recency-first transcription queue ordering (orderPendingForProcessing).
 *
 * Kept in a dedicated, fully-mocked file so importing the transcription service
 * pulls in nothing heavy — the module's real deps (@hidock/transcription,
 * @google/generative-ai, vector-store, config) are stubbed below.
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { vi } from 'vitest'

vi.mock('../database', () => ({
  addToQueue: vi.fn(),
  getRecordingById: vi.fn(),
  resolveRecordingId: vi.fn(),
  updateRecordingTranscriptionStatus: vi.fn(),
  insertTranscript: vi.fn(),
  getQueueItems: vi.fn(() => []),
  updateQueueItem: vi.fn(),
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
  queryOne: vi.fn(),
  queryAll: vi.fn(() => []),
  acquireTranscriptionLock: vi.fn(() => true),
  releaseTranscriptionLock: vi.fn(),
  clearStaleTranscriptionLock: vi.fn(),
  resetStuckTranscriptions: vi.fn()
}))

vi.mock('electron', () => ({ BrowserWindow: class {} }))
vi.mock('../config', () => ({ getConfig: vi.fn(() => ({ transcription: {} })) }))
vi.mock('@google/generative-ai', () => ({ GoogleGenerativeAI: class {} }))
vi.mock('@hidock/transcription', () => ({ GeminiEngine: class {} }))
vi.mock('../vector-store', () => ({ getVectorStore: vi.fn(() => null) }))

const item = (recording_id: string, date_recorded: string | null, created_at: string) =>
  ({ recording_id, date_recorded, created_at })

describe('orderPendingForProcessing — recency-first queue ordering', () => {
  beforeEach(async () => {
    // Priority ids are module-level; reset the ones used by these tests.
    const { clearUserPriority } = await import('../transcription')
    for (const id of ['a', 'b', 'explicit-old']) clearUserPriority(id)
  })

  it('dequeues the newest recording (date_recorded) first regardless of enqueue order', async () => {
    const { orderPendingForProcessing } = await import('../transcription')
    // created_at (enqueue order) is oldest-recording-first; recency must win.
    const ordered = orderPendingForProcessing([
      item('old', '2026-05-01T10:00:00Z', '2026-07-01T00:00:03Z'),
      item('newest', '2026-07-06T09:00:00Z', '2026-07-01T00:00:01Z'),
      item('mid', '2026-06-15T12:00:00Z', '2026-07-01T00:00:02Z')
    ]).map((i) => i.recording_id)
    expect(ordered).toEqual(['newest', 'mid', 'old'])
  })

  it('puts a user-explicit request ahead of a newer backlog item', async () => {
    const { orderPendingForProcessing, markUserPriority } = await import('../transcription')
    markUserPriority('explicit-old')
    const ordered = orderPendingForProcessing([
      item('backlog-new', '2026-07-06T09:00:00Z', '2026-07-01T00:00:02Z'),
      item('explicit-old', '2026-04-01T09:00:00Z', '2026-07-01T00:00:01Z')
    ]).map((i) => i.recording_id)
    expect(ordered).toEqual(['explicit-old', 'backlog-new'])
  })

  it('orders multiple user-explicit requests FIFO by queue created_at', async () => {
    const { orderPendingForProcessing, markUserPriority } = await import('../transcription')
    markUserPriority('a')
    markUserPriority('b')
    // 'b' has a newer recording date but 'a' was enqueued first → FIFO wins among
    // user-explicit items, and both precede the non-priority backlog.
    const ordered = orderPendingForProcessing([
      item('backlog', '2026-07-06T09:00:00Z', '2026-07-01T00:00:00Z'),
      item('b', '2026-07-05T09:00:00Z', '2026-07-01T00:00:02Z'),
      item('a', '2026-01-01T09:00:00Z', '2026-07-01T00:00:01Z')
    ]).map((i) => i.recording_id)
    expect(ordered).toEqual(['a', 'b', 'backlog'])
  })

  it('tiebreaks equal recording dates by queue created_at (FIFO) and sorts undated last', async () => {
    const { orderPendingForProcessing } = await import('../transcription')
    const ordered = orderPendingForProcessing([
      item('undated', null, '2026-07-01T00:00:00Z'),
      item('same-late', '2026-06-01T09:00:00Z', '2026-07-01T00:00:05Z'),
      item('same-early', '2026-06-01T09:00:00Z', '2026-07-01T00:00:01Z')
    ]).map((i) => i.recording_id)
    expect(ordered).toEqual(['same-early', 'same-late', 'undated'])
  })

  it('does not mutate the input array', async () => {
    const { orderPendingForProcessing } = await import('../transcription')
    const items = [
      item('a', '2026-01-01T00:00:00Z', '2026-07-01T00:00:01Z'),
      item('b', '2026-07-01T00:00:00Z', '2026-07-01T00:00:02Z')
    ]
    const snapshot = items.map((i) => i.recording_id)
    orderPendingForProcessing(items)
    expect(items.map((i) => i.recording_id)).toEqual(snapshot)
  })
})
