import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerKnowledgeHandlers } from '../knowledge-handlers'
import { ipcMain } from 'electron'
import { queryAll, queryOne, run } from '../../services/database'

// Mock electron ipcMain
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn()
  }
}))

// Mock database. ROUND-15 RESIDUAL: the handlers now route captures through the
// shared eligibility boundary (recording-eligibility.ts → these DB helpers), so
// they must be mocked too. Default: every recording is eligible/existing so the
// gate is a no-op and these SQL/mapping unit assertions stay focused on the
// query shape. Behavioral exclusion is covered by knowledge-handlers.eligibility.test.ts.
vi.mock('../../services/database', () => ({
  queryAll: vi.fn(),
  queryOne: vi.fn(),
  run: vi.fn(),
  runInTransaction: vi.fn((fn) => fn()),
  getEligibleRecordingIds: vi.fn((ids: Iterable<string>) => ({ eligible: new Set([...ids]), failClosed: false })),
  getExistingRecordingIds: vi.fn((ids: Iterable<string>) => ({ ids: new Set([...ids]), failClosed: false })),
  getExistingCaptureIds: vi.fn((ids: Iterable<string>) => ({ ids: new Set([...ids]), failClosed: false })),
  // ADV15 (round-16): the gated tier routes through filterEligibleCaptureIds →
  // getCaptureEligibilityRows. Return each id as an eligible standalone capture so
  // the gate is a no-op for these query-shape assertions.
  getCaptureEligibilityRows: vi.fn((ids: Iterable<string>) => ({
    rows: [...ids].map((id) => ({ id, source_recording_id: null, quality_rating: 'valuable', deleted_at: null })),
    failClosed: false
  }))
}))

