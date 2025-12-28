/**
 * IPC handlers for RAG chatbot functionality
 */

import { ipcMain } from 'electron'
import { getRAGService, RAGResponse } from '../services/rag'
import { getVectorStore } from '../services/vector-store'
import { getOllamaService } from '../services/ollama'
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
  const ollama = getOllamaService()

  // Check if RAG is ready (new Result pattern)
  ipcMain.handle('rag:status', async (): Promise<Result<RAGStatus>> => {
    try {
      const ollamaAvailable = await ollama.isAvailable()
      const docCount = vectorStore.getDocumentCount()
      const meetingCount = vectorStore.getMeetingCount()

      return success({
        ollamaAvailable,
        documentCount: docCount,
        meetingCount: meetingCount,
        ready: ollamaAvailable && docCount > 0
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

        if (response.error) {
          return error('INTERNAL_ERROR', response.error)
        }

        return success({
          answer: response.answer,
          sources: response.sources
        })
      } catch (err) {
        console.error('rag:chat error:', err)
        return error('INTERNAL_ERROR', 'Failed to process chat message', err)
      }
    }
  )

  // Legacy handler for backwards compatibility
  ipcMain.handle(
    'rag:chat-legacy',
    async (
      _event,
      { sessionId, message, meetingFilter }: { sessionId: string; message: string; meetingFilter?: string }
    ): Promise<RAGResponse> => {
      return rag.chat(sessionId, message, meetingFilter)
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

  // Index a transcript manually
  ipcMain.handle(
    'rag:index-transcript',
    async (
      _event,
      {
        transcript,
        metadata
      }: {
        transcript: string
        metadata: {
          meetingId?: string
          recordingId?: string
          timestamp?: string
          subject?: string
        }
      }
    ) => {
      const count = await vectorStore.indexTranscript(transcript, metadata)
      return { indexed: count }
    }
  )

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
