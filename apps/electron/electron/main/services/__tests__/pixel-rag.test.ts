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
  }),
  /** When true, the fake vision call throws (simulates quota/network failure). */
  visionFails: false,
  /** Billable vision invocations — asserts the backfill's re-billing bound. */
  visionCalls: 0,
  /**
   * ADV41-3 (round-43) — side-effect fired DURING the vision provider call, used
   * to simulate an owner exclusion committing between the vision await and the
   * subsequent write/embed. Null unless a race test sets it.
   */
  onVision: null as null | (() => void)
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

// Fake Gemini vision: counts billable calls; throws when h.visionFails; else
// returns whatever h.visionResponse holds.
vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return {
        generateContent: async () => {
          h.visionCalls++
          if (h.onVision) h.onVision()
          if (h.visionFails) throw new Error('quota exceeded (simulated)')
          return { response: { text: () => h.visionResponse } }
        }
      }
    }
  }
}))

// Deterministic embeddings so indexTranscript actually writes chunk rows.
vi.mock('../embeddings', () => ({
  getEmbeddingsService: () => ({
    generateEmbedding: async () => [0.1, 0.2, 0.3],
    generateEmbeddings: async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3]),
    activeProviderId: async () => 'mock-provider'
  })
}))

import { initializeDatabase, closeDatabase, queryOne, queryAll, run } from '../database'
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
    h.visionFails = false
    h.visionCalls = 0
    h.onVision = null
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

  // --- Backfill hardening: durable attempt state / starvation / billing bound ---
  // These tests share fixture rows created in the first test below (same DB).

  const fixtures: { healthyIds: string[]; poisonIds: string[] } = { healthyIds: [], poisonIds: [] }

  it(
    'poison captures cool down after a failed attempt — older healthy captures still progress, vision bounded',
    async () => {
    // Healthy OLDER captures: imported with no key → no vision, no text, no state.
    h.geminiKey = ''
    for (const tag of ['h1', 'h2']) {
      const r = await importArtifact(writePng(`bf-${tag}.png`, `bf-${tag}`), { title: `Healthy-${tag}.png` })
      fixtures.healthyIds.push(r.artifact.id)
    }
    // Poison NEWER captures: also imported with no key (import bills no vision).
    for (const tag of ['p1', 'p2', 'p3']) {
      const r = await importArtifact(writePng(`bf-${tag}.png`, `bf-${tag}`), { title: `Poison-${tag}.png` })
      fixtures.poisonIds.push(r.artifact.id)
    }
    // Deterministic recency: healthy strictly older than poison.
    fixtures.healthyIds.forEach((id, i) =>
      run('UPDATE artifacts SET created_at = ? WHERE id = ?', [`2026-01-01T00:00:0${i}.000Z`, id])
    )
    fixtures.poisonIds.forEach((id, i) =>
      run('UPDATE artifacts SET created_at = ? WHERE id = ?', [`2026-06-01T00:00:0${i}.000Z`, id])
    )

    // Run 1: key present but vision failing. The batch (limit 3) is exactly the
    // 3 newest eligible rows — the poison captures — and every attempt fails.
    h.geminiKey = 'test-key'
    h.visionFails = true
    h.visionCalls = 0
    const run1 = await backfillImageCaptureIndex(3)
    expect(run1.scanned).toBe(3)
    expect(run1.indexed).toBe(0)
    expect(h.visionCalls).toBe(3)

    // Each poison row now carries durable attempt state on its metadata JSON.
    for (const id of fixtures.poisonIds) {
      const row = queryOne<{ metadata: string }>('SELECT metadata FROM artifacts WHERE id = ?', [id])
      const state = JSON.parse(row!.metadata).pixelRagBackfill
      expect(state.attempts).toBe(1)
      expect(state.errorKind).toBe('VISION_FAILED')
    }

    // Run 2: vision healthy again. Poison rows are cooling down → EXCLUDED from
    // the batch; the OLDER healthy rows progress and vision bills ONLY for them.
    h.visionFails = false
    h.visionCalls = 0
    const run2 = await backfillImageCaptureIndex(3)
    expect(run2.scanned).toBe(2)
    expect(run2.indexed).toBe(2)
    expect(h.visionCalls).toBe(2)
    for (const id of fixtures.healthyIds) {
      const chunks = queryAll<{ id: string }>('SELECT id FROM vector_embeddings WHERE recording_id = ?', [id])
      expect(chunks.length).toBeGreaterThan(0)
    }
  })

  it('terminal rows are never re-billed', async () => {
    // Mark one poison row terminal (as if it exhausted its attempts).
    const terminalId = fixtures.poisonIds[0]
    const row = queryOne<{ metadata: string }>('SELECT metadata FROM artifacts WHERE id = ?', [terminalId])
    const meta = JSON.parse(row!.metadata)
    meta.pixelRagBackfill = {
      attempts: 3,
      lastAttemptAt: new Date().toISOString(),
      errorKind: 'VISION_FAILED',
      terminal: true
    }
    run('UPDATE artifacts SET metadata = ? WHERE id = ?', [JSON.stringify(meta), terminalId])

    // The remaining poison rows are still in cooldown, healthy rows are indexed
    // → NOTHING is eligible, and zero vision calls are billed.
    h.visionCalls = 0
    const res = await backfillImageCaptureIndex(10)
    expect(res.scanned).toBe(0)
    expect(h.visionCalls).toBe(0)
    const chunks = queryAll<{ id: string }>('SELECT id FROM vector_embeddings WHERE recording_id = ?', [terminalId])
    expect(chunks.length).toBe(0)
  })

  it('transient failures retry after the cooldown elapses — and success clears the state', async () => {
    // Age one poison row's attempt past the 24h cooldown.
    const retryId = fixtures.poisonIds[1]
    const row = queryOne<{ metadata: string }>('SELECT metadata FROM artifacts WHERE id = ?', [retryId])
    const meta = JSON.parse(row!.metadata)
    meta.pixelRagBackfill = {
      attempts: 1,
      lastAttemptAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      errorKind: 'VISION_FAILED'
    }
    run('UPDATE artifacts SET metadata = ? WHERE id = ?', [JSON.stringify(meta), retryId])

    h.visionCalls = 0
    const res = await backfillImageCaptureIndex(10)
    // Only the cooled-down row is eligible (the others are terminal/cooling).
    expect(res.scanned).toBe(1)
    expect(res.indexed).toBe(1)
    expect(h.visionCalls).toBe(1)

    // Success persisted the text and CLEARED the failure state.
    const after = queryOne<{ metadata: string; extracted_text: string }>(
      'SELECT metadata, extracted_text FROM artifacts WHERE id = ?',
      [retryId]
    )
    expect(after!.extracted_text).toContain('invalid password')
    expect(JSON.parse(after!.metadata).pixelRagBackfill).toBeUndefined()
  })

  it('a clean vision result with no extractable text goes terminal (billed once, never again)', async () => {
    // Import a fresh no-key capture, then age nothing — it has no state yet.
    h.geminiKey = ''
    const r = await importArtifact(writePng('bf-empty.png', 'bf-empty'), { title: 'Empty.png' })
    run('UPDATE artifacts SET created_at = ? WHERE id = ?', ['2026-06-02T00:00:00.000Z', r.artifact.id])

    // Vision succeeds but the image yields nothing.
    h.geminiKey = 'test-key'
    h.visionResponse = JSON.stringify({ description: '', tags: [] })
    h.visionCalls = 0
    const first = await backfillImageCaptureIndex(10)
    expect(first.scanned).toBe(1)
    expect(h.visionCalls).toBe(1)

    const row = queryOne<{ metadata: string }>('SELECT metadata FROM artifacts WHERE id = ?', [r.artifact.id])
    const state = JSON.parse(row!.metadata).pixelRagBackfill
    expect(state.errorKind).toBe('EMPTY_EXTRACTION')
    expect(state.terminal).toBe(true)

    // Re-running never re-bills the terminal row.
    h.visionCalls = 0
    const second = await backfillImageCaptureIndex(10)
    expect(second.scanned).toBe(0)
    expect(h.visionCalls).toBe(0)
  })

  // 520 sequential INSERTs blow the default 5s testTimeout on starved CI runners
  // (failed the beta push run of #66 at exactly this line) — same runner-speed
  // class as the #61/#66 margins, so give the test the established 20s budget.
  it(
    'SQL-side eligibility: 500+ terminal rows ahead cannot hide an older eligible capture',
    { timeout: 20000 },
    async () => {
    // 520 NEWER terminal rows — more than any scan window. Inserted directly
    // (they need no files: SQL eligibility must exclude them before retrieval).
    const terminalMeta = JSON.stringify({
      pixelRagBackfill: {
        attempts: 3,
        lastAttemptAt: new Date().toISOString(),
        errorKind: 'VISION_FAILED',
        terminal: true
      }
    })
    const wallBase = Date.UTC(2026, 5, 20, 0, 0, 0)
    for (let i = 0; i < 520; i++) {
      run(
        `INSERT INTO artifacts (id, knowledge_capture_id, kind, mime, storage_path, size,
                                content_hash, extracted_text, metadata, created_at)
         VALUES (?, NULL, 'image', 'image/png', NULL, 0, ?, NULL, ?, ?)`,
        [`term-wall-${i}`, `hash-term-wall-${i}`, terminalMeta, new Date(wallBase + i * 1000).toISOString()]
      )
    }

    // One OLDER eligible capture behind the wall. It already has extracted text,
    // so indexing it requires zero vision calls — billing must stay at 0.
    // ADV41-1 (round-43) — a backfill row MUST have a NON-NULL, eligible capture
    // to reach the providers (NULL-capture orphans are now skipped fail-closed),
    // so this row is linked to a real standalone (unrated ⇒ eligible) capture.
    run(
      `INSERT INTO knowledge_captures (id, title, category, status, quality_rating, captured_at, created_at, updated_at)
       VALUES ('cap-eligible-behind-wall', 'Dashboard screenshot', 'note', 'ready', 'unrated',
               '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z')`,
      []
    )
    run(
      `INSERT INTO artifacts (id, knowledge_capture_id, kind, mime, storage_path, size,
                              content_hash, extracted_text, metadata, created_at)
       VALUES ('eligible-behind-wall', 'cap-eligible-behind-wall', 'image', 'image/png', NULL, 0,
               'hash-eligible-behind-wall', 'Dashboard screenshot showing Q3 revenue by region', '{}',
               '2026-01-02T00:00:00.000Z')`,
      []
    )

    h.visionCalls = 0
    const res = await backfillImageCaptureIndex(5)

    // The single run walks straight past the 520 terminal rows: only the
    // eligible row is retrieved and it gets indexed — no starvation, no billing.
    expect(res.scanned).toBe(1)
    expect(res.indexed).toBe(1)
    expect(h.visionCalls).toBe(0)

    const chunks = queryAll<{ source_type: string }>(
      'SELECT source_type FROM vector_embeddings WHERE recording_id = ?',
      ['eligible-behind-wall']
    )
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks[0].source_type).toBe('image')

    // And the terminal wall is still never re-scanned on subsequent runs.
    h.visionCalls = 0
    const again = await backfillImageCaptureIndex(5)
    expect(again.scanned).toBe(0)
    expect(h.visionCalls).toBe(0)
  })

  it('ADV40 sweep (round-42) — a value-excluded image capture is NEVER re-sent to vision/embeddings', async () => {
    // Import with NO key so the capture has no extraction/embeddings — i.e. it is
    // a genuine backfill candidate by attempt-state.
    h.geminiKey = ''
    const imported = await importArtifact(writePng('shot-excluded.png', 'excluded'), { title: 'Excluded.png' })
    expect(imported.indexedChunks).toBe(0)
    expect(imported.artifact.extracted_text).toBeNull()

    // The user marks the capture value-excluded (garbage). "Excluded from all AI
    // processing" must hold: the boot backfill must not re-run vision on the
    // image nor embed its text.
    run(`UPDATE knowledge_captures SET quality_rating = 'garbage' WHERE id = ?`, [imported.knowledgeCaptureId])

    h.geminiKey = 'test-key'
    h.visionCalls = 0
    await backfillImageCaptureIndex(50)

    // Vision never populated this artifact's text, and it was never embedded —
    // proving the gate ran BEFORE both provider calls (scoped to this artifact
    // so unrelated eligible candidates in the shared DB don't affect the check).
    const art = queryOne<{ extracted_text: string | null }>(
      'SELECT extracted_text FROM artifacts WHERE id = ?',
      [imported.artifact.id]
    )
    expect(art!.extracted_text).toBeNull()
    const chunks = queryAll<{ id: string }>(
      'SELECT id FROM vector_embeddings WHERE recording_id = ?',
      [imported.artifact.id]
    )
    expect(chunks.length).toBe(0)
  })

  it('ADV41-1 (round-43, HIGH) — a NULL-capture ORPHAN image is NEVER sent to vision/embeddings', async () => {
    // An unassociable legacy/orphan image: a genuine backfill candidate by
    // attempt-state (no text, has a real file, key present) but with NO owning
    // knowledge_capture_id. Before the fix the `: true` branch retained it and it
    // reached Gemini vision + embeddings with no positive provenance. It must now
    // be skipped fail-closed BEFORE any provider call.
    const orphanFile = writePng('orphan.png', 'orphan')
    run(
      `INSERT INTO artifacts (id, knowledge_capture_id, kind, mime, storage_path, size,
                              content_hash, extracted_text, metadata, created_at)
       VALUES ('orphan-artifact', NULL, 'image', 'image/png', ?, 0,
               'hash-orphan-artifact', NULL, '{}', '2026-01-03T00:00:00.000Z')`,
      [orphanFile]
    )

    h.visionCalls = 0
    await backfillImageCaptureIndex(50)

    // ZERO vision calls attributable to the orphan, and no embeddings for it.
    const art = queryOne<{ extracted_text: string | null }>(
      'SELECT extracted_text FROM artifacts WHERE id = ?',
      ['orphan-artifact']
    )
    expect(art!.extracted_text).toBeNull()
    const chunks = queryAll<{ id: string }>(
      'SELECT id FROM vector_embeddings WHERE recording_id = ?',
      ['orphan-artifact']
    )
    expect(chunks.length).toBe(0)
  })

  it('ADV41-3 (round-43) — capture excluded BETWEEN vision and embed ⇒ no text persisted, no embedding', async () => {
    // Import with no key so the capture is a genuine backfill candidate (no text).
    h.geminiKey = ''
    const imported = await importArtifact(writePng('shot-race.png', 'race'), { title: 'Race.png' })
    expect(imported.artifact.extracted_text).toBeNull()

    // Simulate the owner marking the capture value-excluded DURING the vision
    // call: the fake vision provider fires this side-effect mid-flight, so by the
    // time the post-vision recheck runs the capture is no longer eligible.
    h.geminiKey = 'test-key'
    h.visionCalls = 0
    h.onVision = () => {
      run(`UPDATE knowledge_captures SET quality_rating = 'garbage' WHERE id = ?`, [
        imported.knowledgeCaptureId
      ])
    }

    await backfillImageCaptureIndex(50)

    // Vision ran once (the race happens DURING it), but the post-vision recheck
    // blocked the write and the embed: no extracted text persisted, no chunks.
    expect(h.visionCalls).toBeGreaterThanOrEqual(1)
    const art = queryOne<{ extracted_text: string | null }>(
      'SELECT extracted_text FROM artifacts WHERE id = ?',
      [imported.artifact.id]
    )
    expect(art!.extracted_text).toBeNull()
    const chunks = queryAll<{ id: string }>(
      'SELECT id FROM vector_embeddings WHERE recording_id = ?',
      [imported.artifact.id]
    )
    expect(chunks.length).toBe(0)
  })
})
