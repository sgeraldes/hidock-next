import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock @hidock/transcription ────────────────────────────────────────────────
const mockCollect = vi.fn()
const mockPipeline = { collect: mockCollect }

vi.mock('@hidock/transcription', () => ({
  TranscriptionPipeline: vi.fn(() => mockPipeline),
}))

// ── Mock database-queries ─────────────────────────────────────────────────────
const mockInsertTranscriptSegment = vi.fn()
vi.mock('../database-queries', () => ({
  insertTranscriptSegment: (...args: unknown[]) => mockInsertTranscriptSegment(...args),
}))

// ── Mock database ─────────────────────────────────────────────────────────────
const mockSaveDatabase = vi.fn()
vi.mock('../database', () => ({
  saveDatabase: () => mockSaveDatabase(),
  getDatabase: vi.fn(() => ({ run: vi.fn(), exec: vi.fn(() => []) })),
  initializeDatabase: vi.fn(),
}))

// ── Mock broadcast ────────────────────────────────────────────────────────────
const mockBroadcast = vi.fn()
vi.mock('../../ipc/broadcast', () => ({
  broadcastToAllWindows: (...args: unknown[]) => mockBroadcast(...args),
}))

// ── Import under test ─────────────────────────────────────────────────────────
import { AudioTranscriptionBridge } from '../audio-transcription-bridge'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSegment(overrides: Partial<{
  speaker: string
  text: string
  startTime: number
  endTime: number
  confidence: number
  source: 'mic' | 'system'
}> = {}) {
  return {
    speaker: 'Speaker A',
    text: 'Hello world',
    startTime: 0,
    endTime: 1,
    confidence: 0.95,
    source: 'mic' as const,
    ...overrides,
  }
}

function makeDbSegment(id = 1) {
  return {
    id,
    session_id: 'session-1',
    speaker: 'Speaker A',
    text: 'Hello world',
    start_time: 1_000_000,
    end_time: 1_001_000,
    confidence: 0.95,
    source: 'mic',
  }
}

const SESSION_ID = 'session-1'
const SESSION_START = 1_000_000 // ms

