import { EventEmitter } from 'node:events'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import {
  insertKnowledgeChunk,
  getAllKnowledgeChunks,
  updateKnowledgeChunkEmbedding,
  deleteKnowledgeChunksBySource,
} from './database-queries'
import { saveDatabase } from './database'

// Types
export interface KnowledgeChunkResult {
  id: number
  sourcePath: string
  chunkIndex: number
  text: string
  score: number // cosine similarity score
}

export interface KnowledgeBaseOptions {
  chunkSize?: number       // ~500 tokens default (approx 2000 chars)
  chunkOverlap?: number    // ~50 tokens default (approx 200 chars)
  supportedExtensions?: string[]
}

const DEFAULT_OPTIONS: Required<KnowledgeBaseOptions> = {
  chunkSize: 2000,         // ~500 tokens in characters
  chunkOverlap: 200,       // ~50 tokens in characters
  supportedExtensions: ['.txt', '.md'],
}

export class KnowledgeBase extends EventEmitter {
  private options: Required<KnowledgeBaseOptions>
  private embedFn: ((text: string) => Promise<number[]>) | null = null

  constructor(options?: KnowledgeBaseOptions) {
    super()
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /** Set the embedding function (injected from ai-providers) */
  setEmbedFunction(fn: (text: string) => Promise<number[]>): void {
    this.embedFn = fn
  }

  /** Add a file or directory as a knowledge source */
  async addSource(path: string): Promise<void> {
    if (!existsSync(path)) {
      throw new Error(`[KnowledgeBase] Path does not exist: ${path}`)
    }

    const stat = statSync(path)
    if (stat.isDirectory()) {
      const files = this.collectFiles(path)
      for (const filePath of files) {
        await this.addFile(filePath)
      }
    } else if (stat.isFile()) {
      await this.addFile(path)
    }
  }

  /** Remove all chunks for a source */
  async removeSource(sourcePath: string): Promise<void> {
    deleteKnowledgeChunksBySource(sourcePath)
    saveDatabase()
    this.emit('source-removed', sourcePath)
  }

  /** Search knowledge base using cosine similarity */
  async search(query: string, topK: number = 5): Promise<KnowledgeChunkResult[]> {
    if (!this.embedFn) {
      const results = this.keywordSearch(query, topK)
      this.emit('search-complete', { query, resultCount: results.length, mode: 'keyword' })
      return results
    }

    const queryEmbedding = await this.embedFn(query)
    const chunks = getAllKnowledgeChunks()

    const scored: KnowledgeChunkResult[] = []

    for (const chunk of chunks) {
      if (!chunk.embedding) continue

      let embeddingArray: number[]
      try {
        embeddingArray = this.deserializeEmbedding(chunk.embedding as Uint8Array)
      } catch {
        continue
      }

      const score = this.cosineSimilarity(queryEmbedding, embeddingArray)
      scored.push({
        id: chunk.id,
        sourcePath: chunk.source_path,
        chunkIndex: chunk.chunk_index,
        text: chunk.text,
        score,
      })
    }

    // If no chunks have embeddings, fall back to keyword search
    if (scored.length === 0) {
      const results = this.keywordSearch(query, topK)
      this.emit('search-complete', { query, resultCount: results.length, mode: 'keyword-fallback' })
      return results
    }

    scored.sort((a, b) => b.score - a.score)
    const results = scored.slice(0, topK)

    this.emit('search-complete', { query, resultCount: results.length, mode: 'embedding' })
    return results
  }

  /** Re-index all sources (recompute embeddings) */
  async reindex(): Promise<void> {
    if (!this.embedFn) {
      console.warn('[KnowledgeBase] No embed function set; skipping reindex')
      this.emit('reindex-complete', { chunksProcessed: 0 })
      return
    }

    const chunks = getAllKnowledgeChunks()
    let processed = 0

    for (const chunk of chunks) {
      try {
        const embedding = await this.embedFn(chunk.text)
        const serialized = this.serializeEmbedding(embedding)
        updateKnowledgeChunkEmbedding(chunk.id, serialized)
        processed++
      } catch (err) {
        console.error(`[KnowledgeBase] Failed to embed chunk ${chunk.id}:`, err)
      }
    }

    saveDatabase()
    this.emit('reindex-complete', { chunksProcessed: processed })
  }

  // Private helpers

  /** Recursively collect all supported files from a directory */
  private collectFiles(dirPath: string): string[] {
    const results: string[] = []
    let entries: string[]

    try {
      entries = readdirSync(dirPath)
    } catch (err) {
      console.error(`[KnowledgeBase] Failed to read directory ${dirPath}:`, err)
      return results
    }

    for (const entry of entries) {
      const fullPath = join(dirPath, entry)
      try {
        const stat = statSync(fullPath)
        if (stat.isDirectory()) {
          results.push(...this.collectFiles(fullPath))
        } else if (stat.isFile()) {
          const ext = extname(fullPath).toLowerCase()
          if (this.options.supportedExtensions.includes(ext)) {
            results.push(fullPath)
          }
        }
      } catch (err) {
        console.warn(`[KnowledgeBase] Skipping ${fullPath}:`, err)
      }
    }

    return results
  }

  /** Process a single file: read, chunk, store, embed */
  private async addFile(filePath: string): Promise<void> {
    let content: string
    try {
      content = readFileSync(filePath, 'utf-8')
    } catch (err) {
      console.error(`[KnowledgeBase] Failed to read file ${filePath}:`, err)
      return
    }

    const chunks = this.chunkText(content)

    // Remove old chunks for this source
    deleteKnowledgeChunksBySource(filePath)

    // Insert new chunks
    const insertedIds: Array<{ id: number; text: string }> = []
    for (let i = 0; i < chunks.length; i++) {
      const chunk = insertKnowledgeChunk({
        source_path: filePath,
        chunk_index: i,
        text: chunks[i],
      })
      insertedIds.push({ id: chunk.id, text: chunk.text })
    }

    // Compute embeddings if available
    if (this.embedFn) {
      for (const { id, text } of insertedIds) {
        try {
          const embedding = await this.embedFn(text)
          const serialized = this.serializeEmbedding(embedding)
          updateKnowledgeChunkEmbedding(id, serialized)
        } catch (err) {
          console.error(`[KnowledgeBase] Failed to embed chunk ${id} from ${filePath}:`, err)
        }
      }
    }

    saveDatabase()
    this.emit('source-added', { path: filePath, chunkCount: chunks.length })
  }

  /**
   * Chunk text with overlap, respecting sentence boundaries.
   *
   * Strategy:
   * 1. Split text into sentences on `.`, `!`, `?` followed by whitespace or end.
   * 2. Accumulate sentences until the chunk reaches chunkSize characters.
   * 3. Start the next chunk with the trailing chunkOverlap characters from the
   *    previous chunk so context is preserved across boundaries.
   */
  private chunkText(text: string): string[] {
    const { chunkSize, chunkOverlap } = this.options

    // Split into sentences; keep the delimiter attached to the preceding sentence.
    const sentenceRegex = /[^.!?]*[.!?]+(?:\s+|$)/g
    const sentences: string[] = []
    let match: RegExpExecArray | null

    let lastIndex = 0
    while ((match = sentenceRegex.exec(text)) !== null) {
      sentences.push(match[0])
      lastIndex = sentenceRegex.lastIndex
    }

    // Any trailing text that didn't end with punctuation
    if (lastIndex < text.length) {
      sentences.push(text.slice(lastIndex))
    }

    // If no sentences found (e.g. very short text) return the whole text as one chunk
    if (sentences.length === 0) {
      return text.trim() ? [text.trim()] : []
    }

    const chunks: string[] = []
    let current = ''

    for (const sentence of sentences) {
      if (current.length + sentence.length > chunkSize && current.length > 0) {
        chunks.push(current.trimEnd())

        // Start next chunk with overlap from end of current chunk
        if (chunkOverlap > 0 && current.length > chunkOverlap) {
          current = current.slice(current.length - chunkOverlap) + sentence
        } else {
          current = sentence
        }
      } else {
        current += sentence
      }
    }

    if (current.trim().length > 0) {
      chunks.push(current.trimEnd())
    }

    return chunks
  }

  /** Standard cosine similarity between two equal-length vectors */
  private cosineSimilarity(a: number[], b: number[]): number {
    const len = Math.min(a.length, b.length)
    if (len === 0) return 0

    let dot = 0
    let normA = 0
    let normB = 0

    for (let i = 0; i < len; i++) {
      dot += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB)
    if (denom === 0) return 0

    return dot / denom
  }

  /** Simple keyword-based search fallback */
  private keywordSearch(query: string, topK: number): KnowledgeChunkResult[] {
    const queryWords = query
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 1)

    if (queryWords.length === 0) return []

    const chunks = getAllKnowledgeChunks()
    const scored: KnowledgeChunkResult[] = []

    for (const chunk of chunks) {
      const chunkWords = chunk.text
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 1)

      if (chunkWords.length === 0) continue

      const chunkWordSet = new Set(chunkWords)
      let matchCount = 0
      for (const word of queryWords) {
        if (chunkWordSet.has(word)) matchCount++
      }

      const score = matchCount / queryWords.length

      if (score > 0) {
        scored.push({
          id: chunk.id,
          sourcePath: chunk.source_path,
          chunkIndex: chunk.chunk_index,
          text: chunk.text,
          score,
        })
      }
    }

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, topK)
  }

  /** Serialize a float array to a Uint8Array for SQLite BLOB storage */
  private serializeEmbedding(embedding: number[]): Uint8Array {
    return new Uint8Array(new Float32Array(embedding).buffer)
  }

  /** Deserialize a SQLite BLOB back to a float array */
  private deserializeEmbedding(blob: Uint8Array): number[] {
    return Array.from(new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4))
  }
}
