# Library Component Implementation Plan

## Overview

Transform the existing `Recordings.tsx` page into the redesigned **Library** component - a tri-pane knowledge management interface for the HiDock Knowledge App.

**Route:** `/library`
**Conceptual Pillar:** Library = Sources (immutable evidence)
**Current Implementation:** `apps/electron/src/pages/Recordings.tsx` (1102 lines)

## Problem Statement

The current Recordings page handles audio captures but needs to evolve into a comprehensive Library that:
1. Supports multiple Source types (audio, PDF, markdown, images, web clips)
2. Implements the tri-pane notebook workspace layout
3. Provides robust error handling and state management
4. Scales to 5000+ captures with reliable performance
5. Maintains accessibility standards

## Proposed Solution

Incremental refactoring of the existing implementation into a modular, extensible Library architecture while preserving working functionality.

## Technical Approach

### Architecture

```
apps/electron/src/
├── pages/
│   └── Library.tsx                    # Main route component (renamed from Recordings.tsx)
├── features/
│   └── library/
│       ├── components/
│       │   ├── LibraryHeader.tsx      # Title, stats, refresh, import actions
│       │   ├── LibraryFilters.tsx     # Search, filter dropdowns, view toggle
│       │   ├── LibraryList.tsx        # Virtualized container with view modes
│       │   ├── SourceRow.tsx          # Compact list item (52px)
│       │   ├── SourceCard.tsx         # Card view item (120px+)
│       │   ├── SourceDetailDrawer.tsx # Right-side detail panel
│       │   ├── BulkActionsBar.tsx     # Selection toolbar
│       │   └── EmptyState.tsx         # Zero-state messaging
│       ├── hooks/
│       │   ├── useLibrarySources.ts   # Data loading wrapper
│       │   ├── useLibraryFilters.ts   # Filter state management
│       │   └── useSourceSelection.ts  # Bulk selection logic
│       ├── types/
│       │   └── source.ts              # Source type definitions
│       └── utils/
│           └── filters.ts             # Filter logic functions
├── store/
│   └── useLibraryStore.ts             # Zustand store for Library state
└── types/
    └── source.ts                      # Shared Source type (migration from UnifiedRecording)
```

### Implementation Phases

#### Phase 1: Foundation (Extract & Reorganize)

**Goal:** Extract components from monolithic `Recordings.tsx` without changing behavior.

**Tasks:**

- [ ] Create `features/library/` directory structure
- [ ] Extract `LibraryHeader.tsx` from header section (lines 580-620)
  - Title with record count
  - Refresh button with loading state
  - Device connection indicator
- [ ] Extract `LibraryFilters.tsx` from filter section (lines 621-720)
  - Search input with 300ms debounce
  - Location filter dropdown (all/device-only/local-only)
  - Category filter dropdown
  - Quality filter dropdown
  - Status filter dropdown
  - View mode toggle (compact/card)
- [ ] Extract `SourceRow.tsx` from compact row rendering (lines 850-920)
  - Status icon with tooltip
  - Title (truncated)
  - Duration and date metadata
  - Action buttons (play, download, delete)
- [ ] Extract `SourceCard.tsx` from card rendering (lines 920-1050)
  - Expanded layout with AudioPlayer
  - Meeting card integration
  - Transcript accordion
- [ ] Extract `EmptyState.tsx` for zero-state (lines 654-669)
  - "No Knowledge Captured" vs "No Matching Captures"
  - Device connection CTA
- [ ] Create `useLibraryFilters.ts` hook
  - Migrate filter state from local useState
  - Persist filter preferences in Zustand
- [ ] Create `useSourceSelection.ts` hook
  - Checkbox selection state
  - Select all / deselect all
  - Range selection with Shift+Click
- [ ] Rename `Recordings.tsx` to `Library.tsx`
- [ ] Update route in `router.tsx`

**Files to Modify:**
- `apps/electron/src/pages/Recordings.tsx` → `Library.tsx`
- `apps/electron/src/router.tsx`
- Create 8+ new component files

**Success Criteria:**
- All existing functionality preserved
- No visual regressions
- Tests pass
- Component files < 300 lines each

---

