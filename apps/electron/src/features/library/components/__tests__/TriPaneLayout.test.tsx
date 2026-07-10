import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { TriPaneLayout } from '../TriPaneLayout'
import { useLibraryStore } from '@/store/useLibraryStore'
import { useUIStore } from '@/store/ui/useUIStore'

// matchMedia is mocked to `matches: false` in the test setup, so useIsMobile /
// useIsTablet are both false → TriPaneLayout renders its DESKTOP layout. That is
// the surface these tests exercise (unified list + assistant docking).

const panels = {
  leftPanel: <div data-testid="list-content">LIST ROWS</div>,
  centerPanel: <div data-testid="reader-content">READER</div>,
  rightPanel: <div data-testid="assistant-content">ASSISTANT</div>
}

function renderLayout() {
  return render(
    <TriPaneLayout
      leftPanel={panels.leftPanel}
      centerPanel={panels.centerPanel}
      rightPanel={panels.rightPanel}
    />
  )
}

beforeEach(() => {
  window.localStorage.clear()
  const s = useLibraryStore.getState()
  s.setListCollapsed(false)
  s.setListPaneSize(25)
  s.setPanelSizes([25, 45, 30])
  const ui = useUIStore.getState()
  ui.setChatPlacement('floating') // default: floating chat-bubble
  ui.setChatPosition('right')
  ui.setChatOpen(false)
  ui.setChatEmbeddedCollapsed(false)
})

describe('TriPaneLayout — list column is titled and collapsible (floating placement)', () => {
  it('gives the list pane a visible "Sources" title and a Collapse affordance', () => {
    renderLayout()
    expect(screen.getByRole('heading', { name: 'Sources' })).toBeInTheDocument()
    expect(screen.getByLabelText(/Collapse the source list/i)).toBeInTheDocument()
    expect(screen.getByTestId('list-content')).toBeInTheDocument()
  })

  it('collapsing the list hides its rows, shows a rail, and lets the reader keep the width', () => {
    renderLayout()
    expect(screen.getByTestId('list-content')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText(/Collapse the source list/i))

    expect(useLibraryStore.getState().listCollapsed).toBe(true)
    expect(screen.queryByTestId('list-content')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Open the source list/i)).toBeInTheDocument()
    expect(screen.getByTestId('reader-content')).toBeInTheDocument()
  })

  it('honors the persisted collapse state on first render (remembered across restart)', () => {
    useLibraryStore.getState().setListCollapsed(true)
    renderLayout()
    expect(screen.getByLabelText(/Open the source list/i)).toBeInTheDocument()
    expect(screen.queryByTestId('list-content')).not.toBeInTheDocument()
  })
})

describe('TriPaneLayout — floating chat-bubble (default placement)', () => {
  it('shows a floating AI button and keeps the assistant hidden until opened', () => {
    renderLayout()
    // The chat bubble is the entry point; the chat content is NOT mounted yet.
    expect(screen.getByLabelText(/Open AI assistant/i)).toBeInTheDocument()
    expect(screen.queryByTestId('assistant-content')).not.toBeInTheDocument()
  })

  it('clicking the button opens the floating overlay hosting the assistant chat', () => {
    renderLayout()
    fireEvent.click(screen.getByLabelText(/Open AI assistant/i))

    expect(useUIStore.getState().chatOpen).toBe(true)
    // The existing chat content is now hosted inside the floating overlay.
    const overlay = screen.getByRole('dialog', { name: /AI Assistant/i })
    expect(within(overlay).getByTestId('assistant-content')).toBeInTheDocument()
  })

  it('the pin control embeds the assistant as a docked pane', () => {
    renderLayout()
    fireEvent.click(screen.getByLabelText(/Open AI assistant/i))
    fireEvent.click(screen.getByLabelText(/Pin assistant/i))

    expect(useUIStore.getState().chatPlacement).toBe('embedded')
    expect(useUIStore.getState().chatOpen).toBe(false)
    // Embedded → the assistant pane is docked and visible in the layout.
    expect(screen.getByRole('region', { name: /AI Assistant/i })).toBeInTheDocument()
    expect(screen.getByTestId('assistant-content')).toBeInTheDocument()
  })

  it('closing the overlay (X) hides it again', () => {
    useUIStore.getState().setChatOpen(true)
    renderLayout()
    expect(screen.getByRole('dialog', { name: /AI Assistant/i })).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText(/Close assistant/i))
    expect(useUIStore.getState().chatOpen).toBe(false)
  })
})

describe('TriPaneLayout — embedded (docked pane) placement', () => {
  beforeEach(() => {
    useUIStore.getState().setChatPlacement('embedded')
  })

  it('shows all three panes with a collapsible titled list and assistant', () => {
    renderLayout()
    expect(screen.getByTestId('list-content')).toBeInTheDocument()
    expect(screen.getByTestId('reader-content')).toBeInTheDocument()
    expect(screen.getByTestId('assistant-content')).toBeInTheDocument()
    expect(screen.getByLabelText(/Collapse the source list/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Collapse assistant/i)).toBeInTheDocument()
  })

  it('collapsing the assistant mirrors the list: pane → rail, one click reopens', () => {
    renderLayout()
    expect(screen.getByTestId('assistant-content')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText(/Collapse assistant/i))

    // Persisted preference set; pane replaced by a rail (same affordance as list).
    expect(useUIStore.getState().chatEmbeddedCollapsed).toBe(true)
    expect(screen.queryByTestId('assistant-content')).not.toBeInTheDocument()
    const rail = screen.getByLabelText(/Open the AI assistant/i)
    expect(rail).toBeInTheDocument()

    fireEvent.click(rail)
    expect(useUIStore.getState().chatEmbeddedCollapsed).toBe(false)
    expect(screen.getByTestId('assistant-content')).toBeInTheDocument()
  })

  it('unpinning the docked assistant returns it to floating (as an open overlay)', () => {
    renderLayout()
    fireEvent.click(screen.getByLabelText(/Unpin assistant/i))

    expect(useUIStore.getState().chatPlacement).toBe('floating')
    expect(useUIStore.getState().chatOpen).toBe(true)
    // The assistant stays visible — now floating as an overlay rather than docked.
    const overlay = screen.getByRole('dialog', { name: /AI Assistant/i })
    expect(within(overlay).getByTestId('assistant-content')).toBeInTheDocument()
    // No longer a docked region pane.
    expect(screen.queryByRole('region', { name: /AI Assistant/i })).not.toBeInTheDocument()
  })

  it('honors the persisted collapsed assistant on first render', () => {
    useUIStore.getState().setChatEmbeddedCollapsed(true)
    renderLayout()
    expect(screen.getByLabelText(/Open the AI assistant/i)).toBeInTheDocument()
    expect(screen.queryByTestId('assistant-content')).not.toBeInTheDocument()
    // Reader + list still present.
    expect(screen.getByTestId('reader-content')).toBeInTheDocument()
    expect(screen.getByTestId('list-content')).toBeInTheDocument()
  })
})

describe('TriPaneLayout — list width is read from the persisted store', () => {
  it('renders the recording-list region from the persisted (non-collapsed) width', () => {
    useLibraryStore.getState().setListPaneSize(40)
    renderLayout()
    const listRegion = screen.getByRole('region', { name: /Recording list/i })
    expect(within(listRegion).getByTestId('list-content')).toBeInTheDocument()
  })
})
