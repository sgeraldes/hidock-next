# Phase C Bug Fixes - CHANGES_spec-c006.md

## Overview

Phase C resolves MEDIUM-severity bugs across People, Projects, and Settings pages. Fixes focus on debounce behavior, type safety, validation, sort functionality, empty states, and form dirty tracking.

## People Page Fixes

### C-PPL-001: Debounced search no longer fires on initial mount
- **File:** `src/pages/People.tsx`
- **Bug:** The `useEffect` with `setTimeout(300ms)` fired on initial mount, causing an unnecessary 300ms delay before first data load.
- **Fix:** Split into two effects: an immediate initial load effect (`useEffect([], [])`) and a debounced effect that skips the first mount via `isFirstMount` ref.

### C-PPL-002: Type-safe contact mapping (removed `any[]` spread)
- **File:** `src/pages/People.tsx`
- **Bug:** Contact mapping used `{ ...c }` spread from `any`, losing type safety.
- **Fix:** Explicit property mapping with `: Person` return type annotation on the map callback.

### C-PPL-003: Contact sort functionality
- **File:** `src/pages/People.tsx`
- **Bug:** No way to sort contacts. The `filteredPeople = people` was a dead assignment.
- **Fix:** Added `sortBy` state (name/lastSeen/interactions), `useMemo`-based sorting, and a sort dropdown in the filter bar.

### C-PPL-004: Edit form validation in PersonDetail
- **File:** `src/pages/PersonDetail.tsx`
- **Bug:** Edit form had no validation - empty names and invalid emails could be saved.
- **Fix:** Added name validation (required, min 2 chars) and email format validation (regex) in `handleSaveEdit`. Toast error messages shown on validation failure.

### C-PPL-005: Type-safe meetings array in PersonDetail
- **File:** `src/pages/PersonDetail.tsx`
- **Bug:** `meetings` state was typed as `any[]`.
- **Fix:** Changed to `Meeting[]` with proper import from `@/types`.

## Projects Page Fixes

### C-PRJ-001: Debounced search no longer fires on initial mount
- **File:** `src/pages/Projects.tsx`
- **Bug:** Same debounce-on-mount issue as People page.
- **Fix:** Same pattern: separate initial load + debounced subsequent updates with `isFirstMount` ref.

### C-PRJ-002: Empty state guides user to create project
- **File:** `src/pages/Projects.tsx`
- **Bug:** Empty sidebar showed minimal "No projects" text with no guidance.
- **Fix:** Enhanced empty state with Folder icon, contextual message (handles search vs. filter vs. no-data), and inline "Create Project" button.

### C-PRJ-003: Project member list shows resolved names
- **File:** `src/pages/Projects.tsx`
- **Bug:** `personIds` were available but only displayed as a count.
- **Fix:** Added `ProjectMember` interface and `projectMembers` state. When a project is selected, person IDs are resolved to names via `contacts.getById` calls. Names and initials are displayed below the People stat card.

## Settings Page Fixes

### C-SET-001: Chat settings saved in parallel
- **File:** `src/pages/Settings.tsx`
- **Bug:** `handleSaveChat` called `updateConfig('chat', ...)` then `updateConfig('embeddings', ...)` sequentially, doubling save time.
- **Fix:** Wrapped both calls in `Promise.all()` for parallel execution.

### C-SET-002: Improved API key format validation
- **File:** `src/pages/Settings.tsx`
- **Bug:** Only checked API key length >= 10, no format validation.
- **Fix:** Added check that Gemini API keys start with "AIza" prefix.

### C-SET-003: Form dirty state tracking
- **File:** `src/pages/Settings.tsx`
- **Bug:** Save buttons were always enabled regardless of whether form values changed.
- **Fix:** Added `useMemo`-based dirty state tracking per section (`isCalendarDirty`, `isTranscriptionDirty`, `isChatDirty`). Save buttons are disabled when the section matches the stored config, and label changes from "Save" to "Saved".

## Skipped Items (Feature Requests, Not Bugs)

The following items from the audit were identified as feature requests rather than bugs and are deferred:
- **Dark mode toggle** - Would require theme infrastructure
- **Settings export/import** - New feature, not a bug
- **Bulk actions on People** - Enhancement
- **Pagination** - Enhancement (currently capped at 100)
- **Project activity timeline** - New feature
- **Project deadline/due date** - Schema change required
- **Storage path selector** - Backend `dialog.showOpenDialog` needed for data path (recordings path already has openFolder)
- **Reset to defaults** - New feature

## Test Coverage

### New Tests Added (28 new test cases)

**`src/pages/__tests__/People.test.tsx`** (7 tests):
- Renders list of people
- Renders sort dropdown with Name/Last Seen/Interactions options
- Renders type filter buttons (All/Team/Customer/External/Candidate)
- Renders contact initials avatar (first letter)
- Renders empty state when no people found
- Shows type-colored badges for contacts
- Displays interaction counts

**`src/pages/__tests__/PersonDetail.test.tsx`** (10 tests):
- Renders person details
- Renders person initials avatar
- Renders contact info fields (email, role, company)
- Renders meeting timeline
- Renders tags
- Shows loading state initially
- Enters edit mode with Save/Cancel buttons
- Validates empty name on save (blocks API call)
- Validates email format on save (blocks API call)
- Cancels editing and restores original values

**`src/pages/__tests__/Projects.test.tsx`** (6 tests):
- Renders list of projects
- Renders status filter tabs (all/active/archived)
- Shows empty state with guidance when no projects
- Shows select project message when no project selected
- Opens create project dialog
- Renders search input

**`src/pages/__tests__/Settings.test.tsx`** (7 tests, new file):
- Renders settings sections (Calendar, Transcription, Chat, Storage)
- Renders calendar settings form fields
- Renders transcription settings form fields
- Renders chat provider toggle buttons
- Renders save buttons for each section
- Renders storage section
- Renders health check component

## Verification

```
Test Files: 67 passed (67)
Tests:      983 passed (983)
```
