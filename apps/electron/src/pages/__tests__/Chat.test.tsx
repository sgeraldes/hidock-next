import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react'
import { Chat } from '../Chat'
import { MemoryRouter } from 'react-router-dom'

// F2 (review finding 3): capture the ResizeObserver callback so tests can drive
// container-width transitions across the @lg breakpoint (32rem = 512px). jsdom's
// getBoundingClientRect() reports width 0, so Chat boots in narrow mode by default.
type ROEntry = { contentRect: { width: number } }
let resizeCallback: ((entries: ROEntry[]) => void) | null = null
class MockResizeObserver {
  constructor(cb: (entries: ROEntry[]) => void) {
    resizeCallback = cb
  }
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
}
vi.stubGlobal('ResizeObserver', MockResizeObserver)

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

  // F2: Narrow-container adaptation (floating assistant overlay). Container queries
  // (@lg/@sm) are not evaluated by jsdom, so these assert the structural contract
  // that makes the overlay usable: the docked sidebar collapses (carries the
  // container-hidden classes), a History toggle opens a drawer with the list, and
  // the send-row caption can never wrap one-word-per-line.
  describe('narrow-container (overlay) adaptation', () => {
    it('collapses the docked history sidebar via container-query classes', async () => {
      render(
        <MemoryRouter>
          <Chat />
        </MemoryRouter>
      )
      await screen.findByText('HISTORY')

      const sidebar = screen.getByTestId('chat-history-sidebar')
      // Hidden by default; only shown as a flex column at the @lg container width.
      expect(sidebar.className).toContain('hidden')
      expect(sidebar.className).toContain('@lg:flex')
    })

    it('opens a history drawer from the narrow-mode toggle and lists conversations', async () => {
      render(
        <MemoryRouter>
          <Chat />
        </MemoryRouter>
      )
      await screen.findByText('HISTORY')

      // Drawer is not mounted until the toggle is used.
      expect(screen.queryByTestId('chat-history-drawer')).toBeNull()

      fireEvent.click(screen.getByTestId('chat-history-toggle'))

      const drawer = await screen.findByTestId('chat-history-drawer')
      // The conversation list renders inside the drawer (not just the docked sidebar).
      expect(within(drawer).getByText('Conversation 1')).toBeInTheDocument()
      expect(within(drawer).getByText('Latest Chat')).toBeInTheDocument()
    })

    it('closes the history drawer after selecting a conversation', async () => {
      render(
        <MemoryRouter>
          <Chat />
        </MemoryRouter>
      )
      await screen.findByText('HISTORY')

      fireEvent.click(screen.getByTestId('chat-history-toggle'))
      const drawer = await screen.findByTestId('chat-history-drawer')

      fireEvent.click(within(drawer).getByText('Conversation 1'))

      await waitFor(() => {
        expect(screen.queryByTestId('chat-history-drawer')).toBeNull()
      })
    })

    it('closes the history drawer via its Close button', async () => {
      render(
        <MemoryRouter>
          <Chat />
        </MemoryRouter>
      )
      await screen.findByText('HISTORY')

      fireEvent.click(screen.getByTestId('chat-history-toggle'))
      const drawer = await screen.findByTestId('chat-history-drawer')

      fireEvent.click(within(drawer).getByLabelText('Close history'))

      await waitFor(() => {
        expect(screen.queryByTestId('chat-history-drawer')).toBeNull()
      })
    })

    // F2 review finding 1 (HIGH): the drawer must be a real accessible modal.
    it('history drawer is an accessible modal: dialog semantics + initial focus inside', async () => {
      render(
        <MemoryRouter>
          <Chat />
        </MemoryRouter>
      )
      await screen.findByText('HISTORY')

      const toggle = screen.getByTestId('chat-history-toggle')
      toggle.focus()
      fireEvent.click(toggle)

      const drawer = await screen.findByTestId('chat-history-drawer')
      // Radix Dialog semantics: role=dialog labelled by the DialogTitle. (Radix
      // conveys modality by aria-hiding the outside content rather than aria-modal.)
      expect(drawer).toHaveAttribute('role', 'dialog')
      const labelledBy = drawer.getAttribute('aria-labelledby')
      expect(labelledBy).toBeTruthy()
      const title = document.getElementById(labelledBy as string)
      expect(title?.textContent).toBe('History')
      // Initial focus lands inside the drawer (Radix FocusScope).
      await waitFor(() => {
        expect(drawer.contains(document.activeElement)).toBe(true)
      })
    })

    it('contains Tab focus inside the drawer while open', async () => {
      render(
        <MemoryRouter>
          <Chat />
        </MemoryRouter>
      )
      await screen.findByText('HISTORY')

      const toggle = screen.getByTestId('chat-history-toggle')
      toggle.focus()
      fireEvent.click(toggle)
      const drawer = await screen.findByTestId('chat-history-drawer')
      await waitFor(() => {
        expect(drawer.contains(document.activeElement)).toBe(true)
      })

      // Repeated Tab presses never let focus escape the drawer (Radix focus trap
      // wraps at the edges; jsdom performs no default focus moves in between).
      for (let i = 0; i < 6; i++) {
        fireEvent.keyDown(document.activeElement ?? drawer, { key: 'Tab' })
        expect(drawer.contains(document.activeElement)).toBe(true)
      }
      // And Shift+Tab as well.
      for (let i = 0; i < 3; i++) {
        fireEvent.keyDown(document.activeElement ?? drawer, { key: 'Tab', shiftKey: true })
        expect(drawer.contains(document.activeElement)).toBe(true)
      }
    })

    it('Escape closes the drawer and focus returns to the History toggle', async () => {
      render(
        <MemoryRouter>
          <Chat />
        </MemoryRouter>
      )
      await screen.findByText('HISTORY')

      const toggle = screen.getByTestId('chat-history-toggle')
      toggle.focus()
      fireEvent.click(toggle)
      const drawer = await screen.findByTestId('chat-history-drawer')
      await waitFor(() => {
        expect(drawer.contains(document.activeElement)).toBe(true)
      })

      fireEvent.keyDown(document.activeElement ?? drawer, { key: 'Escape' })

      await waitFor(() => {
        expect(screen.queryByTestId('chat-history-drawer')).toBeNull()
      })
      // Focus restoration (Radix onCloseAutoFocus → previously focused element).
      await waitFor(() => {
        expect(document.activeElement).toBe(toggle)
      })
    })

    // F2 review finding 3 (MEDIUM): historyOpen must not survive breakpoint transitions.
    it('resets an open drawer when the container widens past @lg, and it stays closed on re-narrowing', async () => {
      render(
        <MemoryRouter>
          <Chat />
        </MemoryRouter>
      )
      await screen.findByText('HISTORY')

      fireEvent.click(screen.getByTestId('chat-history-toggle'))
      await screen.findByTestId('chat-history-drawer')

      // Widen past the @lg threshold (32rem = 512px at 16px root font size).
      act(() => {
        resizeCallback?.([{ contentRect: { width: 800 } }])
      })
      await waitFor(() => {
        expect(screen.queryByTestId('chat-history-drawer')).toBeNull()
      })

      // Narrow again — the drawer must NOT pop back uninvited.
      act(() => {
        resizeCallback?.([{ contentRect: { width: 400 } }])
      })
      await waitFor(() => {
        expect(screen.getByTestId('chat-history-toggle')).toBeInTheDocument()
      })
      expect(screen.queryByTestId('chat-history-drawer')).toBeNull()
    })

    // F2 review finding 2 (MEDIUM): search/export must keep compact affordances below @lg.
    it('keeps compact search and export icon affordances in narrow mode', async () => {
      ;(window.electronAPI.assistant.getMessages as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { id: 'm1', role: 'user', content: 'alpha question', createdAt: now.toISOString(), sources: null },
        { id: 'm2', role: 'user', content: 'beta question', createdAt: now.toISOString(), sources: null }
      ])

      render(
        <MemoryRouter>
          <Chat />
        </MemoryRouter>
      )
      await screen.findByText('HISTORY')
      await screen.findByText('alpha question')

      // Compact icon affordances exist (the wide-mode group is container-hidden below @lg).
      const searchToggle = screen.getByTestId('chat-search-toggle')
      expect(screen.getByTestId('chat-export-compact')).toBeInTheDocument()

      // Icon-triggered search input appears and actually filters messages.
      fireEvent.click(searchToggle)
      const bar = await screen.findByTestId('chat-search-bar')
      const barInput = within(bar).getByPlaceholderText('Search messages...')
      fireEvent.change(barInput, { target: { value: 'alpha' } })

      await waitFor(() => {
        expect(screen.queryByText('beta question')).toBeNull()
      })
      expect(screen.getByText('alpha question')).toBeInTheDocument()

      // Closing the compact search clears the filter — no invisible filtering.
      fireEvent.click(searchToggle)
      await waitFor(() => {
        expect(screen.queryByTestId('chat-search-bar')).toBeNull()
      })
      expect(screen.getByText('beta question')).toBeInTheDocument()
    })

    it('compact export icon triggers the export flow', async () => {
      ;(window.electronAPI.assistant.getMessages as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { id: 'm1', role: 'user', content: 'exportable message', createdAt: now.toISOString(), sources: null }
      ])
      const saveToFile = vi.fn().mockResolvedValue({ success: true, data: 'saved' })
      ;(window.electronAPI as any).outputs = { saveToFile }

      render(
        <MemoryRouter>
          <Chat />
        </MemoryRouter>
      )
      await screen.findByText('HISTORY')
      await screen.findByText('exportable message')

      fireEvent.click(screen.getByTestId('chat-export-compact'))

      await waitFor(() => {
        expect(saveToFile).toHaveBeenCalled()
      })
    })

    it('keeps the send-row caption on a single line (never wraps one-word-per-line)', async () => {
      render(
        <MemoryRouter>
          <Chat />
        </MemoryRouter>
      )
      await screen.findByText('HISTORY')

      const caption = screen.getByText('I answer based on your meeting transcripts and documents.')
      // `truncate` forces a single line; `@sm:block` hides it entirely in the
      // sub-24rem overlay so it can never collapse into a one-word-per-line column.
      expect(caption.className).toContain('truncate')
      expect(caption.className).toContain('@sm:block')
    })
  })
})