#### Phase 2: Core Implementation (State & Data Model)

**Goal:** Implement proper state management and evolve toward Source model.

**Tasks:**

- [ ] Create `useLibraryStore.ts` Zustand store
  ```typescript
  interface LibraryStore {
    // View preferences (persisted)
    viewMode: 'compact' | 'card'
    sortBy: 'date' | 'duration' | 'name' | 'quality'
    sortOrder: 'asc' | 'desc'

    // Filter state (persisted)
    locationFilter: 'all' | 'device-only' | 'local-only'
    categoryFilter: string | null
    qualityFilter: string | null
    statusFilter: string | null
    searchQuery: string

    // Selection state (transient)
    selectedIds: Set<string>

    // Actions
    setViewMode: (mode: 'compact' | 'card') => void
    setFilter: (key: string, value: string | null) => void
    toggleSelection: (id: string) => void
    selectAll: (ids: string[]) => void
    clearSelection: () => void
  }
  ```
- [ ] Add persist middleware for view preferences
- [ ] Define `Source` type union (evolving from `UnifiedRecording`)
  ```typescript
  type SourceType = 'audio' | 'pdf' | 'markdown' | 'image' | 'web_clip'

  interface Source {
    id: string
    type: SourceType
    title: string
    capturedAt: string
    location: 'device-only' | 'local-only' | 'both'
    processingStatus: 'none' | 'queued' | 'processing' | 'ready' | 'error'
    // Type-specific fields via discriminated union
  }
  ```
- [ ] Create adapter layer: `UnifiedRecording` → `Source`
- [ ] Implement scroll position restoration
  - Store `scrollOffset` in store
  - Restore on navigation return
- [ ] Add filter state to URL params (optional, for shareability)

**Files to Create:**
- `apps/electron/src/store/useLibraryStore.ts`
- `apps/electron/src/features/library/types/source.ts`
- `apps/electron/src/features/library/utils/adapters.ts`

**Success Criteria:**
- View preferences persist across app restart
- Filter state persists during navigation
- Scroll position restored on back navigation
- Type-safe Source model with adapter

---

#### Phase 3: Error Handling & Recovery

**Goal:** Implement comprehensive error handling for all failure scenarios.

**Tasks:**

- [ ] Define error handling matrix:
  | Scenario | UI Response | Recovery |
  |----------|-------------|----------|
  | Audio file missing | Toast + disable play | Show "File not found" badge |
  | Audio codec error | Toast with details | Suggest re-download |
  | Download failed | Item error badge | Retry button |
  | Download interrupted | Pause indicator | Resume on reconnect |
  | Transcription failed | Error badge | Retry button |
  | Transcription timeout | Timeout badge | Retry with longer timeout |
  | Device disconnected | Global banner | Auto-detect reconnect |
  | API rate limit | Toast + queue pause | Auto-resume after delay |

- [ ] Implement audio playback error handling
  ```typescript
  // In AudioPlayer or useAudioControls
  const handlePlayError = (error: Error, recording: Source) => {
    if (error.name === 'NotFoundError') {
      toast.error(`File not found: ${recording.title}`)
      markFileAsMissing(recording.id)
    } else if (error.name === 'NotSupportedError') {
      toast.error('Audio format not supported')
    }
  }
  ```
- [ ] Implement download error handling with retry
  - Max 3 retries with exponential backoff
  - Persist retry count
  - Show "Retry" button after max retries
- [ ] Implement device disconnect handling
  - Global banner: "Device disconnected"
  - Disable device-only actions
  - Preserve download queue for resume
- [ ] Add transcription error recovery
  - Retry mechanism with different provider fallback
  - Error details in item detail drawer
- [ ] Create `ErrorBoundary` for Library component
  - Catch render errors
  - Show fallback with "Refresh" option

**Files to Create:**
- `apps/electron/src/features/library/components/ErrorBoundary.tsx`
- `apps/electron/src/features/library/utils/errorHandling.ts`

**Files to Modify:**
- `apps/electron/src/components/OperationController.tsx`
- `apps/electron/src/components/AudioPlayer.tsx`

**Success Criteria:**
- All error scenarios show user-friendly messages
- Retry mechanism works for downloads and transcription
- Device disconnect is handled gracefully
- No silent failures

