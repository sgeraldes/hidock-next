/**
 * Vector Store Service
 * Simple in-memory vector store with SQLite persistence for meeting transcript embeddings
 */

import { getDatabase, getExcludedRecordingIds, isRecordingProcessable } from './database'
import { getEmbeddingsService } from './embeddings'

interface VectorDocument {
  id: string
  content: string
  embedding: number[]
  metadata: {
    meetingId?: string
    recordingId?: string
    chunkIndex: number
    timestamp?: string
    subject?: string
    /**
     * Non-transcript origin of the chunk (e.g. 'image' for a screenshot capture).
     * Absent/undefined for the legacy meeting-transcript chunks. Lets RAG label
     * an image-capture excerpt as "[Screenshot: …]" instead of "[Meeting: …]".
     */
    sourceType?: string
    /** knowledge_capture id backing this chunk, so a citation can link the source. */
    captureId?: string
  }
}

/**
 * Persist an embedding as a compact binary Float32 BLOB (4 bytes/dimension)
 * rather than a JSON text array (~13 bytes/dimension). For the 3072-dim vectors
 * this app stores that is a ~3x size reduction and was the fix for the P0 where
 * vector_embeddings alone reached 1.7 GB and crashed the database (schema v36).
 */
function embeddingToBlob(embedding: number[]): Buffer {
  return Buffer.from(new Float32Array(embedding).buffer)
}

/**
 * Decode a stored embedding back to a float array. Accepts the binary Float32
 * BLOB (Buffer/Uint8Array, current format) and legacy JSON text (rows written
 * before the v36 migration, or not yet compacted). Returns [] on anything
 * unparseable so a single bad row can never break RAG load.
 */
function blobToEmbedding(value: unknown): number[] {
  if (value == null) return []
  if (typeof value === 'string') {
    try {
      const arr = JSON.parse(value)
      return Array.isArray(arr) ? (arr as number[]) : []
    } catch {
      return []
    }
  }
  const bytes =
    value instanceof Uint8Array ? value : Buffer.isBuffer(value) ? (value as Buffer) : null
  if (!bytes) return []
  return Array.from(new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4)))
}

interface SearchResult {
  document: VectorDocument
  score: number
}

// Cosine similarity between two vectors
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  return denominator === 0 ? 0 : dotProduct / denominator
}

// Split text into chunks for embedding
function chunkText(text: string, chunkSize = 500, overlap = 50): string[] {
  const chunks: string[] = []
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0)

  let currentChunk = ''

  for (const sentence of sentences) {
    const trimmed = sentence.trim()
    if (currentChunk.length + trimmed.length > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim())
      // Keep overlap from end of previous chunk
      const words = currentChunk.split(' ')
      const overlapWords = words.slice(-Math.ceil(overlap / 10))
      currentChunk = overlapWords.join(' ') + ' ' + trimmed
    } else {
      currentChunk += (currentChunk.length > 0 ? '. ' : '') + trimmed
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim())
  }

  return chunks
}

/** Diversity reranking knobs (F5 PixelRAG — see {@link diversifyResults}). */
const DIVERSITY_CANDIDATE_MIN = 20
const DIVERSITY_CANDIDATE_FACTOR = 4
const MAX_CHUNKS_PER_CAPTURE = 2

/**
 * Light, deterministic diversity reranking over a score-sorted result list
 * (no LLM, O(candidates)). Raw cosine top-K over the shared corpus lets a few
 * near-duplicate screenshot descriptions consume the whole context window, so:
 *
 *  - a larger candidate set is considered (topK*4, min 20);
 *  - image-capture chunks are capped at {@link MAX_CHUNKS_PER_CAPTURE} per
 *    capture (near-identical chunks of one screenshot never stack);
 *  - when BOTH modalities are among the candidates, ceil(topK/2) slots are
 *    reserved for transcript chunks (images take at most topK - ceil(topK/2));
 *  - if the caps leave slots unfilled (e.g. transcripts are scarce), the
 *    best-scoring skipped chunks fill them, so topK results still come back.
 *
 * Pure-transcript queries are unchanged: with no image chunks in the candidate
 * set every cap is a no-op and the raw top-K order is returned.
 */
