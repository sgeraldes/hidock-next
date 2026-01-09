# Library Implementation - Execution Matrix

**Status**: NEEDS_CHANGES before execution
**Last Updated**: 2026-01-04

---

## Quick Summary

| Metric | Value |
|--------|-------|
| **Verdict** | NEEDS_CHANGES |
| **Architecture Score** | B+ (85/100) |
| **Critical Issues** | 4 |
| **Estimated Total Time** | 30-35 hours (sequential) |
| **Estimated with 2 Agents** | 22-25 hours (after fixes) |
| **Current Blocker** | Phase 1 incomplete, naming collision |

---

## Critical Issues Blocking Execution

### Issue 1: Naming Collision in TODO-003 (HIGH PRIORITY)

**Problem**: TODO-003 creates `useLibraryFilters` hook, but this name already exists in `useLibraryStore.ts` (lines 166-173).

**Impact**: TODO-004-migrate Option B references non-existent hook pattern.

**Fix Required**:
```diff
File: plans/library-todos/TODO-003-create-useLibraryFilters-hook.md
- # TODO-003: Create useLibraryFilters Hook File
+ # TODO-003: Create useLibraryFilterManager Hook File
```

**Effort**: 5 minutes

---

### Issue 2: Backwards Dependency (TODO-005/007) (MEDIUM PRIORITY)

**Problem**: TODO-005 depends on TODO-007, but TODOs state the reverse.

**Current (WRONG)**:
```
TODO-005 → TODO-007
```

**Correct**:
```
TODO-007 → TODO-005
(AbortController infrastructure must exist before BulkProgressModal can use it)
```

**Fix Required**: Update dependency declarations in both files.

**Effort**: 5 minutes

---

### Issue 3: Vague Error Integration (HIGH PRIORITY)

**Problem**: TODO-004 says "integrate error handling" but doesn't specify which errors go where.

**Fix Required**: Add specific integration checklist:
- AudioPlayer: NotFoundError, NotSupportedError
- OperationController: NetworkError, AbortError
- SourceRow/Card: Display error badges
- Test requirements for each error type

**Effort**: 15 minutes

---

### Issue 4: Unvalidated Accessibility Claims (HIGH PRIORITY)

**Problem**: README claims "Phase 5: Complete ✅" without audit report or test results.

**Fix Required**: Create TODO-012 with accessibility validation steps:
- axe-core audit
- NVDA/VoiceOver testing
- Keyboard navigation matrix
- WCAG 2.1 AA compliance documentation

**Effort**: 30 minutes to create TODO, 2-3 hours to execute

---

## Corrected Execution Order

### Phase 1: Foundation (SEQUENTIAL - 4-6 hours)

```
┌──────────────────────────────────────────────────┐
│ CRITICAL: Must complete BEFORE any Phase 3-7 work│
└──────────────────────────────────────────────────┘

Step 1: TODO-002 (1 hour)
┌────────────────────────────────────────┐
│ Update tests from Recordings → Library│
│ - Rename test file                    │
│ - Update imports                       │
│ - Add Library-specific test cases     │
└──────────────┬─────────────────────────┘
               │
               ▼
Step 2: TODO-001 (30 mins)
┌────────────────────────────────────────┐
│ Delete legacy Recordings.tsx           │
│ - Verify no references                 │
│ - Delete file                          │
│ - Verify build succeeds                │
└──────────────┬─────────────────────────┘
               │
               ▼
Step 3: TODO-003 (1-2 hours)
┌────────────────────────────────────────┐
│ Create useLibraryFilterManager hook*   │
│ - Wrap store selectors                 │
│ - Add derived state                    │
│ - Export from hooks/index              │
└──────────────┬─────────────────────────┘
               │  *Note: Renamed to avoid collision
               ▼
Step 4: TODO-004-migrate (1-2 hours)
┌────────────────────────────────────────┐
│ Migrate Library.tsx to store filters  │
│ - Remove local useState                │
│ - Use store selectors                  │
│ - Test filter persistence              │
└────────────────────────────────────────┘

VALIDATION CHECKPOINT:
✓ Filter state persists across navigation
✓ All tests pass
✓ No Recordings.tsx in codebase
```

**Parallelization**: NONE (file dependencies prevent parallel work)
**Agent Count**: 1
**Estimated Time**: 4-6 hours

---

### Phase 2: Validation (NEW - PARALLEL - 2-3 hours)

```
Agent A                          Agent B
┌──────────────────────┐         ┌──────────────────────┐
│ TODO-012 (2-3 hrs)   │         │ TODO-013 (1-2 hrs)   │
│ Accessibility Audit  │         │ Performance Baseline │
│                      │         │                      │
│ - axe-core scan      │         │ - Render time tests  │
│ - Screen reader test │         │ - Scroll FPS tests   │
│ - Keyboard nav       │         │ - Filter perf tests  │
│ - WCAG compliance    │         │ - Enrichment timing  │
└──────────────────────┘         └──────────────────────┘

OUTPUT:
- Accessibility audit report
- WCAG 2.1 AA compliance matrix
- Performance baseline metrics
- Optimization priority list
```

