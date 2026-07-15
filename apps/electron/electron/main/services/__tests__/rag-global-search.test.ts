import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getRAGService, resetRAGService } from '../rag'
import initSqlJs from 'sql.js'

// RAGService.globalSearch only touches getDatabase() + escapeLikePattern(); the rest of
// the RAG deps are mocked so the service can be constructed. This test runs the REAL
// globalSearch SQL against a real sql.js database so it catches SQL-level regressions
// (e.g. a broken ESCAPE clause) that a mocked globalSearch would silently pass.

vi.mock('../ollama', () => ({
  getOllamaService: vi.fn(() => ({
    isAvailable: vi.fn().mockResolvedValue(true),
    generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2])
  }))
}))

vi.mock('../chat-llm', () => ({
  getChatLLMService: vi.fn(() => ({
    getStatus: vi.fn().mockResolvedValue({ backend: 'ollama', geminiConfigured: false, ollamaAvailable: true }),
    generate: vi.fn().mockResolvedValue('AI Response')
  }))
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
    getDocumentCount: vi.fn().mockReturnValue(0),
    getMeetingCount: vi.fn().mockReturnValue(0),
    search: vi.fn().mockResolvedValue([])
  }))
}))

let dbInstance: any = null
// RE6-3 (round-6) — controllable exclusion so a recording-backed capture can be
// marked excluded; the knowledge results route through the shared boundary.
let globalExclusion: { ids: Set<string>; failClosed: boolean } = { ids: new Set<string>(), failClosed: false }
vi.mock('../database', () => ({
  getDatabase: () => dbInstance,
  queryOne: vi.fn(),
  getExcludedRecordingIds: () => globalExclusion,
  // ADV9 (round-9) — filterEligibleKnowledge → filterEligibleRecordingIds now
  // uses the POSITIVE allowlist; derive it from the same mutable excluded source.
  getEligibleRecordingIds: (ids: Iterable<string>) =>
    globalExclusion.failClosed
      ? { eligible: new Set<string>(), failClosed: true }
      : { eligible: new Set([...ids].filter((i) => i && !globalExclusion.ids.has(i))), failClosed: false },
  // ADV16-2 (round-17) — filterEligibleKnowledge now routes through the central
  // filterEligibleCaptureIds, which reads the capture rows via
  // getCaptureEligibilityRows. In production getDatabase() and queryAll share ONE
  // engine; this test keeps its data in the sql.js dbInstance, so answer the
  // capture-row lookup from the SAME instance. Only the RECORDING sub-lookup
  // honours failClosed (via getEligibleRecordingIds above).
  getCaptureEligibilityRows: (ids: Iterable<string>) => {
    const want = new Set([...ids].filter(Boolean))
    const rows: Array<{ id: string; source_recording_id: string | null; quality_rating: string | null; deleted_at: unknown }> = []
    if (dbInstance) {
      const res = dbInstance.exec('SELECT id, source_recording_id, quality_rating, deleted_at FROM knowledge_captures')
      if (res.length > 0 && res[0].values) {
        for (const v of res[0].values) {
          if (want.has(v[0] as string)) {
            rows.push({ id: v[0] as string, source_recording_id: (v[1] as string) ?? null, quality_rating: (v[2] as string) ?? null, deleted_at: v[3] })
          }
        }
      }
    }
    return { rows, failClosed: false }
  },
  // Real escaping behavior — escapes % _ \ with a leading backslash, which requires a
  // working `ESCAPE '\'` clause in the query to be interpreted correctly.
  escapeLikePattern: vi.fn((pattern: string) => pattern.replace(/[%_\\]/g, '\\$&'))
}))

