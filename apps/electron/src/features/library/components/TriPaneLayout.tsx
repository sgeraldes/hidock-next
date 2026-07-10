/**
 * TriPaneLayout Component
 *
 * Responsive layout for the Library page. The AI assistant is a DOCKABLE,
 * source-scoped surface with three desktop states (persisted in useLibraryStore):
 *
 *  - `pinned`    → classic three-pane layout (list | reader | assistant).
 *  - `floating`  → two-pane layout (list | reader, reader takes the freed width)
 *                  with the assistant open as a right-docked overlay drawer.
 *  - `collapsed` → two-pane layout with the assistant reduced to a thin icon rail
 *                  (default) — the reader gets the whole width.
 *
 * Breakpoints:
 *  - Desktop (≥1024px): resizable panes + dockable assistant (above).
 *  - Tablet (480–1023px): resizable two-pane + toggleable assistant overlay.
 *  - Mobile (<480px): single pane with tab navigation.
 *
 * Panel sizes persist across navigation via useLibraryStore.
 */

import { useState, useEffect } from 'react'
import { Sparkles, Pin, PinOff, PanelRightClose, PanelLeftClose, PanelLeftOpen, List, X } from 'lucide-react'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'
import { useLibraryStore, type AssistantDock } from '@/store/useLibraryStore'
import { useIsMobile, useIsTablet } from '@/hooks/useMediaQuery'

interface TriPaneLayoutProps {
  leftPanel: React.ReactNode
  centerPanel: React.ReactNode
  rightPanel: React.ReactNode
}

/**
 * Chrome (title + dock controls) shared by the pinned pane and the floating
 * drawer. Keeps the assistant's affordances — Pin/Unpin and Collapse — in one
 * place and consistent between the two desktop presentations.
 */
