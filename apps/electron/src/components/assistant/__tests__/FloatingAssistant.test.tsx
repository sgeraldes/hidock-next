import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FloatingAssistant } from '../FloatingAssistant'
import { useUIStore } from '@/store/ui/useUIStore'

function renderBubble() {
  return render(
    <FloatingAssistant>
      <div data-testid="chat-body">CHAT</div>
    </FloatingAssistant>
  )
}

beforeEach(() => {
  window.localStorage.clear()
  const ui = useUIStore.getState()
  ui.setChatPlacement('floating')
  ui.setChatPosition('right')
  ui.setChatOpen(false)
})

describe('FloatingAssistant', () => {
  it('renders the chat-bubble button and hosts nothing until opened', () => {
    renderBubble()
    expect(screen.getByLabelText(/Open AI assistant/i)).toBeInTheDocument()
    expect(screen.queryByTestId('chat-body')).not.toBeInTheDocument()
  })

  it('opening the overlay hosts the provided chat content (no rebuild)', () => {
    renderBubble()
    fireEvent.click(screen.getByLabelText(/Open AI assistant/i))

    expect(useUIStore.getState().chatOpen).toBe(true)
    expect(screen.getByRole('dialog', { name: /AI Assistant/i })).toBeInTheDocument()
    expect(screen.getByTestId('chat-body')).toBeInTheDocument()
  })

  it('click-away on the scrim dismisses the overlay', () => {
    useUIStore.getState().setChatOpen(true)
    renderBubble()
    fireEvent.click(screen.getByTestId('floating-assistant-scrim'))
    expect(useUIStore.getState().chatOpen).toBe(false)
  })

  it('Escape dismisses the overlay', () => {
    useUIStore.getState().setChatOpen(true)
    renderBubble()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(useUIStore.getState().chatOpen).toBe(false)
  })

  it('pin switches placement to embedded and closes the overlay', () => {
    useUIStore.getState().setChatOpen(true)
    renderBubble()
    fireEvent.click(screen.getByLabelText(/Pin assistant/i))
    expect(useUIStore.getState().chatPlacement).toBe('embedded')
    expect(useUIStore.getState().chatOpen).toBe(false)
  })

  it('honors left position (anchors the bubble to the left edge)', () => {
    useUIStore.getState().setChatPosition('left')
    renderBubble()
    expect(screen.getByLabelText(/Open AI assistant/i).className).toContain('left-4')
  })
})
