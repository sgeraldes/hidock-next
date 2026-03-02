import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Chat } from '../Chat'
import { MemoryRouter } from 'react-router-dom'

// Mock Electron API
const now = new Date()
const oneHourAgo = new Date(now.getTime() - 3600000).toISOString()
const twoDaysAgo = new Date(now.getTime() - 2 * 86400000).toISOString()

global.window.electronAPI = {
  rag: {
    status: vi.fn().mockResolvedValue({ success: true, data: { ready: true, ollamaAvailable: true, documentCount: 5, meetingCount: 2 } }),
    getChunks: vi.fn().mockResolvedValue([]),
    chatLegacy: vi.fn().mockResolvedValue({ answer: 'Hello' }),
    cancel: vi.fn().mockResolvedValue({ success: true })
  },
  assistant: {
    getConversations: vi.fn().mockResolvedValue([
      { id: 'c1', title: 'Conversation 1', updatedAt: oneHourAgo },
      { id: 'c2', title: 'Conversation 2', updatedAt: twoDaysAgo },
      { id: 'c3', title: 'Latest Chat', updatedAt: now.toISOString() }
    ]),
    createConversation: vi.fn().mockResolvedValue({ id: 'c-new', title: 'New Chat', updatedAt: now.toISOString() }),
    getMessages: vi.fn().mockResolvedValue([]),
    addMessage: vi.fn().mockImplementation((_id, role, content) => Promise.resolve({ id: Math.random().toString(), role, content, createdAt: now.toISOString() })),
    deleteConversation: vi.fn().mockResolvedValue({ success: true }),
    getContext: vi.fn().mockResolvedValue([]),
    addContext: vi.fn().mockResolvedValue({ success: true }),
    removeContext: vi.fn().mockResolvedValue({ success: true })
  },
  knowledge: {
    getAll: vi.fn().mockResolvedValue([
      { id: 'k1', title: 'Knowledge 1', capturedAt: now.toISOString() }
    ]),
    getById: vi.fn().mockResolvedValue({ id: 'k1', title: 'Knowledge 1', capturedAt: now.toISOString() }),
    getByIds: vi.fn().mockResolvedValue({ 'k1': { id: 'k1', title: 'Knowledge 1', capturedAt: now.toISOString() } })
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

  it('should open context picker and add context', async () => {
    render(
      <MemoryRouter>
        <Chat />
      </MemoryRouter>
    )

    // Wait for initial load
    await screen.findByText('HISTORY')

    const addContextBtn = await screen.findByTitle(/Add Context/i)
    fireEvent.click(addContextBtn)

    const knowledgeItem = await screen.findByText('Knowledge 1')
    fireEvent.click(knowledgeItem)

    await waitFor(() => {
      expect(window.electronAPI.assistant.addContext).toHaveBeenCalledWith('c3', 'k1')
    })
  })

  it('should sort conversations by most recent first', async () => {
    render(
      <MemoryRouter>
        <Chat />
      </MemoryRouter>
    )

    await waitFor(() => {
      const items = screen.getAllByText(/Conversation|Latest Chat/)
      // "Latest Chat" should appear first since it has the most recent updatedAt
      expect(items[0].textContent).toBe('Latest Chat')
    })
  })

  it('should display character count for input field', async () => {
    render(
      <MemoryRouter>
        <Chat />
      </MemoryRouter>
    )

    await screen.findByText('HISTORY')

    // Character counter should show 0/4000 initially
    expect(screen.getByText('0/4000')).toBeInTheDocument()
  })

  it('should update character count when typing', async () => {
    render(
      <MemoryRouter>
        <Chat />
      </MemoryRouter>
    )

    await screen.findByText('HISTORY')

    const input = screen.getByPlaceholderText(/Ask me anything/)
    fireEvent.change(input, { target: { value: 'Hello' } })

    expect(screen.getByText('5/4000')).toBeInTheDocument()
  })

  it('should render relative timestamps in conversation sidebar', async () => {
    render(
      <MemoryRouter>
        <Chat />
      </MemoryRouter>
    )

    await waitFor(() => {
      // "Latest Chat" was just now, should show "Just now"
      expect(screen.getByText('Just now')).toBeInTheDocument()
    })
  })

  it('should render messages with markdown formatting', async () => {
    // Mock a conversation with messages including markdown
    const msgId = 'msg-md-1'
    ;(window.electronAPI.assistant.getMessages as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: msgId,
        role: 'assistant',
        content: '**Bold text** and *italic text*',
        createdAt: now.toISOString(),
        sources: null
      }
    ])

    render(
      <MemoryRouter>
        <Chat />
      </MemoryRouter>
    )

    await waitFor(() => {
      // ReactMarkdown renders **bold** as <strong>
      const boldEl = screen.getByText('Bold text')
      expect(boldEl.tagName).toBe('STRONG')
    })
  })
})
