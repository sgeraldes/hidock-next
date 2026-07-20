/**
 * Vector-store PROVIDER PARTITIONS (2026-07).
 *
 * Uses a REAL sql.js database (same pattern as the rag suites) so the schema
 * repair, provider-label backfill, and SQL persistence run for real:
 * - initialize() adds embed_provider/embed_dims columns and backfills
 *   pre-partition rows by dimension (3072⇒gemini-api, 2048⇒local-onnx-embed,
 *   768⇒ollama; unknown dims stay unservable).
 * - indexTranscript stamps every chunk with the ACTIVE provider + dims.
 * - The "already indexed" dedup is PER PARTITION: re-indexing under a second
 *   provider is the provider-switch reindex path (old partition untouched).
 * - search() scores ONLY the active provider's partition — a provider switch
 *   empties results without touching the stored chunks (instant backup).
 * - backfillMissingTranscripts targets only recordings missing FROM THE
 *   ACTIVE PARTITION.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import initSqlJs from 'sql.js'
import { join } from 'path'
import { tmpdir } from 'os'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { VECTOR_CACHE_FILENAME } from '../vector-cache'

const CACHE_DIR = join(tmpdir(), 'vs-partitions-cache-test')
const CACHE_FILE = join(CACHE_DIR, VECTOR_CACHE_FILENAME)

const deps = vi.hoisted(() => ({
  activeProvider: 'gemini-api' as string | null,
  embedCalls: [] as Array<{ texts: string[]; opts: { purpose?: string } }>,
  queryEmbedding: [1, 0, 0] as number[],
}))

vi.mock('../embeddings', () => ({
  getEmbeddingsService: () => ({
    generateEmbedding: async (text: string, opts?: { purpose?: string }) => {
      deps.embedCalls.push({ texts: [text], opts: opts ?? {} })
      return deps.queryEmbedding
    },
    generateEmbeddings: async (texts: string[], opts?: { purpose?: string }) => {
      deps.embedCalls.push({ texts, opts: opts ?? {} })
      return texts.map(() => [1, 0, 0])
    },
    activeProviderId: async () => deps.activeProvider,
  }),
}))

// Eligibility boundary: everything eligible in this suite.
vi.mock('../recording-eligibility', () => ({
  filterEligibleRecordingIds: (ids: Iterable<string>) => ({
    eligible: new Set(ids),
    failClosed: false,
  }),
  filterEligibleProvenanceRows: (rows: unknown[]) => rows,
  isRecordingEligible: () => true,
}))

let dbInstance: import('sql.js').Database | null = null
vi.mock('../database', () => ({
  getDatabase: () => dbInstance,
  getDatabasePath: () => join(CACHE_DIR, 'test.db'),
  isRecordingProcessable: () => true,
}))

import { VectorStore } from '../vector-store'

let SQL: initSqlJs.SqlJsStatic

beforeEach(async () => {
  rmSync(CACHE_DIR, { recursive: true, force: true })
  mkdirSync(CACHE_DIR, { recursive: true })
  deps.activeProvider = 'gemini-api'
  deps.embedCalls = []
  deps.queryEmbedding = [1, 0, 0]
  SQL = await initSqlJs()
  dbInstance = new SQL.Database()
})

afterEach(() => {
  dbInstance?.close()
  dbInstance = null
})

async function freshStore(): Promise<VectorStore> {
  const store = new VectorStore()
  await store.initialize()
  return store
}

describe('VectorStore provider partitions', () => {
  it('stamps chunks with the active provider + dims on insert', async () => {
    const store = await freshStore()
    const n = await store.indexTranscript('some meeting transcript text', { recordingId: 'rec-1' })
    expect(n).toBeGreaterThan(0)

    const rows = dbInstance!.exec(
      "SELECT embed_provider, embed_dims FROM vector_embeddings WHERE recording_id = 'rec-1'"
    )
    expect(rows[0].values.length).toBe(n)
    for (const [provider, dims] of rows[0].values) {
      expect(provider).toBe('gemini-api')
      expect(dims).toBe(3) // mock embedding [1,0,0]
    }
    // passage-side embedding for indexing
    expect(deps.embedCalls[0].opts.purpose).toBe('passage')
  })

  it('dedups PER PARTITION — a second provider re-indexes the same recording', async () => {
    const store = await freshStore()
    const first = await store.indexTranscript('transcript A', { recordingId: 'rec-1' })
    expect(first).toBeGreaterThan(0)
    // same provider → deduped
    expect(await store.indexTranscript('transcript A', { recordingId: 'rec-1' })).toBe(0)

    // provider switch → the recording is NOT indexed for the new partition
    deps.activeProvider = 'local-onnx-embed'
    const second = await store.indexTranscript('transcript A', { recordingId: 'rec-1' })
    expect(second).toBe(first)

    const counts = dbInstance!.exec(
      'SELECT embed_provider, COUNT(*) FROM vector_embeddings GROUP BY embed_provider ORDER BY embed_provider'
    )
    expect(counts[0].values).toEqual([
      ['gemini-api', first],
      ['local-onnx-embed', second],
    ])
  })

  it('search() scores only the ACTIVE partition — switch hides, switch back restores', async () => {
    const store = await freshStore()
    await store.indexTranscript('transcript about action items and deadlines', { recordingId: 'rec-1' })

    // active = gemini-api ⇒ results
    const hits = await store.search('action items', 5)
    expect(hits.length).toBeGreaterThan(0)
    expect(deps.embedCalls.at(-1)!.opts.purpose).toBe('query')

    // switch to a provider with no partition ⇒ empty, chunks untouched
    deps.activeProvider = 'local-onnx-embed'
    expect(await store.search('action items', 5)).toEqual([])
    expect(dbInstance!.exec('SELECT COUNT(*) FROM vector_embeddings')[0].values[0][0]).toBeGreaterThan(0)

    // switch back ⇒ results again (the backup path)
    deps.activeProvider = 'gemini-api'
    expect((await store.search('action items', 5)).length).toBeGreaterThan(0)
  })

  it('getEligibleDocumentCount is partition-aware', async () => {
    const store = await freshStore()
    await store.indexTranscript('transcript A', { recordingId: 'rec-1' })
    deps.activeProvider = 'local-onnx-embed'
    await store.indexTranscript('transcript A', { recordingId: 'rec-1' })

    const total = store.getEligibleDocumentCount()
    expect(store.getEligibleDocumentCount('gemini-api')).toBe(total / 2)
    expect(store.getEligibleDocumentCount('local-onnx-embed')).toBe(total / 2)
    expect(store.getEligibleDocumentCount('ollama')).toBe(0)
  })

  it('backfills provider labels on pre-partition rows by dimension', async () => {
    // Hand-craft a pre-partition schema + rows (no embed_provider column).
    dbInstance!.run(`
      CREATE TABLE vector_embeddings (
        id TEXT PRIMARY KEY, content TEXT NOT NULL, embedding BLOB NOT NULL,
        meeting_id TEXT, recording_id TEXT, chunk_index INTEGER,
        timestamp TEXT, subject TEXT, source_type TEXT, capture_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `)
    const blob = (dims: number) => new Uint8Array(dims * 4)
    dbInstance!.run('INSERT INTO vector_embeddings (id, content, embedding, recording_id, chunk_index) VALUES (?, ?, ?, ?, ?)', [
      'g1', 'gemini chunk', blob(3072), 'rec-g', 0,
    ])
    dbInstance!.run('INSERT INTO vector_embeddings (id, content, embedding, recording_id, chunk_index) VALUES (?, ?, ?, ?, ?)', [
      'o1', 'ollama chunk', blob(768), 'rec-o', 0,
    ])
    dbInstance!.run('INSERT INTO vector_embeddings (id, content, embedding, recording_id, chunk_index) VALUES (?, ?, ?, ?, ?)', [
      'x1', 'mystery chunk', blob(512), 'rec-x', 0,
    ])

    const store = await freshStore() // initialize runs the column repair + backfill
    // the hand-crafted docs are 3072-dim — the query embedding must match dims
    deps.queryEmbedding = new Array(3072).fill(0.01)

    const rows = dbInstance!.exec('SELECT id, embed_provider, embed_dims FROM vector_embeddings ORDER BY id')
    expect(rows[0].values).toEqual([
      ['g1', 'gemini-api', 3072],
      ['o1', 'ollama', 768],
      ['x1', null, 512], // unknown dims ⇒ labelled dims but NO provider (unservable)
    ])

    // and the partition filter honours the labels: gemini finds g1 only
    const hits = await store.search('chunk', 10)
    expect(hits.map((h) => h.document.id)).toEqual(['g1'])
  })

  it('backfillMissingTranscripts targets only the ACTIVE partition', async () => {
    dbInstance!.run(`
      CREATE TABLE transcripts (recording_id TEXT, full_text TEXT);
      CREATE TABLE recordings (id TEXT, date_recorded TEXT, filename TEXT, personal INTEGER, deleted_at TEXT);
      INSERT INTO transcripts VALUES ('rec-1', 'full transcript one');
      INSERT INTO transcripts VALUES ('rec-2', 'full transcript two');
      INSERT INTO recordings (id, personal) VALUES ('rec-1', 0), ('rec-2', 0);
    `)
    const store = await freshStore()

    // rec-1 already indexed for gemini-api
    await store.indexTranscript('full transcript one', { recordingId: 'rec-1' })
    deps.embedCalls = []

    // gemini backfill: only rec-2 is missing FROM THE GEMINI PARTITION
    let result = await store.backfillMissingTranscripts()
    expect(result.indexed).toBe(1)
    const indexedForGemini = deps.embedCalls.length
    expect(indexedForGemini).toBe(1)

    // switch provider: BOTH recordings are missing from the new partition
    deps.activeProvider = 'local-onnx-embed'
    deps.embedCalls = []
    result = await store.backfillMissingTranscripts()
    expect(result.indexed).toBe(2)
    expect(deps.embedCalls.length).toBe(2)

    // and now nothing is missing in either partition
    deps.embedCalls = []
    result = await store.backfillMissingTranscripts()
    expect(result.indexed).toBe(0)
  })

  it('second boot loads from the binary cache (same docs, zero-copy vectors, searchable)', async () => {
    const store = await freshStore()
    await store.indexTranscript('cache me please', { recordingId: 'rec-cache' })

    // let scheduleCacheWrite flush (setImmediate + file write)
    for (let i = 0; i < 100 && !existsSync(CACHE_FILE); i++) {
      await new Promise((r) => setTimeout(r, 10))
    }
    expect(existsSync(CACHE_FILE)).toBe(true)

    const store2 = new VectorStore()
    await store2.initialize()
    expect(store2.isCacheBacked()).toBe(true)
    expect(store2.getDocumentCount()).toBe(store.getEligibleDocumentCount('gemini-api'))

    const hits = await store2.search('cache me', 5)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].document.embedding).toBeInstanceOf(Float32Array)
    expect(hits[0].document.metadata.embedProvider).toBe('gemini-api')
  })

  it('a table mutation invalidates the cache and falls back to the SQL load', async () => {
    const store = await freshStore()
    await store.indexTranscript('first transcript', { recordingId: 'rec-a' })
    for (let i = 0; i < 100 && !existsSync(CACHE_FILE); i++) {
      await new Promise((r) => setTimeout(r, 10))
    }
    // mutate the table AFTER the cache was written
    await store.indexTranscript('second transcript', { recordingId: 'rec-b' })

    const store2 = new VectorStore()
    await store2.initialize()
    expect(store2.isCacheBacked()).toBe(false) // fingerprint drift ⇒ SQL fallback
    expect(store2.getDocumentCount()).toBe(store.getDocumentCount())
  })

  it('backfill is a no-op when NO provider is usable', async () => {
    deps.activeProvider = null
    dbInstance!.run(`
      CREATE TABLE transcripts (recording_id TEXT, full_text TEXT);
      CREATE TABLE recordings (id TEXT, date_recorded TEXT, filename TEXT, personal INTEGER, deleted_at TEXT);
      INSERT INTO transcripts VALUES ('rec-1', 'full transcript one');
      INSERT INTO recordings (id, personal) VALUES ('rec-1', 0);
    `)
    const store = await freshStore()
    const result = await store.backfillMissingTranscripts()
    expect(result).toEqual({ indexed: 0, skipped: 0 })
    expect(deps.embedCalls.length).toBe(0)
  })
})
