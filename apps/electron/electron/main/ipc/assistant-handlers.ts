
import { ipcMain } from 'electron'
import { queryAll, queryOne, run, runInTransaction } from '../services/database'
import { filterEligibleCaptureIds } from '../services/recording-eligibility'
import { getRAGService } from '../services/rag'
import {
  packSources,
  packNonRagAssistant,
  presentSourcesNoRevalidate,
  revalidateStoredSources,
  isProvenanceExcluded,
  REDACTED_ANSWER
} from '../services/chat-source-provenance'
import type { Conversation, Message } from '@/types/knowledge'
import { randomUUID } from 'crypto'

// B-CHAT-007: Explicit column lists instead of SELECT *
const CONVERSATION_COLUMNS = 'id, title, created_at, updated_at'
const MESSAGE_COLUMNS = 'id, conversation_id, role, content, sources, created_at, edited_at, original_content, created_output_id, saved_as_insight_id'

/**
 * ADV20-1 (round-21) — the MAIN-OWNED catalog for genuine NON-RAG assistant notices
 * (IPC/transport failures the renderer catches when rag:chat never returned a
 * generation). The renderer supplies only a `code`, NEVER free text, so it can never
 * smuggle excluded/grounded content into a trusted non-rag message. Provider-side
 * generation failures keep their dynamic (brain-naming) text via the pending-generation
 * path (assistant:addMessage + the error generationId), not this catalog.
 */
const ASSISTANT_NOTICES: Record<string, string> = {
  'generic-error':
    'Sorry, I encountered an error processing your request. Please check that a Gemini API key is set in Settings (or that Ollama is running) and try again.',
  'retry-failed': 'Retry failed. Please check your connection and try again.'
}
const DEFAULT_NOTICE_CODE = 'generic-error'

