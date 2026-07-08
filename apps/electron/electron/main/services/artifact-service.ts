/**
 * Artifact Service (Layer 1 pipeline entry — C0 foundation)
 *
 * Imports a concrete file/blob into the library:
 *   sha256 → dedup by content_hash → copy into the artifacts store →
 *   type-dispatched text extraction → insert `artifacts` row →
 *   (create a knowledge_capture if none supplied) → index text into embeddings →
 *   emit `entity:artifact-ready`.
 *
 * No LLM in the fetch/store path; the only optional LLM is a type's own
 * enrichment (e.g. image description), owned by artifact-types.ts.
 */

import { createHash, randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, copyFileSync } from 'fs'
import { join, extname, basename } from 'path'
import { getDataPath } from './config'
import { queryOne, queryAll, run, runInTransaction } from './database'
import { resolveType, getArtifactType, ArtifactExtractionError } from './artifact-types'
import { getVectorStore } from './vector-store'
import { getEventBus } from './event-bus'

export interface ArtifactRow {
  id: string
  knowledge_capture_id: string | null
  kind: string
  mime: string | null
  storage_path: string | null
  size: number | null
  content_hash: string | null
  extracted_text: string | null
  metadata: string | null
  source_connector_id: string | null
  source_ref: string | null
  created_at: string
}

export interface ImportArtifactOptions {
  knowledgeCaptureId?: string
  /** Provenance for connector-fed imports (Layer 2); optional for manual imports. */
  sourceConnectorId?: string
  sourceRef?: string
}

export interface ImportArtifactResult {
  artifact: ArtifactRow
  /** True when an existing artifact with the same content_hash was returned unchanged. */
  deduped: boolean
  knowledgeCaptureId: string
  indexedChunks: number
}

/** Root for the artifacts store — mirrors file-storage's getDataPath()-based resolution. */
export function getArtifactsPath(): string {
  return join(getDataPath(), 'artifacts')
}

/**
 * Import a file as an artifact. Idempotent by content: a file whose bytes were
 * already imported returns the existing artifact (deduped: true) without copying,
 * re-extracting, or re-indexing.
 */
export async function importArtifact(
  filePath: string,
  opts: ImportArtifactOptions = {}
): Promise<ImportArtifactResult> {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`)
  }

  const buffer = readFileSync(filePath)
  const contentHash = createHash('sha256').update(buffer).digest('hex')

  // Dedup by content hash — return the existing artifact untouched.
  const existing = queryOne<ArtifactRow>('SELECT * FROM artifacts WHERE content_hash = ?', [contentHash])
  if (existing) {
    return {
      artifact: existing,
      deduped: true,
      knowledgeCaptureId: existing.knowledge_capture_id ?? '',
      indexedChunks: 0
    }
  }

  const ext = extname(filePath).replace(/^\./, '').toLowerCase()
  const type = resolveType(filePath)
  const kind = type?.kind ?? 'unknown'
  const id = randomUUID()

  // Copy into <dataRoot>/artifacts/<kind>/<hash-prefix>/<id>.<ext>
  const destDir = join(getArtifactsPath(), kind, contentHash.slice(0, 2))
  mkdirSync(destDir, { recursive: true })
  const destPath = join(destDir, ext ? `${id}.${ext}` : id)
  copyFileSync(filePath, destPath)

  // Type-dispatched extraction (+ optional enrichment). Failures are recorded on
  // the artifact's metadata rather than aborting the import.
  let extractedText: string | null = null
  const metadata: Record<string, unknown> = {}
  if (type) {
    try {
      const extraction = await type.extractText(filePath, buffer)
      extractedText = extraction.text ? extraction.text : null
      if (extraction.metadata) Object.assign(metadata, extraction.metadata)

      if (type.enrich) {
        const enriched = await type.enrich({ text: extractedText ?? '', metadata })
        if (enriched.text) extractedText = enriched.text
        if (enriched.metadata) Object.assign(metadata, enriched.metadata)
      }
    } catch (e) {
      if (e instanceof ArtifactExtractionError) {
        metadata.extractionError = e.code
        metadata.extractionMessage = e.message
      } else {
        metadata.extractionError = 'FAILED'
        metadata.extractionMessage = e instanceof Error ? e.message : String(e)
      }
    }
  } else {
    metadata.extractionError = 'NO_TYPE'
    metadata.extractionMessage = `No registered artifact type for ".${ext}"`
  }

  const mime = type?.mimes[0] ?? null
  const now = new Date().toISOString()
  const filename = basename(filePath)

  // Insert artifact + (optionally) a capture atomically.
  let knowledgeCaptureId = opts.knowledgeCaptureId
  runInTransaction(() => {
    if (!knowledgeCaptureId) {
      knowledgeCaptureId = randomUUID()
      run(
        `INSERT INTO knowledge_captures (id, title, category, status, captured_at, created_at, updated_at)
         VALUES (?, ?, 'note', 'ready', ?, ?, ?)`,
        [knowledgeCaptureId, filename, now, now, now]
      )
    }

    run(
      `INSERT INTO artifacts
         (id, knowledge_capture_id, kind, mime, storage_path, size, content_hash,
          extracted_text, metadata, source_connector_id, source_ref, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        knowledgeCaptureId,
        kind,
        mime,
        destPath,
        buffer.length,
        contentHash,
        extractedText,
        JSON.stringify(metadata),
        opts.sourceConnectorId ?? null,
        opts.sourceRef ?? null,
        now
      ]
    )
  })

  // Index extracted text into embeddings by reusing the transcript indexer
  // (generic: keyed by the artifact id, subject = filename). No-op without text.
  let indexedChunks = 0
  if (extractedText && extractedText.trim().length > 0) {
    try {
      const store = getVectorStore()
      await store.initialize()
      indexedChunks = await store.indexTranscript(extractedText, {
        recordingId: id,
        timestamp: now,
        subject: filename
      })
    } catch (e) {
      console.error('[ArtifactService] Failed to index artifact embeddings:', e)
    }
  }

  const artifact = queryOne<ArtifactRow>('SELECT * FROM artifacts WHERE id = ?', [id])
  if (!artifact) {
    throw new Error('Failed to retrieve artifact after insert')
  }

  // Layer-1 pipeline hook — emit only; graph-sync is untouched this round.
  getEventBus().emitDomainEvent({
    type: 'entity:artifact-ready',
    timestamp: now,
    payload: { artifactId: id, knowledgeCaptureId: knowledgeCaptureId!, kind, indexedChunks }
  })

  return { artifact, deduped: false, knowledgeCaptureId: knowledgeCaptureId!, indexedChunks }
}

/** All artifacts owned by a knowledge capture, oldest first. */
export function getArtifactsForCapture(knowledgeCaptureId: string): ArtifactRow[] {
  return queryAll<ArtifactRow>(
    'SELECT * FROM artifacts WHERE knowledge_capture_id = ? ORDER BY created_at ASC, id ASC',
    [knowledgeCaptureId]
  )
}

export function getArtifactById(id: string): ArtifactRow | undefined {
  return queryOne<ArtifactRow>('SELECT * FROM artifacts WHERE id = ?', [id])
}

/** Re-export so IPC/tests can resolve types without importing the registry directly. */
export { resolveType, getArtifactType }