function diversifyResults(sorted: SearchResult[], topK: number): SearchResult[] {
  const candidates = sorted.slice(0, Math.max(topK * DIVERSITY_CANDIDATE_FACTOR, DIVERSITY_CANDIDATE_MIN))
  const hasTranscript = candidates.some((r) => r.document.metadata.sourceType !== 'image')
  const hasImage = candidates.some((r) => r.document.metadata.sourceType === 'image')
  if (!hasImage) return candidates.slice(0, topK)

  const maxImageSlots = hasTranscript ? Math.max(1, topK - Math.ceil(topK / 2)) : topK

  const selected: SearchResult[] = []
  const skipped: SearchResult[] = []
  const perCapture = new Map<string, number>()
  let imageCount = 0

  for (const result of candidates) {
    if (selected.length >= topK) break
    const meta = result.document.metadata
    if (meta.sourceType === 'image') {
      const captureKey = meta.captureId ?? meta.recordingId ?? result.document.id
      const captureCount = perCapture.get(captureKey) ?? 0
      if (imageCount >= maxImageSlots || captureCount >= MAX_CHUNKS_PER_CAPTURE) {
        skipped.push(result)
        continue
      }
      perCapture.set(captureKey, captureCount + 1)
      imageCount++
    }
    selected.push(result)
  }

  // Fill any slots the caps left open with the best skipped candidates so the
  // caller still receives topK results when the corpus allows.
  for (const result of skipped) {
    if (selected.length >= topK) break
    selected.push(result)
  }

  selected.sort((a, b) => b.score - a.score)
  return selected
}

class VectorStore {
  private documents: Map<string, VectorDocument> = new Map()
  private initialized = false

  async initialize(): Promise<void> {
    if (this.initialized) return

    const db = getDatabase()

    // Create vector_embeddings table (separate from database.ts embeddings table)
    db.run(`
      CREATE TABLE IF NOT EXISTS vector_embeddings (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        embedding TEXT NOT NULL,
        meeting_id TEXT,
        recording_id TEXT,
        chunk_index INTEGER,
        timestamp TEXT,
        subject TEXT,
        source_type TEXT,
        capture_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // Add F5 (PixelRAG) columns to a pre-existing table. This table is owned here
    // (CREATE TABLE IF NOT EXISTS, NOT the database.ts migration runner), so the
    // ALTERs are guarded by a PRAGMA check and stay idempotent on every boot.
    // FAIL-CLOSED: throws when any column is still missing afterwards, so
    // `initialized` is never set on a half-upgraded table (every later INSERT
    // references these columns — a swallowed ALTER failure would silently break
    // ALL indexing for the whole process). A throw here leaves `initialized`
    // false, so the next initialize() call retries the repair.
    this.ensureColumns(db, ['source_type', 'capture_id'])

    // Create index for faster lookups
    db.run(`CREATE INDEX IF NOT EXISTS idx_vector_embeddings_meeting ON vector_embeddings(meeting_id)`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_vector_embeddings_recording ON vector_embeddings(recording_id)`)

    // Load existing embeddings into memory
    await this.loadFromDatabase()

    this.initialized = true
    console.log(`Vector store initialized with ${this.documents.size} documents`)
  }

