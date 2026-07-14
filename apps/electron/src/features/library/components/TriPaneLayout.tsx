/**
 * TriPaneLayout Component
 *
 * Responsive layout for the Library page. The AI assistant now has a UNIFIED
 * placement model shared with the global chat-bubble (see useUIStore):
 *
 *  - `floating`  → two-pane layout (list | reader). The assistant lives as a
 *                  floating chat-bubble + overlay (FloatingAssistant) that hovers
 *                  over the app and does NOT push content. Pin → embed.
 *  - `embedded`  → the assistant is a docked pane flanking the reader (classic
 *                  three-pane). Collapsible to a thin side rail — using the SAME
 *                  affordance as the "Sources" list pane, so both panes behave
 *                  identically. Unpin → float.
 *
 * `chatPosition` (Left/Right) picks the side the assistant favours: the floating
 * bubble corner, and the docked pane's edge.
 *
 * Breakpoints:
 *  - Desktop (≥1024px): resizable panes + unified dockable assistant (above).
 *  - Tablet (480–1023px): resizable two-pane + toggleable assistant overlay.
 *  - Mobile (<480px): single pane with tab navigation.
 *
 * Panel sizes persist across navigation via useLibraryStore / useUIStore.
 */

import { useState, useEffect, type ReactNode } from 'react'
import {
  Sparkles,
  PinOff,
  List,
  X,
  PanelLeftClose,
  PanelRightClose,
  PanelLeftOpen,
  PanelRightOpen,
  type LucideIcon
} from 'lucide-react'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'
import { cn } from '@/lib/utils'
import { useLibraryStore } from '@/store/useLibraryStore'
import {
  useUIStore,
  useChatPlacement,
  useChatPosition,
  useChatEmbeddedCollapsed
} from '@/store/ui/useUIStore'
import { useIsMobile, useIsTablet } from '@/hooks/useMediaQuery'
import { FloatingAssistant } from '@/components/assistant/FloatingAssistant'

interface TriPaneLayoutProps {
  leftPanel: React.ReactNode
  centerPanel: React.ReactNode
  rightPanel: React.ReactNode
}

type Side = 'left' | 'right'