---

#### Phase 4: Bulk Operations Enhancement

**Goal:** Improve bulk operation UX with progress tracking and error summary.

**Tasks:**

- [ ] Create `BulkActionsBar.tsx` component
  ```tsx
  <BulkActionsBar
    selectedCount={5}
    totalCount={100}
    onSelectAll={handleSelectAll}
    onDeselectAll={handleDeselectAll}
    onDownload={handleBulkDownload}
    onProcess={handleBulkProcess}
    onDelete={handleBulkDelete}
  />
  ```
- [ ] Implement bulk progress modal/drawer
  - Overall progress: "3 of 8 files downloaded"
  - Per-item status: success/failed/pending icons
  - Expandable error details
  - Cancel button
- [ ] Add bulk operation result summary
  ```tsx
  <BulkResultSummary
    operation="Download"
    succeeded={7}
    failed={1}
    errors={[{ id: 'xxx', message: 'Disk full' }]}
    onRetryFailed={handleRetryFailed}
    onDismiss={handleDismiss}
  />
  ```
- [ ] Implement cancellation for bulk operations
  - AbortController for downloads
  - Queue clearing for transcription
- [ ] Add keyboard shortcuts for bulk actions
  - `Ctrl+A` / `Cmd+A`: Select all visible
  - `Escape`: Clear selection
  - `Delete`: Delete selected (with confirmation)

**Files to Create:**
- `apps/electron/src/features/library/components/BulkActionsBar.tsx`
- `apps/electron/src/features/library/components/BulkProgressModal.tsx`
- `apps/electron/src/features/library/components/BulkResultSummary.tsx`

**Success Criteria:**
- Clear progress indication during bulk operations
- Error summary shows per-item failures
- Cancellation works mid-operation
- Keyboard shortcuts functional

---

#### Phase 5: Accessibility & Keyboard Navigation

**Goal:** Meet WCAG 2.1 AA accessibility standards.

**Tasks:**

- [ ] Implement virtualized list accessibility
  - `role="listbox"` on container
  - `role="option"` on items
  - `aria-rowcount` for total count
  - `aria-rowindex` for position
  - `aria-selected` for selection state
- [ ] Implement keyboard navigation
  - Arrow Up/Down: Move focus
  - Home/End: First/last item
  - Space: Toggle selection
  - Enter: Open detail drawer
  - Escape: Close drawer / clear selection
- [ ] Add focus management
  - Focus trap in detail drawer
  - Return focus to trigger on drawer close
  - Visible focus indicators (ring)
- [ ] Add ARIA live regions for dynamic updates
  - Download completion announcements
  - Transcription status changes
  - Filter result count changes
- [ ] Ensure color-independent status indicators
  - Add icons alongside color badges
  - Use patterns or shapes for distinction
- [ ] Test with screen reader (NVDA/VoiceOver)

**Files to Modify:**
- `apps/electron/src/features/library/components/LibraryList.tsx`
- `apps/electron/src/features/library/components/SourceRow.tsx`
- `apps/electron/src/features/library/components/SourceDetailDrawer.tsx`

**Success Criteria:**
- Full keyboard navigation without mouse
- Screen reader announces all dynamic content
- Focus management follows WAI-ARIA patterns
- No color-only information

---

#### Phase 6: Performance Optimization

**Goal:** Achieve <100ms mount, 60fps scroll with 5000+ items.

**Tasks:**

- [ ] Implement search debouncing (300ms)
  ```typescript
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebouncedValue(searchInput, 300)

  useEffect(() => {
    setSearchQuery(debouncedSearch)
  }, [debouncedSearch])
  ```
- [ ] Add React.memo to list items with custom comparator
  ```typescript
  const SourceRow = memo(({ source, isSelected, isPlaying }) => {
    // ...
  }, (prev, next) => {
    return prev.source.id === next.source.id &&
           prev.isSelected === next.isSelected &&
           prev.isPlaying === next.isPlaying
  })
  ```
- [ ] Use `useTransition` for filter operations
  ```typescript
  const [isPending, startTransition] = useTransition()

  const handleFilterChange = (filter: string) => {
    startTransition(() => {
      setFilter(filter)
    })
  }
  ```
