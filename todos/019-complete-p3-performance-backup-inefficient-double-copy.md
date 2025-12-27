# P3-019: Inefficient Backup Creation Uses Double-Copy Pattern

**Priority**: P3
**Status**: pending
**Category**: performance
**Component**: migration-handlers.ts
**Created**: 2025-12-26
**Severity**: LOW - Performance optimization opportunity

## Problem

Backup creation uses an inefficient pattern: first creates empty table with schema, then copies data separately. This results in 2x write operations for the same data.

## Evidence

**Current Implementation (lines 128-143)**:
```typescript
// Step 1: Create empty table with schema
db.run(`
  CREATE TABLE _backup_recordings AS
  SELECT * FROM recordings WHERE 1=0
`)

// Step 2: Copy data
db.run(`
  INSERT INTO _backup_recordings
  SELECT * FROM recordings
  WHERE migration_status IS NULL OR migration_status = 'pending'
`)
```

## Performance Impact

For a database with 10,000 recordings:
- **Current**: 2 operations (create schema + copy data)
- **Optimized**: 1 operation (create table with data)

Estimated improvement: 30-50% faster backup creation

## Location

- File: `apps/electron/electron/main/ipc/migration-handlers.ts`
- Function: `createMigrationBackup()` (lines 120-152)
- Lines: 128-143 (recordings), similar pattern for transcripts

## Solution

**Single-Step Backup Creation**:
```typescript
db.run(`
  CREATE TABLE _backup_recordings AS
  SELECT * FROM recordings
  WHERE migration_status IS NULL OR migration_status = 'pending'
`)

db.run(`
  CREATE TABLE _backup_transcripts AS
  SELECT t.* FROM transcripts t
  INNER JOIN recordings r ON t.recording_id = r.id
  WHERE r.migration_status IS NULL OR r.migration_status = 'pending'
`)
```

## Why Current Pattern Exists

The `WHERE 1=0` trick is used to:
1. Create table with exact schema
2. Then insert data separately

This was common in older SQL patterns, but modern SQLite optimizes `CREATE TABLE AS SELECT` to be more efficient.

## Trade-offs

**Optimized Approach**:
- ✅ Faster (single operation)
- ✅ Less I/O
- ✅ Simpler code

**Current Approach**:
- ✅ Explicit schema creation (clearer intent)
- ❌ Slower (double operation)
- ❌ More disk writes

## Recommendation

Use single-step approach. The schema is automatically copied from SELECT, so explicit empty table creation is unnecessary.

## Testing Required

1. Verify backup tables have correct schema
2. Verify all columns are copied correctly
3. Benchmark migration with 1000+ recordings
4. Test backup/restore still works

## Estimated Impact

- **Small DBs** (< 100 records): Negligible (~10ms savings)
- **Medium DBs** (1,000 records): ~100ms savings
- **Large DBs** (10,000+ records): ~1s+ savings

## Related Issues

- P2-016: Backup tables should be TEMP (also improves performance)
