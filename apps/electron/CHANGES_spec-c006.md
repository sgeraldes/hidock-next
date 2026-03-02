# Phase C-006: MEDIUM Bug Fixes in People, Projects, and Settings

## Overview

Phase C-006 resolves MEDIUM-severity bugs across People, Projects, and Settings pages. This phase builds on earlier Phase A (CRITICAL) and Phase B (HIGH) fixes. All 23 bugs fixed, with 13 new tests added.

## People Page Fixes (9 bugs)

### C-PPL-001: Pagination support
- **File:** `src/pages/People.tsx`
- **Bug:** All contacts loaded at once with `limit: 100`, no page navigation
- **Fix:** Added `PAGE_SIZE = 30` with proper `offset` calculation, Previous/Next buttons, page indicator
- **Impact:** Prevents overwhelming the UI when contact list grows large

### C-PPL-002: Interaction count grammar
- **File:** `src/pages/People.tsx`
- **Bug:** Displayed "1 interactions" (incorrect grammar)
- **Fix:** Added `interactionLabel()` helper that returns "1 interaction" (singular) or "N interactions" (plural)

### C-PPL-003: Result count indicator
- **File:** `src/pages/People.tsx`
- **Bug:** No indication of how many total contacts exist or which range is displayed
- **Fix:** Added "Showing X-Y of Z people" indicator above the grid

### C-PPL-004: Safe date formatting
- **File:** `src/pages/People.tsx`
- **Bug:** `new Date(person.lastSeenAt).toLocaleDateString()` could show "Invalid Date" for undefined/null dates
- **Fix:** Added `formatDate()` helper that returns "Unknown" for invalid/null/undefined dates

### C-PPL-005: meetings type fix
- **File:** `electron/main/ipc/contacts-handlers.ts`
- **Bug:** `meetings: any[]` in the getById return type
- **Fix:** Changed to `meetings: Meeting[]` with proper import from `@/types`

### C-PPL-006: Remove duplicate contact mapping
- **File:** `src/pages/People.tsx`
- **Bug:** Contact-to-Person mapping was duplicated in both People.tsx and contacts-handlers.ts
- **Fix:** Removed the redundant mapping in People.tsx; now uses server-side `mapToPerson()` result directly

### C-PPL-007: Debounced search no longer fires on initial mount
- **File:** `src/pages/People.tsx` (verified from Phase B)
- **Bug:** The `useEffect` with `setTimeout(300ms)` fired on initial mount
- **Fix:** Split into two effects: immediate initial load + debounced subsequent updates with `isFirstMount` ref

### C-PPL-008: Contact sort functionality
- **File:** `src/pages/People.tsx` (verified from Phase B)
- **Bug:** No way to sort contacts
- **Fix:** Sort dropdown with Name/Last Seen/Interactions options, `useMemo`-based sorting

### C-PPL-009: Edit form validation in PersonDetail
- **File:** `src/pages/PersonDetail.tsx` (verified from Phase B)
- **Bug:** Edit form had no validation for empty names and invalid emails
- **Fix:** Added name validation (required, min 2 chars) and email format validation

## Projects Page Fixes (5 bugs)

### C-PRJ-001: Detail loading state
- **File:** `src/pages/Projects.tsx`
- **Bug:** No visual feedback while loading project details after selection
- **Fix:** Added `detailLoading` state with spinner and "Loading project details..." message

### C-PRJ-002: N+1 query for project members
- **File:** `src/pages/Projects.tsx`
- **Bug:** Sequential `for` loop calling `contacts.getById()` for each person ID
- **Fix:** Changed to `Promise.all()` to resolve all members in parallel

### C-PRJ-003: Inline description editing
- **File:** `src/pages/Projects.tsx`
- **Bug:** Project description displayed read-only with no way to edit
- **Fix:** Added Edit button, inline textarea editing with Save/Cancel, and `handleSaveDescription()` function

### C-PRJ-004: Error handling for project detail load
- **File:** `src/pages/Projects.tsx`
- **Bug:** No user-facing error notification when project detail load fails
- **Fix:** Added `toast.error()` call in the `catch` block of `handleSelectProject()`

### C-PRJ-005: Debounced search no longer fires on initial mount
- **File:** `src/pages/Projects.tsx` (verified from Phase B)
- **Fix:** Separate initial load + debounced subsequent updates with `isFirstMount` ref

