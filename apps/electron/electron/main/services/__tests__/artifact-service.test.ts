// @vitest-environment node
/**
 * Artifact service + entity-type registry (C0/C1) — integration.
 *
 * Exercises the real database.ts (real sql.js engine, schema v28): registry
 * resolution, importArtifact dedup-by-hash, md/txt/pdf extraction + capture
 * creation, and getArtifactsForCapture. Embeddings + data-root are stubbed so
 * the test is deterministic and offline.
 *
 * Runs in the `node` environment (not jsdom): pdf-parse's bundled pdf.js detects
 * jsdom's `window` as a browser and demands a Worker, which is unavailable here.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createRequire } from 'module'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'

const testRoot = join(tmpdir(), `hidock-artifact-test-${Date.now()}`)
const dbPath = join(testRoot, 'hidock.db')
const srcDir = join(testRoot, 'src')

// database.ts reads getDatabasePath from file-storage.
vi.mock('../file-storage', () => ({ getDatabasePath: () => dbPath }))

// artifact-service reads getDataPath (artifacts store root); artifact-types reads
// getConfig (no Gemini key → image extraction skips gracefully).
vi.mock('../config', () => ({
  getDataPath: () => testRoot,
  getConfig: () => ({ transcription: { geminiApiKey: '', geminiModel: 'gemini-3.5-flash' } })
}))

// Keep embedding indexing offline: return nulls so indexTranscript indexes 0.
vi.mock('../embeddings', () => ({
  getEmbeddingsService: () => ({
    generateEmbedding: async () => null,
    generateEmbeddings: async (texts: string[]) => texts.map(() => null),
    activeProviderId: async () => 'mock-provider'
  })
}))

import { initializeDatabase, closeDatabase, queryOne } from '../database'
import { resolveType, getArtifactType, ArtifactExtractionError } from '../artifact-types'
import { importArtifact, getArtifactsForCapture } from '../artifact-service'

/**
 * A real, valid PDF fixture. We deliberately do NOT hand-build one: pdf-parse
 * bundles a 2018 build of pdf.js whose xref-*table* code path miscomputes offsets
 * under vitest's worker runtime (a generated table-based PDF fails with "bad XRef
 * entry", though it parses in production/native node). The bundled sample uses an
 * xref *stream*, which parses reliably everywhere — so it is the robust fixture.
 *
 * `EXPECTED_PAGES`/`EXPECTED_TITLE`/`EXPECTED_TEXT` are properties of this exact,
 * version-pinned sample shipped with pdf-parse.
 */
const require = createRequire(import.meta.url)
const SAMPLE_PDF = join(dirname(require.resolve('pdf-parse/package.json')), 'test', 'data', '04-valid.pdf')
const pdfBytes = (): Buffer => readFileSync(SAMPLE_PDF)
const EXPECTED_PAGES = 5
const EXPECTED_TITLE = 'sag-39-3-4-0902-21:sag-0'
const EXPECTED_TEXT = 'Turk J Med Sci'

describe('entity-type registry', () => {
  it('resolves by file extension', () => {
    expect(resolveType('notes.md')?.kind).toBe('md')
    expect(resolveType('C:/tmp/data.JSON')?.kind).toBe('json')
    expect(resolveType('/home/user/photo.png')?.kind).toBe('image')
    expect(resolveType('report.txt')?.kind).toBe('txt')
    expect(resolveType('doc.pdf')?.kind).toBe('pdf')
  })

  it('resolves by MIME type', () => {
    expect(resolveType('text/markdown')?.kind).toBe('md')
    expect(resolveType('application/json')?.kind).toBe('json')
    expect(resolveType('image/png')?.kind).toBe('image')
    expect(resolveType('application/pdf')?.kind).toBe('pdf')
  })

  it('returns undefined for an unknown type', () => {
    expect(resolveType('archive.zip')).toBeUndefined()
    expect(resolveType('application/x-tar')).toBeUndefined()
  })

  it('pdf extraction returns text, page count, and title from a real PDF', async () => {
    const pdf = getArtifactType('pdf')!
    const result = await pdf.extractText('doc.pdf', pdfBytes())
    expect(result.text).toContain(EXPECTED_TEXT)
    expect(result.metadata?.pageCount).toBe(EXPECTED_PAGES)
    expect(result.metadata?.title).toBe(EXPECTED_TITLE)
    expect(result.metadata?.source).toBe('pdf-parse')
  })

  it('pdf extraction fails gracefully on a corrupt file (typed error, no crash)', async () => {
    const pdf = getArtifactType('pdf')!
    const garbage = Buffer.from('this is not a pdf at all', 'utf-8')
    await expect(pdf.extractText('broken.pdf', garbage)).rejects.toBeInstanceOf(ArtifactExtractionError)
    await expect(pdf.extractText('broken.pdf', garbage)).rejects.toMatchObject({ code: 'PARSE_FAILED' })
  })

  it('image extraction skips gracefully without a Gemini key', async () => {
    const img = getArtifactType('image')!
    const result = await img.extractText(join(srcDir, 'pic.png'), Buffer.from([1, 2, 3]))
    expect(result.text).toBe('')
    expect(result.metadata?.description).toBeNull()
  })
})

