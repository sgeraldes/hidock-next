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

      expect(queryAll).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM knowledge_captures'),
        [10, 0]
      )
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
    it('should construct correct update query', async () => {
      const result = await handlers['knowledge:update']({}, '1', { title: 'New Title', quality: 'archived' })

      expect(run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE knowledge_captures SET title = ?, quality_rating = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'),
        ['New Title', 'archived', '1']
      )
      expect(result).toEqual({ success: true })
    })

    it('should return error on failure', async () => {
      // @ts-ignore
      run.mockImplementation(() => { throw new Error('Update failed') })
      const result = await handlers['knowledge:update']({}, '1', { title: 'X' })
      expect(result.success).toBe(false)
      expect(result.error).toBe('Update failed')
    })
  })
})