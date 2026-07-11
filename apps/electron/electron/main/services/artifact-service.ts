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
import { resolveGeminiApiKey } from './brains'
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
  /**
   * Title for the auto-created knowledge_capture. Defaults to the source
   * filename. Only used when a new capture is created (no knowledgeCaptureId) —
   * lets callers give, e.g., a clipboard screenshot a human title while the
   * `.png` extension still drives the Library's image source-type.
   */
  title?: string
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
 * The human caption for an image artifact — the vision model's `description`
 * (set by the `image` artifact type). Returns null for non-image kinds or when
 * no description was produced (e.g. extraction skipped for a missing Gemini key),
 * so callers fall back to the filename.
 */
function imageCaption(kind: string, metadata: Record<string, unknown>): string | null {
  if (kind !== 'image') return null
  const desc = metadata.description
  return typeof desc === 'string' && desc.trim() ? desc.trim() : null
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
        [knowledgeCaptureId, opts.title ?? filename, now, now, now]
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

  // F5 (PixelRAG): persist a screenshot/image's vision description onto the
  // capture row so the capture is searchable and citations have concise text
  // without re-reading the artifact. Reuses the existing knowledge_captures.summary
  // column (no schema bump); never overwrites a summary a user/enricher already set.
  const captionText = imageCaption(kind, metadata)
  if (captionText && knowledgeCaptureId) {
    try {
      run(
        `UPDATE knowledge_captures SET summary = ?, updated_at = ?
         WHERE id = ? AND (summary IS NULL OR TRIM(summary) = '')`,
        [captionText, now, knowledgeCaptureId]
      )
    } catch (e) {
      console.error('[ArtifactService] Failed to set capture summary:', e)
    }
  }

  // Index extracted text into embeddings by reusing the transcript indexer
  // (generic: keyed by the artifact id). Chunks are tagged with the artifact kind
  // (sourceType) and owning capture id so RAG can label + cite them — e.g. an
  // image capture surfaces as "[Screenshot: <description>]". No-op without text.
  let indexedChunks = 0
  if (extractedText && extractedText.trim().length > 0) {
    try {
      const store = getVectorStore()
      await store.initialize()
      indexedChunks = await store.indexTranscript(extractedText, {
        recordingId: id,
        timestamp: now,
        subject: captionText || filename,
        sourceType: kind,
        captureId: knowledgeCaptureId
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

export interface ImageCaptureBackfillResult {
  /** Eligible image artifacts processed this run (bounded by `limit`). */
  scanned: number
  /** Artifacts that got at least one chunk embedded. */
  indexed: number
  /** Artifacts whose vision text was (re)produced from the stored image this run. */
  extracted: number
  /** Artifacts left for a later boot (no text / no embedding backend / failure). */
  skipped: number
}

interface ImageBackfillRow {
  artifact_id: string
  knowledge_capture_id: string | null
  storage_path: string | null
  extracted_text: string | null
  metadata: string | null
  title: string | null
  summary: string | null
  captured_at: string | null
}

/**
 * Durable per-artifact backfill state, persisted under the `pixelRagBackfill`
 * key of the artifact's EXISTING metadata JSON column (no schema bump). Rows
 * with `terminal: true` or `attempts >= BACKFILL_MAX_ATTEMPTS` are never
 * vision-billed again; non-terminal failures cool down before a retry.
 */
interface PixelRagBackfillState {
  attempts: number
  lastAttemptAt: string
  errorKind?: string
  terminal?: boolean
}

const BACKFILL_STATE_KEY = 'pixelRagBackfill'
const BACKFILL_MAX_ATTEMPTS = 3
const BACKFILL_COOLDOWN_MS = 24 * 60 * 60 * 1000 // one boot-tick-per-day retry cadence

function parseMetadata(json: string | null): Record<string, unknown> {
  if (!json) return {}
  try {
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function readBackfillState(metadata: Record<string, unknown>): PixelRagBackfillState | null {
  const raw = metadata[BACKFILL_STATE_KEY]
  if (!raw || typeof raw !== 'object') return null
  const state = raw as Partial<PixelRagBackfillState>
  if (typeof state.attempts !== 'number' || typeof state.lastAttemptAt !== 'string') return null
  return state as PixelRagBackfillState
}

/**
 * A row is eligible when it has never been attempted, or its last failure is
 * non-terminal AND its cooldown has elapsed. Terminal / max-attempts rows are
 * excluded forever (never re-billed); cooling-down rows are excluded for now —
 * either way they no longer occupy the batch, so OLDER healthy rows progress.
 */
function isBackfillEligible(state: PixelRagBackfillState | null, nowMs: number): boolean {
  if (!state) return true
  if (state.terminal || state.attempts >= BACKFILL_MAX_ATTEMPTS) return false
  const last = Date.parse(state.lastAttemptAt)
  return !Number.isFinite(last) || nowMs - last >= BACKFILL_COOLDOWN_MS
}

/** Persist a (failed) attempt onto the artifact's metadata JSON. Best-effort. */
function recordBackfillAttempt(
  artifactId: string,
  metadata: Record<string, unknown>,
  errorKind: string,
  opts?: { terminal?: boolean }
): void {
  const prev = readBackfillState(metadata)
  const attempts = (prev?.attempts ?? 0) + 1
  const state: PixelRagBackfillState = {
    attempts,
    lastAttemptAt: new Date().toISOString(),
    errorKind,
    terminal: opts?.terminal || attempts >= BACKFILL_MAX_ATTEMPTS || undefined
  }
  try {
    run('UPDATE artifacts SET metadata = ? WHERE id = ?', [
      JSON.stringify({ ...metadata, [BACKFILL_STATE_KEY]: state }),
      artifactId
    ])
  } catch (e) {
    console.error(`[ArtifactService] backfill state update failed for ${artifactId}:`, e)
  }
}

/**
 * Select up to `limit` ELIGIBLE image artifacts lacking embeddings.
 *
 * Eligibility (terminal / max-attempts / cooldown) is enforced IN SQL via JSON
 * predicates on the metadata column, so ineligible rows are never retrieved at
 * all — there is no scan window that terminal/cooling rows can occupy. Any
 * number of terminal rows ahead of an older healthy capture therefore cannot
 * hide it: the query walks straight past them and the LIMIT applies to
 * eligible rows only. (A previous revision filtered eligibility in JS after an
 * OFFSET-paged retrieval capped at 500 rows, which restarted at offset 0 every
 * run — 500+ terminal rows ahead of a healthy row starved it forever.)
 *
 * The CASE expression guarantees evaluation order, so json_extract only runs
 * on rows whose metadata passed json_valid — a single row with garbage
 * metadata can never make the whole query throw (it is treated as eligible,
 * matching {@link parseMetadata}'s lenient JS behavior). Retrieved rows are
 * re-checked with {@link isBackfillEligible} as belt-and-suspenders.
 */
function selectEligibleBackfillRows(limit: number, nowMs: number): ImageBackfillRow[] {
  const cooldownCutoffIso = new Date(nowMs - BACKFILL_COOLDOWN_MS).toISOString()
  try {
    const rows = queryAll<ImageBackfillRow>(
      `SELECT a.id AS artifact_id, a.knowledge_capture_id, a.storage_path,
              a.extracted_text, a.metadata, k.title, k.summary, k.captured_at
         FROM artifacts a
         LEFT JOIN knowledge_captures k ON k.id = a.knowledge_capture_id
        WHERE a.kind = 'image'
          AND NOT EXISTS (SELECT 1 FROM vector_embeddings v WHERE v.recording_id = a.id)
          AND CASE
                WHEN a.metadata IS NULL OR json_valid(a.metadata) = 0 THEN 1
                WHEN COALESCE(json_extract(a.metadata, '$.pixelRagBackfill.terminal'), 0) = 1 THEN 0
                WHEN COALESCE(json_extract(a.metadata, '$.pixelRagBackfill.attempts'), 0) >= ? THEN 0
                WHEN json_extract(a.metadata, '$.pixelRagBackfill.lastAttemptAt') IS NULL THEN 1
                WHEN datetime(json_extract(a.metadata, '$.pixelRagBackfill.lastAttemptAt')) <= datetime(?) THEN 1
                ELSE 0
              END = 1
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ?`,
      [BACKFILL_MAX_ATTEMPTS, cooldownCutoffIso, limit]
    )
    return rows.filter((row) => isBackfillEligible(readBackfillState(parseMetadata(row.metadata)), nowMs))
  } catch (e) {
    console.error('[ArtifactService] image-capture backfill query failed:', e)
    return []
  }
}

/**
 * F5 (PixelRAG) backfill: index EXISTING image captures that have no vector
 * embeddings yet — including screenshots imported before a Gemini key existed,
 * whose vision extraction is (re)run here and persisted back onto the artifact +
 * capture. Batched (`limit` eligible rows per run) so a single boot tick stays
 * cheap, and guarded like {@link VectorStore.backfillMissingTranscripts}.
 *
 * Failure policy (billable vision calls are strictly bounded):
 *  - vision call failed → attempt recorded (cooldown, terminal after
 *    {@link BACKFILL_MAX_ATTEMPTS}); the row stops occupying the batch;
 *  - vision succeeded but the image yields no text → terminal (billed once, never again);
 *  - stored file missing → terminal without billing;
 *  - NO GEMINI KEY → vision is not attempted and NO attempt is recorded, so the
 *    rows are retried when a key appears (silent degrade);
 *  - text present but no embedding backend → no attempt recorded (nothing was
 *    billed; the persisted text is re-indexed vision-free on a later boot).
 */
export async function backfillImageCaptureIndex(limit = 10): Promise<ImageCaptureBackfillResult> {
  const result: ImageCaptureBackfillResult = { scanned: 0, indexed: 0, extracted: 0, skipped: 0 }
  if (limit <= 0) return result

  const store = getVectorStore()
  await store.initialize() // ensures vector_embeddings exists for the NOT EXISTS check

  const rows = selectEligibleBackfillRows(limit, Date.now())
  const imageType = getArtifactType('image')

  let visionKeyAvailable: boolean
  try {
    visionKeyAvailable = Boolean(resolveGeminiApiKey())
  } catch {
    visionKeyAvailable = false
  }

  for (const row of rows) {
    result.scanned++
    const baseMetadata = parseMetadata(row.metadata)
    try {
      let text = row.extracted_text && row.extracted_text.trim() ? row.extracted_text : ''
      let caption: string | null = null

      // Re-run vision extraction only when we have no stored text yet (e.g. the
      // capture predates the Gemini key). Reuses the registered image type's
      // Gemini brain path — no duplicate vision code here.
      if (!text) {
        if (!row.storage_path || !existsSync(row.storage_path)) {
          // The stored image is gone — terminal, and no vision call was billed.
          recordBackfillAttempt(row.artifact_id, baseMetadata, 'FILE_MISSING', { terminal: true })
          result.skipped++
          continue
        }
        if (!imageType || !visionKeyAvailable) {
          // No vision backend — degrade silently WITHOUT recording an attempt,
          // so these rows are retried as soon as a Gemini key is configured.
          result.skipped++
          continue
        }

        const extraction = await imageType.extractText(row.storage_path)
        text = extraction.text ?? ''
        caption = imageCaption('image', extraction.metadata ?? {})

        if (!text.trim()) {
          // The vision call ran and produced nothing: a reported error is a
          // retryable failure (cooldown → terminal after max attempts); a clean
          // empty result is terminal immediately — re-billing an image with no
          // extractable content every boot buys nothing.
          const visionError = (extraction.metadata as Record<string, unknown> | undefined)?.error
          if (visionError) {
            recordBackfillAttempt(row.artifact_id, baseMetadata, 'VISION_FAILED')
          } else {
            recordBackfillAttempt(row.artifact_id, baseMetadata, 'EMPTY_EXTRACTION', { terminal: true })
          }
          result.skipped++
          continue
        }

        result.extracted++
        try {
          // Persist the extraction merged over the existing metadata, clearing
          // any prior backfill failure state (the row succeeded).
          const merged = { ...baseMetadata, ...(extraction.metadata ?? {}) }
          delete merged[BACKFILL_STATE_KEY]
          run('UPDATE artifacts SET extracted_text = ?, metadata = ? WHERE id = ?', [
            text,
            JSON.stringify(merged),
            row.artifact_id
          ])
        } catch (e) {
          console.error('[ArtifactService] backfill artifact update failed:', e)
        }
      }

      const now = new Date().toISOString()
      if (caption && row.knowledge_capture_id) {
        try {
          run(
            `UPDATE knowledge_captures SET summary = ?, updated_at = ?
             WHERE id = ? AND (summary IS NULL OR TRIM(summary) = '')`,
            [caption, now, row.knowledge_capture_id]
          )
        } catch {
          /* best-effort summary backfill */
        }
      }

      const subject =
        caption || (row.summary && row.summary.trim() ? row.summary : row.title) || 'Screenshot'
      const count = await store.indexTranscript(text, {
        recordingId: row.artifact_id,
        timestamp: row.captured_at ?? now,
        subject,
        sourceType: 'image',
        captureId: row.knowledge_capture_id ?? undefined
      })
      if (count > 0) result.indexed++
      else result.skipped++ // no embedding backend — text is persisted; retried vision-free later
    } catch (e) {
      // Unexpected failure (extractText throw, DB error mid-row): record the
      // attempt so the row cools down instead of re-occupying every batch.
      recordBackfillAttempt(row.artifact_id, baseMetadata, 'VISION_FAILED')
      result.skipped++
      console.error(`[ArtifactService] image-capture backfill failed for ${row.artifact_id}:`, e)
    }
  }

  if (result.scanned > 0) {
    console.log(
      `[ArtifactService] image-capture backfill: ${result.indexed} indexed, ` +
        `${result.extracted} re-extracted, ${result.skipped} skipped (of ${result.scanned})`
    )
  }
  return result
}

/** Re-export so IPC/tests can resolve types without importing the registry directly. */
export { resolveType, getArtifactType }
