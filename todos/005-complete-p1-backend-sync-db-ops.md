---
status: pending
priority: p1
issue_id: "005"
tags: [code-review, performance, backend, database]
dependencies: []
---

# P1: Synchronous Database Operations Blocking Main Thread

## Problem Statement

Database operations in backend services execute synchronously on the main Electron thread, blocking the UI and causing application freezes.

## Findings

- Database queries run on main thread
- No worker thread isolation
- UI freezes during large queries
- Poor user experience on slow storage

## Proposed Solutions

### Option A: Worker Thread Pool (Recommended)
Move database operations to worker threads.

**Pros:** Non-blocking, scalable
**Cons:** Complexity increase
**Effort:** Large
**Risk:** Medium - threading bugs

### Option B: Async with Background Scheduling
Use process.nextTick and chunked operations.

**Pros:** Simpler implementation
**Cons:** Still runs on main thread
**Effort:** Medium
**Risk:** Low

## Recommended Action

Implement Option A for heavy operations, Option B as interim fix.

## Technical Details

**Affected files:**
- `apps/electron/electron/main/services/quality-assessment.ts`
- `apps/electron/electron/main/services/storage-policy.ts`
- Database service layer

## Acceptance Criteria

- [ ] Heavy database ops run off main thread
- [ ] UI remains responsive during queries
- [ ] Performance metrics improved
- [ ] No data corruption from threading

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2025-12-26 | Created from performance review | Main thread blocking |

## Resources

- Code Review: Phase 0 Backend Performance (a16a67d)