describe('artifact service', () => {
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

  it('imports a markdown file, extracts text, and creates a note capture', async () => {
    const filePath = join(srcDir, 'design-notes.md')
    writeFileSync(filePath, '# Design\n\nUse dependency injection. Prefer composition.', 'utf-8')

    const result = await importArtifact(filePath)

    expect(result.deduped).toBe(false)
    expect(result.artifact.kind).toBe('md')
    expect(result.artifact.extracted_text).toContain('dependency injection')
    expect(result.artifact.content_hash).toHaveLength(64)
    expect(existsSync(result.artifact.storage_path!)).toBe(true)

    // A knowledge_capture was created with the filename as title and category 'note'.
    const capture = queryOne<{ id: string; title: string; category: string }>(
      'SELECT id, title, category FROM knowledge_captures WHERE id = ?',
      [result.knowledgeCaptureId]
    )
    expect(capture).toBeDefined()
    expect(capture!.title).toBe('design-notes.md')
    expect(capture!.category).toBe('note')
  })

  it('extracts plain text from a txt file', async () => {
    const filePath = join(srcDir, 'log.txt')
    writeFileSync(filePath, 'hello world from a plain text artifact', 'utf-8')

    const result = await importArtifact(filePath)
    expect(result.artifact.kind).toBe('txt')
    expect(result.artifact.extracted_text).toBe('hello world from a plain text artifact')
  })

  it('imports a PDF end-to-end: extracts text, records page count + title, creates a capture', async () => {
    const filePath = join(srcDir, 'report.pdf')
    writeFileSync(filePath, pdfBytes())

    const result = await importArtifact(filePath)

    expect(result.deduped).toBe(false)
    expect(result.artifact.kind).toBe('pdf')
    expect(result.artifact.mime).toBe('application/pdf')
    expect(result.artifact.extracted_text).toContain(EXPECTED_TEXT)
    expect(existsSync(result.artifact.storage_path!)).toBe(true)

    const meta = JSON.parse(result.artifact.metadata!) as { pageCount?: number; title?: string; source?: string }
    expect(meta.pageCount).toBe(EXPECTED_PAGES)
    expect(meta.title).toBe(EXPECTED_TITLE)
    expect(meta.source).toBe('pdf-parse')

    const capture = queryOne<{ id: string; title: string; category: string }>(
      'SELECT id, title, category FROM knowledge_captures WHERE id = ?',
      [result.knowledgeCaptureId]
    )
    expect(capture!.title).toBe('report.pdf')
    expect(capture!.category).toBe('note')
  })

  it('imports a corrupt PDF without crashing (empty text + extractionError note)', async () => {
    const filePath = join(srcDir, 'corrupt.pdf')
    writeFileSync(filePath, Buffer.from('%PDF-1.4 not really a pdf', 'utf-8'))

    const result = await importArtifact(filePath)

    expect(result.artifact.kind).toBe('pdf')
    expect(result.artifact.extracted_text).toBeNull()
    const meta = JSON.parse(result.artifact.metadata!) as { extractionError?: string }
    expect(meta.extractionError).toBe('PARSE_FAILED')
    // The file is still stored despite the extraction failure.
    expect(existsSync(result.artifact.storage_path!)).toBe(true)
  })

  it('dedupes by content hash (same bytes → existing artifact returned)', async () => {
    const a = join(srcDir, 'dup-a.md')
    const b = join(srcDir, 'dup-b.md')
    writeFileSync(a, 'identical content for dedup test', 'utf-8')
    writeFileSync(b, 'identical content for dedup test', 'utf-8')

    const first = await importArtifact(a)
    expect(first.deduped).toBe(false)

    const second = await importArtifact(b)
    expect(second.deduped).toBe(true)
    expect(second.artifact.id).toBe(first.artifact.id)

    const count = queryOne<{ n: number }>(
      'SELECT COUNT(*) as n FROM artifacts WHERE content_hash = ?',
      [first.artifact.content_hash]
    )
    expect(count!.n).toBe(1)
  })

  it('getArtifactsForCapture returns the capture-owned artifacts', async () => {
    const filePath = join(srcDir, 'attached.txt')
    writeFileSync(filePath, 'attached to an existing capture', 'utf-8')

    // Create a capture, then import an artifact into it.
    const captureId = 'cap-existing-1'
    const now = new Date().toISOString()
    const { run } = await import('../database')
    run(
      `INSERT INTO knowledge_captures (id, title, category, status, captured_at, created_at, updated_at)
       VALUES (?, 'Existing Capture', 'note', 'ready', ?, ?, ?)`,
      [captureId, now, now, now]
    )

    const result = await importArtifact(filePath, { knowledgeCaptureId: captureId })
    expect(result.knowledgeCaptureId).toBe(captureId)

    const artifacts = getArtifactsForCapture(captureId)
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0].id).toBe(result.artifact.id)
    expect(artifacts[0].knowledge_capture_id).toBe(captureId)
  })
})
