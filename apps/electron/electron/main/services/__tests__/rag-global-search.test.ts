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
      CREATE TABLE knowledge_captures (id TEXT, title TEXT, summary TEXT, captured_at TEXT, source_recording_id TEXT, deleted_at TEXT);
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
})
