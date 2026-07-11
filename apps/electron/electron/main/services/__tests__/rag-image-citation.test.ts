// @vitest-environment node
/**
 * F5 — PixelRAG retrieval + citation: when rag.chat retrieves an image-capture
 * chunk it must (a) label the excerpt as a Screenshot in the LLM context and
 * (b) return a source carrying sourceType='image' + the capture id so the
 * renderer can cite/link the source image. Meeting transcript chunks are
 * unaffected. Mirrors the rag-context harness (real sql.js, mocked LLM/vectors).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getRAGService, resetRAGService } from '../rag'
import initSqlJs from 'sql.js'

const mockOllamaService = {
  isAvailable: vi.fn().mockResolvedValue(true),
  ensureModels: vi.fn().mockResolvedValue({ embedding: true, chat: true }),
  chat: vi.fn().mockResolvedValue('AI Response'),
  generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2])
}

const mockChatLLMService = {
  getStatus: vi.fn().mockResolvedValue({ backend: 'ollama', geminiConfigured: false, ollamaAvailable: true }),
  generate: vi.fn().mockResolvedValue('AI Response'),
  generateText: vi.fn().mockResolvedValue('AI Response')
}

// The screenshot chunk the vector store returns for the query.
const imageDoc = {
  document: {
    id: 'art-1_0_123',
    content: 'A login screen showing a red "invalid password" error dialog. Tags: error, login',
    embedding: [0.1, 0.2],
    metadata: {
      recordingId: 'art-1',
      chunkIndex: 0,
      timestamp: '2026-07-10T09:00:00Z',
      subject: 'A login screen showing a red "invalid password" error dialog',
      sourceType: 'image',
      captureId: 'cap-42'
    }
  },
  score: 0.92
}

vi.mock('../ollama', () => ({ getOllamaService: vi.fn(() => mockOllamaService) }))
vi.mock('../chat-llm', () => ({ getChatLLMService: vi.fn(() => mockChatLLMService) }))
vi.mock('../embeddings', () => ({
  getEmbeddingsService: vi.fn(() => ({
    generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2]),
    generateEmbeddings: vi.fn().mockResolvedValue([[0.1, 0.2]])
  }))
}))

vi.mock('../vector-store', () => ({
  getVectorStore: vi.fn(() => ({
    initialize: vi.fn().mockResolvedValue(true),
    getDocumentCount: vi.fn().mockReturnValue(3),
    getMeetingCount: vi.fn().mockReturnValue(0),
    search: vi.fn().mockResolvedValue([imageDoc])
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
  queryAll: vi.fn(() => []),
  escapeLikePattern: vi.fn((p: string) => p.replace(/[%_\\]/g, '\\$&'))
}))

describe('RAG image-capture citations (F5 PixelRAG)', () => {
  let SQL: any

  beforeEach(async () => {
    vi.clearAllMocks()
    resetRAGService()
    SQL = await initSqlJs()
    dbInstance = new SQL.Database()
    dbInstance.run(`
      CREATE TABLE conversations (id TEXT PRIMARY KEY);
      CREATE TABLE conversation_context (id TEXT, conversation_id TEXT, knowledge_capture_id TEXT);
      INSERT INTO conversations (id) VALUES ('session-1');
    `)
  })

  afterEach(() => {
    if (dbInstance) dbInstance.close()
  })

  it('labels the excerpt as a Screenshot in the LLM context', async () => {
    const rag = getRAGService()
    await rag.chat('session-1', 'what was the login error?')

    expect(mockChatLLMService.generate).toHaveBeenCalled()
    const messages = vi.mocked(mockChatLLMService.generate).mock.calls[0][0]
    const userMessage = messages[messages.length - 1].content
    expect(userMessage).toContain('[Screenshot: A login screen showing a red "invalid password" error dialog')
    // It must NOT be mislabeled as a meeting.
    expect(userMessage).not.toContain('[Meeting: A login screen')
  })

  it('returns a source tagged image with the capture id for renderer linking', async () => {
    const rag = getRAGService()
    const res = await rag.chat('session-1', 'what was the login error?')

    expect(res.sources.length).toBe(1)
    const src = res.sources[0]
    expect(src.sourceType).toBe('image')
    expect(src.captureId).toBe('cap-42')
    expect(src.meetingId).toBeUndefined()
    expect(src.subject).toContain('invalid password')
  })
})
