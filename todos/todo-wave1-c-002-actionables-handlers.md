# Task: Update Actionables IPC Handlers for Auto-Population

## Track: C (Actionables Auto-Population)
## Priority: MEDIUM
## Dependencies: todo-wave1-c-001-actionable-detection.md

## Current State
`actionables-handlers.ts` exists with basic CRUD operations but no auto-population logic or UI integration for newly detected actionables.

## What's Missing
- Backend support for querying newly detected actionables
- Status workflow management (pending → in_progress → generated)
- Integration with output generation service

## Implementation Notes
**Current handlers (verify they exist):**
- `getActionables` - list all actionables
- `getActionableById` - get single actionable
- `updateActionable` - update actionable (status, etc.)
- `deleteActionable` - remove actionable

**May need to add:**
- `getActionablesByStatus(status)` - filter by pending/in_progress/generated
- `generateOutputFromActionable(id)` - trigger output generation
- Proper error handling and validation

**Status Workflow:**
1. `pending` - AI detected, waiting for user review
2. `in_progress` - User approved, generating output
3. `generated` - Output created, linked via artifact_id
4. `shared` - Output shared with recipients
5. `dismissed` - User chose not to act on

## Acceptance Criteria
- [ ] Verify existing handlers work correctly
- [ ] Add `getActionablesByStatus()` if missing
- [ ] Ensure `updateActionable()` validates status transitions
- [ ] Add error handling for all database operations
- [ ] Document IPC handler interface in code comments

## Files to Modify
- `apps/electron/electron/main/ipc/actionables-handlers.ts`

## Files to Reference
- `apps/electron/electron/main/ipc/outputs-handlers.ts` (output generation integration)
- `apps/electron/electron/main/services/database.ts` (database helpers)

## Related Specs
- Plan: Wave 1 - Track C
- Database schema: `actionables` table

## Security Considerations
- Validate actionable ID exists before operations
- Prevent unauthorized status changes
- Sanitize all inputs (SQL injection prevention)
- Validate template names against allowed list
