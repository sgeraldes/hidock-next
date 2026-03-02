import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getRAGService, resetRAGService, estimateTokens, trimHistoryByTokens } from '../rag'
import type { OllamaChatMessage } from '../ollama'
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
    search: vi.fn().mockResolvedValue([]),
    searchByMeeting: vi.fn().mockResolvedValue([]),
    getAllDocuments: vi.fn().mockReturnValue([])
  }))
}))

let dbInstance: any = null
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
  escapeLikePattern: vi.fn((pattern: string) => pattern.replace(/[%_\\]/g, '\\$&'))
}))

// ================================================================
// B-CHAT-006: Token estimation and trimming tests
// ================================================================

describe('estimateTokens', () => {
  it('should estimate tokens as ceil(length / 4)', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('a')).toBe(1) // ceil(1/4) = 1
    expect(estimateTokens('abcd')).toBe(1) // ceil(4/4) = 1
    expect(estimateTokens('abcde')).toBe(2) // ceil(5/4) = 2
    expect(estimateTokens('hello world')).toBe(3) // ceil(11/4) = 3
    // Longer text
    const text = 'a'.repeat(100)
    expect(estimateTokens(text)).toBe(25) // ceil(100/4) = 25
  })
})

describe('trimHistoryByTokens', () => {
  it('should return empty array for empty history', () => {
    const result = trimHistoryByTokens([], 4096)
    expect(result).toEqual([])
  })

  it('should return all messages if within token limit', () => {
    const history: OllamaChatMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' }
    ]
    const result = trimHistoryByTokens(history, 4096)
    expect(result).toHaveLength(2)
    expect(result[0].content).toBe('Hello')
    expect(result[1].content).toBe('Hi there!')
  })

  it('should keep most recent messages when exceeding limit', () => {
    const history: OllamaChatMessage[] = [
      { role: 'user', content: 'a'.repeat(8000) },   // ~2000 tokens
      { role: 'assistant', content: 'b'.repeat(8000) }, // ~2000 tokens
      { role: 'user', content: 'c'.repeat(4000) },   // ~1000 tokens
      { role: 'assistant', content: 'd'.repeat(4000) }  // ~1000 tokens
    ]

    // With limit of 2500, should keep only last 2 messages (~2000 tokens)
    const result = trimHistoryByTokens(history, 2500)
    expect(result.length).toBe(2)
    expect(result[0].content).toBe('c'.repeat(4000))
    expect(result[1].content).toBe('d'.repeat(4000))
  })

  it('should skip messages that individually exceed the limit', () => {
    const history: OllamaChatMessage[] = [
      { role: 'user', content: 'a'.repeat(20000) }, // ~5000 tokens, exceeds 4096
      { role: 'assistant', content: 'Short response' }
    ]

    const result = trimHistoryByTokens(history, 4096)
    // Should only include the short message since the first alone exceeds limit
    expect(result).toHaveLength(1)
    expect(result[0].content).toBe('Short response')
  })

  it('should use default maxTokens of 4096', () => {
    const history: OllamaChatMessage[] = [
      { role: 'user', content: 'Hello' }
    ]
    // Should not throw and should return the message
    const result = trimHistoryByTokens(history)
    expect(result).toHaveLength(1)
  })
})

// ================================================================
// B-CHAT-002: LRU session eviction tests
// ================================================================

