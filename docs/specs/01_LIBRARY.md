# Knowledge Library Specification

**Module:** Knowledge Management
**Screen:** Library (`/library`)
**Component:** `src/pages/Recordings.tsx`
**Screenshot:** ![Library View](../qa/screenshots/library_master.png)

## 1. Overview
The Library currently acts as the central **Knowledge Repository**, storing all captured conversations, meetings, and insights. It allows users to browse, filter, and manage their knowledge base efficiently using a virtualized list for performance.

**Strategic Note:** While currently implemented as a "List of Files", the vision for this module is to evolve into a "Knowledge System" where the audio file is secondary to the extracted insights, semantic connections, and knowledge graph. See Section 8 for the Future Vision.

---

## 2. Current Implementation (Phase 1)

### 2.1 UI Components & Behavior

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

### 2.2 Component Specification

#### State Management
| State Variable | Type | Description | Persistence |
| :--- | :--- | :--- | :--- |
| `searchQuery` | `string` | Text filter for title/subject/filename. | Session |
| `locationFilter` | `'all' \| 'device-only' \| 'local-only'` | Filter by storage location. | Session |
| `compactView` | `boolean` | Toggle between Card and List view. | **Persisted** (Zustand) |
| `transcripts` | `Map<string, Transcript>` | Enriched data for local recordings. | Session (Memoized) |
| `meetings` | `Map<string, Meeting>` | Linked meeting data. | Session (Memoized) |
| `expandedTranscripts` | `Set<string>` | IDs of cards with expanded details. | Session |

#### Lifecycle & Events
*   **Mount:** Fetches initial recording list via `useUnifiedRecordings` (Device + DB).
*   **Enrichment:** On `recordings` change, batch fetches missing transcripts (`transcripts.getByRecordingIds`) and meetings (`meetings.getByIds`).
*   **Virtualization:** Uses `useVirtualizer` to render only visible rows (`overscan: 5`).

### 2.3 Detailed Behavior

#### List Rendering
*   **Specs:** Must render 1000+ items at 60fps.
*   **Logic:** `filteredRecordings` array is memoized based on all active filters.
*   **Height Calculation:**
    *   **Compact:** Fixed 52px.
    *   **Card:** Dynamic (Base 120px + Player 80px + Transcript 400px).

#### Playback Interactions
*   **Local File:**
    *   **Action:** Click Play (▶).
    *   **Flow:** `currentlyPlayingId` set in global store -> `AudioPlayer` component mounts.
    *   **Outcome:** Audio starts immediately.
*   **Device File:**
    *   **Action:** Click Download/Play.
    *   **Flow:** Calls `downloadService.queueDownloads` with `deviceFilename` and `dateRecorded`.
    *   **Visual:** Button shows spinner (`isDownloading` check from global queue).
    *   **Outcome:** File downloads -> List refreshes -> Play button becomes enabled.

#### Bulk Actions
*   **Bulk Download:**
    *   **Trigger:** "Download All" button (visible if `stats.deviceOnly > 0`).
    *   **Flow:** Iterates all device-only items -> Adds to download queue.
*   **Bulk Process:**
    *   **Trigger:** "Process All" button.
    *   **Flow:** Sets status to `pending` for all untranscribed local files -> Queue picks them up.

### 2.4 API Contracts

#### `UnifiedRecording` (Frontend Model)
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

#### IPC Methods
*   `recordings.getAll()`: Returns raw DB records.
*   `deviceCache.getAll()`: Returns cached device file list.
*   `transcripts.getByRecordingIds(ids[])`: Returns Map of `Transcript` objects.
*   `downloadService.queueDownloads(files[])`: Adds files to background downloader.

### 2.5 Error Handling & Edge Cases

*   **Device Disconnect:** "Download" buttons disabled immediately via `deviceConnected` prop.
*   **Missing Local File:** If `play()` fails due to missing file, shows Toast error "File not found".
*   **Transcription Fail:** Status badge turns Red (`error`). Retry button appears.