- [ ] Optimize enrichment queries
  - Batch size limit (100 items per query)
  - Prioritize visible items
  - Background loading for off-screen items
- [ ] Add performance monitoring
  - Measure initial render time
  - Track scroll FPS
  - Log slow operations (>100ms)
- [ ] Consider pagination fallback for extreme datasets (10K+)

**Files to Modify:**
- `apps/electron/src/features/library/components/LibraryList.tsx`
- `apps/electron/src/features/library/components/SourceRow.tsx`
- `apps/electron/src/features/library/components/SourceCard.tsx`
- `apps/electron/src/hooks/useUnifiedRecordings.ts`

**Success Criteria:**
- Initial render <100ms with 1000 items
- Consistent 60fps during scroll
- No UI freeze during filter/search
- Enrichment doesn't block rendering

---

#### Phase 7: Detail Drawer & Tri-Pane Layout

**Goal:** Implement the Source Detail Drawer and full tri-pane layout.

**Tasks:**

- [ ] Create `SourceDetailDrawer.tsx`
  - Header: Title + status badge + close button
  - Sticky AudioPlayer (when audio source)
  - Tabs: Transcript | Summary | Notes
  - Transcript with clickable time anchors
  - Actions: Transcribe, Export, Link to meeting
- [ ] Implement responsive drawer behavior
  - Desktop (>=1024px): Side drawer (350px)
  - Tablet (768-1023px): Side drawer or full-height sheet
  - Mobile (<768px): Full-screen sheet with back action
- [ ] Add time anchor interaction
  ```typescript
  const handleAnchorClick = (startMs: number, endMs: number) => {
    audioControls.seek(startMs / 1000)
    setSelectedRange({ start: startMs, end: endMs })
    highlightTranscriptRange(startMs, endMs)
  }
  ```
- [ ] Implement tri-pane layout structure
  ```tsx
  <ResizablePanelGroup direction="horizontal">
    <ResizablePanel defaultSize={25}>
      <LibraryList />
    </ResizablePanel>
    <ResizableHandle />
    <ResizablePanel defaultSize={45}>
      <SourceReader />
    </ResizablePanel>
    <ResizableHandle />
    <ResizablePanel defaultSize={30}>
      <AssistantPanel />
    </ResizablePanel>
  </ResizablePanelGroup>
  ```
- [ ] Create `SourceReader.tsx` component
  - Unified viewer for all source types
  - Audio: Waveform + transcript view
  - PDF: Embedded PDF viewer with annotations
  - Markdown: Rendered markdown with syntax highlighting
  - Image: Zoomable image viewer with metadata
  - Web clip: Rendered HTML content with source link
- [ ] Create `AssistantPanel.tsx` component
  - Context-aware chat interface
  - Source content as context for AI queries
  - Quick actions: Summarize, Extract key points, Generate notes
  - Conversation history scoped to selected source

**Files to Create:**
- `apps/electron/src/features/library/components/SourceDetailDrawer.tsx`
- `apps/electron/src/features/library/components/TranscriptViewer.tsx`
- `apps/electron/src/features/library/components/TimeAnchor.tsx`
- `apps/electron/src/features/library/components/SourceReader.tsx`
- `apps/electron/src/features/library/components/AssistantPanel.tsx`
- `apps/electron/src/features/library/components/viewers/AudioViewer.tsx`
- `apps/electron/src/features/library/components/viewers/PdfViewer.tsx`
- `apps/electron/src/features/library/components/viewers/MarkdownViewer.tsx`
- `apps/electron/src/features/library/components/viewers/ImageViewer.tsx`
- `apps/electron/src/features/library/components/viewers/WebClipViewer.tsx`

**Success Criteria:**
- Detail drawer opens smoothly
- Responsive behavior works on all breakpoints
- Time anchors sync with audio playback
- Tri-pane layout fully functional with resizable panels
- SourceReader displays all source types correctly
- AssistantPanel provides context-aware AI chat

---

#### Phase 8: Multi-Source Type Support

**Goal:** Implement full support for all source types beyond audio.

**Tasks:**

