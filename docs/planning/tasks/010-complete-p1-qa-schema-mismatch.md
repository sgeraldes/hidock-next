---
status: complete
priority: p1
issue_id: "010"
tags: [code-review, data-migration, integration-qa, schema]
dependencies: []
---

# P1: Schema Mismatch - knowledge_captures vs knowledge_entries

## Problem Statement

Migration code references `knowledge_captures` table but actual schema uses `knowledge_entries`, causing migration failures or data in wrong table.

## Findings

- Code references `knowledge_captures`
- Database schema defines `knowledge_entries`
- Mismatch causes silent failures
- Data may be orphaned in wrong table

## Proposed Solutions

### Option A: Align Code to Schema (Recommended)
Update all code to use `knowledge_entries`.

**Pros:** Matches existing schema
**Cons:** Code changes required
**Effort:** Small
**Risk:** Low

### Option B: Create Alias View
Create database view aliasing tables.

**Pros:** Both names work
**Cons:** Adds complexity
**Effort:** Small
**Risk:** Medium - maintenance burden

## Recommended Action

Implement Option A - align code to match database schema.

## Technical Details

**Affected files:**
- `apps/electron/electron/main/ipc/migration-handlers.ts`
- `apps/electron/electron/main/services/migrations/v11-migrate.ts`

## Acceptance Criteria

- [ ] All code uses correct table name
- [ ] Migration completes successfully
- [ ] Data ends up in correct table
- [ ] Tests verify table name usage

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2025-12-26 | Created from data migration review | Schema naming issue |

## Resources

- Code Review: Phase 1 Data Migration (af4a7be)
