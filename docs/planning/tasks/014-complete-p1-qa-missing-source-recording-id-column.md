# P1-014: Migration Will Fail - Missing source_recording_id Column

**Priority**: P1
**Status**: pending
**Category**: qa
**Component**: migration-handlers.ts
**Created**: 2025-12-26
**Severity**: CRITICAL - Migration will crash on execution

## Problem

The migration code attempts to insert data into a `source_recording_id` column that doesn't exist in the V11 knowledge_captures schema.

## Evidence

**Migration Code (lines 531-535)**:
```typescript
INSERT INTO knowledge_captures (
  id, title, summary, captured_at, created_at, updated_at,
  meeting_id, source_recording_id  // ❌ Column doesn't exist!
)
```

**Schema Definition (v11-knowledge-captures.sql, lines 21-48)**:
```sql
CREATE TABLE IF NOT EXISTS knowledge_captures (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    summary TEXT,
    -- ... other fields ...
    meeting_id TEXT,
    -- ❌ NO source_recording_id column defined!
    captured_at TEXT NOT NULL,
    -- ...
);
```

**Verification Also Broken (lines 266-274)**:
```typescript
WHERE source_recording_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM recordings WHERE id = knowledge_captures.source_recording_id)
// This query will also fail
```

## Impact

- Migration will crash with error: "table knowledge_captures has no column named source_recording_id"
- ALL P1 fixes are invalidated if migration cannot run
- Users cannot upgrade to V11 schema
- Data migration blocked completely

## Location

- File: `apps/electron/electron/main/ipc/migration-handlers.ts`
- Lines: 531-535 (INSERT), 269-274 (verification), 223-228 (verification count)
- Schema: `apps/electron/electron/main/services/migrations/v11-knowledge-captures.sql`

## Solution

**Option 1: Add column to schema (RECOMMENDED)**
```sql
ALTER TABLE knowledge_captures ADD COLUMN source_recording_id TEXT;
CREATE INDEX IF NOT EXISTS idx_knowledge_captures_source_recording
  ON knowledge_captures(source_recording_id);
```

**Option 2: Remove from migration code**
Remove `source_recording_id` from INSERT and verification queries, but this loses the ability to track which recording created which capture.

## Testing Required

1. Verify schema matches migration INSERT columns
2. Test migration with sample database
3. Verify verification queries run without errors
4. Check foreign key integrity after migration

## Dependencies

- Blocks all migration testing
- Must be fixed before any Phase 1 Integration QA can proceed

## Notes

This is a schema/code mismatch issue. The schema was designed without this column, but the migration code assumes it exists. This suggests the schema and migration code were developed independently without integration testing.
