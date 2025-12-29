# Knowledge Library Specification

**Module:** Knowledge Management
**Screen:** Library (`/library`)
**Component:** `src/pages/Recordings.tsx`
**Screenshot:** ![Library View](../qa/screenshots/library_master.png)

## 1. Overview
The Library acts as the central **Knowledge Repository**, storing all captured conversations, meetings, and insights. It allows users to browse, filter, and manage their knowledge base efficiently using a virtualized list for performance.

## UI Components & Behavior

| Feature | UI Element | Action | Expected Outcome | Redesign Alignment |
| :--- | :--- | :--- | :--- | :--- |
| **Global Navigation** | Sidebar Link | Click "Library" | Navigates to `#/library`. Loads virtualized list of recordings. | Matches "Knowledge Library" renaming. |
| **Search** | Input Field | Type text (e.g., "Amazon") | Filters list by filename/title case-insensitive. Debounced (300ms). | Aligns with "Search & Filter" requirement. |
| **Source Filtering** | Tag Buttons | Click "Meeting", "Interview", etc. | Filters list to show only items with selected tag. Updates item count. | Matches "By Source" taxonomy. |
| **Status Filtering** | "All Statuses" Dropdown | Select "Processing", "Ready" | Filters list by transcription status. | Matches "By Status" taxonomy. |
| **Quality Filtering** | "All Ratings" Dropdown | Select "Valuable", "Low-Value" | Filters list by quality rating. | Matches "By Quality" taxonomy. |
| **Playback** | Play Button (▶) | Click on Item | **Local:** Plays immediately via AudioPlayer.<br>**Device:** Queues download, shows spinner, plays on completion. | Aligns with "Actions per Knowledge Item". |
| **Download** | Download Icon (⬇) | Click on Device-Only Item | Initiates background download. Updates sync status to "Local". | Core "Device Management" utility. |
| **Management** | Trash Icon | Click Delete | Prompts confirmation. Removes from DB (and optionally device). | Standard management action. |

---

## 2. Component Specification

### 2.1 State Management
| State Variable | Type | Description | Persistence |
| :--- | :--- | :--- | :--- |
| `searchQuery` | `string` | Text filter for title/subject/filename. | Session |
| `locationFilter` | `'all' \| 'device-only' \| 'local-only'` | Filter by storage location. | Session |
| `compactView` | `boolean` | Toggle between Card and List view. | **Persisted** (Zustand) |
| `transcripts` | `Map<string, Transcript>` | Enriched data for local recordings. | Session (Memoized) |
| `meetings` | `Map<string, Meeting>` | Linked meeting data. | Session (Memoized) |
| `expandedTranscripts` | `Set<string>` | IDs of cards with expanded details. | Session |

### 2.2 Lifecycle & Events
*   **Mount:** Fetches initial recording list via `useUnifiedRecordings` (Device + DB).
*   **Enrichment:** On `recordings` change, batch fetches missing transcripts (`transcripts.getByRecordingIds`) and meetings (`meetings.getByIds`).
*   **Virtualization:** Uses `useVirtualizer` to render only visible rows (`overscan: 5`).

---

## 3. Detailed Behavior

### 3.1 List Rendering
*   **Specs:** Must render 1000+ items at 60fps.
*   **Logic:** `filteredRecordings` array is memoized based on all active filters.
*   **Height Calculation:**
    *   **Compact:** Fixed 52px.
    *   **Card:** Dynamic (Base 120px + Player 80px + Transcript 400px).

### 3.2 Playback Interactions
*   **Local File:**
    *   **Action:** Click Play (▶).
    *   **Flow:** `currentlyPlayingId` set in global store -> `AudioPlayer` component mounts.
    *   **Outcome:** Audio starts immediately.
*   **Device File:**
    *   **Action:** Click Download/Play.
    *   **Flow:** Calls `downloadService.queueDownloads` with `deviceFilename` and `dateRecorded`.
    *   **Visual:** Button shows spinner (`isDownloading` check from global queue).
    *   **Outcome:** File downloads -> List refreshes -> Play button becomes enabled.

### 3.3 Bulk Actions
*   **Bulk Download:**
    *   **Trigger:** "Download All" button (visible if `stats.deviceOnly > 0`).
    *   **Flow:** Iterates all device-only items -> Adds to download queue.
*   **Bulk Process:**
    *   **Trigger:** "Process All" button.
    *   **Flow:** Sets status to `pending` for all untranscribed local files -> Queue picks them up.

---

## 4. API Contracts

### `UnifiedRecording` (Frontend Model)
```typescript
interface UnifiedRecording {
  id: string;
  filename: string;
  location: 'device-only' | 'local-only' | 'both';
  duration: number;
  size: number;
  dateRecorded: Date;
  transcriptionStatus: 'none' | 'pending' | 'processing' | 'complete' | 'error';
  deviceFilename?: string; // If on device
  localPath?: string;      // If local
}
```

### IPC Methods
*   `recordings.getAll()`: Returns raw DB records.
*   `deviceCache.getAll()`: Returns cached device file list.
*   `transcripts.getByRecordingIds(ids[])`: Returns Map of `Transcript` objects.
*   `downloadService.queueDownloads(files[])`: Adds files to background downloader.

---

## 5. Error Handling & Edge Cases

*   **Device Disconnect:** "Download" buttons disabled immediately via `deviceConnected` prop.
*   **Missing Local File:** If `play()` fails due to missing file, shows Toast error "File not found".
*   **Transcription Fail:** Status badge turns Red (`error`). Retry button appears.

---

## 6. Accessibility & Styling

*   **ARIA:** List items have `role="listitem"`. Interactive elements have `aria-label`.
*   **Keyboard:** `Tab` navigation through list items. `Space` to toggle Play/Pause.
*   **Theme:** Uses `muted/50` for hover states. `primary` color for active filters. Dark mode supported via Tailwind classes.

---

## 7. Testing Strategy

### Unit Tests (`src/pages/__tests__/Recordings.test.tsx`)
*   Test filter logic (`filteredRecordings` memo).
*   Test virtualizer height estimation logic.

### Integration Tests
*   **Render:** Mock `useUnifiedRecordings` with 10 items -> Assert 10 cards rendered.
*   **Enrichment:** Verify `transcripts.getByRecordingIds` is called with correct IDs.
*   **Playback:** Click Play -> Verify `audioControls.play` called with correct ID/Path.

### Performance Targets
*   **Initial Render:** < 200ms.
*   **Filter Update:** < 50ms.
*   **Scroll FPS:** > 50fps on mid-range hardware.