### 2.6 Accessibility & Styling

*   **ARIA:** List items have `role="listitem"`. Interactive elements have `aria-label`.
*   **Keyboard:** `Tab` navigation through list items. `Space` to toggle Play/Pause.
*   **Theme:** Uses `muted/50` for hover states. `primary` color for active filters. Dark mode supported via Tailwind classes.

### 2.7 Testing Strategy

#### Unit Tests (`src/pages/__tests__/Recordings.test.tsx`)
*   Test filter logic (`filteredRecordings` memo).
*   Test virtualizer height estimation logic.

#### Integration Tests
*   **Render:** Mock `useUnifiedRecordings` with 10 items -> Assert 10 cards rendered.
*   **Enrichment:** Verify `transcripts.getByRecordingIds` is called with correct IDs.
*   **Playback:** Click Play -> Verify `audioControls.play` called with correct ID/Path.

#### Performance Targets
*   **Initial Render:** < 200ms.
*   **Filter Update:** < 50ms.
*   **Scroll FPS:** > 50fps on mid-range hardware.

---

## 8. Strategic Vision: The True Knowledge Library (Enhancement Proposal)

**Expert Note:** The current "File List" implementation is insufficient for the product vision. The goal is to move from "managing files" to "managing knowledge".

### 8.1 Core Concept Shift
*   **From:** A directory of `.wav` files with attached transcripts.
*   **To:** A **Knowledge System** that indexes, connects, and visualizes "EVERYTHING that is going on around you".
*   **Entrance:** The HiDock device is merely the *ingestion point*, not the defining structure.

### 8.2 Proposed Core Functionality
1.  **Intelligent Indexing:**
    *   **Automated Pipeline:** Audio -> Transcript -> Speaker Diarization -> Topic Extraction -> Action Item Extraction -> Entity Linking.
    *   **Outcome:** "Files" disappear; "Events" and "Insights" emerge.
2.  **Semantic Search:**
    *   **Capability:** "Find where we discussed the Q3 budget" (Natural Language).
    *   **Tech:** Vector embeddings (RAG) for all indexed content.
3.  **Knowledge Graph:**
    *   **Structure:** `Person` <-> `Meeting` <-> `Topic` <-> `Project`.
    *   **Navigation:** Click a "Topic" node to see all related Meetings and People.
4.  **Contextual Linking:**
    *   **Metadata:** Auto-associate recording time/location with Calendar events (already partially done) and GPS/Location data (future).
5.  **Trend Identification:**
    *   **Insight:** "You spend 30% of your time discussing 'Optimization' this month."

### 8.3 UX/UI Redesign Concepts
*   **Dashboard View:** Not a list. A high-level overview of *Recent Activity*, *Pending Actions*, and *Suggested Insights*.
*   **Graph Visualization:** An interactive node-link diagram replacing the list view for exploration.
*   **Timeline View:** A chronological stream of "Knowledge Events" (Meetings, Ideas, Decisions) rather than file dates.
*   **Tagging 2.0:** AI-suggested taxonomy (e.g., "Strategic", "Tactical", "HR") replacing manual tags.

### 8.4 Technical Requirements (Gap Analysis)
*   **Storage:** Need vector database (e.g., `pgvector`, local ChromaDB) for semantic search.
*   **Search Engine:** Move beyond SQL `LIKE` queries to Hybrid Search (Keyword + Semantic).
*   **API:** Expose "Knowledge Graph" API for external integrations (e.g., Notion sync).

### 8.5 Measurable Success Metrics
*   **Retrieval Time:** Reduce time to find a specific decision by **50%**.
*   **Insight Accuracy:** Increase AI-generated summary acceptance rate to **90%**.
*   **Feature Adoption:** Achieve **40%** user adoption of Semantic Search vs. Keyword Search.
