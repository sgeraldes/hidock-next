/**
 * Vector Store Service
 * Simple in-memory vector store with SQLite persistence for meeting transcript embeddings
 */

import { getDatabase } from './database'
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
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // Create index for faster lookups
    db.run(`CREATE INDEX IF NOT EXISTS idx_vector_embeddings_meeting ON vector_embeddings(meeting_id)`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_vector_embeddings_recording ON vector_embeddings(recording_id)`)

    // Load existing embeddings into memory
    await this.loadFromDatabase()

    this.initialized = true
    console.log(`Vector store initialized with ${this.documents.size} documents`)
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
          subject: doc['subject'] as string | undefined
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
       (id, content, embedding, meeting_id, recording_id, chunk_index, timestamp, subject)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        content,
        embeddingToBlob(embedding),
        metadata.meetingId || null,
        metadata.recordingId || null,
        metadata.chunkIndex,
        metadata.timestamp || null,
        metadata.subject || null
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
    }
  ): Promise<number> {
    // Check if already indexed
    if (metadata.recordingId) {
      const existing = Array.from(this.documents.values()).filter(
        (d) => d.metadata.recordingId === metadata.recordingId
      )
      if (existing.length > 0) {
        console.log(`Transcript ${metadata.recordingId} already indexed`)
        return 0
      }
    }

    // Chunk the transcript and embed all chunks in one batched call
    const chunks = chunkText(transcript)
    const embeddings = await getEmbeddingsService().generateEmbeddings(chunks)

    const db = getDatabase()
    let indexed = 0
    for (let i = 0; i < chunks.length; i++) {
      const embedding = embeddings[i]
      if (!embedding) continue

      const id = `${metadata.recordingId || 'doc'}_${i}_${Date.now()}`
      const doc: VectorDocument = {
        id,
        content: chunks[i],
        embedding,
        metadata: { ...metadata, chunkIndex: i }
      }
      this.documents.set(id, doc)
      db.run(
        `INSERT OR REPLACE INTO vector_embeddings
         (id, content, embedding, meeting_id, recording_id, chunk_index, timestamp, subject)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          chunks[i],
          embeddingToBlob(embedding),
          metadata.meetingId || null,
          metadata.recordingId || null,
          i,
          metadata.timestamp || null,
          metadata.subject || null
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

    // Calculate similarity scores
    const results: SearchResult[] = []

    for (const doc of this.documents.values()) {
      const score = cosineSimilarity(queryEmbedding, doc.embedding)
      results.push({ document: doc, score })
    }

    // Sort by score descending and take top K
    results.sort((a, b) => b.score - a.score)
    return results.slice(0, topK)
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
          subject: row.filename
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

export { VectorStore, chunkText, cosineSimilarity }
export type { VectorDocument, SearchResult }