  /**
   * Idempotently add nullable TEXT columns to vector_embeddings, FAIL-CLOSED.
   *
   * Each ALTER is guarded by a PRAGMA check (a re-run or a DB created with the
   * column already present is a no-op — matches the database-migrations rule for
   * guarded ALTERs). After the repairs the column list is RE-READ and, if any
   * required column is still absent, this THROWS so initialize() fails before
   * setting `initialized` and can retry later. Per-column idempotence also makes
   * a partial upgrade (one of two ALTERs failed) recoverable: the next attempt
   * only adds the column that is still missing.
   */
  private ensureColumns(db: ReturnType<typeof getDatabase>, columns: string[]): void {
    const readColumns = (): string[] => {
      const info = db.exec('PRAGMA table_info(vector_embeddings)')
      return info.length > 0 ? info[0].values.map((row) => row[1] as string) : []
    }

    const existing = readColumns()
    for (const column of columns.filter((c) => !existing.includes(c))) {
      try {
        db.run(`ALTER TABLE vector_embeddings ADD COLUMN ${column} TEXT`)
      } catch (e) {
        // Logged for diagnosis; the verification below decides pass/fail so a
        // transient error on one column cannot leave a silent partial upgrade.
        console.error(`[VectorStore] ALTER ADD COLUMN ${column} failed:`, e)
      }
    }

    // Verification — fail closed if the table still lacks a required column.
    const after = readColumns()
    const stillMissing = columns.filter((c) => !after.includes(c))
    if (stillMissing.length > 0) {
      throw new Error(
        `[VectorStore] vector_embeddings is missing required column(s) after repair: ${stillMissing.join(', ')}. ` +
          'Initialization aborted so it can be retried; indexing would otherwise fail on every insert.'
      )
    }
  }

  private async loadFromDatabase(): Promise<void> {
    const db = getDatabase()
    const rows = db.exec('SELECT * FROM vector_embeddings')

    if (rows.length === 0) return

    const columns = rows[0].columns
    for (const row of rows[0].values) {
      const doc: Record<string, unknown> = {}
      columns.forEach((col, i) => {
        doc[col] = row[i]
      })

      const vectorDoc: VectorDocument = {
        id: doc['id'] as string,
        content: doc['content'] as string,
        embedding: blobToEmbedding(doc['embedding']),
        metadata: {
          meetingId: doc['meeting_id'] as string | undefined,
          recordingId: doc['recording_id'] as string | undefined,
          chunkIndex: doc['chunk_index'] as number,
          timestamp: doc['timestamp'] as string | undefined,
          subject: doc['subject'] as string | undefined,
          sourceType: (doc['source_type'] as string | undefined) || undefined,
          captureId: (doc['capture_id'] as string | undefined) || undefined
        }
      }

      this.documents.set(vectorDoc.id, vectorDoc)
    }
  }

  async addDocument(
    content: string,
    metadata: VectorDocument['metadata']
  ): Promise<string | null> {
    const embedding = await getEmbeddingsService().generateEmbedding(content)
    if (!embedding) {
      console.error('Failed to generate embedding for document')
      return null
    }

    const id = `${metadata.recordingId || 'doc'}_${metadata.chunkIndex}_${Date.now()}`

    const doc: VectorDocument = {
      id,
      content,
      embedding,
      metadata
    }

    // Store in memory
    this.documents.set(id, doc)

    // Persist to database
    const db = getDatabase()
    db.run(
      `INSERT OR REPLACE INTO vector_embeddings
       (id, content, embedding, meeting_id, recording_id, chunk_index, timestamp, subject, source_type, capture_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        content,
        embeddingToBlob(embedding),
        metadata.meetingId || null,
        metadata.recordingId || null,
        metadata.chunkIndex,
        metadata.timestamp || null,
        metadata.subject || null,
        metadata.sourceType || null,
        metadata.captureId || null
      ]
    )

    return id
  }

  async indexTranscript(
    transcript: string,
    metadata: {
      meetingId?: string
      recordingId?: string
      timestamp?: string
      subject?: string
      /** Tags every chunk with a non-transcript origin (e.g. 'image' for a screenshot). */
      sourceType?: string
      /** knowledge_capture id backing the source, carried onto every chunk. */
      captureId?: string
      /**
       * RE-1 (Codex adversarial re-review round 2) — optional eligibility gate
       * re-checked AFTER embeddings are generated (an async await) and
       * immediately BEFORE the synchronous write loop. Returns false ⇒ the
       * caller's recording became ineligible (hard purge / trash / personal)
       * while embeddings ran, so nothing is persisted (returns 0). Not stored on
       * any chunk's metadata.
       */
      shouldPersist?: () => boolean
    }
  ): Promise<number> {
    // Destructure the gate out so it never lands on a stored chunk's metadata.
    const { shouldPersist, ...chunkMeta } = metadata
    // Check if already indexed
    if (chunkMeta.recordingId) {
      const existing = Array.from(this.documents.values()).filter(
        (d) => d.metadata.recordingId === chunkMeta.recordingId
      )
      if (existing.length > 0) {
        console.log(`Transcript ${chunkMeta.recordingId} already indexed`)
        return 0
      }
    }

    // Chunk the transcript and embed all chunks in one batched call
    const chunks = chunkText(transcript)
    const embeddings = await getEmbeddingsService().generateEmbeddings(chunks)

    // RE-1 — re-check eligibility ADJACENT to the write, with no await between
    // here and the synchronous INSERT loop below. A hard purge that committed
    // while embeddings were generated must not leave orphaned vector rows.
    if (shouldPersist && !shouldPersist()) {
      console.log(`[VectorStore] ${chunkMeta.recordingId ?? 'doc'} no longer eligible — skipping index persist`)
      return 0
    }

    const db = getDatabase()
    let indexed = 0
    for (let i = 0; i < chunks.length; i++) {
      const embedding = embeddings[i]
      if (!embedding) continue

      const id = `${chunkMeta.recordingId || 'doc'}_${i}_${Date.now()}`
      const doc: VectorDocument = {
        id,
        content: chunks[i],
        embedding,
        metadata: { ...chunkMeta, chunkIndex: i }
      }
      this.documents.set(id, doc)
      db.run(
        `INSERT OR REPLACE INTO vector_embeddings
         (id, content, embedding, meeting_id, recording_id, chunk_index, timestamp, subject, source_type, capture_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          chunks[i],
          embeddingToBlob(embedding),
          chunkMeta.meetingId || null,
          chunkMeta.recordingId || null,
          i,
          chunkMeta.timestamp || null,
          chunkMeta.subject || null,
          chunkMeta.sourceType || null,
          chunkMeta.captureId || null
        ]
      )
      indexed++
    }

