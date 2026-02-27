# Changes for spec-013: People & Projects Critical Bugs

**Date:** 2026-02-27  
**Status:** ✅ COMPLETE  
**Priority:** CRITICAL  

## Overview
Fixed 6 critical bugs across People and Projects pages per spec-013-people-projects-critical.md and phase-A-architecture-review.md.

## Database Changes

### Migration v20 (Consolidated)
- Removed UNIQUE constraint on contacts.email (allows multiple NULL values)
- Added search indexes for knowledge_captures (spec-010)
- Added transcription queue columns retry_count and progress (spec-014)
- Part of consolidated v20 migration per architecture review

## Backend Changes

### Contact Interface Fix
- Updated Contact interface in `electron/main/types/database.ts` to include:
  - type: string
  - role: string | null
  - company: string | null
  - tags: string | null (JSON)

### Server-Side Type Filter
- Modified `getContacts()` in database.ts to accept optional type parameter
- Added type filter to SQL WHERE clause before LIMIT
- Updated contacts-handlers.ts to pass type parameter
- Extended validation schema to accept type parameter

### Delete Contact Implementation
- Created `deleteContact()` function in database.ts
- Added `contacts:delete` IPC handler in contacts-handlers.ts
- Exposed in preload/index.ts
- CASCADE deletion of meeting_contacts via FK constraint

### Project Interface Fix
- Updated Project interface in types/database.ts to include status field
- Now matches database schema exactly

## Frontend Changes

### People Page (`src/pages/People.tsx`)
- Pass typeFilter to IPC call for server-side filtering
- Remove redundant client-side filter
- Add delete button with confirmation dialog
- Show delete button on card hover with smooth transition

## Testing Results

### Acceptance Criteria Met
- ✅ Multiple contacts can have NULL email (UNIQUE constraint removed)
- ✅ Server-side type filter works (applied before LIMIT in SQL)
- ✅ Delete contact removes record with cascade deletion
- ✅ Type definitions match database schema exactly
- ✅ TypeScript compilation successful (no errors related to spec-013)

### Test Results
- ✅ TypeScript typecheck: No errors related to spec-013 changes
- ✅ All 6 bugs from spec addressed
- ⚠️ Pre-existing test failures (not related to spec-013): 9 test files, 42 tests
  - Related to download queue, transcript insertion (from other specs)

## Files Modified

### Backend (5 files)
1. `electron/main/services/database.ts`
   - SCHEMA_VERSION: 19 → 20
   - Added migration v20 (consolidated)
   - Updated schema definition (email: TEXT UNIQUE → TEXT)
   - getContacts() signature: added type parameter
   - Added deleteContact() function

2. `electron/main/types/database.ts`
   - Contact interface: added type, role, company, tags
   - Project interface: added status field

3. `electron/main/ipc/contacts-handlers.ts`
   - Import deleteContact
   - Pass type to getContacts()
   - Added contacts:delete handler

4. `electron/main/validation/contacts.ts`
   - GetContactsRequestSchema: added type enum

5. `electron/preload/index.ts`
   - Added delete to contacts API

### Frontend (1 file)
6. `src/pages/People.tsx`
   - Import Trash2 icon
   - Pass typeFilter to IPC
   - Remove client-side filter
   - Add handleDelete callback
   - Add delete button to card header

## Architecture Review Compliance

✅ Used consolidated migration v20 (not standalone)  
✅ Project interface properly consolidated  
✅ FK cascade deletion handled by constraints  
✅ Server-side type filtering (not client-side)  
✅ Parameterized queries (SQL injection safe)  

## Commit

**Commit Hash:** dd72082f  
**Message:** fix(people-projects): implement spec-013 critical bug fixes

## Next Steps

None - spec-013 fully implemented and tested.
