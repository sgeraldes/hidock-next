# Implementation Manual: Knowledge App Redesign (Phase 1)

This manual details the step-by-step execution plan to implement the "Deep Specs" for Library, Assistant, and Explore.

## 1. Foundation & Data Layer (Week 1)

### 1.1 Store & Types
**Goal**: Establish the strict TypeScript interfaces defined in the Deep Specs.
1.  **Create Types File**: `apps/electron/src/types/knowledge-next.ts`.
    *   Copy `UnifiedRecording`, `Message`, `Conversation`, `SearchResult` interfaces from specs.
2.  **Update Global Store**:
    *   Extend `useAppStore` or create `useKnowledgeStore` (Zustand).
    *   Add `activeConversationId`, `libraryFilters`, `exploreQuery`.

### 1.2 Shared Components System
**Goal**: Build the reusable visual primitives.
1.  **VirtualList**: Wrap `@tanstack/react-virtual` in a generic component handling empty/loading states.
2.  **FilterToolbar**: Create a generic toolbar accepting `FilterDef[]`.
3.  **ResultCard**: Polymorphic card component for files/people/projects.

## 2. Library Implementation (Week 2)
**Spec**: [`LIBRARY_DEEP_SPEC.md`](./LIBRARY_DEEP_SPEC.md)

### 2.1 Logic (`useLibraryData`)
1.  **Hook**: Create `useLibraryData.ts`.
2.  **Aggregation**: Combine `DeviceService.listRecordings()` and `DatabaseService.getAll()`.
3.  **Memoization**: Implement `useMemo` for filtering `items` based on `searchQuery` and `location`.
    *   *Test*: Ensure typing in search doesn't cause full re-renders of the virtual list.

### 2.2 Views
1.  **List View**:
    *   Implement `RecordingListRow.tsx`. Match the **52px** height spec.
    *   Implement `RecordingDetailDrawer.tsx`. Use `Sheet` from shadcn/ui.
2.  **Audio Player**:
    *   Integrate `wavesurfer.js` into the Drawer.
    *   Connect to `useAudioControls` for global state (stop others when playing).

## 3. Assistant Implementation (Week 3)
**Spec**: [`ASSISTANT_DEEP_SPEC.md`](./ASSISTANT_DEEP_SPEC.md)

### 3.1 RAG Service Upgrade
1.  **Streaming**: Verify `electronAPI.rag` supports streaming. If not, implement standard request/response first, then refactor.
2.  **Context**: Ensure `addContext(convId, recId)` endpoint works and actually influences the RAG prompt.

### 3.2 UI Components
1.  **MessageBubble**:
    *   Implement `react-markdown` configuration.
    *   Create `CitationChip` component.
2.  **Sidebar**:
    *   Implement `VirtualList` for conversation history (could be hundreds).

## 4. Explore Implementation (Week 4)
**Spec**: [`EXPLORE_DEEP_SPEC.md`](./EXPLORE_DEEP_SPEC.md)

### 4.1 Dashboard Widgets
1.  **Topic Extraction**:
    *   Implement `rag.getTopTopics()` (likely aggregated from latest 10 transcripts).
    *   Render `TopicCloudWidget`.
2.  **Recent Activity**:
    *   Query `recordings` sorted by `createdAt` desc.

### 4.2 Search Experience
1.  **Global Search Input**:
    *   Implement the "Hero" to "Header" animation logic using CSS classes (`translate-y`, `scale`).
2.  **Search Service**:
    *   Combine results from FTS (Full Text Search) and Vector Search.

## 5. QA & Polish (Week 5)
1.  **Accessibility Audit**: Run Lighthouse/axe-core. Verify all `aria-labels` from specs.
2.  **Performance Profiling**:
    *   Check `Library` scroll performance (Target 60fps).
    *   Check `Explore` search debounce responsiveness.
3.  **Theme Check**: Verify Dark Mode consistency across all new components.