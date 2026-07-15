// @vitest-environment node

/**
 * ADV19-2 + ADV19-4 (round-20) — the RAG generation's provenance model:
 *   • FIX 2 (ADV19-2): ALL prompt components are revalidated together AFTER every
 *     await, immediately before the provider call. A recording excluded DURING the
 *     buildGraphContext await is DROPPED from the messages sent to the provider.
 *   • FIX 4 (ADV19-4): provenance binds to a UNIQUE generationId (not the
 *     conversation), so overlapping answers never cross-consume; an unknown/missing
 *     id fails closed; a renderer cannot forge a trusted non-rag envelope while a
 *     grounded generation is outstanding; and overlapping same-conversation
 *     generations are rejected by a main-process in-flight guard.
 *
 * Real RAGService; dependencies mocked. The './brains' mock's async
 * resolvePrimaryChatBrainId (awaited inside buildGraphContext) is the hook that
 * simulates a deletion landing DURING the graph await.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

let excluded = new Set<string>()
let throwLookup = false
/** When set to a recording id, the graph-await hook excludes it mid-generation. */
let flipDuringGraphAwait: string | null = null

const searchMock = vi.fn().mockResolvedValue([] as unknown[])
const searchByMeetingMock = vi.fn().mockResolvedValue([] as unknown[])
const generateMock = vi.fn().mockResolvedValue('AI Response')

vi.mock('../ollama', () => ({
  getOllamaService: () => ({
    isAvailable: vi.fn().mockResolvedValue(true),
    ensureModels: vi.fn().mockResolvedValue({ embedding: true, chat: true })
  })
}))

vi.mock('../chat-llm', () => ({
  getChatLLMService: () => ({
    getStatus: vi.fn().mockResolvedValue({ backend: 'ollama', ollamaAvailable: true }),
    generate: generateMock,
    generateText: vi.fn().mockResolvedValue('AI Response')
  })
}))

vi.mock('../embeddings', () => ({
  getEmbeddingsService: () => ({
    generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2]),
    generateEmbeddings: vi.fn().mockResolvedValue([[0.1, 0.2]])
  })
}))

vi.mock('../vector-store', () => ({
  getVectorStore: () => ({
    initialize: vi.fn().mockResolvedValue(true),
    getDocumentCount: () => 10,
    getMeetingCount: () => 5,
    search: searchMock,
    searchByMeeting: searchByMeetingMock
  })
}))

vi.mock('../database', () => ({
  getDatabase: () => ({ exec: () => [] }), // no pinned context
  queryOne: (_sql: string, params: unknown[]) => ({ id: params[0] }), // conversation exists
  queryAll: () => [],
  escapeLikePattern: (p: string) => p,
  getEligibleRecordingIds: (ids: Iterable<string>) =>
    throwLookup
      ? { eligible: new Set<string>(), failClosed: true }
      : { eligible: new Set([...ids].filter((i) => i && !excluded.has(i))), failClosed: false },
  getExcludedRecordingIds: () =>
    throwLookup ? { ids: new Set<string>(), failClosed: true } : { ids: excluded, failClosed: false },
  getExistingRecordingIds: (ids: Iterable<string>) => ({ ids: new Set([...ids]), failClosed: false }),
  getExistingCaptureIds: (ids: Iterable<string>) => ({ ids: new Set([...ids]), failClosed: false }),
  getCaptureEligibilityRows: () => ({ rows: [], failClosed: false })
}))

// Inert graph — contributes no facts. The important part is that its module load +
// budget resolution are AWAITED inside buildGraphContext (see the brains hook).
vi.mock('../knowledge-graph-service', () => ({
  getGroundingExclusionSet: () =>
    throwLookup ? { ids: new Set<string>(), failClosed: true } : { ids: excluded, failClosed: false },
  neighborhoodFacts: () => '',
  findMentionedEntity: () => null,
  queryListNodes: () => [],
  resolveEntityToNodeId: () => null
}))

