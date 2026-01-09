# TODO-014: Tri-Pane Layout Implementation

## Objective
Replace the current single-panel Library page with a three-column resizable layout providing simultaneous visibility of recordings list, source content viewer, and AI assistant panel.

## Current State
- Library page is single-panel with filters, bulk actions, and recording list
- SourceDetailDrawer exists as right-slide overlay panel
- TranscriptViewer component available but not integrated
- No resizable panel infrastructure exists

## Target Architecture
```
┌─────────────────────────────────────────────────────────────────────────┐
│ Header: Library Title + Filters + View Toggle + Bulk Actions            │
├──────────────┬─────────────────────────────────┬────────────────────────┤
│              │                                 │                        │
│  Left Pane   │       Center Pane              │     Right Pane         │
│  (25%)       │       (45%)                    │     (30%)              │
│              │                                 │                        │
│  SourceList  │   SourceReader                 │   AssistantPanel       │
│  - Filters   │   - Audio player               │   - Context chat       │
│  - SourceRow │   - TranscriptViewer           │   - Quick actions      │
│  - SourceCard│   - Metadata                   │   - Suggestions        │
│              │                                 │                        │
├──────────────┴─────────────────────────────────┴────────────────────────┤
│                     Resizable Panel Handles                             │
└─────────────────────────────────────────────────────────────────────────┘
```

## Dependencies
- **Prerequisite**: TODO-010 (TimeAnchor), TODO-011 (TranscriptViewer) - **ALREADY EXIST** in codebase:
  - `apps/electron/src/features/library/components/TimeAnchor.tsx` (80 lines)
  - `apps/electron/src/features/library/components/TranscriptViewer.tsx` (241 lines)
- **New Dependency**: `react-resizable-panels@^2.0.0` (pin to v2.x to avoid v4 compatibility issues)

## Accessibility Requirements

Per Architecture Review, each panel must be accessible:

- [ ] Each panel has `role="region"` and `aria-label`
- [ ] Tab order: Left Panel → Center Panel → Right Panel
- [ ] F6 key cycles between panels (standard pattern)
- [ ] Panel resize handles are keyboard-accessible (built-in to react-resizable-panels)
- [ ] Screen reader announces panel size changes via LiveRegion
- [ ] Focus visible indicators on all interactive elements

## Security Requirements

For AssistantPanel input:

- [ ] User input sanitized before display
- [ ] AI responses rendered as text-only (no HTML injection)
- [ ] Query length limit (max 500 characters)
- [ ] Rate limiting for AI queries when integrated (max 10/minute)

## Store State Clarification

- `selectedIds: Set<string>` - Multi-selection for bulk operations (checkboxes)
- `selectedSourceId: string | null` - Single selection for SourceReader display (row click)
- These coexist: clicking a row selects for detail view, checkbox selects for bulk operations

## Implementation Steps

### Step 1: Install Resizable Panels Dependency

```bash
cd apps/electron
npm install react-resizable-panels
```

