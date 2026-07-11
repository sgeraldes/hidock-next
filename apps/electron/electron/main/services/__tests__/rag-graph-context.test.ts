/**
 * F4 — Context-graph grounding for the RAG assistant.
 *
 * Verifies (with fully mocked stores) that rag.buildGraphContext:
 *   (a) flows graph facts into BrainRouter.chat messages (real chat-llm → mocked brains),
 *   (b) detects entities beyond a literal match — accent-folded labels + contact aliases,
 *   (c) injects a meeting's neighborhood when the chat is scoped to a meeting,
 *   (d) trims graph facts to a per-brain token budget.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- knowledge-graph-service (lazy-imported inside buildGraphContext) ---
const kgMock = {
  findMentionedEntity: vi.fn(),
  neighborhoodFacts: vi.fn(),
  queryListNodes: vi.fn(),
  resolveEntityToNodeId: vi.fn(),
}
vi.mock('../knowledge-graph-service', () => kgMock)

// --- config (per-brain budget lookup) ---
const mockBrains: { taskRouting: Record<string, string>; defaultBrain: string } = {
  taskRouting: {},
  defaultBrain: 'gemini-api',
}
vi.mock('../config', () => ({ getConfig: () => ({ brains: mockBrains }) }))

// --- brains: the seam chat-llm.generate() forwards to (BrainRouter.chat) ---
const mockBrainChat = vi.fn().mockResolvedValue('AI Response')
vi.mock('../brains', () => ({ getBrainRouter: () => ({ chat: mockBrainChat }) }))

// --- ollama (used by real chat-llm status path; unused here but must exist) ---
vi.mock('../ollama', () => ({
  getOllamaService: () => ({
    isAvailable: vi.fn().mockResolvedValue(false),
    chat: vi.fn().mockResolvedValue(null),
  }),
}))

vi.mock('../embeddings', () => ({
  getEmbeddingsService: () => ({
    generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2]),
    generateEmbeddings: vi.fn().mockResolvedValue([[0.1, 0.2]]),
  }),
}))

vi.mock('../vector-store', () => ({
  getVectorStore: () => ({
    initialize: vi.fn().mockResolvedValue(true),
    getDocumentCount: vi.fn().mockReturnValue(10),
    getMeetingCount: vi.fn().mockReturnValue(5),
    search: vi.fn().mockResolvedValue([]),
    searchByMeeting: vi.fn().mockResolvedValue([]),
  }),
}))

// --- database: valid conversation, no pinned context, configurable aliases ---
let aliasRows: Array<{ alias: string; contact_id: string; source: string | null }> = []
vi.mock('../database', () => ({
  getDatabase: () => null, // → pinned-context block is skipped
  queryOne: vi.fn((sql: string, params: any[]) => {
    if (/FROM conversations/i.test(sql)) return { id: params[0] }
    return undefined
  }),
  queryAll: vi.fn((sql: string) => {
    if (/contact_aliases/i.test(sql)) return aliasRows
    return []
  }),
  escapeLikePattern: (p: string) => p.replace(/[%_\\]/g, '\\$&'),
}))

import { buildGraphContext, getRAGService, resetRAGService } from '../rag'

beforeEach(() => {
  vi.clearAllMocks()
  resetRAGService()
  aliasRows = []
  mockBrains.taskRouting = {}
  mockBrains.defaultBrain = 'gemini-api'

  // Sensible defaults: nothing detected, empty facts, no nodes/aliases.
  kgMock.findMentionedEntity.mockReturnValue(null)
  kgMock.queryListNodes.mockReturnValue([])
  kgMock.resolveEntityToNodeId.mockImplementation((id: string) => id)
  kgMock.neighborhoodFacts.mockReturnValue('')
  mockBrainChat.mockResolvedValue('AI Response')
})

describe('buildGraphContext — entity detection tiers', () => {
  it('Tier 1: injects facts for a literal mention', async () => {
    kgMock.findMentionedEntity.mockReturnValue({ id: 'p1', label: 'Alice' })
    kgMock.neighborhoodFacts.mockImplementation((id: string) => (id === 'p1' ? 'FACT-ALICE' : ''))

    const parts = await buildGraphContext('what did Alice decide?')
    expect(parts).toContain('FACT-ALICE')
    expect(kgMock.neighborhoodFacts).toHaveBeenCalledWith('p1', 1)
  })

  it('Tier 2 (accent-fold): matches "Yaravi" against a node labelled "Yaraví"', async () => {
    kgMock.queryListNodes.mockImplementation((type: string) =>
      type === 'person' ? [{ id: 'p2', label: 'Yaraví', type: 'person' }] : []
    )
    kgMock.neighborhoodFacts.mockImplementation((id: string) => (id === 'p2' ? 'FACT-YARAVI' : ''))

    // No accent on the query — literal substring match would miss this.
    const parts = await buildGraphContext('what did Yaravi say in standup?')
    expect(parts).toContain('FACT-YARAVI')
  })

  it('Tier 2 (alias): matches a known contact alias spelling → contact node', async () => {
    aliasRows = [{ alias: 'Yara', contact_id: 'c1', source: null }]
    kgMock.resolveEntityToNodeId.mockImplementation((id: string) => (id === 'c1' ? 'pAlias' : null))
    kgMock.neighborhoodFacts.mockImplementation((id: string) => (id === 'pAlias' ? 'FACT-ALIAS' : ''))

    const parts = await buildGraphContext('please loop in Yara')
    expect(parts).toContain('FACT-ALIAS')
    expect(kgMock.resolveEntityToNodeId).toHaveBeenCalledWith('c1')
  })

  it('Tier 2 (alias): a rejected alias is ignored', async () => {
    aliasRows = [{ alias: 'Yara', contact_id: 'c1', source: 'rejected' }]
    kgMock.neighborhoodFacts.mockReturnValue('SHOULD-NOT-APPEAR')

    const parts = await buildGraphContext('please loop in Yara')
    expect(parts).toEqual([])
    expect(kgMock.resolveEntityToNodeId).not.toHaveBeenCalled()
  })

  it('Tier 3 (meeting scope): injects the scoped meeting neighborhood', async () => {
    kgMock.neighborhoodFacts.mockImplementation((id: string) => (id === 'm1' ? 'FACT-MEETING' : ''))

    const parts = await buildGraphContext('summarize this', 'm1')
    expect(parts).toContain('FACT-MEETING')
  })

  it('dedupes an entity found by multiple tiers (facts fetched once)', async () => {
    kgMock.findMentionedEntity.mockReturnValue({ id: 'p1', label: 'Alice' })
    kgMock.queryListNodes.mockImplementation((type: string) =>
      type === 'person' ? [{ id: 'p1', label: 'Alice', type: 'person' }] : []
    )
    kgMock.neighborhoodFacts.mockImplementation((id: string) => (id === 'p1' ? 'FACT-ALICE' : ''))

    const parts = await buildGraphContext('what did Alice decide?')
    expect(parts).toEqual(['FACT-ALICE'])
    expect(kgMock.neighborhoodFacts).toHaveBeenCalledTimes(1)
  })
})

describe('buildGraphContext — per-brain token budget (d)', () => {
  // Three matched person nodes, each ~300 estimated tokens (1200 chars).
  const bigFact = 'x'.repeat(1200)
  beforeEach(() => {
    kgMock.queryListNodes.mockImplementation((type: string) =>
      type === 'person'
        ? [
            { id: 'p1', label: 'Alpha', type: 'person' },
            { id: 'p2', label: 'Bravo', type: 'person' },
            { id: 'p3', label: 'Charlie', type: 'person' },
          ]
        : []
    )
    kgMock.neighborhoodFacts.mockReturnValue(bigFact)
  })

  it('ollama (small budget=500 tok) admits only the first fact', async () => {
    mockBrains.defaultBrain = 'ollama'
    const parts = await buildGraphContext('Alpha Bravo Charlie all spoke')
    expect(parts).toHaveLength(1)
  })

  it('gemini-api (large budget=1500 tok) admits all three facts', async () => {
    mockBrains.defaultBrain = 'gemini-api'
    const parts = await buildGraphContext('Alpha Bravo Charlie all spoke')
    expect(parts).toHaveLength(3)
  })

  it('honours a per-task chat route over the default brain', async () => {
    mockBrains.defaultBrain = 'gemini-api'
    mockBrains.taskRouting = { chat: 'ollama' }
    const parts = await buildGraphContext('Alpha Bravo Charlie all spoke')
    expect(parts).toHaveLength(1) // routed to ollama's small budget
  })
})

describe('rag.chat — graph context flows into BrainRouter.chat (a)', () => {
  it('passes graph facts through to BrainRouter.chat messages', async () => {
    kgMock.findMentionedEntity.mockReturnValue({ id: 'p1', label: 'Alice' })
    kgMock.neighborhoodFacts.mockImplementation((id: string) =>
      id === 'p1' ? 'Context graph — Alice (person):\n- Alice attended Standup' : ''
    )

    const rag = getRAGService()
    const res = await rag.chat('session-1', 'tell me about Alice')
    expect(res.answer).toBe('AI Response')

    // chat-llm.generate() forwards (task, messages, opts) to BrainRouter.chat.
    expect(mockBrainChat).toHaveBeenCalled()
    const [task, messages] = mockBrainChat.mock.calls[0]
    expect(task).toBe('chat')
    const userMessage = messages[messages.length - 1].content
    expect(userMessage).toContain('Context graph — Alice')
    expect(userMessage).toContain('Alice attended Standup')
  })
})
