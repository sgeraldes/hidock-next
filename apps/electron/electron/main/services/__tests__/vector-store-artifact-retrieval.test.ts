// @vitest-environment node

/**
 * ADV10-P1 (round-11) regression — artifact retrieval must NOT be gated by the
 * recording allowlist.
 *
 * Background: artifact-service.ts and clipboard-capture.ts index EVERY artifact
 * kind (pdf / markdown / txt / json / image) into vector_embeddings, reusing the
 * `recording_id` column for the ARTIFACT id and ALWAYS setting `capture_id`.
 * Real-recording transcript indexing (transcription.ts, backfillMissingTranscripts)
 * NEVER sets `capture_id`. The vector store's positive recording allowlist only
 * admits ids that resolve to an EXISTING recording — an artifact id never does.
 *
 * The round-9 fix exempted only `sourceType === 'image'` from the allowlist, so
 * pdf/markdown/txt/json artifact docs were wrongly treated as recording-backed,
 * failed the positive existence check, and were dropped from vector search +
 * chunk retrieval. The fix discriminates on `captureId` (present ⇒ artifact,
 * absent ⇒ recording), which is future-proof across all artifact kinds.
 *
 * This mock models the REAL positive allowlist: an id is eligible ONLY if it is
 * a known live recording AND not excluded (value/personal/deleted) — exactly why
 * an artifact id, absent from `recordings`, would be dropped if mis-classified.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const deps = vi.hoisted(() => ({
  // Ids that resolve to a live, non-excluded recording row. An artifact id is
  // deliberately NOT a member — that absence is the crux of ADV10-P1.
  recordings: new Set<string>(),
  // Recordings that exist but are value-excluded / personal / soft-deleted.
  excluded: new Set<string>(),
  throwOnExclusion: false
}))

vi.mock('../database', () => ({
  getDatabase: () => ({ run: vi.fn(), exec: () => [], prepare: () => ({ step: () => false, free: () => {} }) }),
  getExcludedRecordingIds: () =>
    deps.throwOnExclusion ? { ids: new Set<string>(), failClosed: true } : { ids: deps.excluded, failClosed: false },
  // Faithful POSITIVE allowlist (database.ts getEligibleRecordingIds semantics):
  // eligible IFF the id resolves to an existing recording AND is not excluded.
  // A missing id (e.g. an artifact id) is NEVER eligible.
  getEligibleRecordingIds: (ids: Iterable<string>) =>
    deps.throwOnExclusion
      ? { eligible: new Set<string>(), failClosed: true }
      : {
          eligible: new Set([...ids].filter((i) => i && deps.recordings.has(i) && !deps.excluded.has(i))),
          failClosed: false
        },
  isRecordingProcessable: () => true
}))
vi.mock('../embeddings', () => ({
  getEmbeddingsService: () => ({
    generateEmbedding: async () => [1, 0, 0],
    generateEmbeddings: async (texts: string[]) => texts.map(() => [1, 0, 0])
  })
}))

import { VectorStore } from '../vector-store'

async function seed(store: VectorStore): Promise<void> {
  // A real recording transcript — recordingId set, NO captureId (transcription.ts
  // never sets captureId). It IS gated by the recording allowlist.
  await store.indexTranscript('a real meeting transcript worth indexing', {
    recordingId: 'rec-live'
  })
  // Three NON-image artifacts, indexed exactly as artifact-service.ts does:
  // recordingId = ARTIFACT id (absent from `recordings`), captureId set.
  await store.addDocument('pdf artifact text', {
    recordingId: 'art-pdf',
    captureId: 'cap-pdf',
    sourceType: 'pdf',
    chunkIndex: 0
  })
  await store.addDocument('markdown artifact text', {
    recordingId: 'art-md',
    captureId: 'cap-md',
    sourceType: 'markdown',
    chunkIndex: 0
  })
  await store.addDocument('txt artifact text', {
    recordingId: 'art-txt',
    captureId: 'cap-txt',
    sourceType: 'txt',
    chunkIndex: 0
  })
  // An image artifact — must still survive (no regression on the round-9 fix).
  await store.addDocument('image caption text', {
    recordingId: 'art-img',
    captureId: 'cap-img',
    sourceType: 'image',
    chunkIndex: 0
  })
}

beforeEach(() => {
  deps.recordings = new Set(['rec-live'])
  deps.excluded = new Set<string>()
  deps.throwOnExclusion = false
})

describe('ADV10-P1 — artifact docs are discriminated by captureId, not sourceType', () => {
  it('returns pdf/markdown/txt (and image) artifacts even though their ids are absent from recordings', async () => {
    const store = new VectorStore()
    await seed(store)

    const ids = (await store.search('anything', 10)).map((r) => r.document.metadata.recordingId).sort()
    // All four artifacts survive (NOT gated by the recording allowlist) plus the
    // live transcript. Before the fix, pdf/md/txt were dropped.
    expect(ids).toEqual(['art-img', 'art-md', 'art-pdf', 'art-txt', 'rec-live'])
  })

  it('a value-excluded (or deleted) transcript is still dropped while every artifact survives', async () => {
    const store = new VectorStore()
    await seed(store)

    // The recording becomes value-excluded / personal / soft-deleted.
    deps.excluded = new Set(['rec-live'])
    const ids = (await store.search('anything', 10)).map((r) => r.document.metadata.recordingId).sort()

    // Transcript gone; all artifacts (image + non-image) remain retrievable.
    expect(ids).toEqual(['art-img', 'art-md', 'art-pdf', 'art-txt'])
    expect(ids).not.toContain('rec-live')
  })

  it('a transcript whose recording no longer exists (hard-purged) is dropped; artifacts unaffected', async () => {
    const store = new VectorStore()
    await seed(store)

    // Simulate the recording row being gone entirely (hard purge): absent from
    // the positive allowlist ⇒ ineligible. Artifacts must not be collateral.
    deps.recordings = new Set<string>()
    const ids = (await store.search('anything', 10)).map((r) => r.document.metadata.recordingId).sort()
    expect(ids).toEqual(['art-img', 'art-md', 'art-pdf', 'art-txt'])
  })

  it('fail-closed on lookup error drops the transcript but keeps every artifact', async () => {
    const store = new VectorStore()
    await seed(store)

    deps.throwOnExclusion = true
    const ids = (await store.search('anything', 10)).map((r) => r.document.metadata.recordingId).sort()
    // Artifacts carry captureId ⇒ not recording-backed ⇒ never fail-closed-dropped.
    expect(ids).toEqual(['art-img', 'art-md', 'art-pdf', 'art-txt'])
    expect(ids).not.toContain('rec-live')
  })
})
