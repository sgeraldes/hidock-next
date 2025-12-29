# Knowledge Library Specification

**Module:** Knowledge Management (Pillar I: SOURCES)
**Screen:** Library (`/library`)
**Component:** `src/pages/Recordings.tsx` (Current) / `src/components/ReaderWorkspace.tsx` (Target)
**Screenshot:** ![Library View](../qa/screenshots/library_master.png)

## 1. Overview
The Library is the **Ingestion and Consumption Workspace**. It facilitates the transition from "managing audio files" to a "Document Reader" interface where users can navigate hierarchical sources, read transcripts/PDFs, and bookmark critical segments.

## UI Components & Behavior

| Feature | UI Element | Action | Expected Outcome | Redesign Alignment |
| :--- | :--- | :--- | :--- | :--- |
| **Global Navigation** | Sidebar Link | Click "Library" | Navigates to `#/library`. Loads the **Reader Workspace**. | Matches "Archive" metaphor. |
| **Hierarchical Nav** | Tree View (Left Pane) | Expand Folder | Displays nested sources (Audio, PDF, Web, Images). | NotebookLM "Source Panel". |
| **Content Reader** | Main Pane | Select Source | Renders interactive content (Waveform + Transcript for audio, Markdown for text, PDF Viewer). | "Seamless Reading Experience". |
| **Processing** | Action Toolbar | Click "Analyze" | Triggers multimodal processing: Transcribe (Audio), Analyze (Docs), Describe (Pictures). | "Intelligent Indexing". |
| **Bookmarking** | Bookmark Icon | Click on segment | Saves a reference to a specific time/line. Persists in "Bookmarks" sidebar. | "Deep Context Retrieval". |
| **UI Controls** | Theme/Font Toggle | Click Icon | Updates typography (Font Size, Contrast) for reading comfort. | "Ample Whitespace/Clear Typography". |

---

## 2. Component Specification (Target State)

### 2.1 State Management
| State Variable | Type | Description | Persistence |
| :--- | :--- | :--- | :--- |
| `sourceTree` | `SourceNode[]` | Hierarchical structure of all raw inputs. | DB-backed |
| `activeSource` | `Source \| null` | The currently rendered document/audio. | Session |
| `viewSettings` | `Object` | Zoom level, font size, theme preference. | **Persisted** (Config) |
| `bookmarks` | `Bookmark[]` | List of saved anchors within sources. | DB-backed |

### 2.2 Lifecycle & Events
*   **Mount:** Fetches source hierarchy and user reading preferences.
*   **Switch Source:** Unloads current renderer (Audio/PDF) and initializes new one.
*   **Process:** Monitors background IPC for completion of OCR/Transcription.

---

## 3. Detailed Behavior

### 3.1 Hierarchical Navigation
*   **Structure:** Recursive tree component.
*   **Drag & Drop:** Supports moving sources between folders and bulk uploads.

### 3.2 Document Reader Interface
*   **Audio/Transcript Integration:** Synchronized scrolling. Clicking a word seeks audio to that timestamp.
*   **PDF/Markdown:** High-performance rendering with full-text selection and highlighting.
*   **Picture Description:** AI generates alt-text/descriptions for visual sources.

### 3.3 Intelligence: Extraction
*   **Action:** Click "Process".
*   **Flow:** Source -> AI Backbone (Esperanto) -> Extract Entities (People, Places) -> Index into Explore (Graph).

---

## 4. API Contracts

### `Source` (Redesign Model)
```typescript
interface Source {
  id: string;
  type: 'audio' | 'pdf' | 'markdown' | 'image';
  parentId?: string; // For hierarchy
  title: string;
  content: string; // Raw text or JSON transcript
  metadata: {
    size: number;
    mimeType: string;
    capturedAt: Date;
  };
}
```

---

## 5. Error Handling

*   **Process Fail:** Shows "Analysis Failed" state on source card with retry option.
*   **Large Files:** Progressive loading for 100MB+ PDFs to prevent UI freeze.

---

## 6. Accessibility & Styling

*   **ARIA:** `role="tree"` for navigation. `aria-live` for processing status updates.
*   **Typography:** Ample line height (1.6), sans-serif default, high contrast mode support.

---

## 7. Testing Strategy

### Integration Tests
*   **Tree Nav:** Click deep nested file -> Verify correct content renders.
*   **Sync:** Verify text highlight in transcript matches audio `currentTime`.

### Performance Targets
*   **Source Switch:** < 300ms.
*   **Search (In-Source):** < 100ms.
