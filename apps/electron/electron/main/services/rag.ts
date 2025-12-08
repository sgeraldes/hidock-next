/**
 * RAG (Retrieval Augmented Generation) Service
 * Combines vector search with LLM to answer questions about meetings
 */

import { getVectorStore, SearchResult } from './vector-store'
import { getOllamaService, OllamaChatMessage } from './ollama'
import { getDatabase } from './database'

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

class RAGService {
  private contexts: Map<string, ChatContext> = new Map()

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

    // Get or create session context
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
        // Re-rank by query relevance
        searchResults = docs.map((doc) => ({
          document: doc,
          score: 0.8 // Default score for filtered results
        }))
      } else {
        searchResults = docs.map((doc) => ({ document: doc, score: 0.8 }))
      }
      searchResults = searchResults.slice(0, 5)
    } else {
      // Global search
      searchResults = await vectorStore.search(message, 5)
    }

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

    // Prepare messages
    const contextText =
      contextParts.length > 0
        ? `Here are relevant excerpts from meeting transcripts:\n\n${contextParts.join('\n\n---\n\n')}`
        : 'No relevant meeting transcripts found for this query.'

    const userMessage = `Context:\n${contextText}\n\nQuestion: ${message}`

    // Add to conversation history
    context.conversationHistory.push({ role: 'user', content: message })

    // Build messages for LLM
    const messages: OllamaChatMessage[] = [
      ...context.conversationHistory.slice(-6), // Keep last 3 exchanges
      { role: 'user', content: userMessage }
    ]

    // Generate response
    const answer = await ollama.chat(messages, {
      systemPrompt: SYSTEM_PROMPT,
      temperature: 0.7,
      maxTokens: 1024
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

    // Keep history limited
    if (context.conversationHistory.length > 20) {
      context.conversationHistory = context.conversationHistory.slice(-10)
    }

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
}

// Singleton instance
let ragInstance: RAGService | null = null

export function getRAGService(): RAGService {
  if (!ragInstance) {
    ragInstance = new RAGService()
  }
  return ragInstance
}

export { RAGService }
export type { RAGResponse, ChatContext }
