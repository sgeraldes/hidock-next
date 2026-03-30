import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'

// ── Mock Electron ──────────────────────────────────────────────────────────
vi.mock('electron', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    ipcMain: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      }),
      on: vi.fn(),
      _handlers: handlers,
    },
    BrowserWindow: { getAllWindows: vi.fn(() => []) },
  }
})

// ── Mock database-queries ─────────────────────────────────────────────────
const MOCK_SOURCES = [
  {
    id: 1,
    path: '/docs/meeting-notes.txt',
    status: 'indexed',
    chunk_count: 5,
    added_at: 1000,
    indexed_at: 2000,
  },
  {
    id: 2,
    path: '/docs/project-plan.md',
    status: 'pending',
    chunk_count: 0,
    added_at: 3000,
    indexed_at: null,
  },
]

const mockGetAllKbSources = vi.fn(() => MOCK_SOURCES)
const mockAddKbSource = vi.fn((path: string) => ({
  id: 3,
  path,
  status: 'pending',
  chunk_count: 0,
  added_at: Date.now(),
  indexed_at: null,
}))
const mockRemoveKbSource = vi.fn()

vi.mock('../../services/database-queries', () => ({
  getAllKbSources: () => mockGetAllKbSources(),
  addKbSource: (path: unknown) => mockAddKbSource(path as string),
  removeKbSource: (path: unknown) => mockRemoveKbSource(path),
}))

// ── Mock database (saveDatabase) ──────────────────────────────────────────
const mockSaveDatabase = vi.fn()

vi.mock('../../services/database', () => ({
  getDatabase: vi.fn(() => ({
    run: vi.fn(),
    exec: vi.fn(() => []),
  })),
  saveDatabase: () => mockSaveDatabase(),
  mapRows: vi.fn(() => []),
}))

// ── Import under test ─────────────────────────────────────────────────────
import { registerKnowledgeHandlers, setKnowledgeBaseService } from '../knowledge-handlers'
import { CHANNELS } from '../channels'

// ── Fake knowledge base service ───────────────────────────────────────────
const mockAddSource = vi.fn()
const mockRemoveSource = vi.fn()
const mockSearch = vi.fn(async (_query: string, _topK?: number) => [] as unknown[])
const mockReindex = vi.fn()

const fakeKBService = {
  addSource: async (path: string) => mockAddSource(path),
  removeSource: async (sourcePath: string) => mockRemoveSource(sourcePath),
  search: async (query: string, topK?: number) => mockSearch(query, topK),
  reindex: async () => mockReindex(),
}

