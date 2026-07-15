/**
 * IPC handlers for RAG chatbot functionality
 */

import { ipcMain } from 'electron'
import { getRAGService } from '../services/rag'
import { getVectorStore } from '../services/vector-store'
import { getChatLLMService } from '../services/chat-llm'
import { success, error, Result } from '../types/api'
import { RAGFilterSchema } from '../validation/common'
import type { RAGFilter, RAGStatus, RAGChatResponse } from '../types/api'
import { getMeetingsForContact, getMeetingsForProject } from '../services/database'

// Helper to extract meeting IDs from RAGFilter
function extractMeetingIdsFromFilter(filter: RAGFilter): string[] | undefined {
  switch (filter.type) {
    case 'none':
      return undefined
    case 'meeting':
      return [filter.meetingId]
    case 'contact':
      return getMeetingsForContact(filter.contactId).map((m) => m.id)
    case 'project':
      return getMeetingsForProject(filter.projectId).map((m) => m.id)
    case 'dateRange':
      // Date range filtering is handled differently - would need vector store support
      return undefined
    default:
      return undefined
  }
}

export function registerRAGHandlers(): void {
  const rag = getRAGService()
  const vectorStore = getVectorStore()

  // Check if RAG is ready (new Result pattern)
  ipcMain.handle('rag:status', async (): Promise<Result<RAGStatus>> => {
    try {
      // Chat is Gemini-first with Ollama fallback — availability reflects EITHER
      // a configured Gemini key OR a reachable Ollama (see chat-llm.ts).
      const chatStatus = await getChatLLMService().getStatus()
      const docCount = vectorStore.getDocumentCount()
      const meetingCount = vectorStore.getMeetingCount()

      return success({
        backend: chatStatus.backend,
        chatAvailable: chatStatus.backend !== 'none',
        ollamaAvailable: chatStatus.ollamaAvailable,
        documentCount: docCount,
        meetingCount: meetingCount,
        ready: chatStatus.backend !== 'none' && docCount > 0
      })
    } catch (err) {
      console.error('rag:status error:', err)
      return error('INTERNAL_ERROR', 'Failed to get RAG status', err)
    }
  })

  // Send a chat message with optional filter (new Result pattern)
  ipcMain.handle(
    'rag:chat',
    async (
      _event,
      request: unknown
    ): Promise<Result<RAGChatResponse>> => {
      try {
        // Validate request
        if (!request || typeof request !== 'object') {
          return error('VALIDATION_ERROR', 'Invalid request')
        }

        const { sessionId, message, filter } = request as {
          sessionId?: string
          message?: string
          filter?: unknown
        }

        if (!sessionId || typeof sessionId !== 'string') {
          return error('VALIDATION_ERROR', 'Session ID is required')
        }
        if (!message || typeof message !== 'string') {
          return error('VALIDATION_ERROR', 'Message is required')
        }

        // Parse filter if provided
        let meetingFilter: string | undefined
        if (filter) {
          const parsedFilter = RAGFilterSchema.safeParse(filter)
          if (!parsedFilter.success) {
            return error('VALIDATION_ERROR', 'Invalid filter', parsedFilter.error.format())
          }

          // Extract meeting ID(s) from filter
          const meetingIds = extractMeetingIdsFromFilter(parsedFilter.data)
          if (meetingIds && meetingIds.length > 0) {
            // For now, use first meeting ID (TODO: support multiple)
            meetingFilter = meetingIds[0]
          }
        }

        const response = await rag.chat(sessionId, message, meetingFilter)

        // ADV22-1 (round-23) — CONTENT-FREE release. The RAG chat IPC returns ONLY the
        // generationId + a non-content status; NEVER the answer text or source excerpts.
        // The generated content stays in main's PendingGeneration (keyed by generationId)
        // and reaches the renderer through EXACTLY ONE sanitized path:
        // assistant:addMessage(generationId), which revalidates provenance at persist and
        // redacts via the shared read boundary. A recording/capture can be excluded DURING
        // the provider await (after the pre-call eligibility check), so releasing the raw
        // answer here would bypass that final revalidation.
        if (response.error) {
          // A provider/generation failure still carries a generationId whose MAIN-owned
          // error text is replayed by assistant:addMessage. Surface it as a non-content
          // error status so the renderer can trigger that replay (or the notice catalog
          // when no generation exists).
          return success({ generationId: response.generationId, status: 'error', error: response.error })
        }

        return success({ generationId: response.generationId, status: 'ok' })
      } catch (err) {
        console.error('rag:chat error:', err)
        return error('INTERNAL_ERROR', 'Failed to process chat message', err)
      }
    }
  )

  // Legacy handler for backwards compatibility — ALSO content-free (ADV22-1, round-23).
  // Returns ONLY generationId + a non-content error string; never the answer or sources.
  // Chat.tsx consumes this path and obtains the displayable answer solely via
  // assistant:addMessage(generationId).
  ipcMain.handle(
    'rag:chat-legacy',
    async (
      _event,
      { sessionId, message, meetingFilter }: { sessionId: string; message: string; meetingFilter?: string }
    ): Promise<{ generationId?: string; error?: string }> => {
      const response = await rag.chat(sessionId, message, meetingFilter)
      return { generationId: response.generationId, error: response.error }
    }
  )

  // Get meeting summary (with Result pattern)
  ipcMain.handle('rag:summarize-meeting', async (_event, meetingId: string): Promise<Result<string>> => {
    try {
      if (!meetingId || typeof meetingId !== 'string') {
        return error('VALIDATION_ERROR', 'Meeting ID is required')
      }

      const summary = await rag.summarizeMeeting(meetingId)
      if (!summary) {
        return error('NOT_FOUND', 'No transcripts found for this meeting')
      }

      return success(summary)
    } catch (err) {
      console.error('rag:summarize-meeting error:', err)
      return error('INTERNAL_ERROR', 'Failed to summarize meeting', err)
    }
  })

  // Find action items (with Result pattern)
  ipcMain.handle('rag:find-action-items', async (_event, meetingId?: string): Promise<Result<string>> => {
    try {
      const actionItems = await rag.findActionItems(meetingId)
      if (!actionItems) {
        return error('NOT_FOUND', 'No action items found')
      }

      return success(actionItems)
    } catch (err) {
      console.error('rag:find-action-items error:', err)
      return error('INTERNAL_ERROR', 'Failed to find action items', err)
    }
  })

  // B-CHAT-005: Cancel in-flight RAG request
  ipcMain.handle('rag:cancel', async (_event, sessionId: string): Promise<Result<boolean>> => {
    try {
      if (!sessionId || typeof sessionId !== 'string') {
        return error('VALIDATION_ERROR', 'Session ID is required')
      }

      const cancelled = rag.cancelRequest(sessionId)
      return success(cancelled)
    } catch (err) {
      console.error('rag:cancel error:', err)
      return error('INTERNAL_ERROR', 'Failed to cancel request', err)
    }
  })

  // Remove last N messages from RAG session history (for retry without losing all context)
  ipcMain.handle('rag:removeLastMessages', async (_event, sessionId: string, count: number): Promise<Result<number>> => {
    try {
      if (!sessionId || typeof sessionId !== 'string') {
        return error('VALIDATION_ERROR', 'Session ID is required')
      }
      if (typeof count !== 'number' || count < 1) {
        return error('VALIDATION_ERROR', 'Count must be a positive number')
      }

      const removed = rag.removeLastMessages(sessionId, count)
      return success(removed)
    } catch (err) {
      console.error('rag:removeLastMessages error:', err)
      return error('INTERNAL_ERROR', 'Failed to remove messages from session', err)
    }
  })

  // Clear chat session (with Result pattern)
  ipcMain.handle('rag:clear-session', async (_event, sessionId: string): Promise<Result<void>> => {
    try {
      if (!sessionId || typeof sessionId !== 'string') {
        return error('VALIDATION_ERROR', 'Session ID is required')
      }

      rag.clearSession(sessionId)
      return success(undefined)
    } catch (err) {
      console.error('rag:clear-session error:', err)
      return error('INTERNAL_ERROR', 'Failed to clear session', err)
    }
  })

  // Get stats
  ipcMain.handle('rag:stats', async () => {
    return rag.getStats()
  })

  // ADV12 (round-13) — the renderer-controlled raw-transcript indexing surface
  // (`rag:index-transcript`) was REMOVED. It let the renderer supply arbitrary
  // transcript text plus an arbitrary/optional recordingId, so excluded or
  // foreign content could ride an eligible id (or no id) into vector search /
  // RAG / LLM prompts — and it had ZERO renderer callers (dead, exploitable).
  // A reindex-by-id feature, if ever needed, must live entirely in the main
  // process: take ONLY a recordingId, load the authoritative transcript +
  // metadata itself, and eligibility-check adjacent to persistence — never
  // trust a renderer-supplied content↔recording association.

  // Search transcripts
  ipcMain.handle(
    'rag:search',
    async (_event, { query, limit = 5 }: { query: string; limit?: number }) => {
      const results = await vectorStore.search(query, limit)
      return results.map((r) => ({
        content: r.document.content,
        meetingId: r.document.metadata.meetingId,
        subject: r.document.metadata.subject,
        score: r.score
      }))
    }
  )

  // Get all chunks (for viewer)
  ipcMain.handle('rag:get-chunks', async () => {
    const documents = vectorStore.getAllDocuments()
    return documents.map((doc) => ({
      id: doc.id,
      content: doc.content,
      meetingId: doc.metadata.meetingId,
      recordingId: doc.metadata.recordingId,
      chunkIndex: doc.metadata.chunkIndex,
      subject: doc.metadata.subject,
      timestamp: doc.metadata.timestamp,
      embeddingDimensions: doc.embedding.length
    }))
  })

  // Global search
  ipcMain.handle('rag:globalSearch', async (_event, { query, limit }: { query: string; limit?: number }) => {
    return rag.globalSearch(query, limit)
  })

  console.log('RAG IPC handlers registered')
}
