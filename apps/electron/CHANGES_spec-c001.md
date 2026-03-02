# Phase C Bug Fixes (spec-c001)

**Date:** 2026-03-02
**Scope:** Actionables, Explore, State Management -- ~15 MEDIUM severity bugs

## Actionables Fixes (8)

### C-ACT-001: Status transition validation relaxed
- **File:** `electron/main/ipc/actionables-handlers.ts`
- **Issue:** Status transitions were too strict, blocking valid workflows like direct `pending -> generated` completion and re-processing from `shared` or `generated` states.
- **Fix:** Expanded the `validTransitions` map to include `pending -> generated`, `shared -> pending`, `generated -> dismissed`. Also updated `generateOutput` handler to allow re-generation from `generated` status.

### C-ACT-002: Cleanup for generated outputs
- **File:** `electron/main/ipc/actionables-handlers.ts`
- **Issue:** When an actionable was dismissed or reverted to pending, the associated output artifact in the `outputs` table was never cleaned up, leading to orphaned rows.
- **Fix:** Added cleanup logic in `updateStatus` handler that deletes the output and clears `artifact_id`/`generated_at` when transitioning to `dismissed` or `pending` from a state that has an artifact.

### C-ACT-003: Consistent status badge styling
- **File:** `src/pages/Actionables.tsx`
- **Issue:** The left status bar color only covered `pending`, `generated`, and a fallback `bg-muted`. Statuses `in_progress`, `shared`, and `dismissed` had inconsistent or missing colors.
- **Fix:** Created `getStatusBarColor()` function mapping all 5 statuses to distinct colors. Updated `getStatusIcon()` to use `text-violet-500` for `shared` (was `text-blue-500`, same as `in_progress`).

### C-ACT-004: Client-side output caching
- **File:** `src/pages/Actionables.tsx`
- **Issue:** Every "View Output" click triggered a round-trip IPC call even when the output was just fetched.
- **Fix:** Added `outputCacheRef` (Map) that caches fetched/generated outputs by actionable ID. Cache is checked before IPC calls. Cache is invalidated on regeneration.

### C-ACT-005: Pagination for actionables list
- **File:** `src/pages/Actionables.tsx`
- **Issue:** All actionables loaded and rendered at once with no pagination, causing potential performance issues with large lists.
- **Fix:** Added client-side pagination with `PAGE_SIZE = 20`, page controls with prev/next buttons, and automatic page reset when status filter changes.

### C-ACT-006: Loading skeleton for initial load
- **File:** `src/pages/Actionables.tsx`
- **Issue:** Initial load showed only a spinning icon with no structural indication of what was loading.
- **Fix:** Created `ActionableSkeleton` component that renders 3 shimmer cards matching the actual card layout (status bar, icon, title, badges).

### C-ACT-007: Confirmation before regenerate
- **File:** `src/pages/Actionables.tsx`
- **Issue:** No confirmation dialog when regenerating an output, risking accidental overwrites.
- **Fix:** Added `confirmRegenerate` state and a Dialog component that prompts users before regeneration, showing the template name and warning about replacement.

### C-ACT-008: Timestamp on generated outputs
- **File:** `src/pages/Actionables.tsx`
- **Issue:** The output modal only showed the template name with no generation timestamp.
- **Fix:** Added `generatedAt` display using `formatDateTime()` in the DialogDescription, shown with a middle dot separator.

## Explore Fixes (5)

### C-EXP-002: Search performance metrics
- **File:** `src/pages/Explore.tsx`
- **Issue:** No visibility into how long searches take, making it hard to identify slow queries.
- **Fix:** Added `searchDurationMs` state tracked via `performance.now()`. Displayed as a small badge next to the result count header (e.g., "142ms").

### C-EXP-003: Pagination for search results
- **File:** `src/pages/Explore.tsx`
- **Issue:** All knowledge results rendered at once regardless of count.
- **Fix:** Added client-side pagination for the knowledge section with `SEARCH_PAGE_SIZE = 20`, prev/next controls, and page reset on new search.

### C-EXP-004: Search input autofocus on mount
- **File:** `src/pages/Explore.tsx`
- **Issue:** Users had to manually click into the search input after navigating to the Explore page.
- **Fix:** Added `searchInputRef` passed to the Input component, with a `useEffect` that calls `.focus()` after a 100ms delay (to account for route transitions).

### C-EXP-005: Loading skeleton during search
- **File:** `src/pages/Explore.tsx`
- **Issue:** During the first search (when no prior results exist), only the spinner in the search bar was visible with no structural loading indication.
- **Fix:** Created `SearchResultSkeleton` component with shimmer placeholders matching the result layout (tabs, section headers, cards). Displayed when `loading && !results`.

### B-EXP-005 (already fixed in Phase B): Debounce cancellation on unmount
- **Status:** Already fixed in Phase B. The `AbortController` and `cancelledRef` pattern properly cancels pending requests on unmount.

## State Management Fixes (2)

### C-SM-001: isDownloading query method optimization
- **File:** `src/store/useAppStore.ts`
- **Status:** Already properly handled. The deprecated `isDownloading()` store method is only used in test code. Production code uses the `useIsDownloading(id)` selector hook which returns a scalar boolean, avoiding the new-function-per-call issue. No code change needed.

### C-SM-002: Stale closure in device polling interval
- **File:** `src/pages/Device.tsx`
- **Issue:** `loadBatteryStatus` was defined as a plain function in the component body and captured by `setInterval`. While current implementation happened to work (stable `deviceService` reference), the pattern was fragile and could break if dependencies changed.
- **Fix:** Wrapped `loadBatteryStatus` in `useCallback` and added a `loadBatteryStatusRef` that always points to the latest version. The `setInterval` callback now reads from the ref, eliminating any stale closure risk. Removed the `eslint-disable-next-line` comment since deps are now properly declared.

## Test Updates

- Updated 3 existing tests in `actionables-handlers.test.ts` to match relaxed transition rules
- Added 5 new tests:
  - `should allow transition shared -> pending`
  - `should allow transition pending -> generated`
  - `should reject truly invalid status transition (shared -> in_progress)`
  - `should clean up output artifact when dismissing a generated actionable`
  - `should clean up output artifact when reverting generated to pending`
  - `should not attempt cleanup when no artifact_id exists`
  - `should allow regeneration from generated status`
  - `should reject generation from dismissed status`

## Test Results

All **66 test files** pass with **961 tests** total (up from 955 before Phase C).
