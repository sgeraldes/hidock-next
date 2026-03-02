# AUD2-001 Implementation Summary

## Objective
Fix the `actionables:getByMeeting` IPC handler to correctly retrieve actionables for a meeting by checking both direct and indirect meeting relationships.

## Changes Implemented

### 1. Database Schema Migration (v21)
**File**: `apps/electron/electron/main/services/database.ts`

- Bumped `SCHEMA_VERSION` from 20 to 21
- Added migration v21 to backfill `meeting_id` in `knowledge_captures` table from recordings
- Migration updates knowledge captures that have `source_recording_id` but NULL `meeting_id`
- Sets `correlation_method` to 'recording_migration' and `correlation_confidence` to 1.0
- Logs count of updated records for debugging

### 2. Meeting Link Propagation
**File**: `apps/electron/electron/main/services/database.ts`

Updated `linkRecordingToMeeting` function (lines 1927-1948):
- Now propagates `meeting_id` to knowledge_captures when a recording is linked to a meeting
- Updates all knowledge captures that reference the recording via `source_recording_id`
- Only updates if `meeting_id` is NULL or different from the new meeting
- Ensures future links maintain data consistency

### 3. Query Fix
**File**: `apps/electron/electron/main/ipc/actionables-handlers.ts`

Updated `actionables:getByMeeting` handler (lines 77-111):
- Changed query to use LEFT JOIN with recordings table
- Checks both direct path (knowledge_captures.meeting_id) and indirect path (recordings.meeting_id)
- Uses DISTINCT to prevent duplicate results
- Added debug logging when no actionables found
- Debug query provides statistics on direct vs. indirect matches

## Technical Details

### SQL Query Changes
**Before:**
```sql
SELECT a.*
FROM actionables a
INNER JOIN knowledge_captures kc ON a.source_knowledge_id = kc.id
WHERE kc.meeting_id = ?
ORDER BY a.created_at DESC
```

**After:**
```sql
SELECT DISTINCT a.*
FROM actionables a
INNER JOIN knowledge_captures kc ON a.source_knowledge_id = kc.id
LEFT JOIN recordings r ON kc.source_recording_id = r.id
WHERE kc.meeting_id = ?
   OR r.meeting_id = ?
ORDER BY a.created_at DESC
```

### Migration SQL
```sql
UPDATE knowledge_captures
SET meeting_id = (
  SELECT r.meeting_id
  FROM recordings r
  WHERE r.id = knowledge_captures.source_recording_id
  AND r.meeting_id IS NOT NULL
),
correlation_method = COALESCE(correlation_method, 'recording_migration'),
correlation_confidence = COALESCE(correlation_confidence, 1.0),
updated_at = CURRENT_TIMESTAMP
WHERE meeting_id IS NULL
  AND source_recording_id IS NOT NULL
  AND EXISTS (...)
```

## Testing Performed

### TypeScript Compilation
- Verified no TypeScript errors in modified files
- Module resolution warnings are pre-existing (missing node_modules)

## Acceptance Criteria Status

- [x] Schema version bumped to 21
- [x] Migration v21 exists and backfills meeting_id
- [x] linkRecordingToMeeting propagates meeting_id to knowledge_captures
- [x] Structural repair already includes meeting_id column (no additional changes needed)
- [x] Query checks both direct and indirect paths
- [x] Debug logging added for troubleshooting
- [x] TypeScript compiles (no new errors)

## Files Modified

1. `apps/electron/electron/main/services/database.ts`
   - Line 9: Bumped SCHEMA_VERSION to 21
   - Lines 1156-1194: Added migration v21
   - Lines 1927-1948: Updated linkRecordingToMeeting with propagation logic

2. `apps/electron/electron/main/ipc/actionables-handlers.ts`
   - Lines 77-111: Updated actionables:getByMeeting query and added debug logging

## Commit

```
feat(db): add migration v21 for meeting_id backfill (AUD2-001)

- Bump SCHEMA_VERSION to 21
- Add migration to backfill knowledge_captures.meeting_id from recordings
- Update linkRecordingToMeeting to propagate meeting_id to knowledge_captures
- Fix actionables:getByMeeting query to check both direct and indirect paths
- Add debug logging when no actionables found
```

Commit hash: 23ebe57e