- [ ] Implement `PdfSource` type and handling
  ```typescript
  interface PdfSource extends BaseSource {
    type: 'pdf'
    pageCount: number
    fileSize: number
    thumbnailPath?: string
    ocrStatus: 'none' | 'queued' | 'processing' | 'ready' | 'error'
    extractedText?: string
  }
  ```
  - PDF import via drag-and-drop and file picker
  - Thumbnail generation for list view
  - OCR integration for searchable text extraction
  - PDF viewer with page navigation and zoom

- [ ] Implement `MarkdownSource` type and handling
  ```typescript
  interface MarkdownSource extends BaseSource {
    type: 'markdown'
    content: string
    wordCount: number
    headings: string[]
  }
  ```
  - Markdown file import
  - In-app markdown editor
  - Live preview rendering
  - Frontmatter metadata extraction

- [ ] Implement `ImageSource` type and handling
  ```typescript
  interface ImageSource extends BaseSource {
    type: 'image'
    dimensions: { width: number; height: number }
    fileSize: number
    format: 'png' | 'jpg' | 'gif' | 'webp'
    ocrStatus: 'none' | 'queued' | 'processing' | 'ready' | 'error'
    extractedText?: string
    altText?: string
  }
  ```
  - Image import via drag-and-drop and file picker
  - Thumbnail generation
  - OCR for text extraction from images
  - Image viewer with zoom and pan

- [ ] Implement `WebClipSource` type and handling
  ```typescript
  interface WebClipSource extends BaseSource {
    type: 'web_clip'
    sourceUrl: string
    clippedAt: string
    htmlContent: string
    textContent: string
    screenshot?: string
  }
  ```
  - Browser extension integration for clipping
  - Manual URL import with content fetching
  - Rendered HTML preview
  - Link back to original source

- [ ] Update `LibraryFilters.tsx` for source type filtering
  - Add "Type" filter dropdown (audio, pdf, markdown, image, web_clip)
  - Update search to include extracted text from all types

- [ ] Update `SourceRow.tsx` and `SourceCard.tsx` for multi-type display
  - Type-specific icons
  - Type-specific metadata display
  - Type-specific action buttons

- [ ] Implement unified import flow
  - Drag-and-drop zone in Library header
  - File picker with multi-type support
  - Import progress tracking
  - Batch import handling

- [ ] Add download progress indicator to `SourceRow.tsx`
  - Progress bar overlay during download
  - Cancel button for in-progress downloads

**Files to Create:**
- `apps/electron/src/features/library/services/pdfService.ts`
- `apps/electron/src/features/library/services/markdownService.ts`
- `apps/electron/src/features/library/services/imageService.ts`
- `apps/electron/src/features/library/services/webClipService.ts`
- `apps/electron/src/features/library/components/ImportDropZone.tsx`
- `apps/electron/src/features/library/components/ImportProgressModal.tsx`

**Files to Modify:**
- `apps/electron/src/features/library/types/source.ts` - Activate all source types
- `apps/electron/src/features/library/components/LibraryFilters.tsx`
- `apps/electron/src/features/library/components/SourceRow.tsx`
- `apps/electron/src/features/library/components/SourceCard.tsx`
- `apps/electron/src/features/library/components/LibraryHeader.tsx`

**Success Criteria:**
- All 5 source types can be imported and displayed
- Type-specific viewers render content correctly
- Search works across all source types including extracted text
- Import flow handles all file types seamlessly
- Download progress visible in list items

---

## Acceptance Criteria

### Functional Requirements
- [ ] Library displays all sources (local + device) in virtualized list
- [ ] Compact and card views switch seamlessly
- [ ] All 5 filters work correctly (location, category, quality, status, search)
- [ ] Search is debounced (300ms) and case-insensitive
- [ ] Bulk selection works with checkbox, Ctrl+Click, Shift+Click
- [ ] Bulk download queues all selected device-only items
- [ ] Bulk process queues all selected items for transcription
- [ ] Single-item actions work: Play, Download, Process, Delete
- [ ] Audio playback works with global state (one at a time)
- [ ] Detail drawer shows transcript, summary, and actions
- [ ] Empty states show appropriate messaging