**Note**: Use v2.x to avoid [known compatibility issues with v4.x](https://github.com/shadcn-ui/ui/issues/9136).

### Step 2: Create shadcn/ui Resizable Component

Create `apps/electron/src/components/ui/resizable.tsx`:

```typescript
import * as React from "react"
import { GripVertical } from "lucide-react"
import * as ResizablePrimitive from "react-resizable-panels"

import { cn } from "@/lib/utils"

const ResizablePanelGroup = ({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelGroup>) => (
  <ResizablePrimitive.PanelGroup
    className={cn(
      "flex h-full w-full data-[panel-group-direction=vertical]:flex-col",
      className
    )}
    {...props}
  />
)

const ResizablePanel = ResizablePrimitive.Panel

const ResizableHandle = ({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelResizeHandle> & {
  withHandle?: boolean
}) => (
  <ResizablePrimitive.PanelResizeHandle
    className={cn(
      "relative flex w-px items-center justify-center bg-border after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-1 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:-translate-y-1/2 data-[panel-group-direction=vertical]:after:translate-x-0 [&[data-panel-group-direction=vertical]>div]:rotate-90",
      className
    )}
    {...props}
  >
    {withHandle && (
      <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border">
        <GripVertical className="h-2.5 w-2.5" />
      </div>
    )}
  </ResizablePrimitive.PanelResizeHandle>
)

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
```

### Step 3: Create TriPaneLayout Component

Create `apps/electron/src/features/library/components/TriPaneLayout.tsx`:

```typescript
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable'
import { useLibraryStore } from '@/store/useLibraryStore'

interface TriPaneLayoutProps {
  leftPanel: React.ReactNode
  centerPanel: React.ReactNode
  rightPanel: React.ReactNode
}

export function TriPaneLayout({ leftPanel, centerPanel, rightPanel }: TriPaneLayoutProps) {
  const { panelSizes, setPanelSizes } = useLibraryStore()

  return (
    <ResizablePanelGroup
      direction="horizontal"
      onLayout={(sizes) => setPanelSizes(sizes)}
      className="h-full"
    >
      <ResizablePanel
        defaultSize={panelSizes[0] ?? 25}
        minSize={15}
        maxSize={35}
        id="left-panel"
      >
        {leftPanel}
      </ResizablePanel>

      <ResizableHandle withHandle />

      <ResizablePanel
        defaultSize={panelSizes[1] ?? 45}
        minSize={30}
        id="center-panel"
      >
        {centerPanel}
      </ResizablePanel>

      <ResizableHandle withHandle />

      <ResizablePanel
        defaultSize={panelSizes[2] ?? 30}
        minSize={20}
        maxSize={40}
        id="right-panel"
      >
        {rightPanel}
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
```

### Step 4: Create SourceReader Component

Create `apps/electron/src/features/library/components/SourceReader.tsx`:

```typescript
import { TranscriptViewer } from './TranscriptViewer'
import { useLibraryStore } from '@/store/useLibraryStore'
import { useUnifiedRecordings } from '@/hooks/useUnifiedRecordings'

export function SourceReader() {
  const { selectedSourceId } = useLibraryStore()
  const { recordings } = useUnifiedRecordings()

  const selectedRecording = recordings.find(r => r.id === selectedSourceId)

  if (!selectedRecording) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Select a recording to view
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Audio Player */}
      <div className="p-4 border-b">
        {/* Audio playback controls here */}
      </div>

      {/* Transcript */}
      <div className="flex-1 overflow-auto">
        <TranscriptViewer recording={selectedRecording} />
      </div>
    </div>
  )
}
```

### Step 5: Create AssistantPanel Component

Create `apps/electron/src/features/library/components/AssistantPanel.tsx`:

```typescript
import { useLibraryStore } from '@/store/useLibraryStore'

export function AssistantPanel() {
  const { selectedSourceId } = useLibraryStore()

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b font-medium">AI Assistant</div>

      <div className="flex-1 overflow-auto p-4">
        {selectedSourceId ? (
          <div className="space-y-4">
            {/* Context-aware suggestions */}
            <div className="text-sm text-muted-foreground">
              Ask questions about this recording...
            </div>
            {/* Chat interface placeholder */}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            Select a recording to get AI assistance
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="p-4 border-t">
        <input
          type="text"
          placeholder="Ask about this recording..."
          className="w-full px-3 py-2 border rounded-md"
          disabled={!selectedSourceId}
        />
      </div>
    </div>
  )
}
```

### Step 6: Update useLibraryStore for Panel State

Add to `apps/electron/src/store/useLibraryStore.ts`:

```typescript
interface LibraryStore {
  // Existing fields...

  // Panel state
  panelSizes: number[]
  setPanelSizes: (sizes: number[]) => void
  selectedSourceId: string | null
  setSelectedSourceId: (id: string | null) => void
}

// In the store creation:
panelSizes: [25, 45, 30],
setPanelSizes: (sizes) => set({ panelSizes: sizes }),
selectedSourceId: null,
setSelectedSourceId: (id) => set({ selectedSourceId: id }),
```

### Step 7: Integrate TriPaneLayout into Library Page

Update `apps/electron/src/pages/Library.tsx` to use TriPaneLayout:

```typescript
import { TriPaneLayout } from '@/features/library/components/TriPaneLayout'
import { SourceReader } from '@/features/library/components/SourceReader'
import { AssistantPanel } from '@/features/library/components/AssistantPanel'

export function Library() {
  // Existing state and hooks...

  return (
    <div className="h-full flex flex-col">
      {/* Header with filters */}
      <div className="p-4 border-b">
        {/* FilterBar, ViewToggle, BulkActions */}
      </div>

      {/* Tri-pane content */}
      <div className="flex-1 overflow-hidden">
        <TriPaneLayout
          leftPanel={
            <div className="h-full overflow-auto">
              {/* Existing SourceRow/SourceCard list */}
            </div>
          }
          centerPanel={<SourceReader />}
          rightPanel={<AssistantPanel />}
        />
      </div>
    </div>
  )
}
```

### Step 8: Add Responsive Breakpoints

Create `apps/electron/src/hooks/useMediaQuery.ts`:

```typescript
import { useState, useEffect } from 'react'

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    const media = window.matchMedia(query)
    setMatches(media.matches)

    const listener = (e: MediaQueryListEvent) => setMatches(e.matches)
    media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  }, [query])

  return matches
}
```

Use in Library.tsx:
```typescript
const isDesktop = useMediaQuery('(min-width: 1024px)')
const isTablet = useMediaQuery('(min-width: 768px)')

// Conditionally render TriPaneLayout, TwoPaneLayout, or SinglePaneLayout
```

## Panel Configuration

| Panel | Component | Default | Min | Max |
|-------|-----------|---------|-----|-----|
| Left | LibraryList | 25% | 15% | 35% |
| Center | SourceReader | 45% | 30% | - |
| Right | AssistantPanel | 30% | 20% | 40% |

## Responsive Strategy

| Breakpoint | Layout | Behavior |
|------------|--------|----------|
| Desktop (>=1024px) | Tri-pane | All three panels visible, resizable |
| Tablet (768-1023px) | Two-pane | Left + Center, collapsible right panel |
| Mobile (<768px) | Single | Bottom tab navigation between panels |

## Files to Create
- `apps/electron/src/components/ui/resizable.tsx`
- `apps/electron/src/features/library/components/TriPaneLayout.tsx`
- `apps/electron/src/features/library/components/SourceReader.tsx`
- `apps/electron/src/features/library/components/AssistantPanel.tsx`
- `apps/electron/src/hooks/useMediaQuery.ts`

## Files to Modify
- `apps/electron/package.json` (add react-resizable-panels)
- `apps/electron/src/store/useLibraryStore.ts` (add panel state)
- `apps/electron/src/pages/Library.tsx` (integrate TriPaneLayout)
- `apps/electron/src/features/library/components/index.ts` (exports)

## Acceptance Criteria
- [ ] Three-pane layout renders correctly on desktop
- [ ] Panels are resizable with drag handles
- [ ] Panel sizes persist across page navigation
- [ ] Selected recording displays in center SourceReader
- [ ] AssistantPanel shows context for selected recording
- [ ] Tablet layout collapses to two panes
- [ ] Mobile layout uses bottom tab navigation
- [ ] Keyboard navigation works for panel focus
- [ ] Panel min/max constraints are enforced

## Design Review
_Pending review_

## Test Plan
1. Visual verification of three-pane layout
2. Drag resize handles and verify constraints
3. Navigate away and back to verify persistence
4. Select recordings and verify center/right panel updates
5. Test tablet/mobile breakpoints
6. Keyboard navigation between panels

## References
- [shadcn/ui Resizable](https://ui.shadcn.com/docs/components/resizable)
- [react-resizable-panels](https://www.npmjs.com/package/react-resizable-panels)
