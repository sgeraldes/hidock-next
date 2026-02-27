# TODO-010: Actionables, Calendar, Explore Critical Bugs (9 bugs)

**Priority**: CRITICAL
**Phase**: A
**Domain**: Actionables Page + Calendar Page + Explore Page
**Audit Reference**: COMPREHENSIVE_BUG_AUDIT_WAVE2.md - Multiple domains CRITICAL

## Problem

9 CRITICAL bugs across 3 pages with similar patterns (missing IPC handlers, DB functions, error boundaries):

### Actionables Page (3 bugs)
1. **Missing DB query functions** - Queries don't exist
2. **Missing IPC handlers** - Handlers not registered
3. **View Output regenerates instead of fetching** - Wastes compute, slow

### Calendar Page (3 bugs)
1. **Race condition between config/meeting loading** - State corruption
2. **Missing error boundary** - Crashes propagate to whole app
3. **Calendar sync reloads stale date range** - Shows old data

### Explore Page (3 bugs)
1. **useEffect missing dependency** - Doesn't re-run when should
2. **SQL injection vulnerability** - Manual escaping misleading
3. **No SQL indexes for search** - Extremely slow searches

## Current State

### Actionables
- DB query functions referenced but not implemented
- IPC handlers declared but not registered
- "View Output" button calls generate() instead of fetch()

### Calendar
- Config and meetings load simultaneously without coordination
- No ErrorBoundary component wrapping calendar
- Sync button uses stale viewDates from state

### Explore
- useEffect doesn't include searchTerm in deps
- SQL queries use string concatenation with escaping (still risky)
- Search queries have no indexes (full table scan)

## Impact

- **Data loss**: Missing queries cause silent failures
- **Security**: SQL injection risk in Explore
- **Performance**: No indexes = 10s+ search times
- **Crashes**: Missing error boundary crashes whole app
- **Stale UI**: Race conditions show wrong data

## Files Affected

### Actionables
- `src/pages/Actionables.tsx`
- `electron/main/ipc/actionables-handlers.ts`
- `electron/main/services/database.ts` - actionables queries

### Calendar
- `src/pages/Calendar.tsx`
- `src/components/ErrorBoundary.tsx` (may need to create)
- `electron/main/services/calendar.ts`

### Explore
- `src/pages/Explore.tsx`
- `electron/main/services/database.ts` - search queries
- Database migration for indexes

## Dependencies

- IPC handler registration pattern
- Database service architecture
- Error boundary implementation
- SQL prepared statements / parameterized queries

## Acceptance Criteria

### Actionables
- [ ] All DB query functions implemented
- [ ] All IPC handlers registered in handlers.ts
- [ ] "View Output" fetches existing output, only regenerates if missing
- [ ] Test: click "View Output" twice, verify only one generation

### Calendar
- [ ] Config loads before meeting queries
- [ ] ErrorBoundary wraps Calendar page
- [ ] Sync button uses fresh viewDates from current state
- [ ] Test: crash calendar, verify app doesn't crash

### Explore
- [ ] useEffect includes all dependencies
- [ ] SQL queries use prepared statements (NOT string concat)
- [ ] Indexes created on searchable columns
- [ ] Test: search 10k records in <1 second

### Security
- [ ] SQL injection prevented via prepared statements
- [ ] Security audit of all search queries
- [ ] Test: inject SQL in search, verify no execution

### General
- [ ] All tests pass
- [ ] Performance benchmarks met

## Related Bugs

- Actionables CRITICAL: Missing DB query functions
- Actionables CRITICAL: Missing IPC handlers
- Actionables CRITICAL: View Output regenerates instead of fetching
- Calendar CRITICAL: Race condition between config/meeting loading
- Calendar CRITICAL: Missing error boundary
- Calendar CRITICAL: Calendar sync reloads stale date range
- Explore CRITICAL: useEffect missing dependency
- Explore CRITICAL: SQL injection vulnerability
- Explore CRITICAL: No SQL indexes for search
