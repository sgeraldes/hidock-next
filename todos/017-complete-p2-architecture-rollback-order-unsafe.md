# P2-017: Rollback Drops Tables Before Verifying Backup

**Priority**: P2
**Status**: pending
**Category**: architecture
**Component**: migration-handlers.ts
**Created**: 2025-12-26
**Severity**: HIGH - Potential data loss

## Problem

The `rollbackV11MigrationImpl()` function drops V11 tables BEFORE checking if backup exists. If backup restoration fails, data is lost forever.

## Evidence

**Rollback Flow (lines 698-728)**:
```typescript
runInTransaction(() => {
  const db = getDatabase()

  // P1 #012: Restore from backup if it exists
  try {
    restoreFromBackup()  // ⚠️ This might fail!
  } catch (error) {
    console.log('No backup to restore, proceeding with standard rollback')
  }

  // ❌ Drop tables AFTER restore attempt - but what if restore failed?
  db.run('DROP TABLE IF EXISTS outputs')
  db.run('DROP TABLE IF EXISTS follow_ups')
  db.run('DROP TABLE IF EXISTS decisions')
  db.run('DROP TABLE IF EXISTS action_items')
  db.run('DROP TABLE IF EXISTS audio_sources')
  db.run('DROP TABLE IF EXISTS knowledge_captures')

  // Reset migration status
  // ...
})
```

## Risk Scenario

1. User runs migration → creates V11 tables with data
2. User decides to rollback
3. `restoreFromBackup()` fails (backup tables already dropped, corrupted, etc.)
4. Code logs "No backup to restore" but continues
5. **Drops all V11 tables anyway** → Data loss!

## Safe Order

1. **FIRST**: Check if backup tables exist
2. **SECOND**: Verify backup data is valid
3. **THIRD**: Restore backup data
4. **FOURTH**: Drop new tables
5. **FIFTH**: Update schema version

```typescript
// Safe rollback order:
runInTransaction(() => {
  const db = getDatabase()

  // 1. Verify backup exists
  const hasBackup = checkBackupExists()  // New function
  if (!hasBackup) {
    throw new Error('Cannot rollback: no backup found')
  }

  // 2. Restore from backup
  restoreFromBackup()

  // 3. Verify restoration succeeded
  verifyRestoration()  // New function

  // 4. NOW it's safe to drop new tables
  db.run('DROP TABLE IF EXISTS knowledge_captures')
  // ... etc
})
```

## Impact

- **Current Risk**: MEDIUM (backup usually exists if migration ran)
- **Edge Cases**: HIGH (cleanup already run, manual database tampering, disk corruption)
- **User Impact**: Cannot safely rollback, forced to restore from external backup

## Location

- File: `apps/electron/electron/main/ipc/migration-handlers.ts`
- Function: `rollbackV11MigrationImpl()` (lines 685-738)

## Solution

1. Create `checkBackupExists()` helper
2. Create `verifyRestoration()` helper
3. Reorder rollback logic to verify before destructive operations
4. Add clear error messages if backup missing

```typescript
function checkBackupExists(): boolean {
  const db = getDatabase()
  const stmt = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name IN ('_backup_recordings', '_backup_transcripts')
  `)
  const tables = []
  while (stmt.step()) {
    tables.push(stmt.getAsObject().name)
  }
  stmt.free()
  return tables.length === 2
}

function verifyRestoration(): void {
  const db = getDatabase()
  // Check that recordings have their migration_status reset
  const stmt = db.prepare(`
    SELECT COUNT(*) as count FROM recordings
    WHERE migration_status = 'migrated'
  `)
  stmt.step()
  const stillMigrated = stmt.getAsObject().count
  stmt.free()

  if (stillMigrated > 0) {
    throw new Error('Restoration incomplete: recordings still marked as migrated')
  }
}
```

## Testing Required

1. Test rollback when backup exists
2. Test rollback when backup missing (should fail gracefully)
3. Test rollback after cleanup already run
4. Verify transaction rollback on restoration failure

## Related Issues

- P2-016: Backup tables should be TEMP (would auto-cleanup)
- P2-015: Backup restore incomplete (transcripts not restored)
