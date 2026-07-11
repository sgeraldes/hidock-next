// @vitest-environment node
/**
 * F5 — PixelRAG: image/screenshot captures become first-class RAG sources.
 *
 * Integration against the real database.ts (sql.js) + the real artifact pipeline.
 * The Gemini vision SDK and the embeddings backend are stubbed so the run is
 * deterministic and offline (node env — pdf-parse needs it). Covers:
 *   - vision extraction on capture (mocked brain vision) → text + description
 *   - description persisted onto the capture row (knowledge_captures.summary)
 *   - embeddings tagged with sourceType='image' + captureId
 *   - no-Gemini-key degrade: ingestion still succeeds, nothing indexed
 *   - bounded backfill: (re)extracts + indexes existing captures, once
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'

const testRoot = join(tmpdir(), `hidock-pixelrag-test-${Date.now()}`)
const dbPath = join(testRoot, 'hidock.db')
const srcDir = join(testRoot, 'src')

// Mutable knobs shared by the mocks (hoisted so vi.mock factories can read them).
const h = vi.hoisted(() => ({
  geminiKey: 'test-key',
  visionResponse: JSON.stringify({
    description: 'A login screen showing a red "invalid password" error dialog',
    tags: ['error', 'login', 'dialog']
  })
}))

// database.ts reads getDatabasePath from file-storage.
vi.mock('../file-storage', () => ({ getDatabasePath: () => dbPath }))

// artifact-service reads getDataPath; artifact-types reads getConfig (geminiModel).
vi.mock('../config', () => ({
  getDataPath: () => testRoot,
  getConfig: () => ({ transcription: { geminiApiKey: h.geminiKey, geminiModel: 'gemini-3.5-flash' } })
}))

// The image artifact type resolves its key via the brain credential store.
vi.mock('../brains', () => ({ resolveGeminiApiKey: () => h.geminiKey }))

// Fake Gemini vision: returns whatever h.visionResponse holds.
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return {
        generateContent: async () => ({ response: { text: () => h.visionResponse } })
      }
    }
  }
}))

// Deterministic embeddings so indexTranscript actually writes chunk rows.
vi.mock('../embeddings', () => ({
  getEmbeddingsService: () => ({
    generateEmbedding: async () => [0.1, 0.2, 0.3],
    generateEmbeddings: async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])
  })
}))

import { initializeDatabase, closeDatabase, queryOne, queryAll } from '../database'
import { importArtifact, backfillImageCaptureIndex } from '../artifact-service'
import { VectorStore } from '../vector-store'

/** A distinct fake PNG buffer per test (dedup is by content hash). */
function png(tag: string): Buffer {
  return Buffer.from(`fake-png-bytes-${tag}`)
}

function writePng(name: string, tag: string): string {
  const p = join(srcDir, name)
  writeFileSync(p, png(tag))
  return p
}