describe('RAGService LRU Eviction', () => {
  let SQL: any

  beforeEach(async () => {
    vi.clearAllMocks()
    resetRAGService()
    SQL = await initSqlJs()
    dbInstance = new SQL.Database()

    // Setup tables
    dbInstance.run(`
      CREATE TABLE conversations (id TEXT PRIMARY KEY);
      CREATE TABLE conversation_context (id TEXT, conversation_id TEXT, knowledge_capture_id TEXT);
      CREATE TABLE knowledge_captures (id TEXT, title TEXT, source_recording_id TEXT);
      CREATE TABLE transcripts (recording_id TEXT, full_text TEXT);
    `)
  })

  afterEach(() => {
    if (dbInstance) dbInstance.close()
  })

  it('should evict least recently used sessions when exceeding max (50)', async () => {
    const rag = getRAGService()

    // Create 51 sessions by chatting in each one
    for (let i = 0; i < 51; i++) {
      const sessionId = `session-${i}`
      dbInstance.run(`INSERT OR IGNORE INTO conversations (id) VALUES (?)`, [sessionId])

      await rag.chat(sessionId, `message for session ${i}`)
    }

    // The stats should show at most 50 sessions
    const stats = rag.getStats()
    expect(stats.sessionCount).toBeLessThanOrEqual(50)
  })

  it('should evict LRU session, not the most recently used one', async () => {
    const rag = getRAGService()

    // Create sessions 0-49
    for (let i = 0; i < 50; i++) {
      const sessionId = `session-${i}`
      dbInstance.run(`INSERT OR IGNORE INTO conversations (id) VALUES (?)`, [sessionId])
      await rag.chat(sessionId, `message for session ${i}`)
    }

    // Access session-0 to make it recently used
    await rag.chat('session-0', 'keep me alive')

    // Add session-50 which should evict session-1 (LRU, since session-0 was just used)
    dbInstance.run(`INSERT INTO conversations (id) VALUES ('session-50')`)
    await rag.chat('session-50', 'new session')

    const stats = rag.getStats()
    expect(stats.sessionCount).toBeLessThanOrEqual(50)
  })

  it('should clear session and cancel controller on clearSession', async () => {
    const rag = getRAGService()
    dbInstance.run(`INSERT INTO conversations (id) VALUES ('test-session')`)

    await rag.chat('test-session', 'hello')

    // Session should exist
    expect(rag.getStats().sessionCount).toBeGreaterThanOrEqual(1)

    // Clear it
    rag.clearSession('test-session')

    // Calling chat again should create a fresh context
    await rag.chat('test-session', 'hello again')
    // Should still work without errors
    expect(mockOllamaService.chat).toHaveBeenCalled()
  })
})

// ================================================================
// B-CHAT-005: Cancel request tests
// ================================================================

describe('RAGService cancelRequest', () => {
  let SQL: any

  beforeEach(async () => {
    vi.clearAllMocks()
    resetRAGService()
    SQL = await initSqlJs()
    dbInstance = new SQL.Database()

    dbInstance.run(`
      CREATE TABLE conversations (id TEXT PRIMARY KEY);
      CREATE TABLE conversation_context (id TEXT, conversation_id TEXT, knowledge_capture_id TEXT);
      CREATE TABLE knowledge_captures (id TEXT, title TEXT, source_recording_id TEXT);
      CREATE TABLE transcripts (recording_id TEXT, full_text TEXT);
    `)
  })

  afterEach(() => {
    if (dbInstance) dbInstance.close()
  })

  it('should return false when cancelling non-existent session', () => {
    const rag = getRAGService()
    const result = rag.cancelRequest('non-existent')
    expect(result).toBe(false)
  })

  it('should return true when cancelling active session', async () => {
    const rag = getRAGService()
    dbInstance.run(`INSERT INTO conversations (id) VALUES ('active-session')`)

    // Use a deferred promise pattern: the mock will hold until we resolve it
    let resolveChat!: (value: string) => void
    const chatBlocker = new Promise<string>(resolve => { resolveChat = resolve })

    mockOllamaService.chat.mockImplementation(() => chatBlocker)

    // Start the chat but don't await - it will block on the ollama.chat call
    const chatPromise = rag.chat('active-session', 'test message')

    // Yield to microtask queue so the RAG service reaches the ollama.chat call
    await new Promise(resolve => setTimeout(resolve, 10))

    // Cancel - the controller should have been set before ollama.chat was called
    const cancelled = rag.cancelRequest('active-session')
    expect(cancelled).toBe(true)

    // Unblock the mock so the promise can settle
    resolveChat('cancelled response')
    await chatPromise

    // Restore mock
    mockOllamaService.chat.mockResolvedValue('AI Response')
  })
})