export function registerAssistantHandlers(): void {
  // Get all conversations
  ipcMain.handle('assistant:getConversations', async () => {
    try {
      const rows = queryAll<any>(`SELECT ${CONVERSATION_COLUMNS} FROM conversations ORDER BY updated_at DESC`)
      return rows.map(mapToConversation)
    } catch (error) {
      console.error('Failed to get conversations:', error)
      return []
    }
  })

  // Create a new conversation
  ipcMain.handle('assistant:createConversation', async (_, title?: string) => {
    try {
      const id = randomUUID()
      const now = new Date().toISOString()
      run('INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
        [id, title || 'New Conversation', now, now])

      const newConv = queryOne<any>(`SELECT ${CONVERSATION_COLUMNS} FROM conversations WHERE id = ?`, [id])
      return mapToConversation(newConv)
    } catch (error) {
      console.error('Failed to create conversation:', error)
      throw error
    }
  })

  // Delete a conversation
  // B-CHAT-002: Also clear RAG session when deleting a conversation
  ipcMain.handle('assistant:deleteConversation', async (_, id: string) => {
    try {
      run('DELETE FROM conversations WHERE id = ?', [id])
      // Clear the RAG session associated with this conversation
      const rag = getRAGService()
      rag.clearSession(id)
      return { success: true }
    } catch (error) {
      console.error('Failed to delete conversation:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Get messages for a conversation
  // B-CHAT-001: Validate conversation exists, return error info instead of empty array
  ipcMain.handle('assistant:getMessages', async (_, conversationId: string) => {
    try {
      // Validate conversation exists
      const conv = queryOne<any>('SELECT id FROM conversations WHERE id = ?', [conversationId])
      if (!conv) {
        console.error(`getMessages: Conversation ${conversationId} not found`)
        return { error: 'Conversation not found', messages: [] }
      }

      const rows = queryAll<any>(`SELECT ${MESSAGE_COLUMNS} FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC`, [conversationId])
      // ADV17-2 — revalidate each persisted message's source provenance against
      // the shared fail-closed boundaries before returning. Excluded snippets are
      // dropped; an answer grounded solely on now-excluded sources is redacted.
      return rows.map((row) => {
        const { sources, redactContent } = revalidateStoredSources(row.sources, row.role)
        const msg = mapToMessage({ ...row, sources })
        if (redactContent) msg.content = REDACTED_ANSWER
        return msg
      })
    } catch (error) {
      console.error('Failed to get messages:', error)
      return []
    }
  })

  // Add a message to a conversation.
  //
  // ADV20-1 / ADV20-2 (round-21) — MAIN OWNS THE ASSISTANT CONTENT end-to-end.
  //   • role='user'      — the renderer authors its OWN text; persisted verbatim.
  //   • role='assistant' — the renderer's `content` argument is IGNORED. Main replays
  //     the answer TEXT + authoritative sources it stored at generation time (keyed by
  //     `generationId`), so a renderer can neither substitute arbitrary content nor
  //     ride a valid generation's eligible provenance with excluded content. An
  //     unknown/missing/cross-conversation generationId ⇒ fail-closed REDACTED_ANSWER,
  //     never renderer content. The RAG provenance union is REVALIDATED at persist time
  //     (an exclusion landing between generation and now ⇒ REDACTED_ANSWER persisted),
  //     and the returned row is sanitized through the SAME read boundary as history
  //     reads (not presentSourcesNoRevalidate) so a live exclusion redacts the UI too.
  ipcMain.handle('assistant:addMessage', async (_, conversationId: string, role: unknown, content: string, _sources?: string, generationId?: string) => {
    try {
      // ADV21 (round-22) — EXACT runtime role allowlist. The TypeScript union is a
      // COMPILE-TIME guarantee only; at runtime a renderer can submit 'system',
      // 'Assistant' (case), ' assistant ' (whitespace), '', null, or a non-string.
      // REJECT anything that is not the exact string 'user' or 'assistant' — do NOT
      // trim/lowercase/normalize (normalizing 'Assistant' → 'assistant' would smuggle
      // arbitrary content into the trusted main-owned branch). Rejection = no insert.
      if (role !== 'user' && role !== 'assistant') {
        const error = new Error(
          `assistant:addMessage rejected invalid role: ${typeof role === 'string' ? JSON.stringify(role) : typeof role}`
        )
        console.error(error.message)
        throw error
      }

      // Validate conversation exists before adding message
      const conv = queryOne<any>('SELECT id FROM conversations WHERE id = ?', [conversationId])
      if (!conv) {
        const error = new Error(`Cannot add message: Conversation ${conversationId} not found`)
        console.error(error.message)
        throw error
      }

      const id = randomUUID()
      const now = new Date().toISOString()

      // role='user' — the user's own text. The renderer may pass raw sources verbatim.
      if (role === 'user') {
        const packedSources = packSources(_sources)
        runInTransaction(() => {
          run('INSERT INTO chat_messages (id, conversation_id, role, content, sources, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            [id, conversationId, role, content, packedSources, now])
          run('UPDATE conversations SET updated_at = ? WHERE id = ?', [now, conversationId])
        })
        const userRow = queryOne<any>(`SELECT ${MESSAGE_COLUMNS} FROM chat_messages WHERE id = ?`, [id])
        return mapToMessage({ ...userRow, sources: presentSourcesNoRevalidate(userRow.sources) })
      }

      // role='assistant' — consume MAIN's stored answer for this generation. The
      // renderer's `content` is deliberately NOT used.
      const answer = getRAGService().consumeAssistantAnswer(conversationId, generationId)

      let finalContent: string
      let packedSources: string | null
      if (answer.kind === 'non-rag') {
        // A genuine main-issued non-RAG emit (e.g. a provider-failure error string).
        finalContent = answer.content
        packedSources = packNonRagAssistant()
      } else if (answer.kind === 'rag') {
        // ADV20-2 — revalidate the provenance union IMMEDIATELY before insertion.
        if (isProvenanceExcluded(answer.prov)) {
          finalContent = REDACTED_ANSWER
          packedSources = packSources(null, answer.prov)
        } else {
          finalContent = answer.content
          packedSources = packSources(answer.sources, answer.prov)
        }
      } else {
        // Unknown/consumed/cross-conversation id, or a renderer trying to author an
        // assistant message with no valid generation ⇒ fail closed (never trusted,
        // never renderer content).
        finalContent = REDACTED_ANSWER
        packedSources = packSources(null, { recordingIds: [], captureIds: [], unverifiable: true })
      }

      runInTransaction(() => {
        run('INSERT INTO chat_messages (id, conversation_id, role, content, sources, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [id, conversationId, 'assistant', finalContent, packedSources, now])
        run('UPDATE conversations SET updated_at = ? WHERE id = ?', [now, conversationId])
      })

      const newMessage = queryOne<any>(`SELECT ${MESSAGE_COLUMNS} FROM chat_messages WHERE id = ?`, [id])
      // ADV20-2 — sanitize the fresh insert through the SAME read boundary so a live
      // exclusion between persist and return still redacts what the UI shows.
      const { sources: sanitized, redactContent } = revalidateStoredSources(newMessage.sources, 'assistant')
      const msg = mapToMessage({ ...newMessage, sources: sanitized })
      if (redactContent) msg.content = REDACTED_ANSWER
      return msg
    } catch (error) {
      console.error('Failed to add message:', error)
      throw error
    }
  })

  // Persist a genuine NON-RAG assistant NOTICE (an IPC/transport error the renderer
  // caught when rag:chat never returned a generation). ADV20-1 (round-21) — the
  // renderer passes only a fixed `code`, NEVER free text, so it cannot author trusted
  // assistant content. Main maps the code to a canonical string and stamps a non-rag
  // envelope. This is the ONLY renderer-invocable assistant-write with no generationId,
  // and it can never carry renderer-supplied prose.
  ipcMain.handle('assistant:addNotice', async (_, conversationId: string, code: string) => {
    try {
      const conv = queryOne<any>('SELECT id FROM conversations WHERE id = ?', [conversationId])
      if (!conv) {
        const error = new Error(`Cannot add notice: Conversation ${conversationId} not found`)
        console.error(error.message)
        throw error
      }
      const id = randomUUID()
      const now = new Date().toISOString()
      const text = ASSISTANT_NOTICES[code] ?? ASSISTANT_NOTICES[DEFAULT_NOTICE_CODE]
      const packedSources = packNonRagAssistant()
      runInTransaction(() => {
        run('INSERT INTO chat_messages (id, conversation_id, role, content, sources, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [id, conversationId, 'assistant', text, packedSources, now])
        run('UPDATE conversations SET updated_at = ? WHERE id = ?', [now, conversationId])
      })
      const row = queryOne<any>(`SELECT ${MESSAGE_COLUMNS} FROM chat_messages WHERE id = ?`, [id])
      return mapToMessage({ ...row, sources: presentSourcesNoRevalidate(row.sources) })
    } catch (error) {
      console.error('Failed to add notice:', error)
      throw error
    }
  })

  // Add context to conversation
  ipcMain.handle('assistant:addContext', async (_, conversationId: string, knowledgeCaptureId: string) => {
    try {
      // Validate both conversation and knowledge capture exist
      const conv = queryOne<any>('SELECT id FROM conversations WHERE id = ?', [conversationId])
      if (!conv) {
        console.error(`addContext: Conversation ${conversationId} not found`)
        return { success: false, error: 'Conversation not found' }
      }

      const kc = queryOne<any>('SELECT id FROM knowledge_captures WHERE id = ?', [knowledgeCaptureId])
      if (!kc) {
        console.error(`addContext: Knowledge capture ${knowledgeCaptureId} not found`)
        return { success: false, error: 'Knowledge capture not found' }
      }

      // ADV38 sweep (round-40) — defense-in-depth: never PIN an already-excluded
      // capture as chat context. The RAG consumer re-checks pinned-context recording
      // eligibility fail-closed at prompt assembly (round-20), so an excluded pin is
      // already dropped before it reaches the LLM; but refusing the write closes the
      // stale-id path that would let a hidden capture be attached at all. Generic
      // not-found so an excluded capture's existence is not disclosed; fail-closed.
      const capElig = filterEligibleCaptureIds([knowledgeCaptureId])
      if (capElig.failClosed || !capElig.eligible.has(knowledgeCaptureId)) {
        console.error(`addContext: Knowledge capture ${knowledgeCaptureId} not eligible`)
        return { success: false, error: 'Knowledge capture not found' }
      }

      const id = randomUUID()
      run('INSERT OR IGNORE INTO conversation_context (id, conversation_id, knowledge_capture_id) VALUES (?, ?, ?)',
        [id, conversationId, knowledgeCaptureId])
      return { success: true }
    } catch (error) {
      console.error('Failed to add context:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Remove context from conversation
  ipcMain.handle('assistant:removeContext', async (_, conversationId: string, knowledgeCaptureId: string) => {
    try {
      // Validate conversation exists before removing context
      const conv = queryOne<any>('SELECT id FROM conversations WHERE id = ?', [conversationId])
      if (!conv) {
        console.error(`removeContext: Conversation ${conversationId} not found`)
        return { success: false, error: 'Conversation not found' }
      }

      run('DELETE FROM conversation_context WHERE conversation_id = ? AND knowledge_capture_id = ?',
        [conversationId, knowledgeCaptureId])
      return { success: true }
    } catch (error) {
      console.error('Failed to remove context:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Update conversation title
  ipcMain.handle('assistant:updateConversationTitle', async (_, conversationId: string, title: string) => {
    try {
      const conv = queryOne<any>('SELECT id FROM conversations WHERE id = ?', [conversationId])
      if (!conv) {
        return { success: false, error: 'Conversation not found' }
      }

      run('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?',
        [title, new Date().toISOString(), conversationId])
      return { success: true }
    } catch (error) {
      console.error('Failed to update conversation title:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Get context for conversation
  ipcMain.handle('assistant:getContext', async (_, conversationId: string) => {
    try {
      // Return IDs of knowledge captures attached as context
      const rows = queryAll<{ knowledge_capture_id: string }>(
        'SELECT knowledge_capture_id FROM conversation_context WHERE conversation_id = ?',
        [conversationId]
      )
      return rows.map(r => r.knowledge_capture_id)
    } catch (error) {
      console.error('Failed to get context:', error)
      return []
    }
  })
}

function mapToConversation(row: any): Conversation {
  return {
    id: row.id,
    title: row.title,
    contextIds: [], // We'll handle context in a separate call or sub-query if needed
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapToMessage(row: any): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as 'user' | 'assistant',
    content: row.content,
    sources: row.sources,
    createdAt: row.created_at,
    editedAt: row.edited_at ?? null,
    originalContent: row.original_content ?? null,
    createdOutputId: row.created_output_id ?? null,
    savedAsInsightId: row.saved_as_insight_id ?? null
  }
}