describe('F5 PixelRAG — image captures as RAG sources', () => {
  beforeAll(async () => {
    mkdirSync(srcDir, { recursive: true })
    await initializeDatabase()
  })

  afterAll(() => {
    closeDatabase()
    if (existsSync(testRoot)) {
      try { rmSync(testRoot, { recursive: true, force: true }) } catch { /* ignore */ }
    }
  })

  beforeEach(() => {
    // Reset to the "key present + normal vision" default before each case.
    h.geminiKey = 'test-key'
    h.visionResponse = JSON.stringify({
      description: 'A login screen showing a red "invalid password" error dialog',
      tags: ['error', 'login', 'dialog']
    })
  })

  it('vision-extracts on capture, stores the description on the capture row, and indexes tagged chunks', async () => {
    const filePath = writePng('shot-a.png', 'a')

    const result = await importArtifact(filePath, { title: 'Screenshot A.png' })

    // 1. Extraction ran through the (mocked) Gemini brain.
    expect(result.artifact.kind).toBe('image')
    expect(result.artifact.extracted_text).toContain('invalid password')
    const meta = JSON.parse(result.artifact.metadata!) as { description?: string; source?: string }
    expect(meta.source).toBe('gemini-vision')
    expect(meta.description).toContain('invalid password')

    // 2. The description is persisted onto the capture row (reused summary column).
    const capture = queryOne<{ summary: string }>(
      'SELECT summary FROM knowledge_captures WHERE id = ?',
      [result.knowledgeCaptureId]
    )
    expect(capture!.summary).toContain('invalid password')

    // 3. Embeddings were written AND tagged as an image capture with the capture id.
    expect(result.indexedChunks).toBeGreaterThan(0)
    const chunks = queryAll<{ source_type: string; capture_id: string; subject: string }>(
      'SELECT source_type, capture_id, subject FROM vector_embeddings WHERE recording_id = ?',
      [result.artifact.id]
    )
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks[0].source_type).toBe('image')
    expect(chunks[0].capture_id).toBe(result.knowledgeCaptureId)
    expect(chunks[0].subject).toContain('invalid password')
  })

  it('restores image tags from the database on reload', async () => {
    const filePath = writePng('shot-reload.png', 'reload')
    const result = await importArtifact(filePath, { title: 'Reload.png' })
    expect(result.indexedChunks).toBeGreaterThan(0)

    // A fresh store hydrates from vector_embeddings and must carry the tags back.
    const store = new VectorStore()
    await store.initialize()
    const doc = store.getAllDocuments().find((d) => d.metadata.recordingId === result.artifact.id)
    expect(doc).toBeDefined()
    expect(doc!.metadata.sourceType).toBe('image')
    expect(doc!.metadata.captureId).toBe(result.knowledgeCaptureId)
  })

  it('degrades silently with no Gemini key — ingestion succeeds, nothing indexed', async () => {
    h.geminiKey = '' // no vision brain configured

    const filePath = writePng('shot-nokey.png', 'nokey')
    const result = await importArtifact(filePath, { title: 'NoKey.png' })

    // The artifact is stored (ingestion never blocked)...
    expect(result.artifact.kind).toBe('image')
    expect(existsSync(result.artifact.storage_path!)).toBe(true)
    // ...but with no extracted text, no summary, and no embeddings.
    expect(result.artifact.extracted_text).toBeNull()
    expect(result.indexedChunks).toBe(0)

    const capture = queryOne<{ summary: string | null }>(
      'SELECT summary FROM knowledge_captures WHERE id = ?',
      [result.knowledgeCaptureId]
    )
    expect(capture!.summary).toBeNull()

    const chunks = queryAll<{ id: string }>(
      'SELECT id FROM vector_embeddings WHERE recording_id = ?',
      [result.artifact.id]
    )
    expect(chunks.length).toBe(0)
  })

  it('backfills an existing capture that was imported before a key existed — once, bounded', async () => {
    // 1. Import with NO key: an image capture that never got extracted/indexed.
    h.geminiKey = ''
    const filePath = writePng('shot-backfill.png', 'backfill')
    const imported = await importArtifact(filePath, { title: 'Backfill.png' })
    expect(imported.artifact.extracted_text).toBeNull()
    expect(imported.indexedChunks).toBe(0)

    // 2. A key is now configured. The bounded backfill re-extracts + indexes it.
    h.geminiKey = 'test-key'
    const first = await backfillImageCaptureIndex(10)
    expect(first.extracted).toBeGreaterThanOrEqual(1)
    expect(first.indexed).toBeGreaterThanOrEqual(1)

    // Extraction + description were persisted back onto the artifact + capture.
    const artifact = queryOne<{ extracted_text: string }>(
      'SELECT extracted_text FROM artifacts WHERE id = ?',
      [imported.artifact.id]
    )
    expect(artifact!.extracted_text).toContain('invalid password')
    const capture = queryOne<{ summary: string }>(
      'SELECT summary FROM knowledge_captures WHERE id = ?',
      [imported.knowledgeCaptureId]
    )
    expect(capture!.summary).toContain('invalid password')

    // Chunks are tagged as an image capture.
    const chunks = queryAll<{ source_type: string; capture_id: string }>(
      'SELECT source_type, capture_id FROM vector_embeddings WHERE recording_id = ?',
      [imported.artifact.id]
    )
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks[0].source_type).toBe('image')
    expect(chunks[0].capture_id).toBe(imported.knowledgeCaptureId)

    // 3. Re-running the backfill does NOT touch the now-indexed capture again
    //    (an already-embedded row is excluded by the NOT EXISTS guard).
    await backfillImageCaptureIndex(10)
    const countAfter = queryAll<{ id: string }>(
      'SELECT id FROM vector_embeddings WHERE recording_id = ?',
      [imported.artifact.id]
    )
    expect(countAfter.length).toBe(chunks.length)
  })

  it('respects the backfill batch limit', async () => {
    const res = await backfillImageCaptureIndex(0)
    expect(res.scanned).toBe(0)
    expect(res.indexed).toBe(0)
  })
})
