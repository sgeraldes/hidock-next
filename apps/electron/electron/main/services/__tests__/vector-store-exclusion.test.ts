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
  generateEmbedding: vi.fn(),
  // ADV40 sweep (round-42) — rows the boot backfill's SELECT "returns" (already
  // personal/deleted-filtered at SQL) + which recording ids actually got indexed
  // (captured from the vector_embeddings INSERT) so a test can assert the shared
  // eligibility boundary ran BEFORE the embed loop.
  backfillRows: [] as Array<{ recording_id: string; full_text: string }>,
  indexedRecordingIds: [] as string[],
  // ADV41-2 (round-43) — side-effect fired DURING the embeddings provider call,
  // used to simulate an owner exclusion committing while an EARLIER row's embed
  // is in flight. Null unless a race test sets it.
  onEmbeddings: null as null | (() => void),
  // ADV44-1 (round-46) — when non-null, the set of recordingIds that resolve to a
  // REAL recording (existence probe). Lets a test model a hard-purged orphan
  // (recordingId present on the chunk but naming no live recording). Null ⇒
  // default behaviour (every non-empty id is treated as a real recording).
  existingOverride: null as null | Set<string>
}))

vi.mock('../database', () => ({
  getDatabase: () => ({
    run: (sql: string, params?: any[]) => {
      if (typeof sql === 'string' && sql.includes('vector_embeddings') && sql.includes('INSERT') && params) {
        deps.indexedRecordingIds.push(params[4]) // recording_id column
      }
    },
    exec: () => [],
    prepare: (_sql: string) => {
      let i = -1
      return {
        bind: () => {},
        step: () => {
          i++
          return i < deps.backfillRows.length
        },
        getAsObject: () => deps.backfillRows[i],
        free: () => {}
      }
    }
  }),
  // Round-6 — { ids, failClosed }. The real getExcludedRecordingIds catches
  // internally and surfaces failClosed rather than throwing, so the mock mimics
  // that: throwOnExclusion ⇒ failClosed (the shared boundary drops all
  // recording-backed docs).
  getExcludedRecordingIds: () =>
    deps.throwOnExclusion ? { ids: new Set<string>(), failClosed: true } : { ids: deps.excluded, failClosed: false },
  // ADV9 (round-9) — positive allowlist derived from the same excluded source.
  getEligibleRecordingIds: (ids: Iterable<string>) =>
    deps.throwOnExclusion
      ? { eligible: new Set<string>(), failClosed: true }
      : { eligible: new Set([...ids].filter((i) => i && !deps.excluded.has(i))), failClosed: false },
  // ADV11 (round-12) — provenance existence. In this suite EVERY recordingId used
  // names a REAL recording (existence = identity; excluded ones still exist), and
  // no captureId is used, so captures resolve to the empty set.
  getExistingRecordingIds: (ids: Iterable<string>) =>
    deps.throwOnExclusion
      ? { ids: new Set<string>(), failClosed: true }
      : {
          ids: new Set(
            [...ids].filter((i): i is string => !!i && (deps.existingOverride ? deps.existingOverride.has(i) : true))
          ),
          failClosed: false
        },
  getExistingCaptureIds: (_ids: Iterable<string>) =>
    deps.throwOnExclusion
      ? { ids: new Set<string>(), failClosed: true }
      : { ids: new Set<string>(), failClosed: false },
  // P2 — used by the boot backfill; not exercised by the search tests.
  isRecordingProcessable: () => true
}))
vi.mock('../embeddings', () => ({
  getEmbeddingsService: () => ({
    generateEmbedding: (text: string) => deps.generateEmbedding(text),
    generateEmbeddings: async (texts: string[]) => {
      if (deps.onEmbeddings) deps.onEmbeddings()
      return texts.map(() => [1, 0, 0])
    },
    activeProviderId: async () => 'mock-provider'
  })
}))

import { VectorStore } from '../vector-store'

