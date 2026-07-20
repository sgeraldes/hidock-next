
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
    generateEmbeddings: vi.fn().mockResolvedValue([[0.1, 0.2]]),
    activeProviderId: vi.fn(async () => 'gemini-api'),
    relevanceThreshold: vi.fn(async () => 0.3)
  }))
}))

vi.mock('../actionable-eligibility', () => ({
  filterEligibleActionableRows: (rows: any[]) => rows,
}))

vi.mock('../vector-store', () => ({
  getVectorStore: vi.fn(() => ({
    initialize: vi.fn().mockResolvedValue(true),
    getDocumentCount: vi.fn().mockReturnValue(10),
    getEligibleDocumentCount: vi.fn((providerId?: string) => (providerId ? eligiblePartitionCount : eligibleDocCount)),
    getMeetingCount: vi.fn().mockReturnValue(5),
    search: vi.fn().mockResolvedValue([]),
    getChunkNeighbors: vi.fn(() => [])
  }))
}))

let dbInstance: any = null
// Mutable knob: how many ELIGIBLE chunks the vector store claims to hold. >0
// with an empty search() result signals an embedding-provider failure.
let eligibleDocCount = 0
// Mutable knob: eligible chunks in the ACTIVE provider's partition. Diverging
// this from eligibleDocCount simulates a just-switched provider (reindex pending).
let eligiblePartitionCount = 0
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
  queryAll: vi.fn((sql: string, params: any[] = []) => {
    if (!dbInstance) return []
    try {
      const result = dbInstance.exec(sql, params)
      if (result.length === 0) return []
      return result[0].values.map((values) => {
        const row: any = {}
        result[0].columns.forEach((col: string, i: number) => { row[col] = values[i] })
        return row
      })
    } catch {
      return [] // missing optional tables (actionables etc.) ⇒ no structured rows
    }
  }),
  escapeLikePattern: vi.fn((pattern: string) => pattern.replace(/[%_\\]/g, '\\$&')),
  // ADV5 (round-5) / round-6 — the pinned-context path revalidates each pinned
  // recording through the shared boundary (recording-eligibility.ts), which
  // reads this. Round-6 shape { ids, failClosed }; the real function surfaces
  // failClosed rather than throwing, so the mock mimics that.
  getExcludedRecordingIds: () =>
    throwExclusionLookup ? { ids: new Set<string>(), failClosed: true } : { ids: excludedRecordingIds, failClosed: false },
  // ADV9 (round-9) — positive allowlist derived from the same excluded source.
  getEligibleRecordingIds: (ids: Iterable<string>) =>
    throwExclusionLookup
      ? { eligible: new Set<string>(), failClosed: true }
      : { eligible: new Set([...ids].filter((i) => i && !excludedRecordingIds.has(i))), failClosed: false }
}))