describe('AudioTranscriptionBridge', () => {
  let bridge: AudioTranscriptionBridge

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    bridge = new AudioTranscriptionBridge(mockPipeline as never, 15_000)
  })

  afterEach(() => {
    bridge.dispose()
    vi.useRealTimers()
  })

  // ── Test 1: start() sets session state correctly ──────────────────────────

  it('start() sets session state correctly', () => {
    bridge.start(SESSION_ID, SESSION_START)

    // No error thrown, bridge is now active
    // Verify it accepts chunks (would throw if not active)
    expect(() => bridge.receiveChunk(Buffer.from('a'), Date.now())).not.toThrow()
  })

  // ── Test 2: receiveChunk() accumulates buffers ────────────────────────────

  it('receiveChunk() accumulates multiple buffers', async () => {
    mockCollect.mockResolvedValue([makeSegment()])
    mockInsertTranscriptSegment.mockReturnValue(makeDbSegment())

    bridge.start(SESSION_ID, SESSION_START)
    bridge.receiveChunk(Buffer.from('chunk1'), SESSION_START + 1000)
    bridge.receiveChunk(Buffer.from('chunk2'), SESSION_START + 2000)
    bridge.receiveChunk(Buffer.from('chunk3'), SESSION_START + 3000)

    await bridge.flush()

    // Pipeline should have received the concatenated audio
    const calledAudio = mockCollect.mock.calls[0][0] as Buffer
    expect(calledAudio).toBeInstanceOf(Buffer)
    expect(calledAudio.toString()).toBe('chunk1chunk2chunk3')
  })

  // ── Test 3: flush() calls pipeline with correct time offset ──────────────

  it('flush() passes correct timeOffset to pipeline', async () => {
    mockCollect.mockResolvedValue([])

    bridge.start(SESSION_ID, SESSION_START)
    const chunkTs = SESSION_START + 5000
    bridge.receiveChunk(Buffer.from('audio'), chunkTs)

    await bridge.flush()

    expect(mockCollect).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({
        source: 'mic',
        timeOffset: 5, // (chunkTs - SESSION_START) / 1000 = 5
      }),
    )
  })

  // ── Test 4: flush() maps pipeline segments to DB format and inserts them ──

  it('flush() maps segments to DB format and inserts them', async () => {
    const seg = makeSegment({ startTime: 2, endTime: 3 })
    mockCollect.mockResolvedValue([seg])
    mockInsertTranscriptSegment.mockReturnValue(makeDbSegment())

    bridge.start(SESSION_ID, SESSION_START)
    bridge.receiveChunk(Buffer.from('audio'), SESSION_START + 1000)

    await bridge.flush()

    expect(mockInsertTranscriptSegment).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: SESSION_ID,
        text: seg.text,
        speaker: seg.speaker,
        start_time: SESSION_START + seg.startTime * 1000,
        end_time: SESSION_START + seg.endTime * 1000,
        confidence: seg.confidence,
        source: seg.source,
      }),
    )
  })

  // ── Test 5: flush() broadcasts transcript:newSegments ─────────────────────

  it('flush() broadcasts transcript:newSegments with DB segments', async () => {
    const dbSeg = makeDbSegment()
    mockCollect.mockResolvedValue([makeSegment()])
    mockInsertTranscriptSegment.mockReturnValue(dbSeg)

    bridge.start(SESSION_ID, SESSION_START)
    bridge.receiveChunk(Buffer.from('audio'), SESSION_START + 1000)

    await bridge.flush()

    expect(mockBroadcast).toHaveBeenCalledWith('transcript:newSegments', [dbSeg])
  })

  // ── Test 6: flush() with empty buffer is a no-op ──────────────────────────

  it('flush() with empty buffer does not call pipeline', async () => {
    bridge.start(SESSION_ID, SESSION_START)

    await bridge.flush()

    expect(mockCollect).not.toHaveBeenCalled()
    expect(mockInsertTranscriptSegment).not.toHaveBeenCalled()
    expect(mockBroadcast).not.toHaveBeenCalled()
  })

  // ── Test 7: flush() during active transcription is skipped (mutex) ─────────

  it('flush() during active transcription is skipped', async () => {
    let resolveFirst!: () => void
    const firstCall = new Promise<void>((resolve) => { resolveFirst = resolve })

    mockCollect
      .mockImplementationOnce(async () => { await firstCall; return [] })
      .mockResolvedValue([])

    bridge.start(SESSION_ID, SESSION_START)
    bridge.receiveChunk(Buffer.from('a'), SESSION_START + 100)

    const p1 = bridge.flush()

    // Second flush should skip because isTranscribing is true
    bridge.receiveChunk(Buffer.from('b'), SESSION_START + 200)
    await bridge.flush()

    resolveFirst()
    await p1

    // Pipeline should only have been called once (second flush was skipped)
    expect(mockCollect).toHaveBeenCalledTimes(1)
  })

  // ── Test 8: stop() flushes remaining chunks and resets state ──────────────

  it('stop() performs a final flush before resetting state', async () => {
    const dbSeg = makeDbSegment()
    mockCollect.mockResolvedValue([makeSegment()])
    mockInsertTranscriptSegment.mockReturnValue(dbSeg)

    bridge.start(SESSION_ID, SESSION_START)
    bridge.receiveChunk(Buffer.from('final-audio'), SESSION_START + 1000)

    await bridge.stop()

    expect(mockCollect).toHaveBeenCalledTimes(1)
    expect(mockBroadcast).toHaveBeenCalledWith('transcript:newSegments', [dbSeg])
  })

  // ── Test 9: stop() on inactive bridge is a no-op ──────────────────────────

  it('stop() on inactive bridge does not throw and does nothing', async () => {
    await expect(bridge.stop()).resolves.toBeUndefined()
    expect(mockCollect).not.toHaveBeenCalled()
  })

  // ── Test 10: dispose() clears timer and resets state ──────────────────────

  it('dispose() clears timer without flushing', async () => {
    bridge.start(SESSION_ID, SESSION_START)
    bridge.receiveChunk(Buffer.from('pending'), SESSION_START + 100)

    bridge.dispose()

    // Timer cleared: advancing time should NOT trigger periodic flush
    vi.advanceTimersByTime(30_000)
    await Promise.resolve()

    expect(mockCollect).not.toHaveBeenCalled()
  })

  // ── Test 11: Pipeline error broadcasts transcript:error ───────────────────

  it('pipeline error broadcasts transcript:error and does not crash bridge', async () => {
    mockCollect.mockRejectedValue(new Error('API rate limit exceeded'))

    bridge.start(SESSION_ID, SESSION_START)
    bridge.receiveChunk(Buffer.from('audio'), SESSION_START + 1000)

    // Should not throw
    await expect(bridge.flush()).resolves.toBeUndefined()

    expect(mockBroadcast).toHaveBeenCalledWith('transcript:error', {
      message: 'API rate limit exceeded',
    })
    // Bridge stays functional — can still receive chunks
    expect(() => bridge.receiveChunk(Buffer.from('more'), SESSION_START + 2000)).not.toThrow()
  })

  // ── Test 12: Time offset calculation ──────────────────────────────────────

  it('calculates time offset correctly as (firstChunkTs - sessionStartTime) / 1000', async () => {
    mockCollect.mockResolvedValue([])

    const sessionStart = 1_700_000_000_000
    const firstChunkTs = sessionStart + 30_000 // 30 seconds after session start

    bridge.start(SESSION_ID, sessionStart)
    bridge.receiveChunk(Buffer.from('audio'), firstChunkTs)

    await bridge.flush()

    expect(mockCollect).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({ timeOffset: 30 }),
    )
  })

  // ── Test 13: Multiple receiveChunk calls accumulate before flush ───────────

  it('accumulates chunks across multiple calls before flushing', async () => {
    mockCollect.mockResolvedValue([])

    bridge.start(SESSION_ID, SESSION_START)

    for (let i = 0; i < 5; i++) {
      bridge.receiveChunk(Buffer.from(`chunk${i}`), SESSION_START + i * 1000)
    }

    await bridge.flush()

    const calledAudio = mockCollect.mock.calls[0][0] as Buffer
    expect(calledAudio.toString()).toBe('chunk0chunk1chunk2chunk3chunk4')
    // Buffer should be empty now
    await bridge.flush()
    expect(mockCollect).toHaveBeenCalledTimes(1) // second flush was a no-op
  })

  // ── Test 14: start() when already active throws ───────────────────────────

  it('start() when already active throws an error', () => {
    bridge.start(SESSION_ID, SESSION_START)

    expect(() => bridge.start('other-session', SESSION_START + 5000)).toThrow(
      /already active/,
    )
  })
})
