# Library View - Comprehensive Engineering Specification

## 1. Component Architecture
The Library view is the primary data grid for the application. It manages the display, filtering, and interaction of `UnifiedRecording` entities.

### 1.1 Component Hierarchy
```
LibraryPage (Route: /library)
â”œâ”€â”€ FilterToolbar
â”‚   â”œâ”€â”€ SearchInput
â”‚   â”œâ”€â”€ FilterChips (Status, Location)
â”‚   â”œâ”€â”€ SortDropdown
â”‚   â””â”€â”€ BulkActionsBar (Conditional)
â”œâ”€â”€ LibraryContent (Flex-1, Scrollable)
â”‚   â”œâ”€â”€ VirtualList (Wrapper for @tanstack/react-virtual)
â”‚   â”‚   â”œâ”€â”€ RecordingListRow (Memoized)
â”‚   â”‚   â””â”€â”€ RecordingGridCard (Memoized)
â”‚   â””â”€â”€ EmptyState (Zero / No Results)
â””â”€â”€ RecordingDetailDrawer (Overlay/Push)
    â”œâ”€â”€ AudioPlayer
    â”œâ”€â”€ TranscriptView
    â””â”€â”€ AISummaryView
```

## 2. Data Model & State

### 2.1 Types & Interfaces
```typescript
// Core Entity
interface UnifiedRecording {
  id: string; // UUID
  filename: string;
  title?: string;
  duration: number; // Seconds
  size: number; // Bytes
  createdAt: string; // ISO Date
  location: 'device-only' | 'local-only' | 'synced';
  transcriptionStatus: 'none' | 'pending' | 'processing' | 'completed' | 'error';
  isFavorite: boolean;
  meetingId?: string; // Link to Calendar
}

// View State
interface LibraryState {
  // Data
  items: UnifiedRecording[];
  isLoading: boolean;
  error: Error | null;
  
  // Selection & Filters
  selectedIds: Set<string>;
  filter: {
    searchQuery: string;
    status: 'all' | 'transcribed' | 'pending';
    location: 'all' | 'device' | 'local';
    dateRange?: [Date, Date];
  };
  sort: {
    field: 'date' | 'duration' | 'title';
    direction: 'asc' | 'desc';
  };
  viewMode: 'list' | 'grid';
  
  // UI
  activeDetailId: string | null; // Controls Drawer
}
```

### 2.2 Lifecycle & Data Flow
1.  **Mount**: Triggers `useLibraryData` hook.
    *   *Action*: Dispatch `FETCH_RECORDINGS`.
    *   *State*: `isLoading = true`.
2.  **Update**:
    *   **Search/Filter**: Client-side filtering of `items` array via `useMemo`.
    *   **Selection**: Updates `selectedIds` set (efficient O(1) lookups).
3.  **Real-time**: Subscribes to `DeviceService` events (`file-added`, `file-removed`) and `DatabaseService` (`transcription-updated`) to patch `items` without full reload.

## 3. Detailed Component Specifications

### 3.1 FilterToolbar
*   **Props**: 
    *   `totalCount: number`
    *   `filteredCount: number`
    *   `onFilterChange: (filter: FilterState) => void`
*   **Behavior**:
    *   **Search**: Debounced (300ms) input. Updates `filter.searchQuery`.
    *   **Bulk Mode**: When `selectedIds.size > 0`, the Toolbar transforms into `BulkActionsBar`.
        *   *Visual*: Background color changes to `bg-accent`. Text changes to "X items selected".
        *   *Actions*: "Download All", "Delete", "Clear Selection".

### 3.2 RecordingListRow (List Mode)
*   **Height**: Fixed **52px**.
*   **Layout (Flexbox)**:
    1.  **Checkbox** (40px): `w-4 h-4` checkbox.
    2.  **Status** (32px): Icon (`Cloud`, `Check`). Tooltip on hover.
    3.  **Title** (Flex-1): Truncated text. Bold.
    4.  **Meta** (120px): Duration (`mm:ss`), Date (`MMM dd`).
    5.  **Actions** (Opacity-0 -> Opacity-100 on Group Hover):
        *   `PlayButton`: Starts audio.
        *   `DetailButton`: Opens Drawer.
*   **Interaction**:
    *   **Click**: Opens Detail View.
    *   **Shift+Click**: Range selection.
    *   **Double Click**: Plays Audio.

### 3.3 RecordingDetailDrawer
*   **Props**: `recording: UnifiedRecording`, `isOpen: boolean`, `onClose: () => void`.
*   **Visual Hierarchy**:
    *   **Header (Primary)**: Large Title (Editable), Status Badge.
    *   **Player (Sticky)**: Waveform (`wavesurfer.js`), Play/Pause FAB, Speed Toggle.
    *   **Content (Scrollable)**:
        *   **Tabs**: "Transcript", "Summary", "Notes".
        *   **Transcript**: Diarized text (Speaker A: text...). Clicking timestamp seeks audio.
*   **Accessibility**:
    *   `role="dialog"`, `aria-modal="true"`.
    *   Focus trap within drawer.
    *   `Esc` key closes drawer.

## 4. Interaction Patterns

| User Action | System Response | Visual Feedback |
| :--- | :--- | :--- |
| **Search Typing** | Filters list in real-time. | List height changes. "No results" state if empty. |
| **Row Click** | Sets `activeDetailId`. | Row background `bg-accent`. Drawer slides in from right. |
| **Play Click** | Sets global `audioContext`. | Play icon turns to Pause. Waveform appears in footer/drawer. |
| **Delete Key** | Checks `selectedIds`. | Dialog: "Delete X items?". |

## 5. Visual Hierarchy & Styling (Theme Tokens)

*   **Primary Elements**:
    *   Row Title: `text-sm font-medium text-foreground`.
    *   Play Button: `text-primary hover:scale-110`.
*   **Secondary Elements**:
    *   Meta Data: `text-xs text-muted-foreground`.
    *   Icons: `w-4 h-4 text-muted-foreground`.
*   **States**:
    *   **Hover**: `bg-muted/50`.
    *   **Selected**: `bg-primary/5 border-l-2 border-primary`.
    *   **Playing**: `bg-green-500/5` (distinct from selection).

## 6. Error Handling

*   **Load Failure**:
    *   *UI*: Central `ErrorState` component with "Retry" button.
    *   *Action*: Re-dispatch `FETCH_RECORDINGS`.
*   **Playback Error** (Missing File):
    *   *UI*: Toast notification "File not found locally".
    *   *Action*: Prompt "Download from Device?".
*   **Bulk Action Failure**:
    *   *UI*: Toast "Failed to delete 2 items".
    *   *State*: Revert UI removal of failed items.

## 7. Testing Strategy

### 7.1 Unit Tests (Vitest)
*   **`filterRecordings`**: Test search logic (case-insensitive, fuzzy).
*   **`RecordingRow`**: Verify rendering of all props. Test "Selected" class application.
*   **`TimeUtils`**: Verify `formatDuration(3665)` -> "1:01:05".

### 7.2 Integration Tests
*   **Selection Logic**:
    *   Click Row 1 -> Selected.
    *   Shift+Click Row 5 -> Rows 1-5 Selected.
*   **Data Flow**: Mock `electronAPI.recordings.list`. Verify list populates.

### 7.3 Performance Targets
*   **Initial Render**: < 100ms.
*   **Scrolling**: 60 FPS (using `windowing`).
*   **Search**: < 16ms per keystroke (filtering 2000 items).