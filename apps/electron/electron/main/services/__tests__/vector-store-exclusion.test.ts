// @vitest-environment node

/**
 * Vector-store RAG privacy: search() must drop chunks that belong to a personal
 * ("ignored") or soft-deleted recording, so the assistant never surfaces private
 * content. Filtering happens at query time against getExcludedRecordingIds(),
 * which makes marking a recording personal instantly effective and reversible.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const deps = vi.hoisted(() => ({
  excluded: new Set<string>(),
  throwOnExclusion: false,
  generateEmbedding: vi.fn()
}))

vi.mock('../database', () => ({
  getDatabase: () => ({ run: vi.fn(), exec: () => [], prepare: () => ({ step: () => false, free: () => {} }) }),
  // Round-6 — { ids, failClosed }. The real getExcludedRecordingIds catches
  // internally and surfaces failClosed rather than throwing, so the mock mimics
  // that: throwOnExclusion ⇒ failClosed (the shared boundary drops all
  // recording-backed docs).
  getExcludedRecordingIds: () =>
    deps.throwOnExclusion ? { ids: new Set<string>(), failClosed: true } : { ids: deps.excluded, failClosed: false },
  // P2 — used by the boot backfill; not exercised by the search tests.
  isRecordingProcessable: () => true
}))
vi.mock('../embeddings', () => ({
  getEmbeddingsService: () => ({
    generateEmbedding: (text: string) => deps.generateEmbedding(text),
    generateEmbeddings: async (texts: string[]) => texts.map(() => [1, 0, 0])
  })
}))

import { VectorStore } from '../vector-store'

beforeEach(() => {
  deps.excluded = new Set<string>()
  deps.throwOnExclusion = false
  deps.generateEmbedding.mockReset()
  deps.generateEmbedding.mockResolvedValue([1, 0, 0])
})

describe('VectorStore.search exclusion', () => {
  it('returns chunks from a normal recording but omits an excluded one', async () => {
    const store = new VectorStore()
    await store.addDocument('normal content', { recordingId: 'r-ok', chunkIndex: 0 })
    await store.addDocument('private content', { recordingId: 'r-personal', chunkIndex: 0 })

    // No exclusions yet — both are searchable.
    let results = await store.search('anything', 10)
    expect(results.map((r) => r.document.metadata.recordingId).sort()).toEqual(['r-ok', 'r-personal'])

    // Mark r-personal excluded (personal or soft-deleted).
    deps.excluded = new Set(['r-personal'])
    results = await store.search('anything', 10)
    const ids = results.map((r) => r.document.metadata.recordingId)
    expect(ids).toContain('r-ok')
    expect(ids).not.toContain('r-personal')
  })

  it('P1 (round-3) — FAILS CLOSED when the exclusion lookup throws: no recording-backed results', async () => {
    const store = new VectorStore()
    await store.addDocument('c', { recordingId: 'r-ok', chunkIndex: 0 })
    deps.throwOnExclusion = true
    // The exclusion set is unknown, so a recording-backed chunk must NOT surface
    // (fail-open would leak private content on a transient DB error).
    const results = await store.search('q', 5)
    expect(results.length).toBe(0)
  })

  it('P1 (round-3) — a NON-recording doc still surfaces when the exclusion lookup throws', async () => {
    const store = new VectorStore()
    // No recordingId → not privacy-scoped → unaffected by the fail-closed drop.
    await store.addDocument('a general note', { chunkIndex: 0 })
    deps.throwOnExclusion = true
    const results = await store.search('q', 5)
    expect(results.length).toBe(1)
  })

  it('P2 (round-3) — indexTranscript skips the write when shouldPersist() is false (ineligible mid-embeddings)', async () => {
    const store = new VectorStore()
    const count = await store.indexTranscript('a transcript worth indexing', {
      recordingId: 'r-purged',
      shouldPersist: () => false
    })
    expect(count).toBe(0)
    const results = await store.search('anything', 10)
    expect(results.map((r) => r.document.metadata.recordingId)).not.toContain('r-purged')
  })

  it('P2 (round-3) — indexTranscript persists when shouldPersist() is true (control)', async () => {
    const store = new VectorStore()
    const count = await store.indexTranscript('a transcript worth indexing', {
      recordingId: 'r-live',
      shouldPersist: () => true
    })
    expect(count).toBeGreaterThan(0)
    const results = await store.search('anything', 10)
    expect(results.map((r) => r.document.metadata.recordingId)).toContain('r-live')
  })

  // F16/spec-002 (T2): getExcludedRecordingIds() now also unions in
  // value-excluded recordings (rated garbage/low-value) — see
  // getValueExcludedRecordingIds in database.ts. At this mock boundary the
  // exclusion source is indistinguishable from the personal/deleted case
  // above (the store only ever sees the merged Set), so this mirrors that
  // test to document the same instant, reversible, query-time-only filtering
  // applies identically to a value-excluded id.
  it('returns chunks from a normal recording but omits a value-excluded one (garbage/low-value rating)', async () => {
    const store = new VectorStore()
    await store.addDocument('normal content', { recordingId: 'r-ok', chunkIndex: 0 })
    await store.addDocument('low-value content', { recordingId: 'r-value-excluded', chunkIndex: 0 })

    // No exclusions yet — both are searchable.
    let results = await store.search('anything', 10)
    expect(results.map((r) => r.document.metadata.recordingId).sort()).toEqual(['r-ok', 'r-value-excluded'])

    // Rating flips to garbage/low-value — getExcludedRecordingIds's union now includes it.
    deps.excluded = new Set(['r-value-excluded'])
    results = await store.search('anything', 10)
    const ids = results.map((r) => r.document.metadata.recordingId)
    expect(ids).toContain('r-ok')
    expect(ids).not.toContain('r-value-excluded')

    // Rating upgraded back (e.g. to valuable/unrated) — instantly retrievable
    // again WITHOUT re-indexing.
    deps.excluded = new Set()
    results = await store.search('anything', 10)
    expect(results.map((r) => r.document.metadata.recordingId).sort()).toEqual(['r-ok', 'r-value-excluded'])
  })
})

// RE6-1 (round-6) — ALL vector read primitives route through the SAME
// fail-closed eligibility boundary, so meeting-scoped chat / summaries /
// action-items (searchByMeeting) and the chunk viewer (getAllDocuments)
// inherit exclusion.
describe('VectorStore read primitives inherit the eligibility boundary', () => {
  it('searchByMeeting omits an excluded recording chunk (meeting chat / summary / action items)', async () => {
    const store = new VectorStore()
    await store.addDocument('ok chunk', { recordingId: 'r-ok', meetingId: 'm-1', chunkIndex: 0 })
    await store.addDocument('secret chunk', { recordingId: 'r-bad', meetingId: 'm-1', chunkIndex: 1 })

    expect((await store.searchByMeeting('m-1')).map((d) => d.metadata.recordingId).sort()).toEqual(['r-bad', 'r-ok'])

    deps.excluded = new Set(['r-bad'])
    const docs = await store.searchByMeeting('m-1')
    expect(docs.map((d) => d.metadata.recordingId)).toEqual(['r-ok'])
  })

  it('searchByMeeting fails closed (no recording-backed docs) on lookup failure', async () => {
    const store = new VectorStore()
    await store.addDocument('ok chunk', { recordingId: 'r-ok', meetingId: 'm-1', chunkIndex: 0 })
    deps.throwOnExclusion = true
    expect(await store.searchByMeeting('m-1')).toEqual([])
  })

  it('getAllDocuments omits excluded recordings (chunk viewer) and fails closed', async () => {
    const store = new VectorStore()
    await store.addDocument('ok chunk', { recordingId: 'r-ok', chunkIndex: 0 })
    await store.addDocument('secret chunk', { recordingId: 'r-bad', chunkIndex: 0 })

    deps.excluded = new Set(['r-bad'])
    expect(store.getAllDocuments().map((d) => d.metadata.recordingId)).toEqual(['r-ok'])

    deps.excluded = new Set()
    deps.throwOnExclusion = true
    expect(store.getAllDocuments()).toEqual([])
  })
})