vi.mock('../brains', () => ({
  getBrainRouter: () => ({
    resolvePrimaryChatBrainId: async () => {
      // ADV19-2 — a deletion landing DURING the graph await: this runs after the
      // vector parts are built but before the post-await recheck.
      if (flipDuringGraphAwait) excluded.add(flipDuringGraphAwait)
      return 'ollama'
    },
    getLastChatFailure: () => null
  }),
  getBrainRegistry: () => ({ get: () => ({ label: 'Ollama' }) })
}))

vi.mock('../event-bus', () => ({ getEventBus: () => ({ onDomainEvent: () => {} }) }))

import { getRAGService, resetRAGService } from '../rag'

const vectorDoc = (recordingId: string, meetingId: string, content: string) => ({
  document: { content, metadata: { recordingId, meetingId, subject: `Meeting ${meetingId}` } },
  score: 0.9
})

beforeEach(() => {
  vi.clearAllMocks()
  resetRAGService()
  excluded = new Set<string>()
  throwLookup = false
  flipDuringGraphAwait = null
  searchMock.mockResolvedValue([])
  searchByMeetingMock.mockResolvedValue([])
  generateMock.mockResolvedValue('AI Response')
})

describe('ADV19-2 — post-await recheck of all prompt components', () => {
  it('drops a vector component whose recording is excluded DURING the graph await', async () => {
    searchMock.mockResolvedValueOnce([
      vectorDoc('recA', 'mA', 'ALPHA_TEXT'),
      vectorDoc('recB', 'mB', 'BETA_TEXT')
    ])
    flipDuringGraphAwait = 'recA' // recA becomes excluded mid-generation (graph await)

    const rag = getRAGService()
    const resp = await rag.chat('conv1', 'question')

    const messages = generateMock.mock.calls[0][0] as Array<{ role: string; content: string }>
    const userMsg = messages[messages.length - 1].content
    // The excluded-during-await component is NEVER sent to the provider.
    expect(userMsg).toContain('BETA_TEXT')
    expect(userMsg).not.toContain('ALPHA_TEXT')
    // Its citation chip is dropped too.
    expect(resp.sources.some((s) => s.meetingId === 'mA')).toBe(false)
    expect(resp.sources.some((s) => s.meetingId === 'mB')).toBe(true)
    // The answer's provenance binds ONLY the surviving recB. ADV20-1 (round-21) —
    // consumeAssistantAnswer also replays MAIN's stored content + sources.
    expect(rag.consumeAssistantAnswer('conv1', resp.generationId!)).toMatchObject({
      kind: 'rag',
      content: 'AI Response',
      prov: { recordingIds: ['recB'], captureIds: [], unverifiable: false }
    })
  })

  it('all-eligible answer keeps every component (baseline, nothing dropped)', async () => {
    searchMock.mockResolvedValueOnce([vectorDoc('recA', 'mA', 'ALPHA_TEXT'), vectorDoc('recB', 'mB', 'BETA_TEXT')])
    const rag = getRAGService()
    const resp = await rag.chat('conv1', 'question')
    const messages = generateMock.mock.calls[0][0] as Array<{ role: string; content: string }>
    const userMsg = messages[messages.length - 1].content
    expect(userMsg).toContain('ALPHA_TEXT')
    expect(userMsg).toContain('BETA_TEXT')
    expect(rag.consumeAssistantAnswer('conv1', resp.generationId!)).toMatchObject({
      kind: 'rag',
      content: 'AI Response',
      prov: { recordingIds: ['recA', 'recB'], captureIds: [], unverifiable: false }
    })
  })

  it('fails closed (drops recording-backed vector components) when the recheck lookup throws', async () => {
    searchMock.mockResolvedValueOnce([vectorDoc('recA', 'mA', 'ALPHA_TEXT')])
    throwLookup = true
    const rag = getRAGService()
    const resp = await rag.chat('conv1', 'question')
    const messages = generateMock.mock.calls[0][0] as Array<{ role: string; content: string }>
    expect(messages[messages.length - 1].content).not.toContain('ALPHA_TEXT')
    expect(resp.sources).toHaveLength(0)
  })
})

