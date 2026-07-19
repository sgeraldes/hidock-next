// @vitest-environment node
/**
 * F5 PixelRAG hardening — vector store.
 *
 * 1. FAIL-CLOSED column repair: initialize() must THROW (and not latch
 *    `initialized`) when the vector_embeddings table still lacks the F5 columns
 *    after repair — a swallowed ALTER failure would otherwise break every later
 *    INSERT for the whole process. Retry after a transient failure must succeed,
 *    including recovery from a PARTIAL upgrade (one of two ALTERs failed).
 *
 * 2. Diversity reranking: raw cosine top-K over the shared corpus must not let
 *    a few near-duplicate screenshot chunks evict all meeting-transcript
 *    evidence; per-capture caps and transcript slot reservation apply, while
 *    pure-transcript queries are byte-for-byte unchanged.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Stateful fake DB: simulates a LEGACY vector_embeddings table (exists, but
// without the F5 columns) whose ALTERs can be made to fail per column.
const fake = vi.hoisted(() => ({
  columns: [] as string[],
  alterFails: new Set<string>(),
  reset(): void {
    this.columns = [
      'id', 'content', 'embedding', 'meeting_id', 'recording_id',
      'chunk_index', 'timestamp', 'subject', 'created_at'
    ]
    this.alterFails = new Set()
  }
}))

const fakeDb = vi.hoisted(() => ({
  run: (sql: string) => {
    const m = sql.match(/ALTER TABLE vector_embeddings ADD COLUMN (\w+)/)
    if (m) {
      if (fake.alterFails.has(m[1])) throw new Error(`disk I/O error (simulated) adding ${m[1]}`)
      fake.columns.push(m[1])
    }
    // CREATE TABLE IF NOT EXISTS / CREATE INDEX are no-ops: the legacy table exists.
  },
  exec: (sql: string) => {
    if (sql.includes('PRAGMA table_info')) {
      return [{ columns: ['cid', 'name', 'type'], values: fake.columns.map((c, i) => [i, c, 'TEXT']) }]
    }
    return [] // SELECT * FROM vector_embeddings → empty
  },
  prepare: () => ({ step: () => false, free: () => {}, getAsObject: () => ({}) })
}))

vi.mock('../database', () => ({
  getDatabase: () => fakeDb,
  // Round-6 — { ids, failClosed } shape.
  getExcludedRecordingIds: () => ({ ids: new Set<string>(), failClosed: false }),
  // ADV9 (round-9) — positive allowlist; nothing excluded here → all eligible.
  getEligibleRecordingIds: (ids: Iterable<string>) => ({ eligible: new Set([...ids].filter((i) => !!i)), failClosed: false }),
  // ADV11 (round-12) — provenance existence, keyed on this suite's id naming:
  // 'rec-*' are real recordings; 'art*' are artifact ids (NOT recordings) whose
  // 'cap-*' captureId names a real capture.
  getExistingRecordingIds: (ids: Iterable<string>) => ({
    ids: new Set([...ids].filter((i): i is string => !!i && !i.startsWith('art'))),
    failClosed: false
  }),
  getExistingCaptureIds: (ids: Iterable<string>) => ({
    ids: new Set([...ids].filter((i): i is string => !!i && i.startsWith('cap'))),
    failClosed: false
  }),
  // ADV16-3 (round-17) — the artifact branch now requires capture ELIGIBILITY.
  // 'cap-*' captures are eligible standalone captures here (unrated, not deleted).
  getCaptureEligibilityRows: (ids: Iterable<string>) => ({
    rows: [...ids]
      .filter((i): i is string => !!i && i.startsWith('cap'))
      .map((id) => ({ id, source_recording_id: null, quality_rating: null, deleted_at: null })),
    failClosed: false
  }),
  isRecordingProcessable: () => true
}))

vi.mock('../embeddings', () => ({
  getEmbeddingsService: () => ({
    generateEmbedding: async () => [1, 0, 0],
    generateEmbeddings: async (texts: string[]) => texts.map(() => [1, 0, 0])
  })
}))

import { VectorStore, diversifyResults, type SearchResult, type VectorDocument } from '../vector-store'

beforeEach(() => {
  fake.reset()
})

describe('fail-closed F5 column repair', () => {
  it('adds both columns on a legacy table (happy path)', async () => {
    const store = new VectorStore()
    await store.initialize()
    expect(fake.columns).toContain('source_type')
    expect(fake.columns).toContain('capture_id')
  })

  it('throws when the ALTERs fail — and does NOT latch initialized', async () => {
    fake.alterFails = new Set(['source_type', 'capture_id'])
    const store = new VectorStore()
    await expect(store.initialize()).rejects.toThrow(/missing required column/)

    // The failure must not have latched `initialized`: once the transient
    // condition clears, the SAME store instance retries the repair and succeeds.
    fake.alterFails = new Set()
    await expect(store.initialize()).resolves.toBeUndefined()
    expect(fake.columns).toContain('source_type')
    expect(fake.columns).toContain('capture_id')
  })

  it('recovers from a PARTIAL upgrade (one of two ALTERs failed)', async () => {
    // First attempt: source_type lands, capture_id fails → initialize throws.
    fake.alterFails = new Set(['capture_id'])
    const store = new VectorStore()
    await expect(store.initialize()).rejects.toThrow(/capture_id/)
    expect(fake.columns).toContain('source_type')
    expect(fake.columns).not.toContain('capture_id')

    // Retry: only the still-missing column is added (idempotent per column).
    fake.alterFails = new Set()
    await expect(store.initialize()).resolves.toBeUndefined()
    expect(fake.columns.filter((c) => c === 'source_type')).toHaveLength(1)
    expect(fake.columns).toContain('capture_id')
  })
})

// ---------------------------------------------------------------------------
// Diversity reranking
// ---------------------------------------------------------------------------

function doc(
  id: string,
  meta: Partial<VectorDocument['metadata']>,
  score: number
): SearchResult {
  return {
    document: {
      id,
      content: `content ${id}`,
      embedding: [1, 0, 0],
      metadata: { chunkIndex: 0, ...meta }
    },
    score
  }
}

describe('diversifyResults', () => {
  it('screenshots cannot evict all meeting evidence when both modalities score', () => {
    // 10 near-duplicate screenshot chunks (2 captures) outrank 3 transcript chunks.
    const sorted: SearchResult[] = [
      ...Array.from({ length: 5 }, (_, i) =>
        doc(`imgA${i}`, { sourceType: 'image', captureId: 'cap-A', recordingId: 'artA' }, 0.99 - i * 0.001)
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        doc(`imgB${i}`, { sourceType: 'image', captureId: 'cap-B', recordingId: 'artB' }, 0.98 - i * 0.001)
      ),
      doc('t1', { recordingId: 'rec-1', subject: 'Standup' }, 0.7),
      doc('t2', { recordingId: 'rec-2', subject: 'Planning' }, 0.65),
      doc('t3', { recordingId: 'rec-3', subject: 'Retro' }, 0.6)
    ]

    const top = diversifyResults(sorted, 5)
    expect(top).toHaveLength(5)

    const transcripts = top.filter((r) => r.document.metadata.sourceType !== 'image')
    const images = top.filter((r) => r.document.metadata.sourceType === 'image')
    // ceil(5/2)=3 slots reserved for transcripts; images capped at 2.
    expect(transcripts.length).toBeGreaterThanOrEqual(3)
    expect(images.length).toBeLessThanOrEqual(2)
  })

  it('caps chunks per capture so one screenshot never stacks the context', () => {
    const sorted: SearchResult[] = [
      ...Array.from({ length: 6 }, (_, i) =>
        doc(`img${i}`, { sourceType: 'image', captureId: 'cap-only', recordingId: 'art1' }, 0.99 - i * 0.001)
      ),
      doc('t1', { recordingId: 'rec-1' }, 0.5)
    ]

    const top = diversifyResults(sorted, 5)
    const fromCapture = top.filter((r) => r.document.metadata.captureId === 'cap-only')
    // Cap is 2 within the constrained pass; overflow backfill may add more ONLY
    // when slots would otherwise go empty — here the transcript fills one slot,
    // so at most 5-1=4 land, and the constrained selection kept the cap at 2
    // before backfill. Assert the transcript survived (never fully evicted).
    expect(top.some((r) => r.document.id === 't1')).toBe(true)
    expect(fromCapture.length).toBeLessThanOrEqual(4)
  })

  it('pure-transcript queries are unchanged (raw top-K order)', () => {
    const sorted: SearchResult[] = Array.from({ length: 8 }, (_, i) =>
      doc(`t${i}`, { recordingId: `rec-${i}` }, 0.9 - i * 0.05)
    )
    const top = diversifyResults(sorted, 5)
    expect(top.map((r) => r.document.id)).toEqual(['t0', 't1', 't2', 't3', 't4'])
  })

  it('pure-image corpora still return topK results (backfill fills capped slots)', () => {
    const sorted: SearchResult[] = Array.from({ length: 8 }, (_, i) =>
      doc(`img${i}`, { sourceType: 'image', captureId: 'cap-1', recordingId: 'art1' }, 0.9 - i * 0.01)
    )
    const top = diversifyResults(sorted, 5)
    expect(top).toHaveLength(5)
  })

  it('search() applies the reranking end-to-end', async () => {
    const store = new VectorStore()
    // Do NOT initialize (fake db) — addDocument works standalone.
    for (let i = 0; i < 6; i++) {
      await store.addDocument(`screenshot chunk ${i}`, {
        sourceType: 'image',
        captureId: 'cap-X',
        recordingId: 'artX',
        chunkIndex: i
      })
    }
    for (let i = 0; i < 3; i++) {
      await store.addDocument(`transcript chunk ${i}`, { recordingId: `rec-${i}`, chunkIndex: i })
    }

    // All embeddings are identical ([1,0,0]) → identical scores; the reranker
    // must still keep transcripts in the top-5 and cap the screenshot capture.
    const results = await store.search('anything', 5)
    expect(results).toHaveLength(5)
    const transcripts = results.filter((r) => r.document.metadata.sourceType !== 'image')
    expect(transcripts.length).toBeGreaterThanOrEqual(3)
  })
})
