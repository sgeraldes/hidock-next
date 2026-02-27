# Changes for spec-013: People & Projects Critical Bugs

**Date:** 2026-02-27  
**Status:** In Progress  
**Priority:** CRITICAL  

## Overview
Fixing 6 critical bugs across People and Projects pages as per spec-013-people-projects-critical.md and phase-A-architecture-review.md.

## Database Changes

### Migration v20 (Consolidated)
- Removed UNIQUE constraint on contacts.email (allows multiple NULL values)
- Part of consolidated v20 migration per architecture review

## Backend Changes

### Contact Interface Fix
- Updated Contact interface in `electron/main/types/database.ts` to include missing fields:
  - type: PersonType
  - role: string | null
  - company: string | null
  - tags: string | null

### Server-Side Type Filter
- Modified `getContacts()` in database.ts to accept optional type parameter
- Added type filter to SQL WHERE clause before LIMIT
- Updated contacts-handlers.ts to pass type parameter
- Updated validation schema to accept type parameter

### Delete Contact Implementation
- Created `deleteContact()` function in database.ts
- Added `contacts:delete` IPC handler in contacts-handlers.ts
- Exposed in preload/index.ts
- Cascade deletes meeting_contacts entries (FK constraint handles it)

## Frontend Changes

### People Page
- Pass typeFilter to IPC call for server-side filtering
- Add delete button with confirmation dialog
- Integrate with delete IPC handler

### Project Interface Consolidation
- Project interface already properly consolidated in types/knowledge.ts
- Backend types/database.ts Project interface updated to include status field
- No action needed - already correct

## Testing
- [ ] Multiple contacts can have NULL email
- [ ] Server-side type filter works with >100 contacts
- [ ] Delete contact removes record and cascade deletes meeting_contacts
- [ ] Type definitions match database schema
- [ ] All tests pass

## Status
- Starting implementation
