---
status: complete
priority: p1
issue_id: "007"
tags: [code-review, performance, backend, memory-leak]
dependencies: []
---

# P1: Unbounded Event Listeners Causing Memory Growth

## Problem Statement

Event listeners are registered without proper cleanup, causing memory growth over time as the application runs.

## Findings

- Event subscriptions created without limits
- No maximum listener cap
- Memory grows with each subscription
- Long-running sessions accumulate listeners

## Proposed Solutions

### Option A: Bounded Event Bus (Recommended)
Implement maximum listener limits and automatic cleanup.

**Pros:** Prevents unbounded growth
**Cons:** May drop events at limit
**Effort:** Medium
**Risk:** Low

### Option B: Manual Cleanup Tracking
Track all subscriptions and clean on component destroy.

**Pros:** Full control
**Cons:** Error-prone, easy to miss
**Effort:** Large
**Risk:** Medium

## Recommended Action

Implement Option A with reasonable limits and cleanup on hot-reload.

## Technical Details

**Affected files:**
- `apps/electron/electron/main/services/event-bus.ts`

## Acceptance Criteria

- [ ] Maximum listener limit enforced
- [ ] Automatic cleanup on component destruction
- [ ] Memory stable over long sessions
- [ ] Warning logged when limit approached

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2025-12-26 | Created from performance review | Memory leak pattern |

## Resources

- Code Review: Phase 0 Backend Performance (a16a67d)
