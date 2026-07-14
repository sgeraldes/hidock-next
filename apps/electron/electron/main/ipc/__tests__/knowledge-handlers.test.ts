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

// Mock database
vi.mock('../../services/database', () => ({
  queryAll: vi.fn(),
  queryOne: vi.fn(),
  run: vi.fn(),
  runInTransaction: vi.fn((fn) => fn())
}))

describe('Knowledge IPC Handlers', () => {
  let handlers: Record<string, Function> = {}

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = {}
    // @ts-ignore
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
      // @ts-ignore
      queryAll.mockReturnValue(mockRows)

      const result = await handlers['knowledge:getAll']({}, { limit: 10, offset: 0 })

      // B-CHAT-007: Should use explicit columns, not SELECT *
      expect(queryAll).toHaveBeenCalledWith(
        expect.stringContaining('FROM knowledge_captures'),
        [10, 0]
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
      // @ts-ignore
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
          captured_at: '2025-01-01T10:00:00Z'
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
      // @ts-ignore
      queryOne.mockReturnValue(mockRow)

      const result = await handlers['knowledge:getById']({}, '1')

      expect(queryOne).toHaveBeenCalledWith(expect.any(String), ['1'])
      expect(result.title).toBe('Single')
    })

    it('should return null if not found', async () => {
      // @ts-ignore
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

    // F16/spec-001: a manual quality edit must stamp quality_source='user' +
    // quality_assessed_at, so the AI value classifier's never-downgrade guard
    // never overwrites it on a later re-analysis.
    it('stamps quality_source=user and quality_assessed_at when quality is updated', async () => {
      const result = await handlers['knowledge:update']({}, '1', { title: 'New Title', quality: 'archived' })

      expect(run).toHaveBeenCalledWith(
        expect.stringContaining(
          'UPDATE knowledge_captures SET title = ?, quality_rating = ?, quality_source = ?, quality_assessed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
        ),
        ['New Title', 'archived', 'user', '1']
      )
      expect(result).toEqual({ success: true })
    })

    it('stamps quality_source=user even when quality is the ONLY field updated', async () => {
      await handlers['knowledge:update']({}, '2', { quality: 'garbage' })

      expect(run).toHaveBeenCalledWith(
        expect.stringContaining('quality_rating = ?, quality_source = ?, quality_assessed_at = CURRENT_TIMESTAMP'),
        ['garbage', 'user', '2']
      )
    })

    it('does NOT touch quality_source when quality is not part of the update', async () => {
      await handlers['knowledge:update']({}, '3', { summary: 'New summary' })

      const [sql] = vi.mocked(run).mock.calls[0]
      expect(sql).not.toContain('quality_source')
      expect(sql).not.toContain('quality_rating')
    })
  })
})