describe('RAGService.globalSearch (real SQL)', () => {
  let SQL: any

  beforeEach(async () => {
    vi.clearAllMocks()
    resetRAGService()
    globalExclusion = { ids: new Set<string>(), failClosed: false }
    SQL = await initSqlJs()
    dbInstance = new SQL.Database()

    dbInstance.run(`
      CREATE TABLE knowledge_captures (id TEXT, title TEXT, summary TEXT, captured_at TEXT, source_recording_id TEXT, quality_rating TEXT, deleted_at TEXT);
      CREATE TABLE contacts (id TEXT, name TEXT, email TEXT, type TEXT, company TEXT, role TEXT);
      CREATE TABLE projects (id TEXT, name TEXT, description TEXT, status TEXT);

      INSERT INTO knowledge_captures (id, title, summary, captured_at) VALUES
        ('kc-1', 'Amazon Connect migration', 'Notes about the Amazon Connect rollout', '2026-01-01'),
        ('kc-2', 'Unrelated topic', 'Something entirely different', '2026-01-02');

      INSERT INTO contacts (id, name, email, type, company, role) VALUES
        ('c-1', 'Mario Rossi', 'mario@example.com', 'person', 'Amazon', 'Engineer'),
        ('c-2', 'Someone Else', 'x@example.com', 'person', 'OtherCo', 'Manager');

      INSERT INTO projects (id, name, description, status) VALUES
        ('p-1', 'Connect Rollout', 'Amazon Connect deployment project', 'active'),
        ('p-2', 'Other Project', 'No relation', 'archived');
    `)
  })

  afterEach(() => {
    if (dbInstance) dbInstance.close()
  })

  // Regression: before the fix, the ESCAPE clause collapsed to `ESCAPE ''` (empty string),
  // which SQLite rejects with "ESCAPE expression must be a single character". Every query
  // threw and globalSearch returned { success: false }. This is the previously-failing case.
  it('single-term query returns success with matching results (was: Global search failed)', async () => {
    const rag = getRAGService()
    const result = await rag.globalSearch('Amazon', 10)

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.knowledge.map((k: any) => k.id)).toContain('kc-1')
    expect(result.data.people.map((p: any) => p.id)).toContain('c-1')
    expect(result.data.projects.map((pr: any) => pr.id)).toContain('p-1')
  })

  it('multi-term query ranks and returns cross-entity results', async () => {
    const rag = getRAGService()
    const result = await rag.globalSearch('Amazon Connect', 10)

    expect(result.success).toBe(true)
    if (!result.success) return
    // Knowledge row matching BOTH terms should be present and ranked first
    expect(result.data.knowledge.length).toBeGreaterThan(0)
    expect(result.data.knowledge[0].id).toBe('kc-1')
    expect(result.data.projects.map((pr: any) => pr.id)).toContain('p-1')
  })

  it('query containing LIKE special characters does not throw (ESCAPE clause works)', async () => {
    const rag = getRAGService()
    // % and _ must be treated literally via the ESCAPE '\' clause — this exercises the
    // exact path that was broken. It must return success (empty results are fine).
    const result = await rag.globalSearch('100% _done', 10)
    expect(result.success).toBe(true)
  })

  it('empty query short-circuits to empty results', async () => {
    const rag = getRAGService()
    const result = await rag.globalSearch('   ', 10)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.knowledge).toEqual([])
    expect(result.data.people).toEqual([])
    expect(result.data.projects).toEqual([])
  })

  // RE6-3 (round-6) — Explore/global knowledge search routes recording-backed
  // captures through the eligibility boundary; eligible standalone captures stay.
  it('drops a recording-backed capture whose source recording is excluded; keeps standalone + deleted-capture handling', async () => {
    dbInstance.run(`
      INSERT INTO knowledge_captures (id, title, summary, captured_at, source_recording_id, deleted_at) VALUES
        ('kc-rec', 'Amazon secret notes', 'Amazon recording-backed capture', '2026-01-03', 'rec-x', NULL),
        ('kc-del', 'Amazon deleted capture', 'Amazon soft-deleted capture', '2026-01-04', 'rec-y', '2026-01-05');
    `)
    // rec-x is excluded (personal/trashed/value-excluded — the boundary only sees the id set).
    globalExclusion = { ids: new Set(['rec-x']), failClosed: false }

    const rag = getRAGService()
    const result = await rag.globalSearch('Amazon', 10)
    expect(result.success).toBe(true)
    if (!result.success) return
    const ids = result.data.knowledge.map((k: any) => k.id)
    expect(ids).toContain('kc-1') // eligible standalone capture stays
    expect(ids).not.toContain('kc-rec') // recording-backed + excluded → gone
    expect(ids).not.toContain('kc-del') // soft-deleted capture → gone
  })

  // ADV16-2 (round-17) — the previous filterEligibleKnowledge kept every
  // non-deleted STANDALONE capture unconditionally (it never read quality_rating).
  // Routing through the central filterEligibleCaptureIds now drops value-excluded
  // (garbage / low-value) standalone captures from Explore / globalSearch.
  it('ADV16-2 — drops a value-excluded (garbage/low-value) STANDALONE capture; keeps a valuable one', async () => {
    dbInstance.run(`
      INSERT INTO knowledge_captures (id, title, summary, captured_at, source_recording_id, quality_rating, deleted_at) VALUES
        ('kc-garb', 'Amazon garbage note', 'Amazon standalone garbage', '2026-01-07', NULL, 'garbage', NULL),
        ('kc-low', 'Amazon low note', 'Amazon standalone low-value', '2026-01-08', NULL, 'low-value', NULL),
        ('kc-val', 'Amazon valuable note', 'Amazon standalone valuable', '2026-01-09', NULL, 'valuable', NULL);
    `)

    const rag = getRAGService()
    const result = await rag.globalSearch('Amazon', 10)
    expect(result.success).toBe(true)
    if (!result.success) return
    const ids = result.data.knowledge.map((k: any) => k.id)
    expect(ids).toContain('kc-val') // valuable standalone stays
    expect(ids).not.toContain('kc-garb') // garbage standalone dropped
    expect(ids).not.toContain('kc-low') // low-value standalone dropped
  })

  it('RE6-3 — fails closed (drops recording-backed captures) when eligibility is unknown', async () => {
    dbInstance.run(`
      INSERT INTO knowledge_captures (id, title, summary, captured_at, source_recording_id, deleted_at) VALUES
        ('kc-rec2', 'Amazon backed', 'Amazon recording-backed', '2026-01-06', 'rec-z', NULL);
    `)
    globalExclusion = { ids: new Set<string>(), failClosed: true }

    const rag = getRAGService()
    const result = await rag.globalSearch('Amazon', 10)
    expect(result.success).toBe(true)
    if (!result.success) return
    const ids = result.data.knowledge.map((k: any) => k.id)
    expect(ids).toContain('kc-1') // standalone still allowed
    expect(ids).not.toContain('kc-rec2') // recording-backed dropped (fail closed)
  })

  // P2 (round-7) — eligibility filtering must run BEFORE the display LIMIT.
  // With the old LIMIT-then-filter order, an excluded capture occupying the
  // first `limit` rows would shrink the result to empty even though an eligible
  // match exists just beyond the limit. Over-fetch fixes this.
  it('P2 — an eligible capture beyond the display LIMIT still surfaces after excluded rows are filtered', async () => {
    // Two captures match a unique term; the FIRST (insert order) is recording-backed
    // and excluded, the SECOND is an eligible standalone capture. limit = 1.
    dbInstance.run(`
      INSERT INTO knowledge_captures (id, title, summary, captured_at, source_recording_id, deleted_at) VALUES
        ('kc-zex', 'Zebra excluded note', 'Zebra recording-backed capture', '2026-02-01', 'rec-x', NULL),
        ('kc-zok', 'Zebra eligible note', 'Zebra standalone capture', '2026-02-02', NULL, NULL);
    `)
    globalExclusion = { ids: new Set(['rec-x']), failClosed: false }

    const rag = getRAGService()
    const result = await rag.globalSearch('Zebra', 1)
    expect(result.success).toBe(true)
    if (!result.success) return
    const ids = result.data.knowledge.map((k: any) => k.id)
    expect(ids).toEqual(['kc-zok']) // excluded row filtered pre-limit; eligible match returned
  })

  // RE7-P2a (round-8) — the previous fix over-fetched to a FIXED ceiling
  // (max(limit*10, 50)); a long run of excluded rows past that ceiling could
  // still truncate away an eligible match. globalSearch now PAGES until `limit`
  // eligible rows are collected, so an eligible capture sitting beyond 50
  // excluded ones still surfaces.
  it('RE7-P2a — pages past a >50-row block of excluded captures to find the eligible one', async () => {
    // 60 excluded recording-backed captures, then 1 eligible standalone capture.
    const stmts: string[] = []
    for (let i = 0; i < 60; i++) {
      stmts.push(
        `INSERT INTO knowledge_captures (id, title, summary, captured_at, source_recording_id, deleted_at) ` +
          `VALUES ('kc-bad-${i}', 'Yak note ${i}', 'Yak recording-backed ${i}', '2026-03-${String((i % 27) + 1).padStart(2, '0')}', 'rec-bad', NULL)`
      )
    }
    stmts.push(
      `INSERT INTO knowledge_captures (id, title, summary, captured_at, source_recording_id, deleted_at) ` +
        `VALUES ('kc-yok', 'Yak eligible', 'Yak standalone', '2026-02-01', NULL, NULL)`
    )
    dbInstance.run(stmts.join(';\n'))
    // rec-bad excluded → all 60 recording-backed captures are ineligible.
    globalExclusion = { ids: new Set(['rec-bad']), failClosed: false }

    const rag = getRAGService()
    const result = await rag.globalSearch('Yak', 1)
    expect(result.success).toBe(true)
    if (!result.success) return
    const ids = result.data.knowledge.map((k: any) => k.id)
    expect(ids).toEqual(['kc-yok']) // found despite sitting beyond a 50+ excluded block
  })

  // RE8-P2b (round-9) — NO fixed scan ceiling: an eligible capture sits beyond
  // 2100 excluded ones (past the old max(limit*10,50)/50-page ≈ 2000-row ceiling
  // that reintroduced truncation-before-filter for large libraries). It must
  // still surface.
  it('RE8-P2b — pages past a >2000-row block of excluded captures with no fixed ceiling', () => {
    const values: string[] = []
    for (let i = 0; i < 2100; i++) {
      values.push(`('kc-w-${i}', 'Wombat note ${i}', 'Wombat backed ${i}', '2026-04-01', 'rec-w', NULL)`)
    }
    values.push(`('kc-wok', 'Wombat eligible', 'Wombat standalone', '2026-04-02', NULL, NULL)`)
    dbInstance.run(
      `INSERT INTO knowledge_captures (id, title, summary, captured_at, source_recording_id, deleted_at) VALUES ${values.join(',')}`
    )
    globalExclusion = { ids: new Set(['rec-w']), failClosed: false }

    const rag = getRAGService()
    return rag.globalSearch('Wombat', 1).then((result) => {
      expect(result.success).toBe(true)
      if (!result.success) return
      expect(result.data.knowledge.map((k: any) => k.id)).toEqual(['kc-wok'])
    })
  })
})