beforeEach(() => {
  deps.excluded = new Set<string>()
  deps.throwOnExclusion = false
  deps.backfillRows = []
  deps.indexedRecordingIds = []
  deps.onEmbeddings = null
  deps.existingOverride = null
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

  it('ADV23-1 (round-24) — a doc with NEITHER recordingId nor captureId is DROPPED (positive provenance)', async () => {
    const store = new VectorStore()
    // Round-24 flip: previously "no recordingId ⇒ surfaces". A doc with no
    // resolvable eligible recording AND no eligible capture has no positive
    // provenance (e.g. a legacy null-provenance vector row) and must NOT surface —
    // it is unassociable, so it survives every exclusion/hard-purge otherwise.
    await store.addDocument('a general note', { chunkIndex: 0 })
    // Dropped even under healthy lookups (no positive provenance)…
    expect((await store.search('q', 5)).length).toBe(0)
    // …and under fail-closed.
    deps.throwOnExclusion = true
    expect((await store.search('q', 5)).length).toBe(0)
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

// ADV40 sweep (round-42) — the boot backfill (backfillMissingTranscripts) embeds
// each un-indexed transcript. Its SELECT only filters personal/deleted at the
// recording level (and its LEFT JOIN treats a hard-purged orphan as eligible), so
// it must ALSO route the candidate ids through the shared fail-closed boundary
// BEFORE the embeddings provider call.
describe('VectorStore.backfillMissingTranscripts — eligibility BEFORE the embed', () => {
  it('embeds only eligible recordings; value-excluded / hard-purged are dropped before embedding', async () => {
    deps.backfillRows = [
      { recording_id: 'r-ok', full_text: 'keep this eligible transcript' },
      { recording_id: 'r-excluded', full_text: 'value-excluded or hard-purged transcript' }
    ]
    // The shared boundary (getEligibleRecordingIds) marks r-excluded ineligible.
    deps.excluded = new Set(['r-excluded'])

    const store = new VectorStore()
    const res = await store.backfillMissingTranscripts()

    // Only the eligible transcript reached the embed loop / INSERT.
    expect(deps.indexedRecordingIds).toEqual(['r-ok'])
    expect(res.indexed).toBe(1)
    expect(res.skipped).toBe(1)
  })

  it('FAILS CLOSED — indexes NOTHING when the eligibility lookup fails', async () => {
    deps.backfillRows = [{ recording_id: 'r-ok', full_text: 'a transcript' }]
    deps.throwOnExclusion = true // getEligibleRecordingIds → failClosed

    const store = new VectorStore()
    const res = await store.backfillMissingTranscripts()

    expect(deps.indexedRecordingIds).toEqual([])
    expect(res.indexed).toBe(0)
  })

  it('ADV41-2 (round-43) — a LATER row excluded WHILE an earlier row embeds is never sent to the provider', async () => {
    // Two eligible rows at batch-filter time. While the FIRST row's embeddings
    // are in flight, the owner excludes the SECOND row. The per-row recheck
    // immediately before each indexTranscript call (plus indexTranscript's
    // pre-provider shouldGenerate) must drop it so it is never embedded.
    deps.backfillRows = [
      { recording_id: 'r-first', full_text: 'first transcript, embeds fine' },
      { recording_id: 'r-later', full_text: 'excluded DURING r-first embed' }
    ]
    // Fire during the FIRST embed call: commit the exclusion of the later row.
    deps.onEmbeddings = () => {
      deps.excluded.add('r-later')
    }

    const store = new VectorStore()
    const res = await store.backfillMissingTranscripts()

    // Only r-first ever reached the embed/INSERT; r-later was dropped by the
    // per-row recheck before its indexTranscript call.
    expect(deps.indexedRecordingIds).toEqual(['r-first'])
    expect(res.indexed).toBe(1)
    expect(res.skipped).toBe(1)
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

// ADV44-1 (round-46) — rag:status derived documentCount/meetingCount/ready from
// the RAW in-memory corpus, so soft-delete/value-exclude/personal docs (whose
// vector rows are RETAINED for restoration) inflated the counts and could make
// Chat appear "ready" with zero eligible docs. getEligibleDocumentCount /
// getEligibleMeetingCount route through the SAME fail-closed eligibility boundary
// search uses, so the status numbers match what the assistant can actually serve.
describe('VectorStore eligible counts (rag:status honesty)', () => {
  it('getEligibleDocumentCount excludes soft-deleted / personal / value-excluded chunks', async () => {
    const store = new VectorStore()
    await store.addDocument('ok chunk a', { recordingId: 'r-ok', chunkIndex: 0 })
    await store.addDocument('ok chunk b', { recordingId: 'r-ok', chunkIndex: 1 })
    await store.addDocument('excluded chunk', { recordingId: 'r-bad', chunkIndex: 0 })

    // Raw count sees every retained row…
    expect(store.getDocumentCount()).toBe(3)

    // …the eligible count drops the excluded recording's chunk.
    deps.excluded = new Set(['r-bad'])
    expect(store.getEligibleDocumentCount()).toBe(2)
  })

  it('getEligibleMeetingCount counts distinct meetings among ELIGIBLE docs only', async () => {
    const store = new VectorStore()
    await store.addDocument('a', { recordingId: 'r-ok', meetingId: 'm-1', chunkIndex: 0 })
    await store.addDocument('b', { recordingId: 'r-bad', meetingId: 'm-2', chunkIndex: 0 })

    expect(store.getMeetingCount()).toBe(2)

    deps.excluded = new Set(['r-bad'])
    expect(store.getEligibleMeetingCount()).toBe(1)
  })

  it('a hard-purged-orphan chunk (recordingId names no real recording, no capture) is not counted', async () => {
    const store = new VectorStore()
    await store.addDocument('orphan', { recordingId: 'r-purged', chunkIndex: 0 })
    // The existence probe reports r-purged is NOT a real recording (hard-purged);
    // with no eligible captureId it has no positive provenance ⇒ dropped.
    deps.existingOverride = new Set<string>() // r-purged resolves to nothing
    expect(store.getEligibleDocumentCount()).toBe(0)
    expect(store.getEligibleMeetingCount()).toBe(0)
  })

  it('fails closed to zero (docs AND meetings) when the eligibility lookup throws', async () => {
    const store = new VectorStore()
    await store.addDocument('a', { recordingId: 'r-ok', meetingId: 'm-1', chunkIndex: 0 })
    deps.throwOnExclusion = true
    expect(store.getEligibleDocumentCount()).toBe(0)
    expect(store.getEligibleMeetingCount()).toBe(0)
  })
})