**Parallelization**: 2 agents (independent tasks)
**Estimated Time**: 2-3 hours (parallel)

---

### Phase 3-4: Error Handling & Bulk Operations (6-10 hours)

```
CRITICAL: TODO-007 must complete BEFORE TODO-005

Track A: AbortController Infrastructure (MUST RUN FIRST)
┌────────────────────────────────────────┐
│ TODO-007 (2-3 hours)                   │
│ Add AbortController support           │
│                                        │
│ - Implement in OperationController    │
│ - Support download cancellation       │
│ - Support transcription queue clear   │
│ - Test cancellation scenarios         │
└──────────────┬─────────────────────────┘
               │
               │ THEN (after TODO-007 complete):
               │
               ├─────────────────┬─────────────────┐
               │                 │                 │
               ▼                 ▼                 ▼
      ┌────────────────┐ ┌──────────────┐ ┌──────────────┐
      │ TODO-004       │ │ TODO-005     │ │ TODO-006     │
      │ Error          │ │ Bulk         │ │ Bulk Result  │
      │ Integration    │ │ Progress     │ │ Summary      │
      │ (2-3 hrs)      │ │ Modal        │ │ (1-2 hrs)    │
      │                │ │ (2-3 hrs)    │ │              │
      └────────────────┘ └──────────────┘ └──────────────┘
           │                    │                 │
           │                    │                 │
           └────────────────────┴─────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │ Integration Test │
                    │ Bulk operations  │
                    └──────────────────┘
```

**Execution Options**:

**Option A: Single Agent Sequential**
- TODO-007 → TODO-004 → TODO-005 → TODO-006
- Time: 8-10 hours
- Risk: LOW

**Option B: Two Agents (After TODO-007)**
- Agent 1: TODO-004
- Agent 2: TODO-005 → TODO-006
- Time: 5-6 hours
- Risk: MEDIUM (merge conflicts possible)

**Recommended**: Option A for safety

---

### Phase 6: Performance Optimization (PARALLEL - 3-4 hours)

```
Agent A                          Agent B
┌──────────────────────┐         ┌──────────────────────┐
│ TODO-008 (2-3 hrs)   │         │ TODO-009 (2-3 hrs)   │
│ useTransition        │         │ Enrichment Batching  │
│                      │         │                      │
│ - Wrap filter state  │         │ - Batch size limit   │
│ - Add isPending      │         │ - Prioritize visible │
│ - UI opacity during  │         │ - Background load    │
│   transition         │         │ - Progress indicator │
└──────────────────────┘         └──────────────────────┘
           │                              │
           └──────────┬───────────────────┘
                      ▼
            ┌──────────────────┐
            │ Performance Test │
            │ Verify targets   │
            └──────────────────┘

VALIDATION:
✓ Render <100ms with 1000 items
✓ Scroll 60fps with 5000 items
✓ No UI freeze during filter
```

**Parallelization**: 2 agents (independent tasks)
**Estimated Time**: 3-4 hours (parallel)

---

### Phase 7: Detail Drawer (SEQUENTIAL - 4-5 hours)

```
Step 1: TODO-010 (2-3 hours)
┌────────────────────────────────────────┐
│ Create TimeAnchor Component            │
│                                        │
│ - Clickable timestamp component       │
│ - Seek audio on click                 │
│ - Highlight current segment           │
│ - Keyboard accessible                 │
└──────────────┬─────────────────────────┘
               │
               ▼
Step 2: TODO-011 (2-3 hours)
┌────────────────────────────────────────┐
│ Create TranscriptViewer Component      │
│                                        │
│ - Parse transcript for timestamps     │
│ - Render TimeAnchors                  │
│ - Synchronized highlighting           │
│ - Auto-scroll to current position     │
│ - Collapsible sections                │
└────────────────────────────────────────┘

VALIDATION:
✓ Time anchors seek audio
✓ Transcript highlights during playback
✓ Drawer responsive on all breakpoints
```

**Parallelization**: NONE (component dependency)
**Agent Count**: 1
**Estimated Time**: 4-5 hours

---

## Complete Parallelization Matrix

### Maximum Parallel Execution (After Fixes)

| Phase | Tasks | Agents | Time (Sequential) | Time (Parallel) | Savings |
|-------|-------|--------|-------------------|-----------------|---------|
| 1 | TODO-002→001→003→004-mig | 1 | 4-6 hrs | 4-6 hrs | 0% |
| 2 | TODO-012 \|\| TODO-013 | 2 | 4-5 hrs | 2-3 hrs | 50% |
| 3-4 | TODO-007 → (TODO-004→005→006) | 1-2 | 8-10 hrs | 5-6 hrs | 40% |
| 6 | TODO-008 \|\| TODO-009 | 2 | 5-6 hrs | 3-4 hrs | 40% |
| 7 | TODO-010 → TODO-011 | 1 | 4-5 hrs | 4-5 hrs | 0% |
| **TOTAL** | **13 TODOs** | **2 max** | **30-35 hrs** | **22-25 hrs** | **30%** |