    console.log(`Indexed ${indexed} chunks for transcript`)
    return indexed
  }

  async search(query: string, topK = 5): Promise<SearchResult[]> {
    const queryEmbedding = await getEmbeddingsService().generateEmbedding(query)
    if (!queryEmbedding) {
      console.error('Failed to generate query embedding')
      return []
    }

    // Exclude chunks from personal ("ignored") or soft-deleted recordings so the
    // assistant never surfaces private content. Filtering at query time (rather
    // than deleting chunks) makes marking a recording personal instantly
    // effective and fully reversible without re-indexing.
    // P1 (round-3, FAIL CLOSED) — if the exclusion lookup THROWS, we cannot
    // prove any recording eligible, so drop EVERY recording-backed result
    // rather than defaulting to an empty set (fail-open would surface private
    // content on a transient DB error). Non-recording docs (no recordingId)
    // are unaffected.
    let excluded: Set<string>
    let exclusionUnavailable = false
    try {
      excluded = getExcludedRecordingIds()
    } catch (e) {
      console.error('[VectorStore] exclusion lookup FAILED — failing closed (no recording-backed results):', e)
      excluded = new Set()
      exclusionUnavailable = true
    }

    // Calculate similarity scores
    const results: SearchResult[] = []

    for (const doc of this.documents.values()) {
      const recId = doc.metadata.recordingId
      if (recId && (exclusionUnavailable || excluded.has(recId))) continue
      const score = cosineSimilarity(queryEmbedding, doc.embedding)
      results.push({ document: doc, score })
    }

    // Sort by score descending, then apply light diversity reranking so a few
    // near-duplicate screenshot descriptions cannot evict all meeting evidence.
    results.sort((a, b) => b.score - a.score)
    return diversifyResults(results, topK)
  }

  /**
   * Index every transcript that has no vector embeddings yet. Runs in the
   * background after startup so the assistant's memory covers the whole
   * knowledge base, not just newly transcribed recordings.
   */
  async backfillMissingTranscripts(): Promise<{ indexed: number; skipped: number }> {
    const db = getDatabase()
    const stmt = db.prepare(`
      SELECT t.recording_id, t.full_text, r.date_recorded, r.filename
      FROM transcripts t
      LEFT JOIN recordings r ON r.id = t.recording_id
      WHERE TRIM(COALESCE(t.full_text, '')) != ''
        AND COALESCE(r.personal, 0) = 0
        AND r.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM vector_embeddings v WHERE v.recording_id = t.recording_id
        )
    `)
    const rows: Array<{ recording_id: string; full_text: string; date_recorded?: string; filename?: string }> = []
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as never)
    }
    stmt.free()

    let indexed = 0
    let skipped = 0
    for (const row of rows) {
      try {
        const count = await this.indexTranscript(row.full_text, {
          recordingId: row.recording_id,
          timestamp: row.date_recorded,
          subject: row.filename,
          // P2 (round-3) — the SELECT above snapshotted eligibility, but a hard
          // purge / trash / mark-personal can land DURING indexTranscript's
          // embeddings await. Re-check adjacent to the write (inside
          // indexTranscript, after embeddings, before the INSERT loop) so this
          // boot backfill never re-indexes a recording made ineligible mid-run.
          shouldPersist: () => isRecordingProcessable(row.recording_id)
        })
        if (count > 0) indexed++
        else skipped++
      } catch (e) {
        skipped++
        console.error(`[VectorStore] Backfill failed for ${row.recording_id}:`, e)
      }
    }
    if (rows.length > 0) {
      console.log(`[VectorStore] Backfill complete: ${indexed} transcripts indexed, ${skipped} skipped (of ${rows.length})`)
    }
    return { indexed, skipped }
  }

  async searchByMeeting(meetingId: string): Promise<VectorDocument[]> {
    return Array.from(this.documents.values())
      .filter((d) => d.metadata.meetingId === meetingId)
      .sort((a, b) => a.metadata.chunkIndex - b.metadata.chunkIndex)
  }

  async deleteByRecording(recordingId: string): Promise<number> {
    let deleted = 0
    const db = getDatabase()

    for (const [id, doc] of this.documents.entries()) {
      if (doc.metadata.recordingId === recordingId) {
        this.documents.delete(id)
        deleted++
      }
    }

    db.run('DELETE FROM vector_embeddings WHERE recording_id = ?', [recordingId])
    return deleted
  }

  /**
   * AI-06 FIX: Update meeting_id for all chunks belonging to a recording
   * Called when AI links a recording to a meeting after transcription
   */
  async updateMeetingIdForRecording(recordingId: string, meetingId: string, meetingSubject?: string): Promise<number> {
    let updated = 0
    const db = getDatabase()

    // Update in-memory documents
    for (const doc of this.documents.values()) {
      if (doc.metadata.recordingId === recordingId) {
        doc.metadata.meetingId = meetingId
        if (meetingSubject) {
          doc.metadata.subject = meetingSubject
        }
        updated++
      }
    }

    // Update in database
    if (meetingSubject) {
      db.run(
        'UPDATE vector_embeddings SET meeting_id = ?, subject = ? WHERE recording_id = ?',
        [meetingId, meetingSubject, recordingId]
      )
    } else {
      db.run(
        'UPDATE vector_embeddings SET meeting_id = ? WHERE recording_id = ?',
        [meetingId, recordingId]
      )
    }

    console.log(`Updated meeting_id for ${updated} vector chunks (recording ${recordingId} -> meeting ${meetingId})`)
    return updated
  }

  getDocumentCount(): number {
    return this.documents.size
  }

  getMeetingCount(): number {
    const meetingIds = new Set<string>()
    for (const doc of this.documents.values()) {
      if (doc.metadata.meetingId) {
        meetingIds.add(doc.metadata.meetingId)
      }
    }
    return meetingIds.size
  }

  getAllDocuments(): VectorDocument[] {
    return Array.from(this.documents.values())
  }
}

// Singleton instance
let vectorStoreInstance: VectorStore | null = null

export function getVectorStore(): VectorStore {
  if (!vectorStoreInstance) {
    vectorStoreInstance = new VectorStore()
  }
  return vectorStoreInstance
}

export { VectorStore, chunkText, cosineSimilarity, diversifyResults }
export type { VectorDocument, SearchResult }
