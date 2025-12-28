
import { ipcMain } from 'electron'
import { queryAll, queryOne, run, runInTransaction } from '../services/database'
import type { Conversation, Message } from '../../src/types/knowledge'
import { randomUUID } from 'crypto'

export function registerAssistantHandlers(): void {
  // Get all conversations
  ipcMain.handle('assistant:getConversations', async () => {
    try {
      const rows = queryAll<any>('SELECT * FROM conversations ORDER BY updated_at DESC')
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
      
      const newConv = queryOne<any>('SELECT * FROM conversations WHERE id = ?', [id])
      return mapToConversation(newConv)
    } catch (error) {
      console.error('Failed to create conversation:', error)
      throw error
    }
  })

  // Delete a conversation
  ipcMain.handle('assistant:deleteConversation', async (_, id: string) => {
    try {
      run('DELETE FROM conversations WHERE id = ?', [id])
      return { success: true }
    } catch (error) {
      console.error('Failed to delete conversation:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // Get messages for a conversation
  ipcMain.handle('assistant:getMessages', async (_, conversationId: string) => {
    try {
      const rows = queryAll<any>('SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC', [conversationId])
      return rows.map(mapToMessage)
    } catch (error) {
      console.error('Failed to get messages:', error)
      return []
    }
  })

  // Add a message to a conversation
  ipcMain.handle('assistant:addMessage', async (_, conversationId: string, role: 'user' | 'assistant', content: string, sources?: string) => {
    try {
      const id = randomUUID()
      const now = new Date().toISOString()
      
      runInTransaction(() => {
        run('INSERT INTO chat_messages (id, conversation_id, role, content, sources, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [id, conversationId, role, content, sources || null, now])
        
        // Update conversation's updated_at timestamp
        run('UPDATE conversations SET updated_at = ? WHERE id = ?', [now, conversationId])
      })

      const newMessage = queryOne<any>('SELECT * FROM chat_messages WHERE id = ?', [id])
      return mapToMessage(newMessage)
    } catch (error) {
      console.error('Failed to add message:', error)
      throw error
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
    createdAt: row.created_at
  }
}