describe('Knowledge IPC Handlers', () => {
  let handlers: Record<string, (...args: any[]) => any> = {}

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = {}
    // @ts-expect-error mock method not present on typed import
    ipcMain.handle.mockImplementation((channel, handler) => {
      handlers[channel] = handler
    })
    registerKnowledgeHandlers()
  })

  it('should register all knowledge handlers', () => {
    expect(ipcMain.handle).toHaveBeenCalledWith('knowledge:getAll', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('knowledge:getById', expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith('knowledge:update', expect.any(Function))
  })

  describe('knowledge:getAll', () => {
    it('should fetch and map knowledge captures', async () => {
      const mockRows = [
        {
          id: '1',
          title: 'Test Capture',
          quality_rating: 'valuable',
          captured_at: '2025-01-01T10:00:00Z',
          source_recording_id: 'rec-1'
        }
      ]
      // @ts-expect-error mock method not present on typed import
      queryAll.mockReturnValue(mockRows)

      const result = await handlers['knowledge:getAll']({}, { limit: 10, offset: 0 })

      // B-CHAT-007: Should use explicit columns, not SELECT *.
      // ROUND-15 RESIDUAL: getAll now over-fetches in batches (fill-until-limit),
      // so the batch size is max(limit, 50) — here 50 — with the caller's offset.
      expect(queryAll).toHaveBeenCalledWith(
        expect.stringContaining('FROM knowledge_captures'),
        [50, 0]
      )
      // Verify it does NOT use SELECT *
      const calledSql = vi.mocked(queryAll).mock.calls[0][0]
      expect(calledSql).not.toContain('SELECT *')
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual(expect.objectContaining({
        id: '1',
        title: 'Test Capture',
        quality: 'valuable',
        capturedAt: '2025-01-01T10:00:00Z',
        sourceRecordingId: 'rec-1'
      }))
    })

    it('should return empty array on database error', async () => {
      // @ts-expect-error mock method not present on typed import
      queryAll.mockImplementation(() => { throw new Error('DB Error') })
      const result = await handlers['knowledge:getAll']({})
      expect(result).toEqual([])
    })

    // F16/spec-001: surface quality_reasons/quality_source to the renderer.
    it('parses quality_reasons JSON and surfaces quality_source', async () => {
      const mockRows = [
        {
          id: '1',
          title: 'Cooking chatter',
          quality_rating: 'garbage',
          quality_reasons: JSON.stringify(['personal_family', 'background_ambient']),
          quality_source: 'ai',
          captured_at: '2025-01-01T10:00:00Z',
          // ROUND-15 RESIDUAL: a GARBAGE standalone capture would be gated out;
          // give it an (eligible-by-mock) source recording so this test stays
          // about quality_reasons parsing, not the value gate.
          source_recording_id: 'rec-ok'
        }
      ]
      // @ts-ignore - mockReturnValue's arg is untyped in this test's minimal row fixtures
      queryAll.mockReturnValue(mockRows)

      const result = await handlers['knowledge:getAll']({})

      expect(result[0]).toEqual(expect.objectContaining({
        qualityReasons: ['personal_family', 'background_ambient'],
        qualitySource: 'ai'
      }))
    })

    it('degrades gracefully on malformed quality_reasons JSON (does not throw)', async () => {
      const mockRows = [
        { id: '1', title: 'Corrupt row', quality_rating: 'unrated', quality_reasons: 'not-valid-json{{', quality_source: null, captured_at: '2025-01-01T10:00:00Z' }
      ]
      // @ts-ignore - mockReturnValue's arg is untyped in this test's minimal row fixtures
      queryAll.mockReturnValue(mockRows)

      const result = await handlers['knowledge:getAll']({})

      expect(result).toHaveLength(1)
      expect(result[0].qualityReasons).toBeNull()
    })

    it('maps a NULL quality_reasons to null (not an empty array)', async () => {
      const mockRows = [
        { id: '1', title: 'No reasons', quality_rating: 'unrated', quality_reasons: null, quality_source: null, captured_at: '2025-01-01T10:00:00Z' }
      ]
      // @ts-ignore - mockReturnValue's arg is untyped in this test's minimal row fixtures
      queryAll.mockReturnValue(mockRows)

      const result = await handlers['knowledge:getAll']({})
      expect(result[0].qualityReasons).toBeNull()
    })
  })

  describe('knowledge:getById', () => {
    it('should return mapped capture if found', async () => {
      const mockRow = { id: '1', title: 'Single' }
      // @ts-expect-error mock method not present on typed import
      queryOne.mockReturnValue(mockRow)

      const result = await handlers['knowledge:getById']({}, '1')

      expect(queryOne).toHaveBeenCalledWith(expect.any(String), ['1'])
      expect(result.title).toBe('Single')
    })

    it('should return null if not found', async () => {
      // @ts-expect-error mock method not present on typed import
      queryOne.mockReturnValue(null)
      const result = await handlers['knowledge:getById']({}, '99')
      expect(result).toBeNull()
    })
  })

  describe('knowledge:update', () => {
    it('should construct correct update query for non-quality fields', async () => {
      const result = await handlers['knowledge:update']({}, '1', { title: 'New Title' })

      expect(run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE knowledge_captures SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'),
        ['New Title', '1']
      )
      expect(result).toEqual({ success: true })
    })

    it('should return error on failure', async () => {
      // mockImplementationOnce (not mockImplementation): clearAllMocks() in
      // beforeEach only resets call history, not a persistent implementation,
      // so a lasting throw here would leak into every later test in this file.
      // @ts-ignore
      run.mockImplementationOnce(() => { throw new Error('Update failed') })
      const result = await handlers['knowledge:update']({}, '1', { title: 'X' })
      expect(result.success).toBe(false)
      expect(result.error).toBe('Update failed')
    })

    // F16/spec-001 + CX-T1-2: a manual quality edit must stamp
    // quality_source='user' + quality_assessed_at (so the AI value
    // classifier's never-downgrade guard never overwrites it on a later
    // re-analysis) AND clear stale AI metadata — quality_reasons justified
    // the OLD AI rating, not the user's new one — while recording full
    // confidence (mirrors spec-003's recordings:setValueRating semantics).
    it('stamps quality_source=user + assessed_at and clears AI reasons/confidence when quality is updated', async () => {
      const result = await handlers['knowledge:update']({}, '1', { title: 'New Title', quality: 'archived' })

      expect(run).toHaveBeenCalledWith(
        expect.stringContaining(
          'UPDATE knowledge_captures SET title = ?, quality_rating = ?, quality_source = ?, quality_assessed_at = CURRENT_TIMESTAMP, quality_reasons = NULL, quality_confidence = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
        ),
        ['New Title', 'archived', 'user', 1.0, '1']
      )
      expect(result).toEqual({ success: true })
    })

    it('clears AI metadata even when quality is the ONLY field updated', async () => {
      await handlers['knowledge:update']({}, '2', { quality: 'garbage' })

      expect(run).toHaveBeenCalledWith(
        expect.stringContaining(
          'quality_rating = ?, quality_source = ?, quality_assessed_at = CURRENT_TIMESTAMP, quality_reasons = NULL, quality_confidence = ?'
        ),
        ['garbage', 'user', 1.0, '2']
      )
    })

    it('does NOT touch quality_source/reasons/confidence when quality is not part of the update', async () => {
      await handlers['knowledge:update']({}, '3', { summary: 'New summary' })

      const [sql] = vi.mocked(run).mock.calls[0]
      expect(sql).not.toContain('quality_source')
      expect(sql).not.toContain('quality_rating')
      expect(sql).not.toContain('quality_reasons')
      expect(sql).not.toContain('quality_confidence')
    })
  })
})