---

## Risk Matrix by Phase

| Phase | Risk Level | Blockers | Mitigation |
|-------|-----------|----------|------------|
| 1 | **HIGH** | Naming collision, Library.tsx uses local state | Fix naming, complete migration |
| 2 | LOW | None | Independent validation tasks |
| 3-4 | MEDIUM | TODO-007 dependency, vague error integration | Complete TODO-007 first, expand error checklist |
| 6 | LOW | None | Independent optimization tasks |
| 7 | LOW | Component dependency | Sequential execution |

---

## Dependency Graph (Corrected)

```
Phase 1 (Sequential):
TODO-002 → TODO-001 → TODO-003 → TODO-004-migrate
    │
    └─────────────────────┐
                          ▼
Phase 2 (Parallel):       ├─→ TODO-012 (Accessibility)
                          └─→ TODO-013 (Performance Baseline)
    │
    └─────────────────────┐
                          ▼
Phase 3-4:                TODO-007 (AbortController)
                               │
                               ├─→ TODO-004 (Error Integration)
                               ├─→ TODO-005 (Bulk Progress)
                               └─→ TODO-006 (Bulk Results)
    │
    └─────────────────────┐
                          ▼
Phase 6 (Parallel):       ├─→ TODO-008 (useTransition)
                          └─→ TODO-009 (Enrichment)
    │
    └─────────────────────┐
                          ▼
Phase 7 (Sequential):     TODO-010 → TODO-011
```

---

## Pre-Execution Checklist

### Before Starting Phase 1

- [ ] Fix TODO-003 hook name to `useLibraryFilterManager`
- [ ] Update TODO-004-migrate to reference correct hook
- [ ] Reverse TODO-005/007 dependency
- [ ] Expand TODO-004 error integration checklist
- [ ] Create TODO-012 (Accessibility validation)
- [ ] Create TODO-013 (Performance baseline)
- [ ] Add test requirements to all TODOs
- [ ] Capture current git state (baseline for rollback)

**Estimated Fix Time**: 1-2 hours

### Before Starting Phase 3

- [ ] Verify Phase 1 complete (filter state persists)
- [ ] Verify Phase 2 validation complete
- [ ] All tests passing
- [ ] Performance baseline documented

### Before Starting Phase 6

- [ ] Verify error handling integrated
- [ ] Verify bulk operations work
- [ ] No regressions in existing functionality

### Before Starting Phase 7

- [ ] Verify performance targets met
- [ ] No UI freezes during filter/search
- [ ] Enrichment batching working

---

## Rollback Strategy

### If Issues Discovered Mid-Phase

**Phase 1**: Rollback to previous commit, restart phase
**Phase 3-4**: Can rollback individual TODOs (file-based)
**Phase 6**: Performance optimizations are additive, can disable flags
**Phase 7**: Components are new, can exclude from build

### Rollback Commands

```bash
# Rollback specific file
git checkout HEAD~1 -- <file-path>

# Rollback entire TODO
git revert <commit-hash>

# Rollback to phase start
git reset --hard <phase-start-commit>
```

---

## Success Criteria

### Phase 1 Complete
- [ ] Filter state persists across navigation (manual test)
- [ ] No Recordings.tsx in codebase
- [ ] All tests pass
- [ ] TypeScript 0 errors

### Phase 2 Complete
- [ ] Accessibility audit passes
- [ ] Performance baseline documented
- [ ] WCAG 2.1 AA compliance verified

### Phase 3-4 Complete
- [ ] All error scenarios tested
- [ ] Bulk operations show progress
- [ ] Cancellation works
- [ ] Retry mechanisms work

### Phase 6 Complete
- [ ] Render <100ms with 1000 items
- [ ] Scroll 60fps with 5000 items
- [ ] Filter transitions smooth

### Phase 7 Complete
- [ ] Time anchors seek audio
- [ ] Transcript highlights during playback
- [ ] Drawer responsive on all breakpoints

---

## Next Steps

1. **Fix critical issues** (1-2 hours)
2. **Complete Phase 1** (4-6 hours)
3. **Execute validation TODOs** (2-3 hours)
4. **Re-assess readiness** (30 minutes)
5. **Approve for parallel development**

**Estimated Time to Approval**: 8-12 hours of work

---

**Status**: Plan is architecturally sound but needs fixes before execution.
**Confidence**: 95% (after fixes applied)
**Recommendation**: Implement critical changes, then proceed with execution.
