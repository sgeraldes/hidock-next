---
status: pending
priority: p1
issue_id: "003"
tags: [code-review, security, backend, validation]
dependencies: []
---

# P1: Missing Input Validation on IPC Handlers

## Problem Statement

IPC handlers in the backend accept data from the renderer process without proper validation, allowing malicious input to reach backend services.

## Findings

- IPC handlers pass data directly to services
- No schema validation on incoming payloads
- Missing type checking at process boundary
- Trust boundary violated between renderer and main process

## Proposed Solutions

### Option A: Zod Schema Validation (Recommended)
Add Zod schemas for all IPC handler inputs.

**Pros:** Type-safe, runtime validation, good error messages
**Cons:** Additional dependency
**Effort:** Medium
**Risk:** Low

### Option B: Manual Validation
Add custom validation functions for each handler.

**Pros:** No dependencies
**Cons:** Verbose, error-prone
**Effort:** Large
**Risk:** Medium - inconsistent validation

## Recommended Action

Implement Option A - Zod validation at all IPC boundaries.

## Technical Details

**Affected files:**
- `apps/electron/electron/main/ipc/*.ts` (all handlers)
- `apps/electron/electron/main/services/*.ts`

## Acceptance Criteria

- [ ] All IPC handlers validate input
- [ ] Invalid input returns proper error responses
- [ ] Type safety maintained
- [ ] Tests cover validation scenarios

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2025-12-26 | Created from security review | Trust boundary issue |

## Resources

- Code Review: Phase 0 Backend Security (a00e98a)
