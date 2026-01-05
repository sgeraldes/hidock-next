# Library Component Implementation - Todo Index

## Architecture Review Status

**Last Review**: 2026-01-04
**Status**: READY_FOR_EXECUTION (critical issues resolved)
**Overall Score**: B+ (85/100) → A- (90/100 after fixes)

### Critical Issues Status
1. ~~Naming collision in TODO-003~~ ✅ RESOLVED (hook renamed to useLibraryFilterManager)
2. ~~Backwards dependency between TODO-005/007~~ ✅ FIXED (TODO-007 now runs first)
3. ~~Vague error integration in TODO-004~~ ✅ EXPANDED (specific checklist added)
4. ~~Unvalidated accessibility claims~~ ✅ TODO-012 CREATED (validation task added)

**See detailed analysis**:
- [Architecture Review Report](ARCHITECTURE_REVIEW.md) - Full analysis
- [Execution Matrix](EXECUTION_MATRIX.md) - Parallelization strategy

---

## Execution Order (FINAL)

**Phase 1: Foundation (Sequential - BLOCKING)**
```
TODO-002 → TODO-001 → TODO-003 → TODO-004-migrate
(Note: TODO-003 creates useLibraryFilterManager hook)
```

**Phase 2: Validation (Parallel - NEW)**
```
TODO-012 || TODO-013 (Accessibility + Performance baseline)
```

**Phases 3-7: Feature Implementation**
```
TODO-007 → TODO-004 → (TODO-005 || TODO-006) (Phase 3-4: Error & Bulk)
TODO-008 || TODO-009 (Phase 6: Performance - can parallelize)
TODO-010 → TODO-011 (Phase 7: Detail Drawer - sequential)
```

---

## Phase 1: Foundation

| # | Todo | Priority | Status | Description |
|---|------|----------|--------|-------------|
| 1 | [TODO-002](todo-002-update-recordings-tests.md) | HIGH | PENDING | Update tests from Recordings to Library |
| 2 | [TODO-001](todo-001-delete-recordings-tsx.md) | HIGH | PENDING | Delete legacy Recordings.tsx |
| 3 | [TODO-003](todo-003-create-useLibraryFilters-hook.md) | MEDIUM | PENDING | Create useLibraryFilterManager hook |
| 4 | [TODO-004-migrate](todo-004-migrate-filter-state.md) | HIGH | PENDING | Migrate Library.tsx to store filters |

**Success Criteria:**
- [ ] All existing functionality preserved
- [ ] No visual regressions
- [ ] Tests pass
- [ ] Filter state persists during navigation

---

## Phase 2: Validation (NEW)

| # | Todo | Priority | Status | Description |
|---|------|----------|--------|-------------|
| 12 | [TODO-012](todo-012-validate-accessibility.md) | HIGH | PENDING | Validate accessibility compliance |
| 13 | [TODO-013](todo-013-performance-baseline.md) | HIGH | PENDING | Capture performance baseline |

**Success Criteria:**
- [ ] axe-core audit passes
- [ ] Keyboard navigation tested
- [ ] Performance metrics documented
- [ ] WCAG 2.1 AA compliance verified

---

## Phase 3: Error Handling & Recovery

| # | Todo | Priority | Status | Description |
|---|------|----------|--------|-------------|
| 4 | [TODO-004](todo-004-integrate-error-handling.md) | HIGH | PENDING | Integrate error handling utilities |

**Success Criteria:**
- [ ] All error scenarios show user-friendly messages
- [ ] Retry mechanism works for downloads/transcription
- [ ] No silent failures

---

## Phase 4: Bulk Operations Enhancement

| # | Todo | Priority | Status | Description |
|---|------|----------|--------|-------------|
| 5 | [TODO-005](todo-005-bulk-progress-modal.md) | HIGH | PENDING | Create BulkProgressModal |
| 6 | [TODO-006](todo-006-bulk-result-summary.md) | HIGH | PENDING | Create BulkResultSummary |
| 7 | [TODO-007](todo-007-abort-controller-support.md) | MEDIUM | PENDING | Add AbortController support |

**Success Criteria:**
- [ ] Clear progress indication during bulk operations
- [ ] Error summary shows per-item failures
- [ ] Cancellation works mid-operation

---

## Phase 5: Accessibility & Keyboard Navigation

**Status: COMPLETE** ✅

All Phase 5 components already implemented:
- useKeyboardNavigation.ts
- LiveRegion.tsx
- ARIA attributes in components

---

## Phase 6: Performance Optimization

| # | Todo | Priority | Status | Description |
|---|------|----------|--------|-------------|
| 8 | [TODO-008](todo-008-use-transition-filters.md) | MEDIUM | PENDING | Add useTransition for filters |
| 9 | [TODO-009](todo-009-enrichment-batching.md) | MEDIUM | PENDING | Implement enrichment batching |

**Success Criteria:**
- [ ] Initial render <100ms with 1000 items
- [ ] 60fps scroll with 5000 items
- [ ] No UI freeze during filter/search

---

## Phase 7: Detail Drawer & Tri-Pane Layout

| # | Todo | Priority | Status | Description |
|---|------|----------|--------|-------------|
| 10 | [TODO-010](todo-010-time-anchor-component.md) | MEDIUM | PENDING | Create TimeAnchor component |
| 11 | [TODO-011](todo-011-transcript-viewer.md) | LOW | PENDING | Create TranscriptViewer component |

**Success Criteria:**
- [ ] Detail drawer opens smoothly
- [ ] Time anchors sync with audio playback
- [ ] Foundation ready for tri-pane expansion

---

## Overall Progress

| Phase | Status | Completion | Notes |
|-------|--------|------------|-------|
| Phase 1 | In Progress | 80% | 4 TODOs remaining |
| Phase 2 | NEW | 0% | Validation (TODO-012, TODO-013) |
| Phase 3 | Planned | 0% | TODO-004 has expanded checklist |
| Phase 4 | Planned | 50% | BulkActionsBar exists |
| Phase 5 | Pending Validation | 95% | Needs TODO-012 audit |
| Phase 6 | Planned | 30% | React.memo, useDeferredValue exist |
| Phase 7 | Planned | 60% | SourceDetailDrawer exists |

**Total TODOs**: 13 (TODO-001 through TODO-013)
**Estimated Effort**: 22-25 hours with 2 parallel agents

---

## Quick Commands

```bash
# Run tests before starting
cd apps/electron && npm run test:run

# Verify build
npm run build

# Start dev server
npm run dev
```
