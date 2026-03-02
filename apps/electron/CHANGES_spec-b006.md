# Spec B-006: MeetingDetail + People + Projects (16 HIGH bugs)

## Summary

Fixed 16 HIGH priority bugs across MeetingDetail, People/Contacts, and Projects features.

## MeetingDetail (5 bugs)

### B-MTG-001: Add edit meeting capability
- **Database**: Added `updateMeeting(id, updates)` function in `database.ts` supporting subject, start_time, end_time, location, description fields
- **IPC**: Created `meetings-handlers.ts` with `meetings:update` handler using Zod validation
- **Preload**: Exposed `meetings.update()` via electronAPI
- **UI**: Added edit mode toggle in MeetingDetail header with inline editing for subject, location, description

### B-MTG-002: Recording link/unlink UI
- **UI**: Added Unlink button (Unlink icon) next to each recording in MeetingDetail
- **UI**: Added Recording Link Dialog using Radix Dialog that shows candidate meetings with confidence scores
- Uses existing `recordings:getCandidates` and `recordings:selectMeeting` IPC channels

### B-MTG-003: Loading state for recording playback
- **UI**: Added `playbackLoading` state that shows a `Loader2` spinner between play click and audio start
- Loading state auto-clears when `currentlyPlayingId` matches, with 5s timeout fallback

### B-MTG-004: loadMeetingDetails memoized
- Wrapped `loadMeetingDetails` in `useCallback` with empty deps array (function is stable)

### B-MTG-005: Attendee list overflow
- Added `max-h-40 overflow-auto` container for attendee list
- Attendees collapsed to 8 by default with "Show all N attendees" / "Show less" toggle button

## People/Contacts (4 bugs)

### B-PPL-001: useContactsStore created
- **New file**: `src/store/domain/useContactsStore.ts`
- Zustand store with `loadContacts`, `selectContact`, `updateContact`, `deleteContact`, `setSearchQuery`, `clearSelection`, `clearError` actions
- Exported from `src/store/index.ts`

### B-PPL-002: Race condition in edit form state
- Edit mode is disabled (`setIsEditing(false)`) when loading starts
- Form is initialized from loaded person data after fetch completes
- Edit button disabled while `loading` is true

### B-PPL-003: Name and email fields editable
- **Validation**: Added `name` and `email` to `UpdateContactRequestSchema` in `contacts.ts`
- **API types**: Added `name` and `email` to `UpdateContactRequest` in `api.ts`
- **Handler**: Updated `contacts:update` handler to pass `name` and `email` to `updateContact()`
- **UI**: PersonDetail now shows editable `name` field in header and `email` field in info card when editing

### B-PPL-004: Delete contact (full chain)
- **Database**: Added `deleteContact(id)` function that removes meeting_contacts junction entries then the contact
- **Validation**: Added `DeleteContactRequestSchema`
- **Handler**: Added `contacts:delete` IPC handler with NOT_FOUND validation
- **Preload**: Exposed `contacts.delete()` via electronAPI
- **UI**: PersonDetail has delete button with Radix AlertDialog confirmation
- **UI**: People page delete button also uses Radix AlertDialog (replaces `confirm()`)

## Projects (7 bugs)

### B-PRJ-001: useProjectsStore created
- **New file**: `src/store/domain/useProjectsStore.ts`
- Zustand store with `loadProjects`, `selectProject`, `createProject`, `updateProject`, `deleteProject`, `setSearchQuery`, `clearSelection`, `clearError` actions
- Exported from `src/store/index.ts`

### B-PRJ-002: knowledgeIds/personIds populated
- **Database**: Added `getKnowledgeIdsForProject()` querying knowledge_captures via recordings and meeting_projects
- **Database**: Added `getPersonIdsForProject()` querying contacts via meeting_contacts and meeting_projects
- **Handler**: `projects:getById` now calls both functions and populates the project response

### B-PRJ-003: projects:getAll respects status filter
- **Validation**: Added `status` field (`'active' | 'archived' | 'all'`) to `GetProjectsRequestSchema`
- **Database**: Updated `getProjects()` to accept optional `status` parameter with WHERE clause
- **Handler**: Passes `status` from validated request to `getProjects()`
- **API types**: Added `status` to `GetProjectsRequest`

### B-PRJ-004: Status field on DB interface
- Added `status: string` to DB `Project` interface in `database.ts`
- Updated `createProject()` to include `status` in INSERT query
- Updated `mapToProject()` to properly map status with type-safe fallback

### B-PRJ-005: loadProjects memoized
- Wrapped `loadProjects` in `useCallback` with `[searchQuery, statusFilter]` dependencies

### B-PRJ-006: Replace prompt() with Radix Dialog
- Replaced `prompt('Enter project name:')` with a proper Radix Dialog modal
- Dialog includes project name input (required) and description textarea (optional)
- Supports Enter key submission

### B-PRJ-007: Replace confirm() with Radix AlertDialog
- Replaced `confirm('Delete project...')` with Radix AlertDialog
- Destructive action styling with red button

## Files Modified

### New Files
- `electron/main/ipc/meetings-handlers.ts` - Meetings update IPC handler
- `src/store/domain/useContactsStore.ts` - Contacts Zustand store
- `src/store/domain/useProjectsStore.ts` - Projects Zustand store
- `electron/main/ipc/__tests__/meetings-handlers.test.ts` - Meetings handler tests
- `src/store/__tests__/useContactsStore.test.ts` - Contacts store tests
- `src/store/__tests__/useProjectsStore.test.ts` - Projects store tests

### Modified Files
- `electron/main/services/database.ts` - updateMeeting, deleteContact, status on Project, junction table queries
- `electron/main/ipc/contacts-handlers.ts` - contacts:delete handler, name/email in update
- `electron/main/ipc/projects-handlers.ts` - status filter, knowledgeIds/personIds population
- `electron/main/ipc/handlers.ts` - Register meetings handlers
- `electron/main/validation/contacts.ts` - name/email in UpdateContactRequestSchema, DeleteContactRequestSchema
- `electron/main/validation/projects.ts` - status in GetProjectsRequestSchema
- `electron/main/types/api.ts` - name/email on UpdateContactRequest, status on GetProjectsRequest
- `electron/preload/index.ts` - meetings.update, contacts.delete, projects status
- `src/store/index.ts` - Export new stores
- `src/pages/MeetingDetail.tsx` - Full rewrite with all 5 fixes
- `src/pages/People.tsx` - AlertDialog for delete confirmation
- `src/pages/PersonDetail.tsx` - Editable name/email, delete with AlertDialog, loading guard
- `src/pages/Projects.tsx` - Radix Dialog for create, AlertDialog for delete, memoized load, status filter

### Updated Test Files
- `electron/main/ipc/__tests__/contacts-handlers.test.ts` - Tests for delete and name/email update
- `electron/main/ipc/__tests__/projects-handlers.test.ts` - Tests for status filter and junction table queries

## Test Results

All 840 tests pass across 57 test files (19 new tests added).