### Non-Functional Requirements
- [ ] Initial render <100ms with 1000 items
- [ ] Scroll maintains 60fps with 5000 items
- [ ] View preferences persist across app restart
- [ ] Filter state persists during navigation
- [ ] All errors show user-friendly messages with recovery options
- [ ] Keyboard navigation works without mouse
- [ ] Screen reader announces dynamic content changes

### Quality Gates
- [ ] Unit tests for filter logic (>80% coverage)
- [ ] Integration tests for data loading
- [ ] Accessibility audit passes (axe-core)
- [ ] Performance benchmark passes
- [ ] No TypeScript errors
- [ ] ESLint passes with no warnings

## Dependencies & Prerequisites

### Internal Dependencies
- `useUnifiedRecordings` hook (existing)
- `useAudioControls` from OperationController (existing)
- `useUIStore` for playback state (existing)
- `useAppStore` for device state (existing)
- shadcn/ui components (existing)

### External Dependencies
- `@tanstack/react-virtual` (existing)
- `zustand` with persist middleware (existing)
- `lucide-react` icons (existing)

### Blockers
- None identified - all dependencies exist

## Risk Analysis & Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Breaking existing functionality | High | Medium | Incremental extraction, comprehensive tests |
| Performance regression | High | Low | Benchmark before/after each phase |
| Accessibility regressions | Medium | Medium | Test with screen reader after each phase |
| State management complexity | Medium | Medium | Start simple, add persistence later |
| Scope creep (tri-pane, new source types) | Medium | High | Strict phase boundaries, defer advanced features |

## Success Metrics

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Initial render time | <100ms | Performance.measure() |
| Scroll FPS | 60fps | Chrome DevTools Performance |
| Error recovery rate | 100% | Manual testing of all error scenarios |
| Keyboard accessibility | Full | Manual testing without mouse |
| Code maintainability | <300 LOC/file | Line count per component |

## References & Research

### Internal References
- Current implementation: `apps/electron/src/pages/Recordings.tsx`
- Data hook: `apps/electron/src/hooks/useUnifiedRecordings.ts`
- Store pattern: `apps/electron/src/store/useAppStore.ts`
- Type definitions: `apps/electron/src/types/unified-recording.ts`
- Specification: `docs/specs/knowledge-app/LIBRARY_SPEC.md`

### External References
- [TanStack Virtual Documentation](https://tanstack.com/virtual/latest)
- [shadcn/ui Components](https://ui.shadcn.com/docs/components)
- [Zustand Persist Middleware](https://github.com/pmndrs/zustand#persist-middleware)
- [WAI-ARIA Listbox Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/)
- [React 18 useTransition](https://react.dev/reference/react/useTransition)

### Research Agents Used
- repo-research-analyst: Repository patterns and conventions
- best-practices-researcher: Industry standards for virtualization, accessibility, bulk UX
- framework-docs-researcher: Latest API documentation for all frameworks
- spec-flow-analyzer: User flow gaps and edge cases

---

## Open Questions Requiring Clarification

### Critical (Must resolve before implementation)

1. **Error Handling Strategy**: What should happen when audio playback fails (file missing, codec error)?
   - Option A: Toast notification + disable play button
   - Option B: Error dialog with "Delete" / "Re-download" options
   - Option C: Badge indicator + tooltip explanation

2. **Device Disconnect Behavior**: What happens to in-progress downloads when device disconnects?
   - Option A: Abort all, clear queue
   - Option B: Pause queue, resume on reconnect
   - Option C: Complete current file, pause rest

3. **Category Field Values**: What are the valid values for the category filter?
   - Current hardcoded: `['meeting', 'interview', '1:1', 'brainstorm', 'note', 'other']`
   - Should this be configurable?

### Important (Should resolve during implementation)

4. **Cross-Page Audio**: Should audio continue playing when navigating away from Library?
   - Current: Yes (global OperationController)
   - Should there be a mini-player in header?

5. **Filter Persistence**: Should filter state persist in URL params for sharing/bookmarking?

6. **Duplicate Downloads**: How to handle downloading a file that already exists locally?
   - Option A: Skip with notification
   - Option B: Overwrite silently
   - Option C: Create versioned filename