## Settings Page Fixes (9 bugs)

### C-SET-001: API key visibility toggle
- **File:** `src/pages/Settings.tsx`
- **Bug:** API key always hidden with `type="password"`, no way to verify entered key
- **Fix:** Added Eye/EyeOff toggle button with `showApiKey` state

### C-SET-002: Redundant checkbox onKeyDown removed
- **File:** `src/pages/Settings.tsx`
- **Bug:** `onKeyDown` handler for Space key on checkbox was redundant (native HTML already handles it)
- **Fix:** Removed the `onKeyDown={(e) => e.key === ' ' && setSyncEnabled(!syncEnabled)}` handler

### C-SET-003: Sync interval clamping
- **File:** `src/pages/Settings.tsx`
- **Bug:** User could type any value (0, 999, etc.) in sync interval input
- **Fix:** Added `Math.min(120, Math.max(5, val))` clamping on onChange

### C-SET-004: Storage loading indicator
- **File:** `src/pages/Settings.tsx`
- **Bug:** Storage section silently loaded with no indication
- **Fix:** Added `storageLoading` state with spinner and "Loading storage info..." message

### C-SET-005: Last sync time display
- **File:** `src/pages/Settings.tsx`
- **Bug:** No indication of when calendar was last synced
- **Fix:** Added "Last synced: {date}" text next to the Sync Now button

### C-SET-006: Chat settings save atomicity
- **File:** `src/pages/Settings.tsx` (verified from Phase B)
- **Fix:** `Promise.all()` for parallel chat + embeddings save

### C-SET-007: API key format validation
- **File:** `src/pages/Settings.tsx` (verified from Phase B)
- **Fix:** Gemini API keys validated for "AIza" prefix

### C-SET-008: Form dirty state tracking
- **File:** `src/pages/Settings.tsx` (verified from Phase B)
- **Fix:** `useMemo`-based dirty state per section, Save/Saved button labels

### C-SET-009: Sync interval NaN guard
- **File:** `src/pages/Settings.tsx`
- **Fix:** Added `isNaN(val)` early return to prevent NaN state

## Test Coverage

### New Tests Added (13 total)

**`src/pages/__tests__/People.test.tsx`** (+6 new tests):
- `should display correct interaction count grammar` - Verifies singular/plural
- `should display result count indicator` - Verifies "Showing X of Y"
- `should pass pagination offset to API` - Verifies limit=30, offset=0
- `should show pagination controls when total exceeds page size` - Verifies Previous/Next
- `should not show pagination controls when total fits one page` - Hidden when unnecessary
- `should handle invalid lastSeenAt dates gracefully` - "Unknown" instead of "Invalid Date"

**`src/pages/__tests__/Projects.test.tsx`** (+3 new tests):
- `should show loading state when selecting a project` - Verifies spinner display
- `should show edit button for project description` - Verifies inline editing UI
- `should resolve project members in parallel` - Verifies Promise.all() for members

**`src/pages/__tests__/Settings.test.tsx`** (+4 new tests):
- `should toggle API key visibility` - Verifies Eye/EyeOff toggle
- `should render sync interval input with min/max attributes` - Verifies constraints
- `should render sync checkbox with onChange handler` - Verifies no redundant onKeyDown
- `should display last sync time when available` - Verifies "Last synced:" display

## Files Modified

| File | Changes |
|------|---------|
| `src/pages/People.tsx` | Pagination, interaction grammar, date safety, result count, remove mapping duplication |
| `src/pages/Projects.tsx` | Detail loading, parallel member query, description editing, error toast |
| `src/pages/Settings.tsx` | API key toggle, checkbox fix, interval clamping, storage loading, last sync |
| `electron/main/ipc/contacts-handlers.ts` | meetings type: `any[]` -> `Meeting[]` |
| `src/pages/__tests__/People.test.tsx` | +6 new tests |
| `src/pages/__tests__/Projects.test.tsx` | +3 new tests |
| `src/pages/__tests__/Settings.test.tsx` | +4 new tests, updated mock config |

## Verification

```
TypeScript: 0 errors (npx tsc --noEmit)
Test Files: 67 passed (67)
Tests:      995 passed (995)
```