describe('RAGService Context Injection', () => {
  let SQL: any

  beforeEach(async () => {
    vi.clearAllMocks()
    resetRAGService()
    excludedRecordingIds = new Set<string>()
    throwExclusionLookup = false
    eligibleDocCount = 0
    eligiblePartitionCount = 0
    SQL = await initSqlJs()
    dbInstance = new SQL.Database()
    
    // Setup tables
    dbInstance.run(`
      CREATE TABLE conversations (id TEXT PRIMARY KEY);
      CREATE TABLE conversation_context (id TEXT, conversation_id TEXT, knowledge_capture_id TEXT);
      CREATE TABLE knowledge_captures (id TEXT, title TEXT, source_recording_id TEXT);
      CREATE TABLE transcripts (recording_id TEXT, full_text TEXT);
      CREATE TABLE actionables (id TEXT, type TEXT, title TEXT, description TEXT, status TEXT, created_at TEXT, source_knowledge_id TEXT);
      CREATE TABLE recordings (id TEXT, date_recorded TEXT);

      INSERT INTO conversations (id) VALUES ('session-1');
      INSERT INTO conversations (id) VALUES ('session-no-pins');
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

  // Retrieval-failure surfacing (2026-07): vectorStore.search() returns [] ONLY
  // on embedding-provider failure or a truly empty store. With eligible chunks
  // present, the prompt must say retrieval broke — NOT "no transcripts found".
  it('signals retrieval failure when search is empty but eligible chunks exist', async () => {
    eligibleDocCount = 110463
    eligiblePartitionCount = 110463 // the ACTIVE partition holds the chunks
    const rag = getRAGService()

    // A session with no pinned context, so the fallback string is exercised.
    await rag.chat('session-no-pins', 'What actions do I have for this week?')

    const lastCall = vi.mocked(mockChatLLMService.generate).mock.calls[0]
    const messages = lastCall[0]
    const userMessage = messages[messages.length - 1].content
    expect(userMessage).toContain('semantic search is temporarily unavailable')
    expect(userMessage).not.toContain('No relevant meeting transcripts found')
  })

  it('signals reindex-pending when the active partition is empty but others hold chunks', async () => {
    eligibleDocCount = 110463 // other partitions (e.g. gemini) hold the library
    eligiblePartitionCount = 0 // the ACTIVE provider has nothing yet
    const rag = getRAGService()

    await rag.chat('session-no-pins', 'What actions do I have for this week?')

    const lastCall = vi.mocked(mockChatLLMService.generate).mock.calls[0]
    const messages = lastCall[0]
    const userMessage = messages[messages.length - 1].content
    expect(userMessage).toContain('re-indexing for the active provider has not completed')
    expect(userMessage).not.toContain('No relevant meeting transcripts found')
  })

  it('answers action questions from STRUCTURED ACTION ITEMS even with an empty vector search', async () => {
    // An action item extracted from a meeting, dated TODAY (inside "this week"
    // regardless of when the test runs).
    dbInstance.run(
      `INSERT INTO actionables VALUES ('a-live', 'action_items', 'Bring updated resource plans by 3pm', 'Edu asked for updated data', 'pending', ?, 'kc-1')`,
      [new Date().toISOString()]
    )
    const rag = getRAGService()

    await rag.chat('session-no-pins', 'What actions do I have for this week?')

    const lastCall = vi.mocked(mockChatLLMService.generate).mock.calls[0]
    const messages = lastCall[0]
    const userMessage = messages[messages.length - 1].content
    expect(userMessage).toContain('STRUCTURED ACTION ITEMS')
    expect(userMessage).toContain('Bring updated resource plans by 3pm')
    expect(userMessage).toContain('DATE GROUNDING')
    // and the retrieval-failure notes must NOT fire — structured content exists
    expect(userMessage).not.toContain('No relevant meeting transcripts found')
    expect(userMessage).not.toContain('semantic search is temporarily unavailable')
  })

  it('keeps the legacy "no transcripts" fallback when nothing is indexed', async () => {
    const rag = getRAGService()

    await rag.chat('session-no-pins', 'What actions do I have for this week?')

    const lastCall = vi.mocked(mockChatLLMService.generate).mock.calls[0]
    const messages = lastCall[0]
    const userMessage = messages[messages.length - 1].content
    expect(userMessage).toContain('No relevant meeting transcripts found for this query.')
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

  // ADV18-1 (round-19) — the RAG conversation-history resend path revalidates
  // each cached assistant turn's provenance BEFORE prepending it to the next LLM
  // prompt. Turn 1 grounds its answer on the pinned recording rec-1; turn 2
  // asserts the presence/absence of that prior answer in the messages array
  // actually sent to the provider.
  function assistantTurnsInCall(callIndex: number): unknown[] {
    const messages = vi.mocked(mockChatLLMService.generate).mock.calls[callIndex][0]
    return (messages as Array<{ role: string }>).filter((m) => m.role === 'assistant')
  }

  it('ADV18-1 — keeps a prior answer in the resent history while its recording is eligible', async () => {
    const rag = getRAGService()
    await rag.chat('session-1', 'first question') // grounded on pinned rec-1 (eligible)
    await rag.chat('session-1', 'second question')
    // The turn-1 assistant answer is revalidated-eligible → resent as history.
    expect(assistantTurnsInCall(1)).toHaveLength(1)
  })

  it('ADV18-1 — DROPS a prior answer from the resent history once its recording is excluded', async () => {
    const rag = getRAGService()
    await rag.chat('session-1', 'first question') // grounded on pinned rec-1 (eligible)
    excludedRecordingIds = new Set(['rec-1']) // rec-1 trashed/personal/value-excluded before turn 2
    await rag.chat('session-1', 'second question')
    // The turn-1 answer's provenance is now excluded → it is NOT resent to the LLM.
    expect(assistantTurnsInCall(1)).toHaveLength(0)
  })

  it('ADV18-1 — fails closed (drops prior answer) when the resend eligibility lookup throws', async () => {
    const rag = getRAGService()
    await rag.chat('session-1', 'first question')
    throwExclusionLookup = true
    await rag.chat('session-1', 'second question')
    expect(assistantTurnsInCall(1)).toHaveLength(0)
  })
})
