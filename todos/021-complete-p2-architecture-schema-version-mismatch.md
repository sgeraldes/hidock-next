# P2-021: Schema Version Mismatch Between database.ts and Migration

**Priority**: P2
**Status**: pending
**Category**: architecture
**Component**: database.ts, migration-handlers.ts
**Created**: 2025-12-26
**Severity**: MEDIUM - Version confusion and migration path unclear

## Problem

`database.ts` defines `SCHEMA_VERSION = 9`, but the migration creates V11 tables. There's no migration path for V10 or V11 in the main database migrations.

## Evidence

**database.ts (line 8)**:
```typescript
const SCHEMA_VERSION = 9
```

**database.ts MIGRATIONS object (lines 220-500)**:
```typescript
const MIGRATIONS: Record<number, () => void> = {
  2: () => { /* v2 migration */ },
  3: () => { /* v3 migration */ },
  6: () => { /* v6 migration */ },
  7: () => { /* v7 migration */ },
  8: () => { /* v8 migration */ },
  9: () => { /* v9 migration */ }
  // ❌ No migration for v10 or v11!
}
```

**migration-handlers.ts (line 643)**:
```typescript
db.run(`INSERT OR REPLACE INTO schema_version (version) VALUES (11)`)
```

## Confusion Matrix

| Component | Schema Version | Migration Path |
|-----------|---------------|----------------|
| database.ts | 9 | Migrations 2-9 defined |
| migration-handlers.ts | 11 | No migration defined |
| v11-knowledge-captures.sql | 11 | Standalone schema |

## Problems This Creates

1. **Version Gap**: What is V10? Does it exist?
2. **Migration Path Unclear**: How do users get from V9 → V11?
3. **Schema Divergence**: database.ts and migration-handlers.ts don't agree on current version
4. **Rollback Confusion**: Rolling back from V11 goes to... what version?

## Impact

- Database version tracking broken
- Future migrations unclear (is next version 10 or 12?)
- No single source of truth for schema version
- Debugging difficult (which version is actually running?)

## Location

- File 1: `apps/electron/electron/main/services/database.ts` (lines 8, 220-500)
- File 2: `apps/electron/electron/main/ipc/migration-handlers.ts` (line 643)
- File 3: `apps/electron/electron/main/services/migrations/v11-knowledge-captures.sql`

## Solution Options

### Option 1: Skip V10, Register V11 in database.ts (RECOMMENDED)

```typescript
// database.ts
const SCHEMA_VERSION = 11  // Update to 11

const MIGRATIONS: Record<number, () => void> = {
  // ... existing migrations ...
  9: () => { /* existing v9 */ },
  10: () => {
    // Reserved for future use (skipped to V11)
    console.log('V10 reserved - skipped to V11 knowledge captures architecture')
  },
  11: () => {
    console.log('Running migration to schema v11: Knowledge Captures')
    // NOTE: Actual migration logic is in migration-handlers.ts
    // This is just a placeholder to track version
    // User must run migration via UI
  }
}
```

### Option 2: Separate Schema Versioning

Create two version tracks:
- **Base schema**: Managed by database.ts (currently v9)
- **Migration schema**: Managed by migration-handlers.ts (v11)

Store both in schema_version:
```sql
INSERT INTO schema_version (version, type) VALUES (9, 'base');
INSERT INTO schema_version (version, type) VALUES (11, 'migration');
```

### Option 3: Rename V11 to V10

Change migration to write version 10 instead of 11, eliminating the gap.

## Recommendation

Use **Option 1** because:
- Maintains single version number sequence
- Clear migration path: v9 → v10 (no-op) → v11 (knowledge captures)
- Future migrations continue from v12
- Rollback target is clear (v9)

## Implementation

1. Update `SCHEMA_VERSION` in database.ts to 11
2. Add v10 placeholder migration (no-op)
3. Add v11 migration that delegates to migration-handlers.ts
4. Document that v11 requires user action via migration UI
5. Update schema_version table schema to track migration status

```typescript
// New schema for version tracking
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT DEFAULT CURRENT_TIMESTAMP,
    migration_type TEXT,  -- 'automatic' or 'manual'
    requires_user_action INTEGER DEFAULT 0
);
```

## Testing Required

1. Fresh database should initialize to v11
2. Existing v9 database should migrate through v10 to v11
3. Version checks should report consistent version
4. Rollback should work (v11 → v9, skipping v10)

## Related Issues

- P2-019: Schema version validation missing in migration
