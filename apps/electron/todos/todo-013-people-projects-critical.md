# TODO-013: People & Projects Pages Critical Bugs (6 bugs)

**Priority**: CRITICAL
**Phase**: A
**Domain**: People Page + Projects Page
**Audit Reference**: COMPREHENSIVE_BUG_AUDIT_WAVE2.md - People & Projects CRITICAL

## Problem

6 CRITICAL bugs across People and Projects pages:

### People Page (3 bugs)
1. **Invalid email constraint blocks multiple null emails** - Can't create contacts without email
2. **Type filter operates client-side after 100-record limit** - Wrong results
3. **No delete functionality** - Can't remove contacts

### Projects Page (3 bugs)
1. **Type mismatch between database schema and UI type** - Crashes / wrong data
2. **Missing status field in database Project type** - Critical field missing
3. **No store integration** - Projects not managed in state

## Current State

### People
- Database email column has UNIQUE constraint preventing NULL
- Type filter applied after LIMIT 100, not in WHERE clause
- Delete button missing or not wired

### Projects
- TypeScript Project type doesn't match DB schema
- Status field in DB but not in TypeScript type
- No Zustand store for projects, direct DB queries only

## Impact

- **People bugs**: Can't create contacts without email, filter broken, can't delete
- **Projects bugs**: Type errors, missing fields, no state management

## Files Affected

### People
- `src/pages/People.tsx`
- `electron/main/services/database.ts` - contacts schema, queries
- Database migration to fix email constraint

### Projects
- `src/pages/Projects.tsx`
- `src/types/index.ts` - Project type definition
- `src/store/domain/useProjectsStore.ts` (create if missing)
- `electron/main/services/database.ts` - projects queries

## Dependencies

- Database migration system
- Type definition conventions
- Zustand store patterns
- IPC handler registration

## Acceptance Criteria

### People - Email Constraint
- [ ] Database migration removes UNIQUE constraint on email
- [ ] Multiple contacts can have NULL email
- [ ] Email uniqueness validated only for non-null values
- [ ] Test: create 10 contacts without email, all succeed

### People - Type Filter
- [ ] Type filter applied in SQL WHERE clause, not client-side
- [ ] Filter works correctly with >100 records
- [ ] Test: create 200 contacts, filter by type, verify correct results

### People - Delete
- [ ] Delete button wired to IPC handler
- [ ] Handler deletes contact from database
- [ ] UI updates after delete
- [ ] Test: delete contact, verify removed

### Projects - Type Mismatch
- [ ] TypeScript Project type matches DB schema exactly
- [ ] All fields present in both type and schema
- [ ] Status field included in type definition
- [ ] Test: fetch project, verify no type errors

### Projects - Store Integration
- [ ] useProjectsStore created with CRUD operations
- [ ] Projects page uses store, not direct IPC calls
- [ ] Store persisted properly
- [ ] Test: CRUD operations via store work

### General
- [ ] All tests pass
- [ ] No type errors

## Related Bugs

- People CRITICAL: Invalid email constraint blocks multiple null emails
- People CRITICAL: Type filter operates client-side after 100-record limit
- People CRITICAL: No delete functionality
- Projects CRITICAL: Type mismatch between database schema and UI type
- Projects CRITICAL: Missing status field in database Project type
- Projects HIGH: No store integration
