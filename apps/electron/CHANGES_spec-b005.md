# Spec B-005: Library (9 HIGH bugs) - Changes Summary

## B-LIB-001: Race condition in loading state

**Problem:** Boolean `unifiedRecordingsLoading` was toggled by multiple concurrent async operations, causing race conditions where one operation clearing loading would hide the fact that another was still in progress.

**Fix:** Added counter-based loading: `unifiedRecordingsLoadingCount: number` with `incrementUnifiedRecordingsLoading()` and `decrementUnifiedRecordingsLoading()` actions. The `unifiedRecordingsLoading` boolean is now derived from `loadingCount > 0`. A `decremented` flag in `loadRecordings` prevents double-decrement on error paths.

**Files changed:**
- `src/store/useAppStore.ts` -- Added counter state and actions
- `src/hooks/useUnifiedRecordings.ts` -- Replaced `setLoading(true/false)` with increment/decrement
- `src/hooks/__tests__/useUnifiedRecordings.test.ts` -- Updated mock and assertions
- `src/store/__tests__/useAppStore.test.ts` -- Added 6 counter-based loading tests

---

## B-LIB-002: Stale closure in useAudioControls

**Problem:** `useAudioControls()` returned a new object on every call, causing stale closures when consumed by components using the controls in callbacks.

**Fix:** Wrapped return value with `useMemo(() => ({...}), [])`. The functions delegate to `window.__audioControls` at call time, so the empty dependency array is correct.

**Files changed:**
- `src/components/OperationController.tsx` -- Added `useMemo` wrapper
- `src/components/__tests__/AudioPlayer-playbackRate.test.tsx` -- Updated to use `renderHook`

---

## B-LIB-003: Infinite render loop risk from isSelected function

**Problem:** The `isSelected` function in `useLibraryStore` created a closure that captured state at subscription time. When used as a Zustand selector, it could cause infinite re-renders because the function reference changed on every state update.

**Fix:** Removed `isSelected` method from the store entirely. Components now use `selectedIds.has(id)` directly, which is a method call on the stable `Set` reference. Updated `useSourceSelection` hook to no longer expose `isSelected`.

**Files changed:**
- `src/store/useLibraryStore.ts` -- Removed `isSelected` from interface and implementation
- `src/features/library/hooks/useSourceSelection.ts` -- Removed `isSelected` from hook
- `src/pages/Library.tsx` -- Changed to `selectedIds.has(recording.id)`
- `src/store/__tests__/useLibraryStore.test.ts` -- Updated tests to use `selectedIds.has()`
- `src/pages/__tests__/Library.test.tsx` -- Updated mock
- `src/__tests__/performance/library-performance.test.tsx` -- Updated mock
- `src/__tests__/accessibility/library-a11y.test.tsx` -- Updated mock

---

## B-LIB-004: Batch operations don't check abort signal

**Problem:** The enrichment `Promise.all` in Library.tsx did not check whether the component had been re-rendered (filters changed, navigation) before applying the fetched results, potentially applying stale data.

**Fix:** Added abort signal check after `Promise.all` completes and before processing results. Uses the existing `enrichmentAbortController` ref. Early return if `signal.aborted` is true.

**Files changed:**
- `src/pages/Library.tsx` -- Added `signal.aborted` check after Promise.all

---

## B-LIB-005: expandedTranscripts state not centralized

**Problem:** `expandedTranscripts` was managed as local React state in `Library.tsx`, making it impossible for other components to access or control transcript expansion state.

**Fix:** Moved `expandedTranscripts: Set<string>` to `useLibraryStore` as transient state (excluded from `partialize`, not persisted). Added `toggleTranscriptExpansion(id)` and `collapseAllTranscripts()` actions. Library.tsx now reads from the store instead of `useState`.

**Files changed:**
- `src/store/useLibraryStore.ts` -- Added `expandedTranscripts`, `toggleTranscriptExpansion`, `collapseAllTranscripts`
- `src/pages/Library.tsx` -- Replaced `useState` with store selectors

---

## B-LIB-006: Uses window.confirm for destructive actions

**Problem:** Three destructive operations (bulk delete, device delete, local delete) used `window.confirm()` which is blocking, unstyled, and not accessible.

**Fix:** Created `ConfirmDialog` component using Radix `AlertDialog`. Replaced all three `window.confirm()` calls with state-driven dialog pattern. Also replaced `alert()` error notifications with toast calls.

**Files changed:**
- `src/components/ConfirmDialog.tsx` -- New reusable confirm dialog component
- `src/pages/Library.tsx` -- Replaced `window.confirm` with `ConfirmDialog` state pattern

---

## B-LIB-007: No batch delete API

**Problem:** Bulk deletion required N sequential IPC calls, one per recording. No batch endpoint existed.

**Fix:** Added `recordings:deleteBatch` IPC handler with Zod validation (`z.array(z.string().uuid()).min(1).max(1000)`). Returns structured result with `{success, deleted, failed, errors}`. Added 5 unit tests for the handler.

**Files changed:**
- `electron/main/ipc/recording-handlers.ts` -- Added `recordings:deleteBatch` handler
- `electron/main/ipc/validation.ts` -- Added `DeleteBatchRecordingsSchema`
- `electron/preload/index.ts` -- Exposed `deleteBatch` in preload
- `electron/main/ipc/__tests__/recording-handlers.test.ts` -- Added 5 tests

---

## B-LIB-008: estimateSize complex calculation unnecessary

**Problem:** The virtualizer `estimateSize` function performed complex per-row calculations based on transcript expansion, playing state, meeting links, etc. These calculations were unnecessary because the virtualizer uses `measureElement` for actual sizing.

**Fix:** Simplified to `() => compactView ? 48 : 200` with only `[compactView]` dependency.

**Files changed:**
- `src/pages/Library.tsx` -- Simplified `estimateSize` callback

---

## B-LIB-009: Download queue key inconsistency

**Problem:** Calendar.tsx used `recording.id` as the download queue map key, while the download orchestrator used `item.filename` (the device filename). This mismatch meant Calendar couldn't detect when a file was already being downloaded by the orchestrator.

**Fix:** Standardized Calendar.tsx to use `recording.deviceFilename` as the download queue key, matching the download orchestrator pattern. Updated both single-download and bulk-download code paths.

**Files changed:**
- `src/pages/Calendar.tsx` -- Changed download queue key from `recording.id` to `recording.deviceFilename`

---

## Test Results

All 831 tests pass across 54 test files. New tests added: 11 (6 counter-loading + 5 deleteBatch handler).
