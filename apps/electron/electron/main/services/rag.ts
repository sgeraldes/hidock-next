/**
 * RAG (Retrieval Augmented Generation) Service
 * Combines vector search with LLM to answer questions about meetings
 */

import { getVectorStore, SearchResult } from './vector-store'
import { getOllamaService, OllamaChatMessage } from './ollama'
import { getDatabase, queryOne, escapeLikePattern } from './database'
import { Result, success, error } from '../types/api'

interface ChatContext {
  meetingId?: string
  conversationHistory: OllamaChatMessage[]
}

interface RAGResponse {
  answer: string
  sources: Array<{
    content: string
    meetingId?: string
    subject?: string
    timestamp?: string
    score: number
  }>
  error?: string
}

const SYSTEM_PROMPT = `You are a helpful meeting assistant that answers questions based on meeting transcripts.

Your capabilities:
- Summarize discussions and decisions from meetings
- Find action items and follow-ups mentioned in meetings
- Identify key topics and themes across meetings
- Answer specific questions about what was discussed

Guidelines:
- Only answer based on the meeting transcripts provided as context
- If the context doesn't contain relevant information, say so honestly
- Be concise but thorough
- Reference specific meetings when relevant
- If asked about something not in the transcripts, acknowledge the limitation

Context from meeting transcripts will be provided with each question.`

// B-CHAT-006: Token estimation and history trimming utilities
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

export function trimHistoryByTokens(
  history: OllamaChatMessage[],
  maxTokens: number = 4096
): OllamaChatMessage[] {
  let totalTokens = 0
  const trimmed: OllamaChatMessage[] = []

  // Walk backwards through history, keeping most recent messages first
  for (let i = history.length - 1; i >= 0; i--) {
    const msgTokens = estimateTokens(history[i].content)
    if (totalTokens + msgTokens > maxTokens) break
    totalTokens += msgTokens
    trimmed.unshift(history[i])
  }

  return trimmed
}

// B-CHAT-002: LRU session cache with max size eviction
const MAX_SESSIONS = 50

class LRUSessionCache {
  private cache: Map<string, ChatContext> = new Map()
  private accessOrder: string[] = [] // Most recently accessed at end

  get(sessionId: string): ChatContext | undefined {
    const context = this.cache.get(sessionId)
    if (context) {
      // Move to end (most recently used)
      this.accessOrder = this.accessOrder.filter(id => id !== sessionId)
      this.accessOrder.push(sessionId)
    }
    return context
  }

  set(sessionId: string, context: ChatContext): void {
    // If already exists, just update
    if (this.cache.has(sessionId)) {
      this.cache.set(sessionId, context)
      this.accessOrder = this.accessOrder.filter(id => id !== sessionId)
      this.accessOrder.push(sessionId)
      return
    }

    // Evict LRU entries if at capacity
    while (this.cache.size >= MAX_SESSIONS && this.accessOrder.length > 0) {
      const lruKey = this.accessOrder.shift()!
      this.cache.delete(lruKey)
      console.log(`[RAG] LRU evicted session: ${lruKey}`)
    }

    this.cache.set(sessionId, context)
    this.accessOrder.push(sessionId)
  }

  delete(sessionId: string): boolean {
    this.accessOrder = this.accessOrder.filter(id => id !== sessionId)
    return this.cache.delete(sessionId)
  }

  get size(): number {
    return this.cache.size
  }
}

class RAGService {
  private contexts: LRUSessionCache = new LRUSessionCache()
  // B-CHAT-005: Active AbortControllers for cancellable requests
  private activeControllers: Map<string, AbortController> = new Map()

  async isReady(): Promise<{ ready: boolean; reason?: string }> {
    const ollama = getOllamaService()
    const vectorStore = getVectorStore()

    const ollamaAvailable = await ollama.isAvailable()
    if (!ollamaAvailable) {
      return { ready: false, reason: 'Ollama is not running. Start Ollama to use the chat feature.' }
    }

    const docCount = vectorStore.getDocumentCount()
    if (docCount === 0) {
      return {
        ready: false,
        reason: 'No meeting transcripts indexed yet. Record some meetings first.'
      }
    }

    return { ready: true }
  }

