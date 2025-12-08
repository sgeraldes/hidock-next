/**
 * IPC handlers for RAG chatbot functionality
 */

import { ipcMain } from 'electron'
import { getRAGService, RAGResponse } from '../services/rag'
import { getVectorStore } from '../services/vector-store'
import { getOllamaService } from '../services/ollama'

export function registerRAGHandlers(): void {
  const rag = getRAGService()
  const vectorStore = getVectorStore()
  const ollama = getOllamaService()

  // Check if RAG is ready
  ipcMain.handle('rag:status', async () => {
    const ollamaAvailable = await ollama.isAvailable()
    const docCount = vectorStore.getDocumentCount()
    const meetingCount = vectorStore.getMeetingCount()

    return {
      ollamaAvailable,
      documentCount: docCount,
      meetingCount: meetingCount,
      ready: ollamaAvailable && docCount > 0
    }
  })

  // Send a chat message
  ipcMain.handle(
    'rag:chat',
    async (
      _event,
      { sessionId, message, meetingFilter }: { sessionId: string; message: string; meetingFilter?: string }
    ): Promise<RAGResponse> => {
      return rag.chat(sessionId, message, meetingFilter)
    }
  )

  // Get meeting summary
  ipcMain.handle('rag:summarize-meeting', async (_event, meetingId: string) => {
    return rag.summarizeMeeting(meetingId)
  })

  // Find action items
  ipcMain.handle('rag:find-action-items', async (_event, meetingId?: string) => {
    return rag.findActionItems(meetingId)
  })

  // Clear chat session
  ipcMain.handle('rag:clear-session', async (_event, sessionId: string) => {
    rag.clearSession(sessionId)
    return true
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

  console.log('RAG IPC handlers registered')
}
