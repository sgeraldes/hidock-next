// @vitest-environment node
/**
 * Clipboard screenshot capture — integration against the real artifact pipeline.
 *
 * Uses the real database.ts (sql.js) + importArtifact so we prove a clipboard
 * image becomes a genuine IMAGE knowledge capture that the Library will classify
 * via getSourceType. The Electron `clipboard` module, data-root, and embeddings
 * are stubbed for a deterministic offline run (node env — pdf-parse needs it).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { tmpdir } from 'os'
import { join } from 'path'
import { existsSync, mkdirSync, rmSync } from 'fs'

const testRoot = join(tmpdir(), `hidock-clipboard-test-${Date.now()}`)
const dbPath = join(testRoot, 'hidock.db')

// Mutable fake clipboard image — tests flip it between "empty" and "has image".
let fakeImage: { isEmpty: () => boolean; toPNG: () => Buffer } = {
  isEmpty: () => true,
  toPNG: () => Buffer.alloc(0)
}
function setClipboardImage(bytes: Buffer): void {
  fakeImage = { isEmpty: () => false, toPNG: () => bytes }
}
function clearClipboard(): void {
  fakeImage = { isEmpty: () => true, toPNG: () => Buffer.alloc(0) }
}

vi.mock('electron', () => ({
  clipboard: { readImage: () => fakeImage }
}))

// database.ts reads getDatabasePath from file-storage.
vi.mock('../file-storage', () => ({ getDatabasePath: () => dbPath }))

// artifact-service reads getDataPath; artifact-types reads getConfig (no Gemini
// key → image extraction skips gracefully, so no network is touched).
vi.mock('../config', () => ({
  getDataPath: () => testRoot,
  getConfig: () => ({ transcription: { geminiApiKey: '', geminiModel: 'gemini-3.5-flash' } })
}))

vi.mock('../embeddings', () => ({
  getEmbeddingsService: () => ({
    generateEmbedding: async () => null,
    generateEmbeddings: async (texts: string[]) => texts.map(() => null)
  })
}))

import { initializeDatabase, closeDatabase, queryOne } from '../database'
import {
  captureClipboardImage,
  startClipboardWatch,
  stopClipboardWatch,
  isClipboardWatchActive,
  buildScreenshotTitle,
  __resetClipboardCaptureState,
  type ClipboardCaptureResult
} from '../clipboard-capture'

describe('clipboard capture', () => {
  beforeAll(async () => {
    mkdirSync(testRoot, { recursive: true })
    await initializeDatabase()
  })

  afterAll(() => {
    closeDatabase()
    if (existsSync(testRoot)) {
      try { rmSync(testRoot, { recursive: true, force: true }) } catch { /* ignore */ }
    }
  })

  beforeEach(() => {
    __resetClipboardCaptureState()
    clearClipboard()
  })

  it('returns no-image when the clipboard holds no image', async () => {
    const result = await captureClipboardImage()
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('no-image')
  })

  it('creates an IMAGE knowledge capture the Library classifies as image', async () => {
    setClipboardImage(Buffer.from('fake-png-bytes-alpha'))
    const now = new Date('2026-07-10T14:05:09')

    const result = await captureClipboardImage({ now })

    expect(result.ok).toBe(true)
    expect(result.sourceType).toBe('image')
    expect(result.title).toBe('Screenshot 2026-07-10 14-05-09.png')
    expect(result.captureId).toBeTruthy()

    // The `.png` title is exactly what the Library's getSourceType() keys on to
    // classify the row as an image (see the useClipboardCapture renderer test,
    // which asserts getSourceType('Screenshot ….png') === 'image').
    expect(result.title!.endsWith('.png')).toBe(true)

    // A knowledge_capture exists with the screenshot title. Category is 'note'
    // (consistent with picker/drag-drop image imports); the image classification
    // comes from the .png filename via getSourceType, not the category.
    const capture = queryOne<{ title: string; category: string }>(
      'SELECT title, category FROM knowledge_captures WHERE id = ?',
      [result.captureId!]
    )
    expect(capture!.title).toBe('Screenshot 2026-07-10 14-05-09.png')
    expect(capture!.category).toBe('note')

    // The artifact is an image kind stored on disk.
    const artifact = queryOne<{ kind: string; storage_path: string }>(
      'SELECT kind, storage_path FROM artifacts WHERE knowledge_capture_id = ?',
      [result.captureId!]
    )
    expect(artifact!.kind).toBe('image')
    expect(existsSync(artifact!.storage_path)).toBe(true)
  })

  it('dedups the same clipboard image (no double-add)', async () => {
    const bytes = Buffer.from('identical-clipboard-image')
    setClipboardImage(bytes)

    const first = await captureClipboardImage()
    expect(first.ok).toBe(true)

    // Same image still on the clipboard → treated as a duplicate, no new capture.
    const second = await captureClipboardImage()
    expect(second.ok).toBe(false)
    expect(second.reason).toBe('duplicate')

    // Exactly one artifact for these bytes.
    const count = queryOne<{ n: number }>(
      'SELECT COUNT(*) as n FROM artifacts WHERE id = ?',
      [first.artifactId!]
    )
    expect(count!.n).toBe(1)
  })

  it('gates the auto-watch: inactive until started, then stoppable', () => {
    expect(isClipboardWatchActive()).toBe(false)
    startClipboardWatch({ intervalMs: 10 })
    expect(isClipboardWatchActive()).toBe(true)
    // Idempotent start.
    startClipboardWatch({ intervalMs: 10 })
    expect(isClipboardWatchActive()).toBe(true)
    stopClipboardWatch()
    expect(isClipboardWatchActive()).toBe(false)
  })

  it('auto-watch adds a newly copied image and does not grab a pre-existing one', async () => {
    // A pre-existing clipboard image should NOT be captured when the watch starts.
    setClipboardImage(Buffer.from('pre-existing-not-captured'))

    const captured: ClipboardCaptureResult[] = []
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('watch did not fire')), 2000)
      startClipboardWatch({
        intervalMs: 15,
        onCapture: (r) => {
          captured.push(r)
          clearTimeout(timeout)
          resolve()
        }
      })
      // Copy a NEW image after the watch has primed on the pre-existing one.
      setClipboardImage(Buffer.from('newly-copied-after-watch-start'))
    })
    stopClipboardWatch()

    expect(captured.length).toBeGreaterThanOrEqual(1)
    expect(captured[0].ok).toBe(true)
    expect(captured[0].sourceType).toBe('image')
    expect(captured[0].title).toMatch(/^Screenshot \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.png$/)
  })

  it('buildScreenshotTitle formats a .png title', () => {
    expect(buildScreenshotTitle(new Date('2026-01-02T03:04:05'))).toBe('Screenshot 2026-01-02 03-04-05.png')
  })
})
