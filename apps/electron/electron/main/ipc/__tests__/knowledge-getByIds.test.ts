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

describe('knowledge:getByIds handler (B-CHAT-004)', () => {
  let handlers: Record<string, Function> = {}

  beforeEach(() => {
    vi.clearAllMocks()
    handlers = {}
    // @ts-ignore
    ipcMain.handle.mockImplementation((channel: string, handler: Function) => {
      handlers[channel] = handler
    })
    registerKnowledgeHandlers()
  })

  it('should register the knowledge:getByIds handler', () => {
    expect(ipcMain.handle).toHaveBeenCalledWith('knowledge:getByIds', expect.any(Function))
  })

  it('should return empty array for empty IDs list', async () => {
    const result = await handlers['knowledge:getByIds']({}, [])
    expect(result).toEqual([])
  })

  it('should return empty array for non-array input', async () => {
    const result = await handlers['knowledge:getByIds']({}, null)
    expect(result).toEqual([])
  })

  it('should fetch and map multiple knowledge captures', async () => {
    const mockRows = [
      {
        id: 'kc-1',
        title: 'First Capture',
        summary: 'Summary 1',
        quality_rating: 'valuable',
        captured_at: '2025-01-01T10:00:00Z',
        source_recording_id: 'rec-1',
        category: 'meeting',
        status: 'ready'
      },
      {
        id: 'kc-2',
        title: 'Second Capture',
        summary: 'Summary 2',
        quality_rating: 'unrated',
        captured_at: '2025-01-02T10:00:00Z',
        source_recording_id: 'rec-2',
        category: 'note',
        status: 'enriched'
      }
    ]
    // @ts-ignore
    queryAll.mockReturnValue(mockRows)

    const result = await handlers['knowledge:getByIds']({}, ['kc-1', 'kc-2'])

    // Verify the query uses parameterized WHERE IN
    expect(queryAll).toHaveBeenCalledWith(
      expect.stringContaining('WHERE id IN (?,?)'),
      ['kc-1', 'kc-2']
    )

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual(expect.objectContaining({
      id: 'kc-1',
      title: 'First Capture',
      quality: 'valuable'
    }))
    expect(result[1]).toEqual(expect.objectContaining({
      id: 'kc-2',
      title: 'Second Capture',
      quality: 'unrated'
    }))
  })

  it('should build correct number of placeholders for IDs', async () => {
    // @ts-ignore
    queryAll.mockReturnValue([])

    await handlers['knowledge:getByIds']({}, ['a', 'b', 'c'])

    expect(queryAll).toHaveBeenCalledWith(
      expect.stringContaining('WHERE id IN (?,?,?)'),
      ['a', 'b', 'c']
    )
  })

  it('should handle single ID', async () => {
    // @ts-ignore
    queryAll.mockReturnValue([{
      id: 'single',
      title: 'Single Item',
      quality_rating: 'valuable',
      captured_at: '2025-01-01T10:00:00Z'
    }])

    const result = await handlers['knowledge:getByIds']({}, ['single'])

    expect(queryAll).toHaveBeenCalledWith(
      expect.stringContaining('WHERE id IN (?)'),
      ['single']
    )
    expect(result).toHaveLength(1)
  })

  it('should return empty array on database error', async () => {
    // @ts-ignore
    queryAll.mockImplementation(() => { throw new Error('DB Error') })

    const result = await handlers['knowledge:getByIds']({}, ['kc-1'])
    expect(result).toEqual([])
  })

  it('should not use SELECT * in the query', async () => {
    // @ts-ignore
    queryAll.mockReturnValue([])

    await handlers['knowledge:getByIds']({}, ['kc-1'])

    const queryString = vi.mocked(queryAll).mock.calls[0][0]
    expect(queryString).not.toContain('SELECT *')
    // Should use explicit column list
    expect(queryString).toContain('id, title, summary')
  })
})
