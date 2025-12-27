---
status: pending
priority: p1
issue_id: "008"
tags: [code-review, performance, backend, storage]
dependencies: []
---

# P1: Full Table Scan Per Tier in Cleanup Operations

## Problem Statement

StoragePolicyService performs full table scans for each storage tier during cleanup, causing O(n*t) complexity where n=records and t=tiers.

## Findings

- Cleanup iterates each tier separately
- Each tier does full table scan
- 3 tiers = 3 full scans
- Performance degrades with data volume

## Proposed Solutions

### Option A: Single Pass with Partitioning (Recommended)
Query all records once, partition in memory by tier.

**Pros:** O(n) complexity, single scan
**Cons:** Memory for full result set
**Effort:** Small
**Risk:** Low

### Option B: Database-Side Grouping
Use GROUP BY query to batch by tier.

**Pros:** Database-optimized
**Cons:** Complex query
**Effort:** Medium
**Risk:** Low

## Recommended Action

Implement Option A for simplicity, or Option B for very large datasets.

## Technical Details

**Affected files:**
- `apps/electron/electron/main/services/storage-policy.ts`

## Acceptance Criteria

- [ ] Single query for all tiers
- [ ] Cleanup time < 5 seconds for 10K records
- [ ] Tests verify single-pass behavior
- [ ] No functionality regression

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2025-12-26 | Created from performance review | Multi-scan inefficiency |

## Resources

- Code Review: Phase 0 Backend Performance (a16a67d)