describe('Knowledge Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    const handlers = (ipcMain as unknown as { _handlers: Map<string, Function> })._handlers
    handlers.clear()
    setKnowledgeBaseService(fakeKBService)
    registerKnowledgeHandlers()
  })

  // ── Registration ────────────────────────────────────────────────────────

  it('registers all knowledge handlers including listSources', () => {
    expect(ipcMain.handle).toHaveBeenCalledWith(CHANNELS.knowledge.addSource, expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith(CHANNELS.knowledge.removeSource, expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith(CHANNELS.knowledge.search, expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith(CHANNELS.knowledge.reindex, expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith(CHANNELS.knowledge.listSources, expect.any(Function))
  })

  // ── kb:listSources ───────────────────────────────────────────────────────

  describe('kb:listSources', () => {
    it('returns sources from DB via getAllKbSources', async () => {
      const handlers = (ipcMain as unknown as { _handlers: Map<string, Function> })._handlers
      const handler = handlers.get(CHANNELS.knowledge.listSources)
      expect(handler).toBeDefined()

      const result = await handler?.({}, undefined)

      expect(mockGetAllKbSources).toHaveBeenCalled()
      expect(result).toHaveLength(2)
      expect(result[0].path).toBe('/docs/meeting-notes.txt')
      expect(result[0].status).toBe('indexed')
      expect(result[1].path).toBe('/docs/project-plan.md')
    })

    it('returns empty array when no sources exist', async () => {
      mockGetAllKbSources.mockReturnValueOnce([])
      const handlers = (ipcMain as unknown as { _handlers: Map<string, Function> })._handlers
      const handler = handlers.get(CHANNELS.knowledge.listSources)

      const result = await handler?.({}, undefined)

      expect(result).toEqual([])
    })
  })

  // ── kb:addSource ─────────────────────────────────────────────────────────

  describe('kb:addSource', () => {
    it('calls service.addSource with the path', async () => {
      const handlers = (ipcMain as unknown as { _handlers: Map<string, Function> })._handlers
      const handler = handlers.get(CHANNELS.knowledge.addSource)

      await handler?.({}, { path: '/new/file.txt' })

      expect(mockAddSource).toHaveBeenCalledWith('/new/file.txt')
    })

    it('calls addKbSource to persist source in DB', async () => {
      const handlers = (ipcMain as unknown as { _handlers: Map<string, Function> })._handlers
      const handler = handlers.get(CHANNELS.knowledge.addSource)

      await handler?.({}, { path: '/new/file.txt' })

      expect(mockAddKbSource).toHaveBeenCalledWith('/new/file.txt')
    })

    it('calls saveDatabase after persisting source', async () => {
      const handlers = (ipcMain as unknown as { _handlers: Map<string, Function> })._handlers
      const handler = handlers.get(CHANNELS.knowledge.addSource)

      await handler?.({}, { path: '/new/file.txt' })

      expect(mockSaveDatabase).toHaveBeenCalled()
    })

    it('returns null on success', async () => {
      const handlers = (ipcMain as unknown as { _handlers: Map<string, Function> })._handlers
      const handler = handlers.get(CHANNELS.knowledge.addSource)

      const result = await handler?.({}, { path: '/new/file.txt' })

      expect(result).toBeNull()
    })

    it('returns null when no service is set', async () => {
      setKnowledgeBaseService(null as unknown as Parameters<typeof setKnowledgeBaseService>[0])
      const handlers = (ipcMain as unknown as { _handlers: Map<string, Function> })._handlers
      handlers.clear()
      registerKnowledgeHandlers()
      const handler = handlers.get(CHANNELS.knowledge.addSource)

      const result = await handler?.({}, { path: '/file.txt' })

      expect(result).toBeNull()
      expect(mockAddKbSource).not.toHaveBeenCalled()
    })
  })

  // ── kb:removeSource ──────────────────────────────────────────────────────

  describe('kb:removeSource', () => {
    it('calls service.removeSource with the sourcePath', async () => {
      const handlers = (ipcMain as unknown as { _handlers: Map<string, Function> })._handlers
      const handler = handlers.get(CHANNELS.knowledge.removeSource)

      await handler?.({}, { sourcePath: '/docs/old-file.txt' })

      expect(mockRemoveSource).toHaveBeenCalledWith('/docs/old-file.txt')
    })

    it('calls removeKbSource to remove from DB', async () => {
      const handlers = (ipcMain as unknown as { _handlers: Map<string, Function> })._handlers
      const handler = handlers.get(CHANNELS.knowledge.removeSource)

      await handler?.({}, { sourcePath: '/docs/old-file.txt' })

      expect(mockRemoveKbSource).toHaveBeenCalledWith('/docs/old-file.txt')
    })

    it('calls saveDatabase after removing source', async () => {
      const handlers = (ipcMain as unknown as { _handlers: Map<string, Function> })._handlers
      const handler = handlers.get(CHANNELS.knowledge.removeSource)

      await handler?.({}, { sourcePath: '/docs/old-file.txt' })

      expect(mockSaveDatabase).toHaveBeenCalled()
    })
  })

  // ── Channel name consistency ──────────────────────────────────────────────

  it('listSources channel name matches CHANNELS constant', () => {
    expect(CHANNELS.knowledge.listSources).toBe('kb:listSources')
  })
})
