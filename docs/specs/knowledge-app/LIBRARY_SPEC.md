# Library Component Specification

## 1. Component Overview
The **Library** (formerly `Recordings`) is the central repository for all captured knowledge. It displays a unified list of recordings from both the local database and connected HiDock devices. It supports filtering, searching, playback, and management of these assets.

**Path**: `apps/electron/src/pages/Recordings.tsx` (To be renamed `Library.tsx`)

## 2. Component Interface

### Props
The component is a top-level route and does not accept external props.
```typescript
interface LibraryProps {}
```

### State Management
| State Variable | Type | Description |
| :--- | :--- | :--- |
| `recordings` | `UnifiedRecording[]` | List of all available recordings (local + device). |
| `loading` | `boolean` | Global loading state for fetching recordings. |
| `locationFilter` | `'all' | 'device-only' | 'local-only'` | Filter by storage location. |
| `categoryFilter` | `string` | Filter by recording category (meeting, note, etc). |
| `qualityFilter` | `string` | Filter by AI-assigned quality rating. |
| `statusFilter` | `string` | Filter by processing status (transcribed, pending). |
| `searchQuery` | `string` | User input for searching filename/title/subject. |
| `compactView` | `boolean` | Toggles between List (compact) and Card views. Persisted in `UIStore`. |
| `expandedTranscripts` | `Set<string>` | Tracks IDs of expanded transcript accordions. |
| `bulkProcessing` | `boolean` | Indicates if a bulk operation is in progress. |

### Data Flow & Dependencies
-   **`useUnifiedRecordings`**: Hook that aggregates data from `DeviceService` and `DatabaseService`.
-   **`useUIStore`**: Persists view preferences (`compactView`) and audio playback state.
-   **`useAudioControls`**: Centralized controller for the global audio player.
-   **`electronAPI`**:
    -   `transcripts.getByRecordingIds`: Batch fetches transcript data.
    -   `meetings.getByIds`: Batch fetches calendar meeting metadata.
    -   `downloadService`: Queues device files for download.

## 3. Behavior & Interactions

### 3.1 Data Loading & Enrichment
-   **Initial Load**: Fetches recording list immediately on mount.
-   **Enrichment**:
    -   **Trigger**: When `recordings` list changes (specifically local IDs).
    -   **Action**: Batched async fetch of `transcripts` and `meetings` for visible/local items.
    -   **Optimization**: Uses `enrichmentKey` memoization to prevent redundant fetches.

### 3.2 Filtering & Search
-   **Logic**: Client-side filtering on the `recordings` array.
-   **Performance**: Memoized `filteredRecordings` to prevent re-calculation on render.
-   **Criteria**:
    -   Location (Device/Local)
    -   Category (Meeting/Note/etc)
    -   Quality (Valuable/Archived)
    -   Status (Processing/Ready)
    -   Search (Filename, Title, Meeting Subject)

### 3.3 Virtualization
-   **Library**: `@tanstack/react-virtual`
-   **Row Height**:
    -   **Compact**: Fixed 52px.
    -   **Card**: Dynamic based on content (Base 120px + Player + Meeting + Transcript).
-   **Overscan**: 5 items for smooth scrolling.

### 3.4 Audio Playback
-   **Interaction**: Click Play button on a card/row.
-   **Logic**:
    -   If `localPath` exists: Plays via `AudioPlayer`.
    -   If `device-only`: Prompt/Trigger download first.
    -   State: Only one audio file plays at a time (managed by `currentlyPlayingId`).

### 3.5 Bulk Actions
-   **Download All**: queues all `device-only` items in the current filter view.
-   **Process All**: queues all `local-only` items without transcripts for AI processing.

## 4. Design & Styling

### Design Tokens
-   **Colors**: Uses `shadcn/ui` theme variables (`bg-background`, `text-muted-foreground`, `border-input`).
-   **Icons**: `lucide-react` for all iconography.

### Status Indicators
-   **Device Only**: `text-orange-600` (Cloud icon)
-   **Synced**: `text-green-600` (Check icon)
-   **Local Only**: `text-blue-600` (HardDrive icon)

## 5. Accessibility (A11y)

### ARIA Roles
-   **List Container**: `role="feed"` or `role="list"` for the virtualizer container.
-   **List Item**: `role="article"` or `role="listitem"`.
-   **Interactive Elements**: All buttons must have `aria-label` or `title`.

### Keyboard Navigation
-   **Focus**: Filters and List items should be focusable via `Tab`.
-   **Shortcuts**:
    -   `Space/Enter` on a row: Play/Pause or Expand details.
    -   `Arrow Up/Down`: Navigate list (if focus management is implemented).

## 6. Error Handling

| Scenario | UX Result | Recovery |
| :--- | :--- | :--- |
| **Load Failed** | Show error banner with retry button. | Manual retry via "Refresh" button. |
| **Download Failed** | Toast notification error. | Retry button on item. |
| **Enrichment Failed** | Silently log error; Show basic card without details. | Auto-retry on next refresh. |
| **Device Disconnected** | Disable "Download" and "Device-delete" actions. | Visual indicator in header. |

## 7. Testing Requirements

### Unit Tests
-   **Filtering**: Verify `filteredRecordings` logic correctly excludes items based on all 5 filter types.
-   **Formatting**: Test `formatBytes`, `formatDuration` helpers.

### Integration Tests
-   **Data Loading**: Mock `useUnifiedRecordings` and verify list renders.
-   **Enrichment**: Verify `electronAPI` calls are triggered with correct IDs.
-   **Empty States**: Verify "No Knowledge Captured" vs "No Matching Captures" states.

### Performance Benchmarks
-   **Render Time**: < 100ms for list mount.
-   **Scroll FPS**: Maintains 60fps with 1000+ items (via virtualization).