  async initialize(): Promise<boolean> {
    const ollama = getOllamaService()
    const vectorStore = getVectorStore()

    // Check if Ollama is available
    const available = await ollama.isAvailable()
    if (!available) {
      console.log('Ollama not available, RAG service will be limited')
      return false
    }

    // Ensure required models are available
    const models = await ollama.ensureModels()
    if (!models.embedding || !models.chat) {
      console.log('Required Ollama models not available')
      return false
    }

    // Initialize vector store
    await vectorStore.initialize()

    console.log('RAG service initialized')
    return true
  }

  async chat(
    sessionId: string,
    message: string,
    meetingFilter?: string
  ): Promise<RAGResponse> {
    const ollama = getOllamaService()
    const vectorStore = getVectorStore()

    // Validate that sessionId corresponds to a valid conversation
    try {
      const conversation = queryOne<any>('SELECT id FROM conversations WHERE id = ?', [sessionId])
      if (!conversation) {
        console.error(`RAG chat: Invalid conversation ID ${sessionId}`)
        return {
          answer: '',
          sources: [],
          error: 'Invalid conversation ID. Please create a new conversation.'
        }
      }
    } catch (error) {
      console.error('RAG chat: Failed to validate conversation:', error)
      return {
        answer: '',
        sources: [],
        error: 'Failed to validate conversation. Please try again.'
      }
    }

    // B-CHAT-005: Create AbortController for this request
    // Cancel any existing in-flight request for this session
    const existingController = this.activeControllers.get(sessionId)
    if (existingController) {
      existingController.abort()
    }
    const controller = new AbortController()
    this.activeControllers.set(sessionId, controller)

    // Get or create session context (LRU cache)
    let context = this.contexts.get(sessionId)
    if (!context) {
      context = { conversationHistory: [] }
      this.contexts.set(sessionId, context)
    }

    // Apply meeting filter if specified
    if (meetingFilter) {
      context.meetingId = meetingFilter
    }

    // Search for relevant context
    let searchResults: SearchResult[]
    if (context.meetingId) {
      // Search within specific meeting
      const docs = await vectorStore.searchByMeeting(context.meetingId)
      const queryEmbedding = await ollama.generateEmbedding(message)
      if (queryEmbedding) {
        // Re-rank by actual query relevance using cosine similarity
        searchResults = docs.map((doc) => {
          let score = 0.5 // Default if embedding comparison fails
          if (doc.embedding && doc.embedding.length === queryEmbedding.length) {
            let dotProduct = 0, normA = 0, normB = 0
            for (let i = 0; i < queryEmbedding.length; i++) {
              dotProduct += queryEmbedding[i] * doc.embedding[i]
              normA += queryEmbedding[i] * queryEmbedding[i]
              normB += doc.embedding[i] * doc.embedding[i]
            }
            const denominator = Math.sqrt(normA) * Math.sqrt(normB)
            score = denominator === 0 ? 0 : dotProduct / denominator
          }
          return { document: doc, score }
        })
        // Sort by actual relevance
        searchResults.sort((a, b) => b.score - a.score)
      } else {
        searchResults = docs.map((doc) => ({ document: doc, score: 0.5 }))
      }
      searchResults = searchResults.slice(0, 5)
    } else {
      // Global search
      searchResults = await vectorStore.search(message, 5)
    }

    // --- Added: Fetch explicit conversation context ---
    const pinnedContextParts: string[] = []
    try {
      const db = getDatabase()
      if (db) {
        // Get knowledge captures attached to this conversation
        const contextRes = db.exec('SELECT knowledge_capture_id FROM conversation_context WHERE conversation_id = ?', [sessionId])
        if (contextRes && contextRes.length > 0 && contextRes[0].values && contextRes[0].values.length > 0) {
          const kcIds = contextRes[0].values.map(v => v[0] as string)
          for (const id of kcIds) {
            // Fetch the full transcript for each pinned knowledge capture
            const transcriptRes = db.exec(`
              SELECT t.full_text, k.title 
              FROM transcripts t
              JOIN knowledge_captures k ON k.source_recording_id = t.recording_id
              WHERE k.id = ?
            `, [id])
            
            if (transcriptRes && transcriptRes.length > 0 && transcriptRes[0].values && transcriptRes[0].values.length > 0) {
              const [text, title] = transcriptRes[0].values[0] as [string, string]
              pinnedContextParts.push(`[PINNED CONTEXT: ${title}]\n${text}`)
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch pinned context:', error)
    }
    // ------------------------------------------------

    // Build context from search results
    const contextParts: string[] = []
    const sources: RAGResponse['sources'] = []

    for (const result of searchResults) {
      if (result.score < 0.3) continue // Skip low-relevance results

      const { document: doc, score } = result
      const meetingInfo = doc.metadata.subject
        ? `Meeting: ${doc.metadata.subject}`
        : doc.metadata.meetingId
          ? `Meeting ID: ${doc.metadata.meetingId}`
          : 'Unknown meeting'

      const dateInfo = doc.metadata.timestamp
        ? ` (${new Date(doc.metadata.timestamp).toLocaleDateString()})`
        : ''

      contextParts.push(`[${meetingInfo}${dateInfo}]\n${doc.content}`)
      sources.push({
        content: doc.content.substring(0, 200) + (doc.content.length > 200 ? '...' : ''),
        meetingId: doc.metadata.meetingId,
        subject: doc.metadata.subject,
        timestamp: doc.metadata.timestamp,
        score
      })
    }

    // Combine pinned context and search results
    const allContextParts = [...pinnedContextParts, ...contextParts]

    // Prepare messages
    const contextText =
      allContextParts.length > 0
        ? `Here are relevant excerpts from meeting transcripts and pinned knowledge base items:\n\n${allContextParts.join('\n\n---\n\n')}`
        : 'No relevant meeting transcripts found for this query.'

    const userMessage = `Context:\n${contextText}\n\nQuestion: ${message}`

    // B-CHAT-006: Build messages for LLM with token-aware trimming
    const trimmedHistory = trimHistoryByTokens(context.conversationHistory, 4096)
    const messages: OllamaChatMessage[] = [
      ...trimmedHistory,
      { role: 'user', content: userMessage }
    ]

    // Add raw message to conversation history (after building messages to avoid duplicate)
    context.conversationHistory.push({ role: 'user', content: message })

    // B-CHAT-005: Generate response with abort signal support
    const answer = await ollama.chat(messages, {
      systemPrompt: SYSTEM_PROMPT,
      temperature: 0.7,
      maxTokens: 1024,
      signal: controller.signal
    })

    if (!answer) {
      return {
        answer: '',
        sources: [],
        error: 'Failed to generate response. Please try again.'
      }
    }

    // Add assistant response to history
    context.conversationHistory.push({ role: 'assistant', content: answer })

    // B-CHAT-006: Token-aware history pruning replaces simple slice
    // Keep the history manageable but let trimHistoryByTokens do the real work at query time
    if (context.conversationHistory.length > 40) {
      context.conversationHistory = context.conversationHistory.slice(-20)
    }

    // B-CHAT-005: Clean up controller after successful completion
    this.activeControllers.delete(sessionId)

    return { answer, sources }
  }

  async summarizeMeeting(meetingId: string): Promise<string | null> {
    const ollama = getOllamaService()
    const vectorStore = getVectorStore()

    // Get all chunks for this meeting
    const docs = await vectorStore.searchByMeeting(meetingId)
    if (docs.length === 0) {
      return null
    }

    // Combine chunks
    const transcript = docs.map((d) => d.content).join('\n\n')

    // Get meeting info
    const db = getDatabase()
    const meetingRows = db.exec('SELECT subject FROM meetings WHERE id = ?', [meetingId])
    const subject = meetingRows[0]?.values[0]?.[0] as string | undefined

    const prompt = `Please provide a concise summary of this meeting${subject ? ` about "${subject}"` : ''}. Include:
1. Main topics discussed
2. Key decisions made
3. Action items (if any)
4. Important points or conclusions

Meeting transcript:
${transcript.substring(0, 8000)}` // Limit context size

    return ollama.generate(prompt)
  }

  async findActionItems(meetingId?: string): Promise<string | null> {
    const ollama = getOllamaService()
    const vectorStore = getVectorStore()

    let docs
    if (meetingId) {
      docs = await vectorStore.searchByMeeting(meetingId)
    } else {
      // Search for action item related content across all meetings
      const results = await vectorStore.search(
        'action items tasks to-do follow up assigned responsibility deadline',
        10
      )
      docs = results.map((r) => r.document)
    }

    if (docs.length === 0) {
      return 'No meeting transcripts found.'
    }

    const transcript = docs.map((d) => d.content).join('\n\n')

    const prompt = `Extract all action items, tasks, and follow-ups from these meeting transcripts. For each item include:
- What needs to be done
- Who is responsible (if mentioned)
- Deadline (if mentioned)

Format as a numbered list.

Meeting transcripts:
${transcript.substring(0, 8000)}`

    return ollama.generate(prompt)
  }

  clearSession(sessionId: string): void {
    this.contexts.delete(sessionId)
    // Also cancel any in-flight request for this session
    const controller = this.activeControllers.get(sessionId)
    if (controller) {
      controller.abort()
      this.activeControllers.delete(sessionId)
    }
  }

  // B-CHAT-005: Cancel in-flight RAG request for a session
  cancelRequest(sessionId: string): boolean {
    const controller = this.activeControllers.get(sessionId)
    if (controller) {
      controller.abort()
      this.activeControllers.delete(sessionId)
      return true
    }
    return false
  }

  getStats(): {
    documentCount: number
    meetingCount: number
    sessionCount: number
  } {
    const vectorStore = getVectorStore()
    return {
      documentCount: vectorStore.getDocumentCount(),
      meetingCount: vectorStore.getMeetingCount(),
      sessionCount: this.contexts.size
    }
  }

  /**
   * Perform a global search across all entities.
   * B-EXP-003: Multi-term LIKE search with ranking by match count
   * (FTS5 is NOT available in sql.js WASM, so we use improved multi-term LIKE).
   */
  async globalSearch(query: string, limit = 5): Promise<Result<{
    knowledge: any[]
    people: any[]
    projects: any[]
  }>> {
    try {
      const db = getDatabase()

      // B-EXP-003: Multi-term LIKE search with ranking
      // B-CHAT-007: Explicit columns instead of SELECT *
      const terms = query.trim().split(/\s+/).filter((t) => t.length > 0)

      if (terms.length === 0) {
        return success({ knowledge: [], people: [], projects: [] })
      }

      // For single-term queries, use simpler approach
      if (terms.length === 1) {
        const escaped = escapeLikePattern(terms[0])
        const likeQuery = `%${escaped}%`

        const knowledgeRows = db.exec(`
          SELECT id, title, summary, captured_at FROM knowledge_captures
          WHERE title LIKE ? ESCAPE '\' OR summary LIKE ? ESCAPE '\'
          LIMIT ?
        `, [likeQuery, likeQuery, limit])

        const knowledge = knowledgeRows.length > 0 ? knowledgeRows[0].values.map(v => ({
          id: v[0],
          title: v[1],
          summary: v[2],
          capturedAt: v[3]
        })) : []

        const peopleRows = db.exec(`
          SELECT id, name, email, type FROM contacts
          WHERE name LIKE ? ESCAPE '\' OR email LIKE ? ESCAPE '\' OR company LIKE ? ESCAPE '\' OR role LIKE ? ESCAPE '\'
          LIMIT ?
        `, [likeQuery, likeQuery, likeQuery, likeQuery, limit])

        const people = peopleRows.length > 0 ? peopleRows[0].values.map(v => ({
          id: v[0],
          name: v[1],
          email: v[2],
          type: v[3]
        })) : []

        const projectRows = db.exec(`
          SELECT id, name, description, status FROM projects
          WHERE name LIKE ? ESCAPE '\' OR description LIKE ? ESCAPE '\'
          LIMIT ?
        `, [likeQuery, likeQuery, limit])

        const projects = projectRows.length > 0 ? projectRows[0].values.map(v => ({
          id: v[0],
          name: v[1],
          status: v[3]
        })) : []

        return success({ knowledge, people, projects })
      }

      // Multi-term search: match ANY term, rank by how many terms matched
      const buildMultiTermQuery = (
        table: string,
        columns: string[],
        selectCols: string,
        limitVal: number
      ): { sql: string; params: unknown[] } => {
        const params: unknown[] = []
        const termClauses: string[] = []
        const matchCountParts: string[] = []

        for (const term of terms) {
          const escaped = escapeLikePattern(term)
          const likeVal = `%${escaped}%`

          const colClauses = columns.map((col) => {
            params.push(likeVal)
            return `${col} LIKE ? ESCAPE '\'`
          })
          termClauses.push(`(${colClauses.join(' OR ')})`)

          const countExpr = columns.map((col) => {
            params.push(likeVal)
            return `CASE WHEN ${col} LIKE ? ESCAPE '\' THEN 1 ELSE 0 END`
          })
          matchCountParts.push(`MAX(${countExpr.join(', ')})`)
        }

        const whereClause = termClauses.join(' OR ')
        const rankExpr = `(${matchCountParts.join(' + ')})`

        const sql = `SELECT ${selectCols}, ${rankExpr} AS match_rank FROM ${table} WHERE ${whereClause} ORDER BY match_rank DESC LIMIT ?`
        params.push(limitVal)
        return { sql, params }
      }

      // 1. Search knowledge captures with explicit columns + multi-term ranking
      const kq = buildMultiTermQuery('knowledge_captures', ['title', 'summary'], 'id, title, summary, captured_at', limit)
      const knowledgeRows = db.exec(kq.sql, kq.params)
      const knowledge = knowledgeRows.length > 0 ? knowledgeRows[0].values.map(v => ({
        id: v[0],
        title: v[1],
        summary: v[2],
        capturedAt: v[3]
      })) : []

      // 2. Search people with explicit columns + multi-term ranking
      const pq = buildMultiTermQuery('contacts', ['name', 'email', 'company', 'role'], 'id, name, email, type', limit)
      const peopleRows = db.exec(pq.sql, pq.params)
      const people = peopleRows.length > 0 ? peopleRows[0].values.map(v => ({
        id: v[0],
        name: v[1],
        email: v[2],
        type: v[3]
      })) : []

      // 3. Search projects with explicit columns + multi-term ranking
      const prq = buildMultiTermQuery('projects', ['name', 'description'], 'id, name, description, status', limit)
      const projectRows = db.exec(prq.sql, prq.params)
      const projects = projectRows.length > 0 ? projectRows[0].values.map(v => ({
        id: v[0],
        name: v[1],
        status: v[3]
      })) : []

      return success({ knowledge, people, projects })
    } catch (err) {
      console.error('RAGService:globalSearch error:', err)
      return error('DATABASE_ERROR', 'Global search failed', err)
    }
  }
}

// Singleton instance
let ragInstance: RAGService | null = null

export function getRAGService(): RAGService {
  if (!ragInstance) {
    ragInstance = new RAGService()
  }
  return ragInstance
}

export function resetRAGService(): void {
  ragInstance = null
}

export { RAGService }
export type { RAGResponse, ChatContext }
