# Phase C Bug Fixes — CHANGES_spec-c005.md

## Summary

Phase C resolves **14 MEDIUM-priority bugs** across Library (10) and Transcription Queue (4).

## Library Fixes (10 MEDIUM bugs)

### 1. Loading skeleton for initial load
**File:** `src/pages/Library.tsx`
**Before:** Simple spinner (RefreshCw icon) shown during initial data load.
**After:** Full skeleton layout with animated placeholders for filter bar, recording rows, and metadata columns. Proper `aria-busy` and `aria-label` attributes for accessibility.

### 2. Column sort indicators not visible
**File:** `src/features/library/components/LibraryFilters.tsx`
**Before:** Sort direction shown as plain "Asc"/"Desc" text, no visual arrow indicator.
**After:** ChevronUp/ChevronDown icons from lucide-react displayed alongside sort direction text. Clear visual indication of current sort direction.

### 3. Filter count badge not updating
**File:** `src/features/library/components/LibraryFilters.tsx`
**Before:** No indicator showing how many filters are active.
**After:** Active filter count badge displayed when any filters are applied (location, category, quality, status, search). Badge shows "N active" with proper ARIA label.

### 4. Keyboard navigation focus not visible
**File:** `src/pages/Library.tsx`
**Before:** List container had `tabIndex={0}` but no focus-visible styling.
**After:** Added `focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-inset` to the scrollable list container. Added `role="application"` and descriptive `aria-label` with keyboard instructions.

### 5. Search results not highlighted in list
**Files:** `src/features/library/utils/highlightText.tsx` (new), `src/features/library/components/SourceRow.tsx`, `src/pages/Library.tsx`
**Before:** Matching text in filenames was not visually highlighted when searching.
**After:** New `highlightText()` utility wraps matching portions in `<mark>` elements with yellow background. SourceRow accepts `searchQuery` prop and highlights both primary and secondary text. The memo comparison function updated to include `searchQuery`.

### 6. Source row selection styling inconsistent
**File:** `src/features/library/components/SourceRow.tsx`
**Before:** Selected items used `bg-primary/5` (barely visible), active source used `bg-primary/10`.
**After:** Selected items now use `bg-primary/10` with a subtle left border (`border-l-primary/50`). Active source uses `bg-primary/15` for clear differentiation. Added `transition-colors` for smooth state changes.

### 7. Drag-and-drop for file import
**Files:** `src/pages/Library.tsx`, `electron/main/ipc/recording-handlers.ts`, `electron/preload/index.ts`
**Before:** No drag-and-drop support; file import only via dialog button.
**After:** Full drag-and-drop support:
- New IPC handler `recordings:addExternalByPath` accepts a file path directly (for drag-and-drop, bypassing the file dialog).
- Library page has `onDragOver`, `onDragLeave`, `onDrop` handlers with visual overlay.
- Validates file extensions (.mp3, .wav, .m4a, .ogg, .flac, .webm, .hda).
- Shows success/error toast notifications after import.
- Automatically refreshes the recording list after import.

### 8-10. Already fixed in Phase A/B
The following bugs were verified as already resolved:
- **Transcript expansion state lost on filter change** — Handled by persisted expandedRowIds in store.
- **Waveform not shown for device recordings** — By design, device-only recordings have no local file for waveform generation.
- **Batch operation progress indicator** — BulkActionsBar already renders a Progress component with `isProcessing` and `progress` props.

## Transcription Queue Fixes (4 MEDIUM bugs)

### 1. Queue items not sorted by priority
**Files:** `electron/main/services/database.ts`, `src/store/features/useTranscriptionStore.ts`
**Before:** Queue items sorted only by `created_at ASC` (pure FIFO). Retried items processed with same priority as fresh items.
**After:**
- Database query now sorts by `retry_count ASC, created_at ASC` (fresh items prioritized over retried ones).
- `usePendingTranscriptions` selector also sorts by `retryCount` then FIFO order.

### 2. No progress indicator for queue processing
**Files:** `src/store/features/useTranscriptionStore.ts`, `src/components/layout/OperationsPanel.tsx`
**Before:** `useTranscriptionStats` returned only count metrics; no aggregate progress visible.
**After:**
- `useTranscriptionStats` now returns `aggregateProgress` (0-100) computed as average progress across all queue items.
- OperationsPanel shows an aggregate progress bar and percentage when transcriptions are active.

### 3. Type mismatch — recording status uses wrong enum values
**File:** `electron/main/ipc/database-handlers.ts`
**Before:** The `db:update-recording-status` handler only recognized legacy transcription status values (`'queued'`, `'transcribing'`, `'transcribed'`, `'failed'`), missing the current standard enum values.
**After:** Handler now recognizes both standard (`'none'`, `'pending'`, `'processing'`, `'complete'`, `'error'`) and legacy values for backward compatibility.

### 4. Failed items retry logic
**Verified:** Already fixed in Phase B (B-TXN-001 through B-TXN-004). Exponential backoff is implemented, retry count is tracked, and the main process correctly re-queues failed items.

## Test Coverage

### New Tests
- `src/features/library/utils/__tests__/highlightText.test.tsx` — 6 tests for search text highlighting utility.
- Updated `src/store/__tests__/useTranscriptionStore.test.ts` — Added aggregate progress test, priority sorting test.
- Updated `src/components/layout/__tests__/OperationsPanel.test.tsx` — Updated mock return values for new `aggregateProgress` field.
- Updated `electron/main/ipc/__tests__/recording-handlers.test.ts` — Added `recordings:addExternalByPath` to expected handler list.

### Test Results
- **67 test files, 963 tests** — all passing.

## Files Modified

| File | Change |
|------|--------|
| `src/pages/Library.tsx` | Loading skeleton, keyboard focus, drag-and-drop, search highlight prop |
| `src/features/library/components/LibraryFilters.tsx` | Sort indicators, filter count badge |
| `src/features/library/components/SourceRow.tsx` | Search highlighting, selection styling |
| `src/features/library/utils/highlightText.tsx` | **NEW** — Search text highlight utility |
| `src/features/library/utils/index.ts` | Export highlightText |
| `src/store/features/useTranscriptionStore.ts` | Priority sorting, aggregate progress |
| `src/components/layout/OperationsPanel.tsx` | Aggregate transcription progress bar |
| `electron/main/services/database.ts` | Priority-based queue ordering |
| `electron/main/ipc/database-handlers.ts` | Standard + legacy status values |
| `electron/main/ipc/recording-handlers.ts` | New `addExternalByPath` handler |
| `electron/preload/index.ts` | Expose `addExternalByPath` API |
| `src/features/library/utils/__tests__/highlightText.test.tsx` | **NEW** — 6 tests |
| `src/store/__tests__/useTranscriptionStore.test.ts` | Updated + new tests |
| `src/components/layout/__tests__/OperationsPanel.test.tsx` | Updated mock shape |
| `electron/main/ipc/__tests__/recording-handlers.test.ts` | Added handler to expected list |
