/**
 * F4 — Context-graph grounding for the RAG assistant.
 *
 * Verifies (with fully mocked stores) that rag.buildGraphContext:
 *   (a) flows graph facts into BrainRouter.chat messages (real chat-llm → mocked brains),
 *   (b) detects entities beyond a literal match — accent-folded labels + contact aliases —
 *       with WHOLE-TOKEN matching (no substring false positives: Ana≠banana, Ann≠annual),
 *   (c) injects a meeting's graph neighborhood when the chat is scoped to a meeting,
 *       resolving the app meeting id to its GRAPH NODE id first (distinct id spaces),
 *   (d) trims graph facts to a per-brain token budget, preferring the router's
 *       resolvePrimaryChatBrainId() when present and falling back to config,
 *   (e) does bounded work per message: cached entity index, not a per-message corpus scan.
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

// --- config (per-brain budget lookup fallback) ---
const mockBrains: { taskRouting: Record<string, string>; defaultBrain: string } = {
  taskRouting: {},
  defaultBrain: 'gemini-api',
}
vi.mock('../config', () => ({ getConfig: () => ({ brains: mockBrains }) }))

// --- brains: the seam chat-llm.generate() forwards to (BrainRouter.chat), plus
// the (feature-detected) resolvePrimaryChatBrainId budget source. The router
// object is mutable so tests can add/remove the helper.
const mockBrainChat = vi.fn().mockResolvedValue('AI Response')
const mockRouter: {
  chat: typeof mockBrainChat
  resolvePrimaryChatBrainId?: () => string | null | undefined
} = { chat: mockBrainChat }
vi.mock('../brains', () => ({ getBrainRouter: () => mockRouter }))

// --- event-bus (lazy-imported for index invalidation; electron-free mock) ---
// NOTE: rag.ts wires its invalidation handlers ONCE per module lifetime, so this
// registry must NOT be cleared between tests — the handlers registered on the
// first buildGraphContext call are the ones later tests fire.
const domainHandlers = new Map<string, Array<() => void>>()
vi.mock('../event-bus', () => ({
  getEventBus: () => ({
    onDomainEvent: (type: string, handler: () => void) => {
      const arr = domainHandlers.get(type) ?? []
      arr.push(handler)
      domainHandlers.set(type, arr)
      return () => {}
    },
  }),
}))

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
// aliasRows is read lazily inside the queryAll callback, so the vi.mock factory
// (hoisted) never touches it before initialization.
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

import {
  buildGraphContext,
  getRAGService,
  resetRAGService,
  resetEntityDetectionIndex,
} from '../rag'
import { queryAll } from '../database'

const mockQueryAll = vi.mocked(queryAll)

beforeEach(() => {
  vi.clearAllMocks()
  resetRAGService()
  resetEntityDetectionIndex()
  aliasRows = []
  mockBrains.taskRouting = {}
  mockBrains.defaultBrain = 'gemini-api'
  delete mockRouter.resolvePrimaryChatBrainId

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

  it('Tier 2: matches a multi-word project label', async () => {
    kgMock.queryListNodes.mockImplementation((type: string) =>
      type === 'project' ? [{ id: 'prj1', label: 'Project Apollo', type: 'project' }] : []
    )
    kgMock.neighborhoodFacts.mockImplementation((id: string) => (id === 'prj1' ? 'FACT-APOLLO' : ''))

    const parts = await buildGraphContext('status of project apollo please')
    expect(parts).toContain('FACT-APOLLO')
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

describe('buildGraphContext — whole-token matching (no substring false positives)', () => {
  it('node label "Ana" does NOT match inside "banana"', async () => {
    kgMock.queryListNodes.mockImplementation((type: string) =>
      type === 'person' ? [{ id: 'pAna', label: 'Ana', type: 'person' }] : []
    )
    kgMock.neighborhoodFacts.mockReturnValue('SHOULD-NOT-APPEAR')

    const parts = await buildGraphContext('I baked banana bread yesterday')
    expect(parts).toEqual([])
  })

  it('alias "Ann" does NOT match inside "annual"', async () => {
    aliasRows = [{ alias: 'Ann', contact_id: 'c9', source: null }]
    kgMock.neighborhoodFacts.mockReturnValue('SHOULD-NOT-APPEAR')

    const parts = await buildGraphContext('prepare the annual report')
    expect(parts).toEqual([])
    expect(kgMock.resolveEntityToNodeId).not.toHaveBeenCalled()
  })

  it('a name adjacent to punctuation still matches ("ping Yara, please")', async () => {
    aliasRows = [{ alias: 'Yara', contact_id: 'c1', source: null }]
    kgMock.resolveEntityToNodeId.mockImplementation((id: string) => (id === 'c1' ? 'pAlias' : null))
    kgMock.neighborhoodFacts.mockImplementation((id: string) => (id === 'pAlias' ? 'FACT-ALIAS' : ''))

    const parts = await buildGraphContext('ping Yara, please — (urgent!)')
    expect(parts).toContain('FACT-ALIAS')
  })

  it('a label at the very start/end of the message matches', async () => {
    kgMock.queryListNodes.mockImplementation((type: string) =>
      type === 'person' ? [{ id: 'pAna', label: 'Ana', type: 'person' }] : []
    )
    kgMock.neighborhoodFacts.mockImplementation((id: string) => (id === 'pAna' ? 'FACT-ANA' : ''))

    expect(await buildGraphContext('Ana said yes')).toContain('FACT-ANA')
    resetEntityDetectionIndex()
    expect(await buildGraphContext('what about Ana')).toContain('FACT-ANA')
  })
})

describe('buildGraphContext — meeting scope resolves app id → graph node id', () => {
  it('resolves the meeting id to its node id before fetching facts', async () => {
    // Distinct id spaces: app meeting id 'meeting-123' vs graph node 'node-m1'.
    // Mirrors the real service: neighborhood facts live under graph node ids.
    kgMock.resolveEntityToNodeId.mockImplementation((id: string) =>
      id === 'meeting-123' ? 'node-m1' : null
    )
    kgMock.neighborhoodFacts.mockImplementation((id: string) =>
      id === 'node-m1' ? 'FACT-MEETING' : ''
    )

    const parts = await buildGraphContext('summarize this', 'meeting-123')
    expect(parts).toContain('FACT-MEETING')
    expect(kgMock.resolveEntityToNodeId).toHaveBeenCalledWith('meeting-123')
    expect(kgMock.neighborhoodFacts).toHaveBeenCalledWith('node-m1', 1)
    // The raw app meeting id must never reach the facts call.
    expect(kgMock.neighborhoodFacts).not.toHaveBeenCalledWith('meeting-123', 1)
  })

  it('skips cleanly when the meeting has no graph node', async () => {
    kgMock.resolveEntityToNodeId.mockReturnValue(null)
    kgMock.neighborhoodFacts.mockReturnValue('SHOULD-NOT-APPEAR')

    const parts = await buildGraphContext('summarize this', 'meeting-unknown')
    expect(parts).toEqual([])
    expect(kgMock.neighborhoodFacts).not.toHaveBeenCalled()
  })

  it('dedupes when a named entity resolves to the same node as the meeting', async () => {
    kgMock.findMentionedEntity.mockReturnValue({ id: 'node-m1', label: 'Standup' })
    kgMock.resolveEntityToNodeId.mockImplementation((id: string) =>
      id === 'meeting-123' ? 'node-m1' : null
    )
    kgMock.neighborhoodFacts.mockImplementation((id: string) =>
      id === 'node-m1' ? 'FACT-MEETING' : ''
    )

    const parts = await buildGraphContext('summarize Standup', 'meeting-123')
    expect(parts).toEqual(['FACT-MEETING'])
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

  it('honours a per-task chat route over the default brain (config fallback path)', async () => {
    mockBrains.defaultBrain = 'gemini-api'
    mockBrains.taskRouting = { chat: 'ollama' }
    const parts = await buildGraphContext('Alpha Bravo Charlie all spoke')
    expect(parts).toHaveLength(1) // routed to ollama's small budget
  })

  it('prefers BrainRouter.resolvePrimaryChatBrainId() over the config read when present', async () => {
    // Config says gemini (budget 1500 → 3 facts) but the router — the source of
    // truth for what actually serves the chat — says ollama (budget 500 → 1).
    mockBrains.defaultBrain = 'gemini-api'
    mockRouter.resolvePrimaryChatBrainId = () => 'ollama'
    const parts = await buildGraphContext('Alpha Bravo Charlie all spoke')
    expect(parts).toHaveLength(1)
  })

  it('falls back to the config read when the router helper returns nothing', async () => {
    mockBrains.defaultBrain = 'gemini-api'
    mockRouter.resolvePrimaryChatBrainId = () => null
    const parts = await buildGraphContext('Alpha Bravo Charlie all spoke')
    expect(parts).toHaveLength(3) // config path: gemini budget
  })
})

describe('buildGraphContext — bounded work (cached entity index)', () => {
  it('builds the label/alias index once across messages (no per-message corpus scan)', async () => {
    kgMock.queryListNodes.mockImplementation((type: string) =>
      type === 'person' ? [{ id: 'p1', label: 'Alice', type: 'person' }] : []
    )
    aliasRows = [{ alias: 'Ali', contact_id: 'c1', source: null }]

    await buildGraphContext('first message about Alice')
    await buildGraphContext('second message about Alice')
    await buildGraphContext('third message, nothing relevant')

    // One index build = one node listing per type + one alias query, total.
    expect(kgMock.queryListNodes).toHaveBeenCalledTimes(2) // person + project
    expect(mockQueryAll.mock.calls.filter(([sql]) => /contact_aliases/i.test(sql))).toHaveLength(1)
  })

  it('resetEntityDetectionIndex() forces a rebuild (invalidation hook)', async () => {
    kgMock.queryListNodes.mockReturnValue([])
    await buildGraphContext('one')
    resetEntityDetectionIndex()
    await buildGraphContext('two')
    expect(kgMock.queryListNodes).toHaveBeenCalledTimes(4) // 2 builds × 2 types
  })

  it('a domain entity-changed event invalidates the cached index', async () => {
    kgMock.queryListNodes.mockReturnValue([])
    await buildGraphContext('one') // wires invalidation + builds index
    // Let the lazy event-bus import settle, then fire the domain event.
    await new Promise((r) => setTimeout(r, 0))
    for (const h of domainHandlers.get('entity:contact-changed') ?? []) h()
    await buildGraphContext('two')
    expect(kgMock.queryListNodes).toHaveBeenCalledTimes(4) // rebuilt after event
  })

  it('scale: hundreds of nodes/aliases, repeated messages stay ms-bounded', async () => {
    const people = Array.from({ length: 300 }, (_, i) => ({
      id: `p${i}`,
      label: `Person${i} Surname${i}`,
      type: 'person',
    }))
    const projects = Array.from({ length: 300 }, (_, i) => ({
      id: `prj${i}`,
      label: `Project Codename${i}`,
      type: 'project',
    }))
    kgMock.queryListNodes.mockImplementation((type: string) =>
      type === 'person' ? people : projects
    )
    aliasRows = Array.from({ length: 400 }, (_, i) => ({
      alias: `Nick${i}`,
      contact_id: `c${i}`,
      source: null,
    }))
    kgMock.resolveEntityToNodeId.mockImplementation((id: string) =>
      id.startsWith('c') ? `p-${id}` : null
    )
    kgMock.neighborhoodFacts.mockImplementation((id: string) => (id === 'p42' ? 'FACT-P42' : ''))

    const start = performance.now()
    let hits = 0
    for (let i = 0; i < 100; i++) {
      const parts = await buildGraphContext(
        `a fairly typical chat message ${i} mentioning Person42 Surname42 and some noise words`
      )
      if (parts.includes('FACT-P42')) hits++
    }
    const elapsed = performance.now() - start

    expect(hits).toBe(100) // correctness at scale
    expect(kgMock.queryListNodes).toHaveBeenCalledTimes(2) // index built once
    expect(elapsed).toBeLessThan(1500) // 100 messages vs 600 nodes + 400 aliases
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
