---
status: complete
priority: p1
issue_id: "004"
tags: [code-review, security, backend, event-bus]
dependencies: []
---

# P1: Uncontrolled Data Broadcasting to Renderer

## Problem Statement

The DomainEventBus broadcasts events to the renderer process without filtering sensitive data, potentially exposing internal state or PII.

## Findings

- All domain events broadcast to renderer via IPC
- No filtering of sensitive fields
- Internal backend state exposed to frontend
- Payload could contain PII or security-sensitive data

## Proposed Solutions

### Option A: Event Filtering Layer (Recommended)
Add a filtering layer that sanitizes events before broadcasting.

**Pros:** Centralized control, maintainable
**Cons:** Additional complexity
**Effort:** Medium
**Risk:** Low

### Option B: Whitelist Allowed Events
Only broadcast specific whitelisted event types.

**Pros:** Simple, secure by default
**Cons:** May miss needed events
**Effort:** Small
**Risk:** Medium - functionality gaps

## Recommended Action

Implement Option A with a sanitization layer that removes sensitive fields and validates event structure before broadcast.

## Technical Details

**Affected files:**
- `apps/electron/electron/main/services/event-bus.ts`

## Acceptance Criteria

- [ ] Events filtered before broadcast
- [ ] Sensitive data removed from payloads
- [ ] Whitelist of broadcastable event types
- [ ] Tests verify no sensitive data leakage

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2025-12-26 | Created from security review | Data exposure risk |

## Resources

- Code Review: Phase 0 Backend Security (a00e98a)
