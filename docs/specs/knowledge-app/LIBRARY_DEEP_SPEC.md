# Library View - Deep Functional Specification

## 1. Overview & Goals
The **Library** is the core knowledge repository of the application. It aggregates all captured audio (meetings, notes, uploads) from both the local file system and connected HiDock devices.
**Goal**: Provide a highly performant, filterable, and actionable list of all captures, allowing users to manage (delete/move) and consume (play/read) content efficiently.

## 2. Views & Components

### 2.1 View Structure
The Library consists of two main visualization modes and a detail context.
1.  **List View (Default)**: A dense, virtualized table optimized for scanning metadata.
2.  **Card View**: A richer visual grid emphasizing content summary and media type.
3.  **Detail Panel (Drawer/Modal)**: A focused view for a single recording (see Detail Spec).

### 2.2 Minimal Viable Components (MVC)

#### A. Filter Toolbar (Top)
*   **Search Input**: Real-time text filtering (title, filename, participants).
*   **Filter Chips**: "Device Only", "Downloaded", "Transcribed", "Favorites".
*   **Sort Dropdown**: Date (New/Old), Duration, Name.
*   **View Toggle**: Icons for List vs Card.
*   **Bulk Actions Bar**: Appears only when items are selected (Download Selected, Delete Selected, Process Selected).

#### B. Recording List (Main Content)
*   **Virtualized Container**: Handles infinite scroll for 1000+ items.
*   **List Item Row**:
    *   **Selection Checkbox**: For bulk actions.
    *   **Status Icon**: Cloud (Device), Check (Local), Spinner (Syncing).
    *   **Title/Name**: Primary identifier.
    *   **Meta Info**: Date, Duration, Size.
    *   **Quick Actions (Hover)**: Play, Transcribe, Menu (dots).

#### C. Detail View (Side Panel/Route)
*   **Header**: Title, Date, Duration, Edit Title button.
*   **Media Player**: Waveform visualization, Play/Pause, Speed.
*   **Transcript View**: Speaker-diarized text, auto-scroll.
*   **AI Summary**: "Key Points", "Action Items" tabs.

## 3. Data States

| State | Visual Representation | Behavior |
| :--- | :--- | :--- |
| **Loading** | Skeleton rows (shimmer effect). | User cannot interact. |
| **Empty (Total)** | "Zero State" illustration. CTA: "Connect Device" or "Import File". | Center aligned, friendly messaging. |
| **Empty (Filtered)** | "No matching results". | CTA: "Clear Filters". |
| **Populated** | Full list rendered. | Interactive. |
| **Error** | Red banner/toast at top. | "Retry" button available. |

## 4. Interaction Patterns

### 4.1 Navigation & Gestures
*   **Scroll**: Standard vertical scroll. Sticky header for column titles.
*   **Click/Tap (Row)**: Opens Detail View (Side Panel or Navigate).
*   **Right-Click (Row)**: Context Menu (Delete, Rename, Show in Folder).
*   **Double-Click**: Starts Audio Playback immediately.
*   **Hover**: Reveals "Quick Actions" to reduce visual clutter.

### 4.2 Selection Model
*   **Single Click Checkbox**: Selects row (enters Bulk Mode).
*   **Shift + Click**: Range selection.
*   **Cmd/Ctrl + A**: Select all visible/loaded.

## 5. Visual Hierarchy

1.  **Primary**: Recording Title, Play Button.
2.  **Secondary**: Date, Duration, Status Icons (Sync state).
3.  **Tertiary**: File size, Path, Tech metadata (Format, Bitrate).

**Theme Tokens**:
-   **Background**: `bg-background` (White/Dark Gray)
-   **Row Hover**: `hover:bg-muted/50`
-   **Selected Row**: `bg-accent/20`
-   **Text Primary**: `text-foreground`
-   **Text Meta**: `text-muted-foreground`

## 6. Responsiveness

| Breakpoint | Layout Change |
| :--- | :--- |
| **Desktop (>1024px)** | Full Table with all columns (Size, Path, etc). Detail view can be a Side Drawer (Split View). |
| **Tablet (768px-1024px)** | Hide "Path" and "Size" columns. Detail view is a Modal. |
| **Mobile (<768px)** | Switch to **Card View** automatically (Row layout too wide). Hide "Bulk Actions" behind a "Select" mode toggle. |

## 7. Implementation Manual (Step-by-Step)

### Phase 1: Structure & Routing
1.  **Rename**: `apps/electron/src/pages/Recordings.tsx` -> `Library.tsx`.
2.  **Refactor**: Split `Library.tsx` into `components/library/RecordingList.tsx`, `RecordingCard.tsx`, `FilterToolbar.tsx`.
3.  **Route**: Ensure `/library` points to this new container.

### Phase 2: Virtualization & Data
1.  **Hook**: Create `useLibraryData.ts`. Move data fetching logic (UnifiedRecordings) there.
2.  **Virtualizer**: Implement `@tanstack/react-virtual` in `RecordingList.tsx`.
3.  **Optimization**: Ensure `estimateSize` is accurate for both List (52px) and Card (variable) modes.

### Phase 3: Selection & Bulk Actions
1.  **State**: Add `selectedIds: Set<string>` to `useUIStore` or local state.
2.  **UI**: Create `BulkActionBar` component (floating bottom or sticky top).
3.  **Logic**: Implement `handleDownloadSelected`, `handleDeleteSelected` connecting to `electronAPI`.

### Phase 4: Detail View
1.  **Router**: Add child route `/library/:id` OR state-driven Drawer `<Sheet open={!!selectedId}>`.
2.  **Component**: Extract Detail logic from `Recordings.tsx` (the expanded accordion part) into a proper `RecordingDetail` component.
3.  **Waveform**: (Optional) Integrate a waveform player library (e.g., `wavesurfer.js`) replacing the simple HTML5 audio.

### Phase 5: Design Polish
1.  **Tailwind**: Apply `shadcn/ui` Table component styles to the virtualized list.
2.  **Icons**: Update status icons to use the specific color tokens defined in Hierarchy.
3.  **Empty States**: Create designated SVG/Illustration components for "No Device" and "No Results".

## 8. Proposed Design Mockup Description
*   **Header**: Clean white background. Left: "Library" (H1). Right: "Search" (pill shape), "View Toggle" (Segmented Control).
*   **Sub-Header**: Filter Chips (Pill shape, outline). Active filters turn solid primary color.
*   **Main List**: Zebra-striped rows (very subtle). Status icon is the first column. Title is bold. Hovering a row highlights it and shows a floating "Play" button over the file icon.
*   **Drawer**: Slides in from right (30% width). White background. Top: Audio Player (Sticky). Bottom: Scrollable Transcript with "Summary" tab.
