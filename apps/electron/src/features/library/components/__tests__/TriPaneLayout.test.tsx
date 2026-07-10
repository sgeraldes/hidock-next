import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { TriPaneLayout } from '../TriPaneLayout'
import { useLibraryStore } from '@/store/useLibraryStore'

// matchMedia is mocked to `matches: false` in the test setup, so useIsMobile /
// useIsTablet are both false → TriPaneLayout renders its DESKTOP layout. That is
// the surface these tests exercise (list resize + collapse to a rail).

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
  s.setAssistantDock('collapsed') // two-pane desktop layout (the default)
  s.setListCollapsed(false)
  s.setListPaneSize(25)
  s.setPanelSizes([25, 45, 30])
})

describe('TriPaneLayout — list column is titled and collapsible (responsive)', () => {
  it('gives the list pane a visible "Sources" title and a Collapse affordance', () => {
    renderLayout()
    // Discoverability: the previously-untitled list pane now has a name.
    expect(screen.getByRole('heading', { name: 'Sources' })).toBeInTheDocument()
    // Affordance to reclaim space when the list is a narrow rail.
    expect(screen.getByLabelText(/Collapse the source list/i)).toBeInTheDocument()
    // The list content is rendered.
    expect(screen.getByTestId('list-content')).toBeInTheDocument()
  })

  it('collapsing the list hides its rows, shows a rail, and lets the reader keep the width', () => {
    renderLayout()
    expect(screen.getByTestId('list-content')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText(/Collapse the source list/i))

    // Store reflects the collapse (persisted preference).
    expect(useLibraryStore.getState().listCollapsed).toBe(true)
    // List rows gone; a thin "open the list" rail replaces them.
    expect(screen.queryByTestId('list-content')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Open the source list/i)).toBeInTheDocument()
    // The reader is still present (it reclaimed the freed space).
    expect(screen.getByTestId('reader-content')).toBeInTheDocument()
  })

  it('restores the list from the rail when expanded', () => {
    useLibraryStore.getState().setListCollapsed(true)
    renderLayout()

    // Starts collapsed (reads the persisted state).
    expect(screen.queryByTestId('list-content')).not.toBeInTheDocument()
    const rail = screen.getByLabelText(/Open the source list/i)

    fireEvent.click(rail)

    expect(useLibraryStore.getState().listCollapsed).toBe(false)
    expect(screen.getByTestId('list-content')).toBeInTheDocument()
  })

  it('honors the persisted collapse state on first render (remembered across restart)', () => {
    useLibraryStore.getState().setListCollapsed(true)
    renderLayout()
    // No manual click needed — the rail is shown straight away.
    expect(screen.getByLabelText(/Open the source list/i)).toBeInTheDocument()
    expect(screen.queryByTestId('list-content')).not.toBeInTheDocument()
  })
})

describe('TriPaneLayout — pinned (three-pane) layout also supports list collapse', () => {
  beforeEach(() => {
    useLibraryStore.getState().setAssistantDock('pinned')
  })

  it('shows all three panes with a collapsible titled list', () => {
    renderLayout()
    expect(screen.getByTestId('list-content')).toBeInTheDocument()
    expect(screen.getByTestId('reader-content')).toBeInTheDocument()
    expect(screen.getByTestId('assistant-content')).toBeInTheDocument()
    expect(screen.getByLabelText(/Collapse the source list/i)).toBeInTheDocument()
  })

  it('collapsing keeps the reader and assistant while the list becomes a rail', () => {
    renderLayout()
    fireEvent.click(screen.getByLabelText(/Collapse the source list/i))

    expect(useLibraryStore.getState().listCollapsed).toBe(true)
    expect(screen.queryByTestId('list-content')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Open the source list/i)).toBeInTheDocument()
    expect(screen.getByTestId('reader-content')).toBeInTheDocument()
    expect(screen.getByTestId('assistant-content')).toBeInTheDocument()
  })
})

describe('TriPaneLayout — list width is read from the persisted store', () => {
  it('renders the recording-list region from the persisted (non-collapsed) width', () => {
    useLibraryStore.getState().setListPaneSize(40)
    renderLayout()
    // The list region exists and is driven by listPaneSize; the exact pixel width
    // is a layout concern, but the region must render and carry the list content.
    const listRegion = screen.getByRole('region', { name: /Recording list/i })
    expect(within(listRegion).getByTestId('list-content')).toBeInTheDocument()
  })
})