/** Thin side rail shown when a pane is collapsed — one click reopens it. */
function SideRail({
  side,
  icon: Icon,
  label,
  onExpand,
  expandLabel,
  expandTitle
}: {
  side: Side
  icon: LucideIcon
  label: string
  onExpand: () => void
  expandLabel: string
  expandTitle: string
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 flex-col items-center border-border bg-card/60 px-1 py-3',
        side === 'left' ? 'border-r' : 'border-l'
      )}
    >
      <button
        onClick={onExpand}
        className="flex flex-col items-center gap-2 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={expandLabel}
        title={expandTitle}
      >
        <Icon className="h-5 w-5" aria-hidden={true} />
        <span className="rotate-180 text-[11px] font-medium tracking-wide [writing-mode:vertical-rl]">{label}</span>
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
  // Persisted list-column width + collapse state (remembered across nav/restart).
  const listPaneSize = useLibraryStore((state) => state.listPaneSize)
  const setListPaneSize = useLibraryStore((state) => state.setListPaneSize)
  const listCollapsed = useLibraryStore((state) => state.listCollapsed)
  const setListCollapsed = useLibraryStore((state) => state.setListCollapsed)

  // Unified assistant placement (global, persisted in useUIStore).
  const chatPlacement = useChatPlacement()
  const chatPosition = useChatPosition()
  const chatCollapsed = useChatEmbeddedCollapsed()
  const setChatPlacement = useUIStore((s) => s.setChatPlacement)
  const setChatOpen = useUIStore((s) => s.setChatOpen)
  const setChatEmbeddedCollapsed = useUIStore((s) => s.setChatEmbeddedCollapsed)

  // Responsive breakpoint detection
  const isMobile = useIsMobile()
  const isTablet = useIsTablet()

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

  // ---- Shared desktop pane/rail builders (unify list + assistant) ----
  const listPane = (side: Side) => (
    <SidePaneChromeWithCollapse
      side={side}
      icon={List}
      title="Sources"
      regionLabel="Recording list"
      collapseLabel="Collapse the source list"
      collapseTitle="Collapse the list — give the reader more room"
      onCollapse={() => setListCollapsed(true)}
    >
      {leftPanel}
    </SidePaneChromeWithCollapse>
  )

  const handleUnpin = () => {
    setChatPlacement('floating')
    setChatOpen(true)
  }

  const assistantPane = (side: Side) => (
    <SidePaneChromeWithCollapse
      side={side}
      icon={Sparkles}
      title="Assistant"
      regionLabel="AI Assistant"
      collapseLabel="Collapse assistant"
      collapseTitle="Collapse the assistant"
      onCollapse={() => setChatEmbeddedCollapsed(true)}
      extra={
        <button
          onClick={handleUnpin}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Unpin assistant (float as overlay)"
          title="Unpin — float the assistant as an overlay"
        >
          <PinOff className="h-4 w-4" aria-hidden={true} />
        </button>
      }
    >
      {rightPanel}
    </SidePaneChromeWithCollapse>
  )

  const listRail = (side: Side) => (
    <SideRail
      side={side}
      icon={side === 'left' ? PanelLeftOpen : PanelRightOpen}
      label="Sources"
      onExpand={() => setListCollapsed(false)}
      expandLabel="Open the source list"
      expandTitle="Show sources"
    />
  )

  const assistantRail = (side: Side) => (
    <SideRail
      side={side}
      icon={side === 'left' ? PanelLeftOpen : PanelRightOpen}
      label="Assistant"
      onExpand={() => setChatEmbeddedCollapsed(false)}
      expandLabel="Open the AI assistant for this source"
      expandTitle="Ask about this source"
    />
  )

  const readerPane = (
    <div role="region" aria-label="Recording content viewer" className="h-full overflow-hidden">
      {centerPanel}
    </div>
  )

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
            <div role="region" aria-label="Recording list" className="h-full overflow-auto">
              {leftPanel}
            </div>
          )}
          {activeMobilePane === 'center' && (
            <div role="region" aria-label="Recording content viewer" className="h-full overflow-hidden">
              {centerPanel}
            </div>
          )}
          {activeMobilePane === 'right' && (
            <div role="region" aria-label="AI Assistant" className="h-full overflow-hidden">
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
          <ResizablePanel defaultSize={panelSizes[0] ?? 30} minSize={25} maxSize={45} id="left-panel-tablet">
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

  // ---------------------------------------------------------------------------
  // Desktop Layout — unified placement model.
  // ---------------------------------------------------------------------------

  // EMBEDDED: the assistant is a docked pane flanking the reader. List + assistant
  // sit on opposite outer edges; `chatPosition` decides which side the assistant
  // takes. Each pane collapses to a rail with the identical affordance.
  if (chatPlacement === 'embedded') {
    const listSide: Side = chatPosition === 'right' ? 'left' : 'right'
    const assistantSide: Side = chatPosition === 'right' ? 'right' : 'left'
    const order: Array<'list' | 'reader' | 'assistant'> =
      chatPosition === 'right' ? ['list', 'reader', 'assistant'] : ['assistant', 'reader', 'list']

    // Build the resizable panels in visual order, skipping any collapsed pane.
    const listDefault = clampListSize(listPaneSize, 35)
    const assistantDefault = 28
    const panelDefs: Array<{ id: string; node: ReactNode; min: number; max?: number; defaultSize: number }> = []
    for (const id of order) {
      if (id === 'list' && !listCollapsed) {
        panelDefs.push({ id: 'embedded-list', node: listPane(listSide), min: 18, max: 35, defaultSize: listDefault })
      } else if (id === 'assistant' && !chatCollapsed) {
        panelDefs.push({ id: 'embedded-assistant', node: assistantPane(assistantSide), min: 20, max: 40, defaultSize: assistantDefault })
      } else if (id === 'reader') {
        panelDefs.push({ id: 'embedded-reader', node: readerPane, min: 30, defaultSize: 0 })
      }
    }
    const sideTotal = panelDefs.filter((p) => p.id !== 'embedded-reader').reduce((a, p) => a + p.defaultSize, 0)
    const readerDefault = Math.max(30, 100 - sideTotal)
    const listIndex = panelDefs.findIndex((p) => p.id === 'embedded-list')

    // Rails live on the OUTER edge (their own side), outside the resizable group.
    const listRailNode = listCollapsed ? listRail(listSide) : null
    const assistantRailNode = chatCollapsed ? assistantRail(assistantSide) : null
    const leftRail = listSide === 'left' ? listRailNode : assistantRailNode
    const rightRail = listSide === 'left' ? assistantRailNode : listRailNode

    // Remount the group when the structural signature changes so react-resizable
    // -panels re-derives sizes cleanly (no stale cached widths).
    const sig = `${chatPosition}-${listCollapsed ? 'lc' : 'le'}-${chatCollapsed ? 'cc' : 'ce'}`

    return (
      <div className="flex h-full">
        {leftRail}
        <ResizablePanelGroup
          key={sig}
          direction="horizontal"
          className="h-full flex-1 min-w-0"
          onLayout={(sizes) => {
            if (listIndex >= 0 && typeof sizes[listIndex] === 'number') setListPaneSize(sizes[listIndex])
          }}
        >
          {panelDefs.map((p, i) => (
            <PanelWithHandle
              key={p.id}
              first={i === 0}
              id={p.id}
              minSize={p.min}
              maxSize={p.max}
              defaultSize={p.id === 'embedded-reader' ? readerDefault : p.defaultSize}
            >
              {p.node}
            </PanelWithHandle>
          ))}
        </ResizablePanelGroup>
        {rightRail}
      </div>
    )
  }

  // FLOATING: two panes (list | reader) fill the width; the assistant lives as a
  // floating chat-bubble + overlay hovering over the app. The list still collapses
  // to a rail (identical affordance).
  const twoPaneListSize = clampListSize(listPaneSize, 45)

  return (
    <div className="flex h-full relative overflow-hidden">
      {listCollapsed ? (
        <>
          {listRail('left')}
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
          <ResizablePanel defaultSize={twoPaneListSize} minSize={18} maxSize={45} id="left-panel-2pane">
            {listPane('left')}
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={100 - twoPaneListSize} minSize={40} id="center-panel-2pane">
            <div role="region" aria-label="Recording content viewer" className="h-full overflow-hidden">
              {centerPanel}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      )}

      <FloatingAssistant title="Assistant">{rightPanel}</FloatingAssistant>
    </div>
  )
}

/** A ResizablePanel preceded by a handle (except the first) — keeps the map tidy. */
function PanelWithHandle({
  first,
  id,
  minSize,
  maxSize,
  defaultSize,
  children
}: {
  first: boolean
  id: string
  minSize: number
  maxSize?: number
  defaultSize: number
  children: ReactNode
}) {
  return (
    <>
      {!first && <ResizableHandle withHandle />}
      <ResizablePanel id={id} minSize={minSize} maxSize={maxSize} defaultSize={defaultSize}>
        {children}
      </ResizablePanel>
    </>
  )
}

/**
 * SidePaneChrome that wires its own Collapse button. Kept separate from the
 * presentational scaffold so the collapse handler stays local and the header
 * markup is shared verbatim between the list and the assistant panes.
 */
function SidePaneChromeWithCollapse({
  side,
  icon: Icon,
  title,
  regionLabel,
  collapseLabel,
  collapseTitle,
  onCollapse,
  extra,
  children
}: {
  side: Side
  icon: LucideIcon
  title: string
  regionLabel: string
  collapseLabel: string
  collapseTitle: string
  onCollapse: () => void
  extra?: ReactNode
  children: ReactNode
}) {
  const CollapseIcon = side === 'left' ? PanelLeftClose : PanelRightClose
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-muted/40 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden={true} />
          <h3 className="truncate text-sm font-semibold text-foreground">{title}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {extra}
          <button
            onClick={onCollapse}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={collapseLabel}
            title={collapseTitle}
          >
            <CollapseIcon className="h-4 w-4" aria-hidden={true} />
          </button>
        </div>
      </div>
      <div role="region" aria-label={regionLabel} className="min-h-0 flex-1 overflow-auto">
        {children}
      </div>
    </div>
  )
}