describe('ADV19-4 — provenance bound to a unique generation id', () => {
  it('each answer carries ITS OWN generation provenance — no cross-consumption', async () => {
    const rag = getRAGService()
    searchMock.mockResolvedValueOnce([vectorDoc('recA', 'mA', 'A')])
    const a = await rag.chat('conv1', 'q1')
    searchMock.mockResolvedValueOnce([vectorDoc('recB', 'mB', 'B')])
    const b = await rag.chat('conv1', 'q2')

    expect(a.generationId).toBeTruthy()
    expect(b.generationId).toBeTruthy()
    expect(a.generationId).not.toBe(b.generationId)

    // A's id resolves to recA; B's id resolves to recB — A can NEVER consume B's union.
    expect(rag.consumeAssistantAnswer('conv1', a.generationId!)).toMatchObject({
      kind: 'rag',
      prov: { recordingIds: ['recA'], captureIds: [], unverifiable: false }
    })
    expect(rag.consumeAssistantAnswer('conv1', b.generationId!)).toMatchObject({
      kind: 'rag',
      prov: { recordingIds: ['recB'], captureIds: [], unverifiable: false }
    })
  })

  it('an unknown / missing generationId fails closed (kind:unverifiable)', async () => {
    const rag = getRAGService()
    expect(rag.consumeAssistantAnswer('conv1', 'does-not-exist')).toEqual({ kind: 'unverifiable' })
  })

  it('a consumed generationId cannot be reused (second consume fails closed)', async () => {
    const rag = getRAGService()
    searchMock.mockResolvedValueOnce([vectorDoc('recA', 'mA', 'A')])
    const a = await rag.chat('conv1', 'q1')
    expect(rag.consumeAssistantAnswer('conv1', a.generationId!).kind).toBe('rag')
    // Reuse ⇒ no longer pending ⇒ unverifiable.
    expect(rag.consumeAssistantAnswer('conv1', a.generationId!)).toEqual({ kind: 'unverifiable' })
  })

  it('ADV20-1 — a persist attempt with NO generationId fails closed (renderer cannot author content)', async () => {
    const rag = getRAGService()
    searchMock.mockResolvedValueOnce([vectorDoc('recA', 'mA', 'A')])
    await rag.chat('conv1', 'q') // grounded generation registered, NOT consumed
    // The renderer cannot author an assistant message: no generationId ⇒ fail closed,
    // never the outstanding grounded content, never a trusted non-rag.
    expect(rag.consumeAssistantAnswer('conv1')).toEqual({ kind: 'unverifiable' })
    // Even on a fresh conversation with nothing outstanding.
    expect(rag.consumeAssistantAnswer('conv-fresh')).toEqual({ kind: 'unverifiable' })
  })

  it('ADV20-1 — a provider-failure error is a MAIN-owned non-rag emit consumable by its generationId', async () => {
    const rag = getRAGService()
    searchMock.mockResolvedValueOnce([vectorDoc('recA', 'mA', 'A')])
    generateMock.mockResolvedValueOnce('') // provider returns nothing ⇒ error path
    const resp = await rag.chat('conv1', 'q')
    expect(resp.error).toBeTruthy()
    expect(resp.generationId).toBeTruthy()
    const persisted = rag.consumeAssistantAnswer('conv1', resp.generationId!)
    expect(persisted.kind).toBe('non-rag')
    expect(persisted).toMatchObject({ kind: 'non-rag', content: resp.error })
  })

  it('rejects an overlapping generation for the same conversation (in-flight guard)', async () => {
    const rag = getRAGService()
    searchMock.mockResolvedValue([vectorDoc('recA', 'mA', 'A')])
    const [r1, r2] = await Promise.all([rag.chat('conv1', 'q1'), rag.chat('conv1', 'q2')])
    const errors = [r1, r2].filter((r) => r.error)
    const oks = [r1, r2].filter((r) => !r.error)
    expect(errors).toHaveLength(1)
    expect(errors[0].error).toMatch(/already being generated/i)
    expect(oks).toHaveLength(1)
    expect(oks[0].generationId).toBeTruthy()
  })
})
