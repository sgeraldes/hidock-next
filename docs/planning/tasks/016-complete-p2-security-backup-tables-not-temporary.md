# P2-016: Security - Backup Tables Not Temporary

**Priority**: P2
**Status**: pending
**Category**: security
**Component**: migration-handlers.ts
**Created**: 2025-12-26
**Severity**: MEDIUM - Data leakage and pollution risk

## Problem

Migration backup tables (`_backup_recordings`, `_backup_transcripts`) are created as regular persistent tables instead of temporary tables. This means:

1. They remain in the database schema after cleanup
2. Other parts of the application could query them
3. Failed cleanup leaves sensitive backup data exposed
4. Database bloat if cleanup fails repeatedly

## Evidence

**Backup Creation (lines 128-136)**:
```typescript
db.run(`
  CREATE TABLE _backup_recordings AS
  SELECT * FROM recordings WHERE 1=0
`)

db.run(`
  CREATE TABLE _backup_transcripts AS
  SELECT * FROM transcripts WHERE 1=0
`)
```

**Cleanup (lines 194-195)**:
```typescript
db.run('DROP TABLE IF EXISTS _backup_recordings')
db.run('DROP TABLE IF EXISTS _backup_transcripts')
```

## Security Issues

1. **Data Persistence**: If cleanup fails (process crash, power loss), backup data remains
2. **Schema Pollution**: Backup tables visible to all database introspection
3. **Query Leakage**: Other code could accidentally SELECT from backup tables
4. **Forensic Trail**: Backup tables persist beyond intended lifetime

## Impact

- Low-level data leakage risk
- Database schema confusion
- Potential for accidental data access
- Debugging complexity (are these real tables or leftovers?)

## Location

- File: `apps/electron/electron/main/ipc/migration-handlers.ts`
- Functions: `createMigrationBackup()` (lines 120-152), `cleanupBackupTables()` (lines 190-200)

## Solution

**Option 1: Use TEMP tables (RECOMMENDED for sql.js)**
```typescript
db.run(`
  CREATE TEMP TABLE _backup_recordings AS
  SELECT * FROM recordings WHERE 1=0
`)

db.run(`
  CREATE TEMP TABLE _backup_transcripts AS
  SELECT * FROM transcripts WHERE 1=0
`)
```

**Benefits**:
- Automatically deleted when connection closes
- Not visible in main schema
- No manual cleanup required

**Option 2: Add validation to prevent external access**
Add checks in database query layer to prevent queries against `_backup_*` tables from outside migration module.

## Testing Required

1. Verify TEMP tables work with sql.js (they should, it's SQLite)
2. Test that temp tables survive transaction ROLLBACK (they do)
3. Confirm temp tables are cleaned up on process exit
4. Verify backup/restore still works with TEMP tables

## Compatibility Notes

SQLite TEMP tables are:
- Connection-scoped (perfect for single-connection sql.js)
- Automatically cleaned up
- Not saved to disk (in sql.js, this means not included in export())

This is actually BETTER for backup tables since they're truly ephemeral.

## Related Issues

- P2-017: Rollback drops tables before verifying backup exists
