# Implementation Manual: Knowledge App Redesign

This manual guides the engineering team through the implementation of the new Library, Assistant, and Explore views, transitioning from the current prototype to the "Deep Spec" vision.

## Phase 0: Foundation & Cleanup
**Goal**: Prepare the codebase structure.

1.  **Rename & Route Update**:
    *   `Recordings.tsx` -> `Library.tsx` (Update `App.tsx` routes).
    *   `Chat.tsx` -> `Assistant.tsx`.
    *   Ensure `/library`, `/assistant`, `/explore` are the canonical routes.
2.  **Shared Components**:
    *   Create `components/common/VirtualList.tsx` (Wrapper around TanStack Virtual).
    *   Create `components/common/FilterBar.tsx`.
    *   Create `components/common/EmptyState.tsx`.
3.  **Store Updates**:
    *   Update `useUIStore` to hold view preferences for all 3 pages (`libraryViewMode`, `assistantSidebarOpen`).

## Phase 1: Library Implementation
**Spec**: [`LIBRARY_DEEP_SPEC.md`](./LIBRARY_DEEP_SPEC.md)

1.  **Data Layer**:
    *   Create `hooks/useLibraryData.ts`.
    *   Migrate logic from `useUnifiedRecordings` into this new hook, adding sorting/filtering logic *inside the hook* or a selector.
2.  **List View**:
    *   Implement `RecordingList.tsx` using `VirtualList`.
    *   Create `RecordingRow.tsx` (Compact) and `RecordingCard.tsx` (Grid).
    *   **Task**: Ensure 52px fixed height for rows.
3.  **Detail View**:
    *   Create `components/library/RecordingDetailDrawer.tsx`.
    *   Implement the "Split View" logic: If screen > 1024px and item selected, show Drawer inline. Else, show Modal.
4.  **Polish**:
    *   Add "Skeleton" loading states.
    *   Implement "Bulk Action Bar" (appears when `selectedIds.size > 0`).

## Phase 2: Assistant Implementation
**Spec**: [`ASSISTANT_DEEP_SPEC.md`](./ASSISTANT_DEEP_SPEC.md)

1.  **Layout Refactor**:
    *   Split `Assistant.tsx` into `Sidebar.tsx`, `ChatThread.tsx`, `Composer.tsx`.
2.  **Message Components**:
    *   Create `MessageBubble.tsx`.
    *   Implement `CitationChip` component that parses the `sources` JSON.
    *   **Task**: Ensure clicking a citation navigates to `Library` detail view.
3.  **RAG Context**:
    *   Enhance `ContextPicker` to support filtering by date/type.
    *   Ensure attached context visual feedback in `Composer`.
4.  **Streaming**:
    *   (Backend task) Verify if `electronAPI.rag.chat` supports streaming. If so, implement `onChunk` handler in `useAssistant`.

## Phase 3: Explore Implementation
**Spec**: [`EXPLORE_DEEP_SPEC.md`](./EXPLORE_DEEP_SPEC.md)

1.  **Dashboard Grid**:
    *   Create `components/explore/Dashboard.tsx`.
    *   Implement widgets: `TopicCloud`, `RecentActivity`.
2.  **Search Logic**:
    *   Create `components/explore/GlobalSearch.tsx`.
    *   Implement the "Hero Input" to "Sticky Header" transition animation.
3.  **Result Rendering**:
    *   Create `ResultCard` components for `Knowledge`, `Person`, `Project` types.
    *   Implement tab switching logic.

## Phase 4: Integration & Testing
1.  **Navigation**:
    *   Verify deep links: Clicking a Search Result -> Opens Library Detail.
    *   Verify Citation -> Opens Library Detail.
2.  **Responsiveness**:
    *   Test on 1920x1080 (Desktop), 1024x768 (Laptop), and resized window (Mobile view).
3.  **Performance**:
    *   Run Library with 1000 mock items. Scroll FPS > 50.
    *   Assistant typing latency < 50ms.

## Phase 5: Design Review
*   Compare implementation against the "Proposed Design Mockup Descriptions" in the Deep Specs.
*   Adjust margins, typography, and colors to match the "Visual Hierarchy" rules.
