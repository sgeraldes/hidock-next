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
 * The round-9 fix exempted only `sourceType === 'image'`; round-11 switched to
 * `captureId` presence. ADV11 (round-12) then found that trusting `captureId`
 * PRESENCE is a privacy bypass (a renderer can forge it). The current design
 * resolves provenance POSITIVELY against the DB: `recordingId` that names a REAL
 * recording ⇒ recording-backed (obeys the allowlist); otherwise a genuine
 * artifact ONLY when `captureId` names a REAL knowledge_captures row.
 *
 * This mock models that: existence probes (getExistingRecordingIds /
 * getExistingCaptureIds) answer IDENTITY, and the allowlist
 * (getEligibleRecordingIds) answers ELIGIBILITY, so an artifact id — absent from
 * `recordings` but present in `knowledge_captures` — is retained, while a real
 * excluded recording is dropped even with any captureId attached. The forged-
 * captureId attack itself is exercised against a REAL DB in
 * vector-store-forged-provenance.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const deps = vi.hoisted(() => ({
  // Ids that EXIST as recording rows (any state). An artifact id is deliberately
  // NOT a member — that absence is the crux of ADV10-P1 / ADV11.
  recordings: new Set<string>(),
  // Recordings that exist but are value-excluded / personal / soft-deleted.
  excluded: new Set<string>(),
  // Ids that EXIST as knowledge_captures rows (genuine artifact/capture ids).
  captures: new Set<string>(),
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
  // ADV11 (round-12) — positive-provenance existence probes. Existence is
  // IDENTITY, not eligibility: an excluded recording still EXISTS.
  getExistingRecordingIds: (ids: Iterable<string>) =>
    deps.throwOnExclusion
      ? { ids: new Set<string>(), failClosed: true }
      : { ids: new Set([...ids].filter((i) => i && deps.recordings.has(i))), failClosed: false },
  getExistingCaptureIds: (ids: Iterable<string>) =>
    deps.throwOnExclusion
      ? { ids: new Set<string>(), failClosed: true }
      : { ids: new Set([...ids].filter((i) => i && deps.captures.has(i))), failClosed: false },
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
  deps.captures = new Set(['cap-pdf', 'cap-md', 'cap-txt', 'cap-img'])
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

  it('fail-closed on lookup error drops everything that carries a recordingId', async () => {
    const store = new VectorStore()
    await seed(store)

    deps.throwOnExclusion = true
    const ids = (await store.search('anything', 10)).map((r) => r.document.metadata.recordingId).sort()
    // ADV11 (round-12) — when provenance CANNOT be resolved we can no longer tell a
    // genuine artifact from a forged chunk, so we fail closed and keep ONLY docs
    // with NO recordingId. Every seeded doc (transcript AND artifacts) carries a
    // recordingId, so the result is empty. This is stricter than round-11 (which
    // trusted captureId presence) — the whole point of the fix.
    expect(ids).toEqual([])
  })

  it('fail-closed keeps a doc that has NO recordingId', async () => {
    const store = new VectorStore()
    await store.addDocument('a general standalone note', { chunkIndex: 0 })

    deps.throwOnExclusion = true
    const contents = (await store.search('anything', 10)).map((r) => r.document.content)
    expect(contents).toEqual(['a general standalone note'])
  })
})
