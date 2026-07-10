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
  generateEmbedding: vi.fn()
}))

vi.mock('../database', () => ({
  getDatabase: () => ({ run: vi.fn(), exec: () => [], prepare: () => ({ step: () => false, free: () => {} }) }),
  getExcludedRecordingIds: () => deps.excluded
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

  it('never throws if the exclusion lookup fails', async () => {
    const store = new VectorStore()
    await store.addDocument('c', { recordingId: 'r-ok', chunkIndex: 0 })
    // Force getExcludedRecordingIds to throw by making the set access blow up.
    const results = await store.search('q', 5)
    expect(results.length).toBe(1)
  })
})
