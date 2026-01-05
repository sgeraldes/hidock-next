
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerRAGHandlers } from '../rag-handlers'
import { ipcMain } from 'electron'

// Mock dependencies
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: vi.fn(() => 'test-path') }
}))

vi.mock('../services/rag', () => ({
  getRAGService: vi.fn(() => ({
    globalSearch: vi.fn().mockResolvedValue({ success: true, data: { knowledge: [], people: [], projects: [] } })
  }))
}))

vi.mock('../services/vector-store', () => ({
  getVectorStore: vi.fn(() => ({
    getDocumentCount: vi.fn(),
    getMeetingCount: vi.fn()
  }))
}))

vi.mock('../services/ollama', () => ({
  getOllamaService: vi.fn(() => ({
    isAvailable: vi.fn()
  }))
}))

describe('RAG Global Search Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should register rag:globalSearch handler', () => {
    registerRAGHandlers()
    expect(ipcMain.handle).toHaveBeenCalledWith('rag:globalSearch', expect.any(Function))
  })
})
