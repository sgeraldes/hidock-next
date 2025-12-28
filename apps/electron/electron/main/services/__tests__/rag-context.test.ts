
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getRAGService, resetRAGService } from '../rag'
import * as db from '../database'
import * as ollama from '../ollama'
import * as vectorStore from '../vector-store'
import initSqlJs from 'sql.js'

// Stable mock object
const mockOllamaService = {
  isAvailable: vi.fn().mockResolvedValue(true),
  ensureModels: vi.fn().mockResolvedValue({ embedding: true, chat: true }),
  chat: vi.fn().mockResolvedValue('AI Response'),
  generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2])
}

// Mock dependencies (except database)
vi.mock('../ollama', () => ({
  getOllamaService: vi.fn(() => mockOllamaService)
}))

vi.mock('../vector-store', () => ({
  getVectorStore: vi.fn(() => ({
    initialize: vi.fn().mockResolvedValue(true),
    getDocumentCount: vi.fn().mockReturnValue(10),
    getMeetingCount: vi.fn().mockReturnValue(5),
    search: vi.fn().mockResolvedValue([])
  }))
}))

let dbInstance: any = null
vi.mock('../database', () => ({
  getDatabase: () => dbInstance
}))

describe('RAGService Context Injection', () => {
  let SQL: any

  beforeEach(async () => {
    vi.clearAllMocks()
    resetRAGService()
    SQL = await initSqlJs()
    dbInstance = new SQL.Database()
    
    // Setup tables
    dbInstance.run(`
      CREATE TABLE conversation_context (id TEXT, conversation_id TEXT, knowledge_capture_id TEXT);
      CREATE TABLE knowledge_captures (id TEXT, title TEXT, source_recording_id TEXT);
      CREATE TABLE transcripts (recording_id TEXT, full_text TEXT);
      
      INSERT INTO knowledge_captures (id, title, source_recording_id) VALUES ('kc-1', 'Test Title', 'rec-1');
      INSERT INTO transcripts (recording_id, full_text) VALUES ('rec-1', 'Full transcript text from knowledge capture');
      INSERT INTO conversation_context (id, conversation_id, knowledge_capture_id) VALUES ('ctx-1', 'session-1', 'kc-1');
    `)
  })

  afterEach(() => {
    if (dbInstance) dbInstance.close()
  })

  it('should include conversation context in the prompt', async () => {
    const rag = getRAGService()
    
    await rag.chat('session-1', 'What is in the context?')

    expect(mockOllamaService.chat).toHaveBeenCalled()
    
    const lastCall = vi.mocked(mockOllamaService.chat).mock.calls[0]
    const messages = lastCall[0]
    const userMessage = messages[messages.length - 1].content
    expect(userMessage).toContain('Full transcript text from knowledge capture')
    expect(userMessage).toContain('PINNED CONTEXT: Test Title')
  })
})
