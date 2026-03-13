# SPEC-008: Library Selection Model & File Operations

## Problem Statement
The current HiDock Next selection model in the Knowledge Library is inconsistent and confusing. Users face two independent state systems: `selectedSourceId` (for viewing in the center panel) and `selectedIds` (for checkboxes/bulk operations). These systems do not synchronize, leading to situations where a user is viewing one recording while others are checked, with confusing status indicators like "1 of 1333 selected" referring only to checkboxes.

Furthermore, the application lacks essential file-level operations. Users cannot open a recording in their default system player, reveal it in Explorer/Finder, or copy its file path, limiting the utility of the "Universal Knowledge Hub" as a file management tool.

## Bugs Addressed
| Bug ID | Summary | Severity |
|--------|---------|----------|
| **BUG-016** | Selection model inconsistency between row click (view) and checkboxes (bulk) | P2 |
| **BUG-017** | Missing "Open File" and "Open Containing Folder" for individual recordings | P3 |

## User Stories
1. **As a user**, I want clicking a recording to both select it for viewing and mark it as the primary selection, so the selection state is intuitive and consistent.
2. **As a user**, I want to use standard keyboard modifiers (Shift+Click, Ctrl/Cmd+Click) to select multiple recordings for bulk operations.
3. **As a user**, I want to be able to right-click a recording and open it in my default media player or see where it is located on my disk.
4. **As a user**, I want the "Bulk Action Bar" to appear automatically whenever more than one item is selected, providing clear options for the selected set.

## Current Behavior (Broken)
1. **Independent States**: `selectedSourceId` (Zustand) and `selectedIds` (local state in `useSourceSelection`) are disconnected.
2. **Conflicting Visuals**: A row can be highlighted as "active" (center panel) while its checkbox is unchecked, or vice versa.
3. **Limited Actions**: The center panel action buttons only include Play, Link, Download, Transcribe, and Delete. There is no "Open" or "Reveal" functionality.
4. **No Context Menu**: Right-clicking a row does nothing or shows default browser context menu.

## Expected Behavior (Target)
1. **Unified Selection**: 
    - Single Click: Selects the item, clears other selections, and opens it in the center panel.
    - Checkbox Click: Toggles the item's inclusion in the selection set without necessarily changing the center panel view (unless it's the first item selected).
    - Shift+Click: Selects a range from the last selected item to the clicked item.
    - Ctrl/Cmd+Click: Toggles individual items in the selection set.
2. **Coordinated UI**: Rows highlight when selected (checkbox checked). The center panel shows the "most recently interacted" item among the selection.
3. **Enhanced File Operations**: New actions "Open in Default App" and "Reveal in Explorer/Finder" added to SourceReader and a new Right-Click Context Menu.

## Acceptance Criteria
### Selection Model
- [ ] Clicking a row (excluding buttons/checkbox) MUST set `selectedSourceId` AND add that ID to `selectedIds` (clearing others).
- [ ] Ctrl/Cmd+Click MUST toggle the item in `selectedIds` without clearing others.
- [ ] Shift+Click MUST select the range in the current filtered list.
- [ ] The "Bulk Action Bar" MUST show the count of `selectedIds`.
- [ ] Pressing `Enter` on a focused row MUST select it and open the detail view.

### File Operations
- [ ] `SourceReader` MUST include "Open File" and "Reveal in Folder" buttons (only for local recordings).
- [ ] Right-clicking a `SourceRow` MUST open a context menu with: Open, Reveal in Folder, Copy Path, Transcribe, Delete.
- [ ] "Open File" MUST use `shell.openPath()`.
- [ ] "Reveal in Folder" MUST use `shell.showItemInFolder()`.

### State Synchronization
- [ ] `useLibraryStore` MUST be updated to manage both `selectedSourceId` and `selectedIds` to ensure cross-component synchronization.
- [ ] If `selectedSourceId` is deleted, the selection MUST move to the next available item or clear.

## Technical Approach

### Selection Model Redesign
Move `selectedIds` from local hook state to `useLibraryStore`. This ensures that `LibraryHeader`, `SourceRow`, and `BulkActionsBar` all see the same truth.

```typescript
// useLibraryStore.ts updates
interface LibraryState {
  selectedIds: Set<string>        // Currently exists, but needs to be primary
  lastSelectedId: string | null   // For Shift+click range start
  selectedSourceId: string | null // For center panel
}

interface LibraryActions {
  selectSingle: (id: string) => void
  toggleSelection: (id: string) => void
  selectRange: (id: string, filteredIds: string[]) => void
  // ... existing actions
}
```

### File Operations IPC Contract
New IPC handlers in `storage-handlers.ts`:

| Channel | Payload | Description |
|---------|---------|-------------|
| `storage:open-file` | `{ filePath: string }` | Invokes `shell.openPath(filePath)` |
| `storage:reveal-file` | `{ filePath: string }` | Invokes `shell.showItemInFolder(filePath)` |

### Context Menu Implementation
Add a `onContextMenu` handler to `SourceRow.tsx`. Use a Radix UI Context Menu or a custom Electron native menu via IPC. Given the project's use of Radix primitives, a React-based context menu is preferred for consistency.

## UI/UX Requirements
- **Selection Visuals**: Selected rows get a distinct background color and the checkbox is checked.
- **Bulk Bar**: Slides up from bottom when `selectedIds.size > 1`.
- **Empty Selection**: If no items are selected, center panel shows an empty state.
- **Iconography**: 
  - Open File: `ExternalLink` or `PlayCircle`
  - Reveal: `FolderSearch` or `FolderOpen`
  - Copy Path: `Copy`

## Testing Strategy
- **Unit Tests**: Update `useLibraryStore` tests to verify selection logic (range, toggle).
- **Integration Tests**: Verify IPC calls for `open-file` and `reveal-file` using mocks.
- **Manual QA**:
  - Test Shift+Click range selection across multiple pages of virtualized list.
  - Verify "Reveal in Folder" opens the correct OS window (Explorer/Finder).
  - Check that clicking a button inside a row doesn't trigger row selection.

## Dependencies & Risks
- **Virtualization**: Shift-selecting ranges requires access to the full filtered list, not just visible items (already handled by `filteredRecordings` memo).
- **OS Differences**: `shell.openPath` behavior varies by OS (Windows might prompt for app, macOS uses Launch Services).

## Out of Scope
- File renaming (will be handled in a separate metadata spec).
- Drag-and-drop to export files (planned for Wave 5).
- Multi-select delete confirmation (handled in SPEC-007).