function AssistantChrome({
  dock,
  onDockChange
}: {
  dock: AssistantDock
  onDockChange: (dock: AssistantDock) => void
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/40">
      <div className="flex items-center gap-2 min-w-0">
        <Sparkles className="h-4 w-4 text-primary shrink-0" aria-hidden="true" />
        <h3 className="font-semibold text-sm text-foreground truncate">Ask about this source</h3>
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        {dock === 'pinned' ? (
          <button
            onClick={() => onDockChange('floating')}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Unpin assistant (float as overlay)"
            title="Unpin — float the assistant as an overlay"
          >
            <PinOff className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <button
            onClick={() => onDockChange('pinned')}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Pin assistant (dock as a permanent pane)"
            title="Pin — dock the assistant as a permanent pane"
          >
            <Pin className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
        <button
          onClick={() => onDockChange('collapsed')}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Collapse assistant"
          title="Collapse the assistant"
        >
          {dock === 'pinned' ? <PanelRightClose className="h-4 w-4" aria-hidden="true" /> : <X className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
    </div>
  )
}

/** Thin right rail shown when the assistant is collapsed — one click reopens it. */
function AssistantRail({ onExpand }: { onExpand: () => void }) {
  return (
    <div className="flex flex-col items-center border-l border-border bg-card/60 py-3 px-1 shrink-0">
      <button
        onClick={onExpand}
        className="flex flex-col items-center gap-2 rounded-md p-1.5 text-muted-foreground hover:text-primary hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Open the AI assistant for this source"
        title="Ask about this source"
      >
        <Sparkles className="h-5 w-5" aria-hidden="true" />
        <span className="[writing-mode:vertical-rl] rotate-180 text-[11px] font-medium tracking-wide">Assistant</span>
      </button>
    </div>
  )
}

/**
 * Chrome around the source list: a slim title bar (giving the otherwise-untitled
 * list pane a name — a discoverability win) plus a Collapse control. Collapsing
 * lets the reader reclaim the full width when the list has become a narrow rail,
 * mirroring the dockable assistant. The list content scrolls below the bar.
 */
function ListPaneChrome({
  onCollapse,
  children
}: {
  onCollapse: () => void
  children: React.ReactNode
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-muted/40 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <List className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
          <h3 className="font-semibold text-sm text-foreground truncate">Sources</h3>
        </div>
        <button
          onClick={onCollapse}
          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Collapse the source list"
          title="Collapse the list — give the reader more room"
        >
          <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div role="region" aria-label="Recording list" className="flex-1 overflow-auto">
        {children}
      </div>
    </div>
  )
}

/** Thin left rail shown when the list is collapsed — one click reopens it. */
function ListRail({ onExpand }: { onExpand: () => void }) {
  return (
    <div className="flex flex-col items-center border-r border-border bg-card/60 py-3 px-1 shrink-0">
      <button
        onClick={onExpand}
        className="flex flex-col items-center gap-2 rounded-md p-1.5 text-muted-foreground hover:text-primary hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Open the source list"
        title="Show sources"
      >
        <PanelLeftOpen className="h-5 w-5" aria-hidden="true" />
        <span className="[writing-mode:vertical-rl] rotate-180 text-[11px] font-medium tracking-wide">Sources</span>
      </button>
    </div>
  )
}

/** Clamp a persisted list-pane percentage into a layout's allowed [18, max] band. */
function clampListSize(size: number, max: number): number {
  if (!Number.isFinite(size)) return Math.min(max, 25)
  return Math.max(18, Math.min(max, size))
}

export function TriPaneLayout({ leftPanel, centerPanel, rightPanel }: TriPaneLayoutProps) {
  const panelSizes = useLibraryStore((state) => state.panelSizes)
  const setPanelSizes = useLibraryStore((state) => state.setPanelSizes)
  const assistantDock = useLibraryStore((state) => state.assistantDock)
  const setAssistantDock = useLibraryStore((state) => state.setAssistantDock)
  // Persisted list-column width + collapse state (remembered across nav/restart).
  const listPaneSize = useLibraryStore((state) => state.listPaneSize)
  const setListPaneSize = useLibraryStore((state) => state.setListPaneSize)
  const listCollapsed = useLibraryStore((state) => state.listCollapsed)
  const setListCollapsed = useLibraryStore((state) => state.setListCollapsed)

  // Normalize panel sizes to ensure they total 100% and respect constraints
  const normalizeDesktopPanelSizes = (sizes: number[]): [number, number, number] => {
    const [left = 32, center = 42, right = 26] = sizes
    const total = left + center + right

    if (Math.abs(total - 100) < 0.1) {
      // Already normalized
      return [left, center, right]
    }

    // Normalize to 100% while respecting min/max constraints
    const scale = 100 / total
    const normalized = [
      Math.max(20, Math.min(35, left * scale)),   // left: min 20, max 35
      Math.max(30, center * scale),                // center: min 30, no max
      Math.max(20, Math.min(40, right * scale))    // right: min 20, max 40
    ]

    // Ensure final total is exactly 100
    const normalizedTotal = normalized[0] + normalized[1] + normalized[2]
    if (Math.abs(normalizedTotal - 100) > 0.1) {
      // Adjust center panel to make up the difference
      normalized[1] = 100 - normalized[0] - normalized[2]
    }

    return normalized as [number, number, number]
  }

  const desktopPanelSizes = normalizeDesktopPanelSizes(panelSizes)

  // Responsive breakpoint detection
  const isMobile = useIsMobile()
  const isTablet = useIsTablet()
  // Desktop layout is default when neither mobile nor tablet

  // Mobile: Track active pane
  const [activeMobilePane, setActiveMobilePane] = useState<'left' | 'center' | 'right'>('center')

  // Tablet: Track right panel visibility
  const [showRightPanelTablet, setShowRightPanelTablet] = useState(false)

  // Persist mobile tab selection
  useEffect(() => {
    const saved = localStorage.getItem('mobile-active-pane')
    if (saved && isMobile) {
      setActiveMobilePane(saved as 'left' | 'center' | 'right')
    }
  }, [isMobile])

  useEffect(() => {
    if (isMobile) {
      localStorage.setItem('mobile-active-pane', activeMobilePane)
    }
  }, [activeMobilePane, isMobile])

  // Mobile Layout: Single pane with tab navigation
  if (isMobile) {
    return (
      <div className="flex flex-col h-full">
        {/* Tab Navigation */}
        <div className="flex border-b border-border bg-card">
          <button
            onClick={() => setActiveMobilePane('left')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeMobilePane === 'left'
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            aria-label="Show recording list"
            aria-pressed={activeMobilePane === 'left'}
          >
            Sources
          </button>
          <button
            onClick={() => setActiveMobilePane('center')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeMobilePane === 'center'
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            aria-label="Show recording content"
            aria-pressed={activeMobilePane === 'center'}
          >
            Content
          </button>
          <button
            onClick={() => setActiveMobilePane('right')}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeMobilePane === 'right'
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            aria-label="Show AI assistant"
            aria-pressed={activeMobilePane === 'right'}
          >
            Assistant
          </button>
        </div>

        {/* Active Pane Content */}
        <div className="flex-1 overflow-hidden">
          {activeMobilePane === 'left' && (
            <div
              role="region"
              aria-label="Recording list"
              className="h-full overflow-auto"
            >
              {leftPanel}
            </div>
          )}
          {activeMobilePane === 'center' && (
            <div
              role="region"
              aria-label="Recording content viewer"
              className="h-full overflow-hidden"
            >
              {centerPanel}
            </div>
          )}
          {activeMobilePane === 'right' && (
            <div
              role="region"
              aria-label="AI Assistant"
              className="h-full overflow-hidden"
            >
              {rightPanel}
            </div>
          )}
        </div>
      </div>
    )
  }

  // Tablet Layout: Two-pane resizable layout with toggleable assistant overlay
  if (isTablet) {
    return (
      <div className="flex h-full relative">
        <ResizablePanelGroup
          direction="horizontal"
          onLayout={(sizes) => {
            setPanelSizes([sizes[0] ?? 30, sizes[1] ?? 70, panelSizes[2] ?? 30])
          }}
          className="flex-1"
        >
          <ResizablePanel
            defaultSize={panelSizes[0] ?? 30}
            minSize={25}
            maxSize={45}
            id="left-panel-tablet"
          >
            <div role="region" aria-label="Recording list" className="h-full overflow-auto">
              {leftPanel}
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={panelSizes[1] ?? 70} minSize={40} id="center-panel-tablet">
            <div role="region" aria-label="Recording content viewer" className="h-full overflow-hidden">
              {centerPanel}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>

        {/* Assistant overlay drawer */}
        {showRightPanelTablet && (
          <div
            role="region"
            aria-label="AI Assistant"
            className="w-80 max-w-[80vw] border-l border-border overflow-hidden shadow-lg bg-card flex-shrink-0 z-10 flex flex-col"
          >
            <div className="flex justify-between items-center px-3 py-2 border-b border-border bg-muted/40">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
                <h3 className="font-semibold text-sm text-foreground">Ask about this source</h3>
              </div>
              <button
                onClick={() => setShowRightPanelTablet(false)}
                className="p-1.5 hover:bg-muted rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Close AI assistant panel"
              >
                <X className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">{rightPanel}</div>
          </div>
        )}

        {!showRightPanelTablet && (
          <button
            onClick={() => setShowRightPanelTablet(true)}
            className="fixed bottom-6 right-6 bg-primary text-primary-foreground px-4 py-3 rounded-full shadow-lg hover:bg-primary/90 transition-colors flex items-center gap-2 z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Open AI assistant panel"
          >
            <Sparkles className="w-5 h-5" aria-hidden="true" />
            <span className="text-sm font-medium">Assistant</span>
          </button>
        )}
      </div>
    )
  }

  // The pinned assistant pane (title chrome + assistant), shared by the pinned
  // layout whether or not the list is collapsed.
  const pinnedAssistantPane = (
    <div role="region" aria-label="AI Assistant" className="h-full overflow-hidden flex flex-col">
      <AssistantChrome dock="pinned" onDockChange={setAssistantDock} />
      <div className="flex-1 overflow-hidden">{rightPanel}</div>
    </div>
  )

  // Desktop Layout — dockable assistant.
  // PINNED: three resizable panes (classic layout). When the list is collapsed,
  // it becomes a thin rail and the reader + assistant share the freed width.
  if (assistantDock === 'pinned') {
    if (listCollapsed) {
      return (
        <div className="flex h-full">
          <ListRail onExpand={() => setListCollapsed(false)} />
          <ResizablePanelGroup direction="horizontal" className="h-full flex-1 min-w-0">
            <ResizablePanel defaultSize={65} minSize={30} id="center-panel-pinned-lc">
              <div role="region" aria-label="Recording content viewer" className="h-full overflow-hidden">
                {centerPanel}
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={35} minSize={20} maxSize={45} id="right-panel-pinned-lc">
              {pinnedAssistantPane}
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      )
    }
    return (
      <ResizablePanelGroup
        direction="horizontal"
        // Persist the split: store the full 3-tuple AND mirror the list width into
        // listPaneSize so the two-pane layout inherits it when the assistant unpins.
        onLayout={(sizes) => {
          setPanelSizes(sizes)
          if (typeof sizes[0] === 'number') setListPaneSize(sizes[0])
        }}
        className="h-full"
      >
        <ResizablePanel defaultSize={desktopPanelSizes[0]} minSize={18} maxSize={35} id="left-panel">
          <ListPaneChrome onCollapse={() => setListCollapsed(true)}>{leftPanel}</ListPaneChrome>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={desktopPanelSizes[1]} minSize={30} id="center-panel">
          <div role="region" aria-label="Recording content viewer" className="h-full overflow-hidden">
            {centerPanel}
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        <ResizablePanel defaultSize={desktopPanelSizes[2]} minSize={20} maxSize={40} id="right-panel">
          {pinnedAssistantPane}
        </ResizablePanel>
      </ResizablePanelGroup>
    )
  }

  // FLOATING / COLLAPSED: two resizable panes (list | reader) that fill the
  // whole width, plus either a right-docked overlay drawer (floating) or a thin
  // icon rail (collapsed). The reader reclaims the width the assistant used to
  // occupy, so wide windows have no dead gutters.
  // Left width for the two-pane layout comes from the persisted listPaneSize so a
  // resize the user makes is REMEMBERED across navigation and restart. It is NOT
  // written back into the 3-tuple panelSizes (whose semantics only fit the pinned
  // layout), which is what previously mangled the width on remount.
  const twoPaneListSize = clampListSize(listPaneSize, 45)

  return (
    <div className="flex h-full relative overflow-hidden">
      {listCollapsed ? (
        // Collapsed: the list is a thin rail and the reader takes the whole width
        // (minus the assistant), so the user is never stuck with a crushed list.
        <>
          <ListRail onExpand={() => setListCollapsed(false)} />
          <div role="region" aria-label="Recording content viewer" className="flex-1 min-w-0 overflow-hidden">
            {centerPanel}
          </div>
        </>
      ) : (
        <ResizablePanelGroup
          direction="horizontal"
          onLayout={(sizes) => {
            if (typeof sizes[0] === 'number') setListPaneSize(sizes[0])
          }}
          className="flex-1 min-w-0"
        >
          <ResizablePanel
            defaultSize={twoPaneListSize}
            minSize={18}
            maxSize={45}
            id="left-panel-2pane"
          >
            <ListPaneChrome onCollapse={() => setListCollapsed(true)}>{leftPanel}</ListPaneChrome>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={100 - twoPaneListSize} minSize={40} id="center-panel-2pane">
            <div role="region" aria-label="Recording content viewer" className="h-full overflow-hidden">
              {centerPanel}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      )}

      {assistantDock === 'floating' ? (
        <div
          role="complementary"
          aria-label="AI Assistant"
          className="w-[22rem] max-w-[40vw] xl:w-96 border-l border-border bg-card shadow-xl flex flex-col shrink-0 z-10"
        >
          <AssistantChrome dock="floating" onDockChange={setAssistantDock} />
          <div className="flex-1 overflow-hidden">{rightPanel}</div>
        </div>
      ) : (
        <AssistantRail onExpand={() => setAssistantDock('floating')} />
      )}
    </div>
  )
}
