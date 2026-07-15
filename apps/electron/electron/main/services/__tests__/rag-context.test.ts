
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getRAGService, resetRAGService } from '../rag'
import initSqlJs from 'sql.js'

// Stable mock object
const mockOllamaService = {
  isAvailable: vi.fn().mockResolvedValue(true),
  ensureModels: vi.fn().mockResolvedValue({ embedding: true, chat: true }),
  chat: vi.fn().mockResolvedValue('AI Response'),
  generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2])
}

// Chat now routes through chat-llm (Gemini-first, Ollama fallback), not ollama.chat directly.
const mockChatLLMService = {
  getStatus: vi.fn().mockResolvedValue({ backend: 'ollama', geminiConfigured: false, ollamaAvailable: true }),
  generate: vi.fn().mockResolvedValue('AI Response'),
  generateText: vi.fn().mockResolvedValue('AI Response')
}

// Mock dependencies (except database)
vi.mock('../ollama', () => ({
  getOllamaService: vi.fn(() => mockOllamaService)
}))

vi.mock('../chat-llm', () => ({
  getChatLLMService: vi.fn(() => mockChatLLMService)
}))

vi.mock('../embeddings', () => ({
  getEmbeddingsService: vi.fn(() => ({
    generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2]),
    generateEmbeddings: vi.fn().mockResolvedValue([[0.1, 0.2]])
  }))
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
// ADV5 — mutable so a test can flip a pinned recording to excluded / force a throw.
let excludedRecordingIds: Set<string> = new Set<string>()
let throwExclusionLookup = false
vi.mock('../database', () => ({
  getDatabase: () => dbInstance,
  queryOne: vi.fn((sql: string, params: any[]) => {
    if (!dbInstance) return undefined
    const result = dbInstance.exec(sql, params)
    if (result.length === 0 || result[0].values.length === 0) return undefined
    const columns = result[0].columns
    const values = result[0].values[0]
    const row: any = {}
    columns.forEach((col: string, i: number) => { row[col] = values[i] })
    return row
  }),
  escapeLikePattern: vi.fn((pattern: string) => pattern.replace(/[%_\\]/g, '\\$&')),
  // ADV5 (round-5) — the pinned-context path revalidates each pinned recording
  // against this shared exclusion source; empty ⇒ rec-1 is eligible.
  getExcludedRecordingIds: () => {
    if (throwExclusionLookup) throw new Error('exclusion lookup failed (simulated)')
    return excludedRecordingIds
  }
}))

describe('RAGService Context Injection', () => {
  let SQL: any

  beforeEach(async () => {
    vi.clearAllMocks()
    resetRAGService()
    excludedRecordingIds = new Set<string>()
    throwExclusionLookup = false
    SQL = await initSqlJs()
    dbInstance = new SQL.Database()
    
    // Setup tables
    dbInstance.run(`
      CREATE TABLE conversations (id TEXT PRIMARY KEY);
      CREATE TABLE conversation_context (id TEXT, conversation_id TEXT, knowledge_capture_id TEXT);
      CREATE TABLE knowledge_captures (id TEXT, title TEXT, source_recording_id TEXT);
      CREATE TABLE transcripts (recording_id TEXT, full_text TEXT);

      INSERT INTO conversations (id) VALUES ('session-1');
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

    expect(mockChatLLMService.generate).toHaveBeenCalled()

    const lastCall = vi.mocked(mockChatLLMService.generate).mock.calls[0]
    const messages = lastCall[0]
    const userMessage = messages[messages.length - 1].content
    expect(userMessage).toContain('Full transcript text from knowledge capture')
    expect(userMessage).toContain('PINNED CONTEXT: Test Title')
  })

  async function pinnedUserMessage(): Promise<string> {
    const rag = getRAGService()
    await rag.chat('session-1', 'What is in the context?')
    const messages = vi.mocked(mockChatLLMService.generate).mock.calls[0][0]
    return messages[messages.length - 1].content
  }

  it('ADV5 — drops a pinned recording that became excluded (soft-deleted / personal / value-excluded)', async () => {
    // rec-1 was pinned while eligible, then excluded before this message.
    excludedRecordingIds = new Set(['rec-1'])
    const userMessage = await pinnedUserMessage()
    expect(userMessage).not.toContain('Full transcript text from knowledge capture')
    expect(userMessage).not.toContain('PINNED CONTEXT: Test Title')
  })

  it('ADV5 — fails closed (no pinned recording-backed context) when the exclusion lookup throws', async () => {
    throwExclusionLookup = true
    const userMessage = await pinnedUserMessage()
    expect(userMessage).not.toContain('Full transcript text from knowledge capture')
    expect(userMessage).not.toContain('PINNED CONTEXT: Test Title')
  })
})
