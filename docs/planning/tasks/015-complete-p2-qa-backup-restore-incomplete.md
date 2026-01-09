# P2-015: Backup Restore Incomplete - Transcripts Not Restored

**Priority**: P2
**Status**: pending
**Category**: qa
**Component**: migration-handlers.ts
**Created**: 2025-12-26
**Severity**: HIGH - Data loss on rollback

## Problem

The `restoreFromBackup()` function creates backups of both recordings AND transcripts, but only restores recordings. If migration fails, transcript data is permanently lost.

## Evidence

**Backup Creation (lines 146-151)**:
```typescript
db.run(`
  INSERT INTO _backup_transcripts
  SELECT t.* FROM transcripts t
  INNER JOIN recordings r ON t.recording_id = r.id
  WHERE r.migration_status IS NULL OR r.migration_status = 'pending'
`)
```

**Restore Function (lines 172-181)**:
```typescript
// Restore recordings from backup
db.run(`
  UPDATE recordings
  SET migration_status = (
    SELECT migration_status FROM _backup_recordings b
    WHERE b.id = recordings.id
  ),
  migrated_to_capture_id = NULL,
  migrated_at = NULL
  WHERE id IN (SELECT id FROM _backup_recordings)
`)
// ❌ NO RESTORE FOR TRANSCRIPTS!
```

## Impact

- If migration fails after modifying transcripts, original transcript data is lost
- Defeats the entire purpose of the backup system
- Users cannot safely rollback after failed migration
- Data corruption risk

## Location

- File: `apps/electron/electron/main/ipc/migration-handlers.ts`
- Function: `restoreFromBackup()` (lines 154-188)
- Missing code after line 181

## Solution

Add transcript restoration after line 181:

```typescript
// Restore transcripts from backup (if they were modified)
db.run(`
  DELETE FROM transcripts
  WHERE recording_id IN (SELECT id FROM _backup_recordings)
`)

db.run(`
  INSERT INTO transcripts
  SELECT * FROM _backup_transcripts
`)
```

**Note**: The current migration doesn't modify transcripts, so this might not be strictly necessary NOW, but it's a correctness issue for the backup/restore architecture.

## Testing Required

1. Trigger migration failure mid-process
2. Verify both recordings AND transcripts are restored
3. Compare restored data with pre-migration snapshot
4. Test with recordings that have transcripts and recordings without

## Risk Assessment

- **Current Risk**: LOW (migration doesn't modify transcripts)
- **Future Risk**: HIGH (if future migrations modify transcripts)
- **Architectural Risk**: HIGH (incomplete backup system is a maintenance trap)

## Recommendation

Fix this now to prevent future data loss, even if current migration doesn't strictly require it.
