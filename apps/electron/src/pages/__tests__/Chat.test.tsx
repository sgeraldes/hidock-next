
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Chat } from '../Chat'
import { MemoryRouter } from 'react-router-dom'

// Mock Electron API
global.window.electronAPI = {
  rag: {
    status: vi.fn().mockResolvedValue({ success: true, data: { ready: true, ollamaAvailable: true, documentCount: 5, meetingCount: 2 } }),
    getChunks: vi.fn().mockResolvedValue([]),
    chatLegacy: vi.fn().mockResolvedValue({ answer: 'Hello' })
  },
  assistant: {
    getConversations: vi.fn().mockResolvedValue([{ id: 'c1', title: 'Conversation 1', updatedAt: new Date().toISOString() }]),
    createConversation: vi.fn().mockResolvedValue({ id: 'c2', title: 'New Chat', updatedAt: new Date().toISOString() }),
    getMessages: vi.fn().mockResolvedValue([])
  },
  chat: {
    getHistory: vi.fn().mockResolvedValue([]),
    addMessage: vi.fn().mockImplementation((role, content) => Promise.resolve({ id: Math.random().toString(), role, content, created_at: new Date().toISOString() }))
  }
} as any

describe('Chat Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render conversation history sidebar', async () => {
    render(
      <MemoryRouter>
        <Chat />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getAllByText('Conversation 1').length).toBeGreaterThan(0)
    })
  })

  it('should create a new chat when clicking New Chat button', async () => {
    render(
      <MemoryRouter>
        <Chat />
      </MemoryRouter>
    )

    const newChatBtn = await screen.findByText(/New Chat/i)
    fireEvent.click(newChatBtn)

    await waitFor(() => {
      expect(window.electronAPI.assistant.createConversation).toHaveBeenCalled()
    })
  })
})
