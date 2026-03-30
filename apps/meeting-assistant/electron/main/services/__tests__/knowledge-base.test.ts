/**
 * KnowledgeBase service tests.
 *
 * Since knowledge-base.ts uses named ESM imports from 'node:fs' (which cannot
 * be intercepted by vi.mock in native-ESM mode), these tests use the real
 * filesystem with temporary directories/files.  Only the database layer is
 * mocked so the tests remain self-contained.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as os from 'node:os'
import * as fs from 'node:fs'
import * as path from 'node:path'

// ─── Mocks (database layer only) ─────────────────────────────────────────────

vi.mock('../database-queries', () => ({
  insertKnowledgeChunk: vi.fn((params) => ({
    id: Math.floor(Math.random() * 100_000),
    source_path: params.source_path,
    chunk_index: params.chunk_index,
    text: params.text,
    embedding: null,
    updated_at: Date.now(),
  })),
  getAllKnowledgeChunks: vi.fn(() => []),
  updateKnowledgeChunkEmbedding: vi.fn(),
  deleteKnowledgeChunksBySource: vi.fn(),
}))

vi.mock('../database', () => ({
  saveDatabase: vi.fn(),
}))

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import * as dbQueries from '../database-queries'
import * as db from '../database'
import { KnowledgeBase } from '../knowledge-base'

const mockInsertKnowledgeChunk = vi.mocked(dbQueries.insertKnowledgeChunk)
const mockGetAllKnowledgeChunks = vi.mocked(dbQueries.getAllKnowledgeChunks)
const mockUpdateKnowledgeChunkEmbedding = vi.mocked(dbQueries.updateKnowledgeChunkEmbedding)
const mockDeleteKnowledgeChunksBySource = vi.mocked(dbQueries.deleteKnowledgeChunksBySource)
const mockSaveDatabase = vi.mocked(db.saveDatabase)

// ─── Temp file helpers ────────────────────────────────────────────────────────

let tmpDir: string

function createTmpFile(name: string, content: string): string {
  const filePath = path.join(tmpDir, name)
  fs.writeFileSync(filePath, content, 'utf-8')
  return filePath
}

function createTmpDir(name: string): string {
  const dirPath = path.join(tmpDir, name)
  fs.mkdirSync(dirPath, { recursive: true })
  return dirPath
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('KnowledgeBase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Create a fresh temp directory for each test
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-test-'))

    // Default insert mock
    mockInsertKnowledgeChunk.mockImplementation((params) => ({
      id: Math.floor(Math.random() * 100_000),
      source_path: params.source_path,
      chunk_index: params.chunk_index,
      text: params.text,
      embedding: null,
      updated_at: Date.now(),
    }))
    mockGetAllKnowledgeChunks.mockReturnValue([])
  })

  afterEach(() => {
    // Clean up temp directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }
  })

  // ── 1. Constructor defaults ──────────────────────────────────────────────
  describe('constructor', () => {
    it('uses default options when none provided', () => {
      const kb = new KnowledgeBase()
      expect(kb).toBeInstanceOf(KnowledgeBase)
    })

    it('accepts custom chunkSize and supportedExtensions', async () => {
      const kb = new KnowledgeBase({ chunkSize: 100, chunkOverlap: 10, supportedExtensions: ['.txt'] })
      const longText = 'Short sentence. '.repeat(20) // 320+ chars, exceeds chunkSize=100
      const filePath = createTmpFile('long.txt', longText)
      await kb.addSource(filePath)
      expect(mockInsertKnowledgeChunk.mock.calls.length).toBeGreaterThan(1)
    })
  })

  // ── 2. setEmbedFunction ──────────────────────────────────────────────────
  describe('setEmbedFunction', () => {
    it('stores and uses the provided embed function on addSource', async () => {
      const kb = new KnowledgeBase()
      const embedFn = vi.fn(async (_text: string) => [0.1, 0.2, 0.3])
      kb.setEmbedFunction(embedFn)

      const filePath = createTmpFile('file.txt', 'Sentence one. Sentence two.')
      await kb.addSource(filePath)
      expect(embedFn).toHaveBeenCalled()
    })
  })

  // ── 3. addSource (file) ──────────────────────────────────────────────────
  describe('addSource - file', () => {
    it('reads file, inserts chunks, saves database, emits source-added', async () => {
      const filePath = createTmpFile('notes.txt', 'Hello world. This is a test. Another sentence here.')
      const kb = new KnowledgeBase()
      const events: unknown[] = []
      kb.on('source-added', (e) => events.push(e))

      await kb.addSource(filePath)

      expect(mockInsertKnowledgeChunk).toHaveBeenCalled()
      expect(mockSaveDatabase).toHaveBeenCalled()
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ path: filePath })
    })

    it('clears old chunks before inserting new ones', async () => {
      const filePath = createTmpFile('notes.txt', 'Hello world.')
      const kb = new KnowledgeBase()
      await kb.addSource(filePath)
      expect(mockDeleteKnowledgeChunksBySource).toHaveBeenCalledWith(filePath)
    })

    it('passes correct source_path and chunk_index to insertKnowledgeChunk', async () => {
      const filePath = createTmpFile('notes.md', 'Content for testing.')
      const kb = new KnowledgeBase()
      await kb.addSource(filePath)

      const firstCall = mockInsertKnowledgeChunk.mock.calls[0][0]
      expect(firstCall.source_path).toBe(filePath)
      expect(firstCall.chunk_index).toBe(0)
      expect(typeof firstCall.text).toBe('string')
      expect(firstCall.text.length).toBeGreaterThan(0)
    })

    it('reports correct chunkCount in source-added event', async () => {
      const filePath = createTmpFile('multi.txt', 'First sentence. Second sentence.')
      const kb = new KnowledgeBase()
      const events: Array<{ path: string; chunkCount: number }> = []
      kb.on('source-added', (e) => events.push(e))

      await kb.addSource(filePath)
      expect(events[0].chunkCount).toBe(mockInsertKnowledgeChunk.mock.calls.length)
    })
  })

  // ── 4. addSource (directory) ─────────────────────────────────────────────
  describe('addSource - directory', () => {
    it('reads directory, processes each supported file', async () => {
      const dirPath = createTmpDir('docs')
      createTmpFile('docs/a.txt', 'Content A.')
      createTmpFile('docs/b.md', 'Content B.')
      // .png is not supported
      fs.writeFileSync(path.join(dirPath, 'c.png'), Buffer.from([0]))

      const kb = new KnowledgeBase()
      const events: unknown[] = []
      kb.on('source-added', (e) => events.push(e))

      await kb.addSource(dirPath)
      // Should process a.txt and b.md, not c.png
      expect(events).toHaveLength(2)
    })

    it('skips unsupported file extensions', async () => {
      const dirPath = createTmpDir('mixed')
      createTmpFile('mixed/a.txt', 'Only txt.')
      createTmpFile('mixed/b.md', 'Markdown file.')

      const kb = new KnowledgeBase({ supportedExtensions: ['.txt'] })
      const events: unknown[] = []
      kb.on('source-added', (e) => events.push(e))

      await kb.addSource(dirPath)
      expect(events).toHaveLength(1) // only a.txt
    })
  })

  // ── 5. addSource (nonexistent) ───────────────────────────────────────────
  describe('addSource - nonexistent path', () => {
    it('throws an error when path does not exist', async () => {
      const kb = new KnowledgeBase()
      const fakePath = path.join(tmpDir, 'nonexistent-file.txt')
      await expect(kb.addSource(fakePath)).rejects.toThrow(
        `[KnowledgeBase] Path does not exist: ${fakePath}`,
      )
    })
  })

  // ── 6. addSource with embeddings ─────────────────────────────────────────
  describe('addSource - with embed function', () => {
    it('calls embedFn for each inserted chunk and updates embeddings', async () => {
      const filePath = createTmpFile('emb.txt', 'Sentence one. Sentence two. Sentence three.')
      const kb = new KnowledgeBase()
      const embedFn = vi.fn(async (_text: string) => [0.5, 0.6, 0.7])
      kb.setEmbedFunction(embedFn)

      await kb.addSource(filePath)

      const insertCallCount = mockInsertKnowledgeChunk.mock.calls.length
      expect(insertCallCount).toBeGreaterThan(0)
      expect(embedFn).toHaveBeenCalledTimes(insertCallCount)
      expect(mockUpdateKnowledgeChunkEmbedding).toHaveBeenCalledTimes(insertCallCount)
    })
  })

  // ── 7. removeSource ──────────────────────────────────────────────────────
  describe('removeSource', () => {
    it('calls deleteKnowledgeChunksBySource, saveDatabase, emits source-removed', async () => {
      const kb = new KnowledgeBase()
      const events: unknown[] = []
      kb.on('source-removed', (e) => events.push(e))

      await kb.removeSource('/docs/old-file.txt')

      expect(mockDeleteKnowledgeChunksBySource).toHaveBeenCalledWith('/docs/old-file.txt')
      expect(mockSaveDatabase).toHaveBeenCalled()
      expect(events).toEqual(['/docs/old-file.txt'])
    })
  })

  // ── 8. search (keyword fallback) ─────────────────────────────────────────
  describe('search - keyword fallback', () => {
    it('does keyword search when no embedFn is set and emits search-complete', async () => {
      const kb = new KnowledgeBase()

      mockGetAllKnowledgeChunks.mockReturnValue([
        { id: 1, source_path: '/a.txt', chunk_index: 0, text: 'hello world example', embedding: null, updated_at: 0 },
        { id: 2, source_path: '/b.txt', chunk_index: 0, text: 'unrelated content here', embedding: null, updated_at: 0 },
      ])

      const searchEvents: unknown[] = []
      kb.on('search-complete', (e) => searchEvents.push(e))

      const results = await kb.search('hello world', 5)

      expect(results.length).toBeGreaterThan(0)
      expect(results[0].id).toBe(1)
      expect(searchEvents).toHaveLength(1)
      expect(searchEvents[0]).toMatchObject({ mode: 'keyword' })
    })

    it('returns empty array when no chunks match', async () => {
      const kb = new KnowledgeBase()
      mockGetAllKnowledgeChunks.mockReturnValue([
        { id: 1, source_path: '/a.txt', chunk_index: 0, text: 'completely different topic', embedding: null, updated_at: 0 },
      ])
      const results = await kb.search('xyz quantum')
      expect(results).toEqual([])
    })
  })

  // ── 9. search (with embeddings) ──────────────────────────────────────────
  describe('search - with embed function', () => {
    it('computes cosine similarity and returns ranked results', async () => {
      const kb = new KnowledgeBase()
      const embedFn = vi.fn(async (_text: string) => [1, 0, 0])
      kb.setEmbedFunction(embedFn)

      const makeEmbedding = (vec: number[]) =>
        new Uint8Array(new Float32Array(vec).buffer)

      mockGetAllKnowledgeChunks.mockReturnValue([
        { id: 10, source_path: '/a.txt', chunk_index: 0, text: 'relevant content', embedding: makeEmbedding([1, 0, 0]), updated_at: 0 },
        { id: 20, source_path: '/b.txt', chunk_index: 0, text: 'less relevant', embedding: makeEmbedding([0, 1, 0]), updated_at: 0 },
      ])

      const events: unknown[] = []
      kb.on('search-complete', (e) => events.push(e))

      const results = await kb.search('relevant content', 5)

      expect(results[0].id).toBe(10)
      expect(results[0].score).toBeCloseTo(1.0)
      expect(events[0]).toMatchObject({ mode: 'embedding' })
    })

    it('falls back to keyword search when no chunks have embeddings', async () => {
      const kb = new KnowledgeBase()
      const embedFn = vi.fn(async (_text: string) => [1, 0, 0])
      kb.setEmbedFunction(embedFn)

      mockGetAllKnowledgeChunks.mockReturnValue([
        { id: 1, source_path: '/a.txt', chunk_index: 0, text: 'hello world', embedding: null, updated_at: 0 },
      ])

      const events: unknown[] = []
      kb.on('search-complete', (e) => events.push(e))

      await kb.search('hello', 5)
      expect(events[0]).toMatchObject({ mode: 'keyword-fallback' })
    })
  })

  // ── 10. search emits 'search-complete' ───────────────────────────────────
  describe('search - event emission', () => {
    it('always emits search-complete with resultCount', async () => {
      const kb = new KnowledgeBase()
      mockGetAllKnowledgeChunks.mockReturnValue([])

      const events: unknown[] = []
      kb.on('search-complete', (e) => events.push(e))

      await kb.search('anything')
      expect(events).toHaveLength(1)
      expect((events[0] as { resultCount: number }).resultCount).toBeDefined()
    })
  })

  // ── 11. reindex ──────────────────────────────────────────────────────────
  describe('reindex', () => {
    it('emits reindex-complete with chunksProcessed=0 when no embedFn', async () => {
      const kb = new KnowledgeBase()
      const events: unknown[] = []
      kb.on('reindex-complete', (e) => events.push(e))

      await kb.reindex()
      expect(events).toEqual([{ chunksProcessed: 0 }])
      expect(mockUpdateKnowledgeChunkEmbedding).not.toHaveBeenCalled()
    })

    it('recomputes embeddings for all chunks when embedFn is set', async () => {
      const kb = new KnowledgeBase()
      const embedFn = vi.fn(async (_text: string) => [0.1, 0.2])
      kb.setEmbedFunction(embedFn)

      mockGetAllKnowledgeChunks.mockReturnValue([
        { id: 1, source_path: '/a.txt', chunk_index: 0, text: 'text one', embedding: null, updated_at: 0 },
        { id: 2, source_path: '/a.txt', chunk_index: 1, text: 'text two', embedding: null, updated_at: 0 },
      ])

      const events: unknown[] = []
      kb.on('reindex-complete', (e) => events.push(e))

      await kb.reindex()
      expect(embedFn).toHaveBeenCalledTimes(2)
      expect(mockUpdateKnowledgeChunkEmbedding).toHaveBeenCalledTimes(2)
      expect(mockSaveDatabase).toHaveBeenCalled()
      expect(events).toEqual([{ chunksProcessed: 2 }])
    })
  })

  // ── 12. chunkText (via addSource) ────────────────────────────────────────
  describe('chunkText - via addSource', () => {
    it('produces a single chunk for short text', async () => {
      const filePath = createTmpFile('short.txt', 'Short text.')
      const kb = new KnowledgeBase()
      await kb.addSource(filePath)
      expect(mockInsertKnowledgeChunk).toHaveBeenCalledTimes(1)
    })

    it('produces multiple chunks for text longer than chunkSize', async () => {
      const filePath = createTmpFile('chunked.txt',
        'First sentence here ends. Second sentence here ends. Third sentence here ends.',
      )
      const kb = new KnowledgeBase({ chunkSize: 50, chunkOverlap: 0 })
      await kb.addSource(filePath)
      expect(mockInsertKnowledgeChunk.mock.calls.length).toBeGreaterThan(1)
    })

    it('correctly numbers chunk_index starting from 0', async () => {
      const filePath = createTmpFile('indexed.txt',
        'Chunk one data here ends. Chunk two data here ends. Chunk three data ends.',
      )
      const kb = new KnowledgeBase({ chunkSize: 30, chunkOverlap: 0 })
      await kb.addSource(filePath)
      const indices = mockInsertKnowledgeChunk.mock.calls.map((c) => c[0].chunk_index)
      indices.forEach((idx, i) => expect(idx).toBe(i))
    })
  })
})
