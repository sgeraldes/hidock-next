# CHANGES_spec-b001: Actionables + Explore (10 HIGH bugs)

## Summary

Fixed 10 HIGH-priority bugs across the Actionables and Explore pages, covering
server-side rate limiting, race condition prevention, error handling improvements,
output retrieval, search highlighting, navigation context preservation, multi-term
search ranking, callback memoization, and request cancellation on unmount.

## Bug Fixes

### Actionables (5 bugs)

#### B-ACT-001: Server-side rate limiting
- **File:** `electron/main/ipc/outputs-handlers.ts`
- Added sliding window rate limiter using `Map<string, number[]>` keyed by
  actionableId or knowledgeCaptureId (5 requests per 60-second window)
- Added `RATE_LIMITED` error code to `electron/main/types/api.ts`
- Client-side rate limit in Actionables.tsx aligned to 5/minute (was 3)
- Client-side now uses toast.warning for rate limit messages

#### B-ACT-002: Race condition in handleApprove
- **File:** `src/pages/Actionables.tsx`
- Added `loadingActionableIds: Set<string>` state for per-actionable tracking
- Approve button shows per-item `<Loader2>` spinner and text "Generating..."
- Button is disabled during the operation (prevents double-click race)
- On failure, explicitly reverts actionable status to 'pending' client-side

#### B-ACT-003: Missing error handling for dismiss
- **File:** `src/pages/Actionables.tsx`
- Replaced `setGenerationError()` with `toast.error()` for dismiss failures
- Dismiss errors now appear as non-blocking toast notifications

#### B-ACT-004: No way to view existing output for actionable
- **File:** `electron/main/ipc/outputs-handlers.ts` (new handler)
- **File:** `electron/preload/index.ts` (exposed in preload)
- Added `outputs:getByActionableId` IPC handler that queries the actionable's
  `artifact_id` and returns the associated output from the `outputs` table
- View Output button now fetches existing output instead of regenerating
- Falls back to regeneration if no existing output is found

#### B-ACT-005: Error access inconsistent
- **File:** `src/pages/Actionables.tsx`
- Normalized all error access to use optional chaining: `result.error?.message`
- View Output errors now use `toast.error()` instead of `setGenerationError()`
- Consistent error handling pattern across all Actionables operations

### Explore (5 bugs)

#### B-EXP-001: No search result highlighting
- **File:** `src/utils/highlight.ts` (NEW)
- Created `highlightMatch(text, query)` utility that wraps matching terms in
  `<mark>` tags with XSS protection (HTML-escapes input before highlighting)
- Applied to knowledge titles/summaries, people names, and project names in
  Explore.tsx with `[&_mark]:bg-yellow-200` Tailwind styling

#### B-EXP-002: Knowledge navigation loses context
- **File:** `src/pages/Explore.tsx`
- Knowledge cards now navigate with `navigate('/library', { state: { selectedId: k.id } })`
- Project cards now navigate with `navigate('/projects', { state: { selectedId: pr.id } })`
- Library.tsx already has handler for incoming `selectedId` navigation state

#### B-EXP-003: No FTS (FTS5 not available in sql.js WASM)
- **File:** `electron/main/services/rag.ts`
- Replaced single-term LIKE search with multi-term LIKE search
- Each term is matched independently across all searchable columns
- Results are ranked by match count (how many distinct terms matched)
- Single-term queries use the simpler original approach for efficiency
- Uses `buildMultiTermQuery` helper that generates SQL with CASE/MAX ranking

#### B-EXP-004: handleSearch not memoized
- **File:** `src/pages/Explore.tsx`
- Wrapped `handleSearch` in `useCallback` with `[query]` dependency
- Added `handleSearch` to the debounce effect dependency array

#### B-EXP-005: No cancellation on unmount
- **File:** `src/pages/Explore.tsx`
- Added `AbortController` ref to cancel superseded requests
- Added `cancelledRef` for unmount detection
- Cleanup effect aborts pending controller and sets cancelled flag on unmount
- State updates are skipped if the request was cancelled or component unmounted

## New Files

| File | Purpose |
|------|---------|
| `src/utils/highlight.ts` | XSS-safe text highlighting utility |
| `src/utils/__tests__/highlight.test.ts` | 15 tests for highlight utility |
| `electron/main/ipc/__tests__/outputs-handlers-b001.test.ts` | 7 tests for getByActionableId handler |

## Modified Files

| File | Changes |
|------|---------|
| `electron/main/types/api.ts` | Added `RATE_LIMITED` error code |
| `electron/main/ipc/outputs-handlers.ts` | Rate limiting + getByActionableId handler |
| `electron/preload/index.ts` | Exposed `outputs.getByActionableId` |
| `src/pages/Actionables.tsx` | Per-item loading, toast errors, output fetch |
| `src/pages/Explore.tsx` | Highlighting, navigation, useCallback, cancellation |
| `electron/main/services/rag.ts` | Multi-term search with ranking |

## Test Results

All 843 tests pass across 56 test files (22 new tests added).
