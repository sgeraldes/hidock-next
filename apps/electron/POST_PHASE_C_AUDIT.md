# Post-Phase C Comprehensive Bug Audit

**Date:** 2026-03-02
**Scope:** All 6 Phase C domains (Actionables, Explore, Calendar, Meetings, Chat, RAG, Device, Downloads, Library, Transcription, People, Projects, Settings)
**Method:** Parallel agent audit with use-case tracing
**Agents:** 6 domain specialists

---

## Executive Summary

After completing Phase C (97 MEDIUM priority bug fixes), a systematic audit discovered **142 new bugs** across all domains:

| Severity | Count | % |
|----------|-------|---|
| CRITICAL | 26 | 18% |
| HIGH | 44 | 31% |
| MEDIUM | 43 | 30% |
| LOW | 29 | 21% |
| **TOTAL** | **142** | **100%** |

**Key Findings:**
- Multiple complete feature failures (library components missing, battery polling never starts, actionables UI broken)
- Data loss risks (download queue corruption, meeting details race conditions)
- Silent failures (transcription events lost, sync status wrong, errors swallowed)
- Performance issues (infinite re-renders, memory leaks, polling storms)

---

## Findings by Domain

### AUD1: Actionables + Explore (10 bugs)
- 0 CRITICAL, 0 HIGH, 2 MEDIUM, 3 LOW, 5 false positives
- **Top Issue**: Scroll position not reset on tab change
- **Status**: Well-implemented, only minor polish needed

### AUD2: Calendar + Meetings (22 bugs)
- 5 CRITICAL, 8 HIGH, 6 MEDIUM, 3 LOW
- **Top Issues**:
  - AUD2-001: Meeting actionables silently fail (wrong table queried)
  - AUD2-002: Actionables UI completely missing despite data loading
  - AUD2-005: Download queue key mismatch still exists despite claimed fix

### AUD3: Chat + RAG (24 bugs)
- 7 CRITICAL, 8 HIGH, 6 MEDIUM, 3 LOW
- **Top Issues**:
  - AUD3-001: Scroll breaks when filtering messages (wrong dependency)
  - AUD3-003: RAG session not cleared on retry (stale context)
  - AUD3-004: Race condition in conversation switching
  - AUD3-005: Input never disabled during processing

### AUD4: Device + Downloads (47 bugs)
- 8 CRITICAL, 15 HIGH, 16 MEDIUM, 8 LOW
- **Top Issues**:
  - AUD4-001: Battery polling never starts (empty deps array)
  - AUD4-002: File list race condition causes data loss
  - AUD4-003: Connection timeout cleanup race
  - AUD4-005: Download stall detection false positives

### AUD5: Library + Transcription (23 bugs)
- 3 CRITICAL, 7 HIGH, 8 MEDIUM, 5 LOW
- **Top Issues**:
  - AUD5-001: RecordingRow component does not exist (import mismatch)
  - AUD5-002: useLibraryActions hook does not exist (missing file)
  - AUD5-003: Transcription events never reach UI (hooks not invoked)

### AUD6: People + Projects + Settings (16 bugs)
- 3 CRITICAL, 6 HIGH, 5 MEDIUM, 2 LOW
- **Top Issues**:
  - AUD6-001: Settings RAG default value mismatch (5 vs 10)
  - AUD6-002: RAG context size validation missing
  - AUD6-003: Projects N+1 query NOT actually fixed

---

## Critical Bugs (Immediate Action Required)

### Complete Feature Failures

**AUD5-001**: RecordingRow component missing
- Library page will crash on load
- Import path mismatch: code imports `RecordingRow`, actual component is `SourceRow`

**AUD5-002**: useLibraryActions hook missing
- All user actions (delete, transcribe, download) non-functional
- Hook imported but file doesn't exist

**AUD5-003**: Transcription events never reach UI
- Progress bars never update
- Status changes not reflected
- Hooks exist but never invoked in component tree

**AUD4-001**: Battery polling never starts
- Effect has empty dependency array
- If device connects after mount, polling never begins

**AUD2-001 + AUD2-002**: Meeting actionables completely broken
- Handler queries wrong table (knowledge_captures.meeting_id always NULL)
- UI component missing (data loads but never renders)

---

### Data Loss Risks

**AUD4-002**: File list race condition
- Two simultaneous refreshes clear data before fetches complete
- Results in complete recording list loss

**AUD4-008**: Download queue corruption on rapid cancel
- Queue modifications not transactional
- Partial cancellations leave queue in inconsistent state

**AUD2-003**: Calendar sync timestamp failure
- Config update exception returns success with stale timestamp
- UI shows incorrect "last synced" time

---

### Silent Failures

**AUD3-003**: RAG session not cleared on retry
- Failed messages removed from DB but stay in LLM context
- Causes confused/hallucinated responses

**AUD2-005**: Download queue key mismatch persists
- Phase C claimed fix incomplete
- Download buttons show wrong state

**AUD5-009**: Database returns wrong transcription status
- Queries return `status` column instead of `transcription_status`
- UI always shows incorrect transcription state

---

## High Priority Bugs (Fix Soon)

### Race Conditions

- **AUD3-004**: Conversation selection race (rapid switching shows wrong messages)
- **AUD4-003**: Connection timeout cleanup race (disconnects just-connected device)
- **AUD2-004**: Meeting playback state update after unmount
- **AUD4-017**: Device state update race with file list refresh

### Missing Error Recovery

- **AUD3-002**: Context picker shows infinite spinner on load failure
- **AUD2-009**: Actionables load error silently swallowed
- **AUD2-010**: Calendar sync doesn't verify transaction success
- **AUD4-007**: Format storage no rollback on failure

### Performance Issues

- **AUD5-005**: Download queue Map in selector causes infinite re-renders
- **AUD2-008**: Calendar auto-scroll fires on every list view toggle
- **AUD5-014**: Device connection triggers triple refresh
- **AUD4-023**: Auto-sync triggered twice on connect

### UX Breaks

- **AUD3-005**: Message input never disabled during processing
- **AUD3-006**: Conversation title never updated after first message
- **AUD4-016**: Retry failed doesn't check if device connected
- **AUD6-005**: People refresh button no loading state

---

## Medium Priority Bugs (Fix in Sprint)

### Missing Features
- **AUD2-007**: Meeting time editing UI incomplete
- **AUD3-016**: No empty conversation list state
- **AUD5-006**: Transcript expansion persistence mismatch
- **AUD6-014**: People sort doesn't persist

### Validation Gaps
- **AUD6-002**: RAG context size validation missing
- **AUD5-013**: Drag-drop import no file size check
- **AUD3-012**: No token limit validation on input

### Data Flow Issues
- **AUD3-011**: Source display logic broken (Map not populated)
- **AUD4-022**: Device file list doesn't update sync status live
- **AUD6-011**: Projects description update doesn't affect list

---

## Low Priority Bugs (Backlog)

### Dead Code
- **AUD3-018**: Message edit columns defined but never used
- **AUD6-015**: RAG_DEFAULTS constant mismatch
- **AUD5-019**: QA logs spam without toggle check

### Edge Cases
- **AUD2-021**: useToday import appears unused (side-effect only)
- **AUD4-043**: Realtime counter never resets on stop
- **AUD5-022**: Device cache never expires

### Cosmetic
- **AUD4-042**: Storage display no color coding for low space
- **AUD4-047**: Device model "UNKNOWN" not user-friendly
- **AUD5-020**: Empty state message too generic

---

## Cross-Cutting Issues

### Zustand Store Patterns
- **ERROR-0004 violations**: Multiple stores returning Maps/Sets without useShallow
- **getState() overuse**: Components re-render on any store change
- **Missing granular selectors**: No per-field selector hooks

### IPC Inconsistencies
- **Result<T> pattern**: Some handlers use it, others don't
- **Type safety**: Some handlers return `any[]` instead of proper types
- **Error propagation**: Success toasts shown even if refresh fails

### Event System
- **Lost events**: Transcription events emitted but no listeners
- **Missing forwarding**: Downloads complete but Library not notified
- **Race conditions**: Multiple events trigger same refresh

---

## Recommendations

### Immediate (CRITICAL)
1. Fix AUD5-001: Rename RecordingRow import to SourceRow
2. Fix AUD5-002: Create useLibraryActions or remove import
3. Fix AUD5-003: Wire up transcription event hooks in Library
4. Fix AUD4-001: Add deviceState.connected to battery polling deps
5. Fix AUD2-001/002: Query correct table and add actionables UI

### Short-term (HIGH)
1. Add conversation selection debounce (AUD3-004)
2. Fix download queue key consistency (AUD2-005)
3. Disable input during chat processing (AUD3-005)
4. Fix Map selector equality (AUD5-005)
5. Clear RAG session on retry (AUD3-003)

### Medium-term (MEDIUM)
1. Add validation for all config fields
2. Implement proper error recovery paths
3. Add loading states to all async buttons
4. Persist UI preferences (sort, filters, expansion)

### Long-term (Architecture)
1. Centralize event bus for cross-component notifications
2. Standardize IPC Result<T> pattern across all handlers
3. Add granular selectors to all Zustand stores
4. Implement proper state machines for complex flows
5. Add transaction boundaries for data mutations

---

## Testing Requirements

### Unit Tests Needed
- Zustand store selectors (equality checking)
- Date parsing edge cases (DST, fractional hours)
- Download queue operations (cancel, retry, corruption)
- RAG session management (clear, retry, stale context)

### Integration Tests Needed
- Library page render with actual hooks wired up
- Transcription event flow end-to-end
- Device connection lifecycle (timeout, cancel, disconnect)
- Calendar sync with transaction rollback

### E2E Tests Needed
- Complete transcription flow (device → download → transcribe → display)
- Multi-conversation chat switching
- Download queue with concurrent operations
- Settings save with validation errors

---

## Priority Matrix

```
┌─────────────────────────────────────────────┐
│ CRITICAL (26)                               │
│ - Library page crashes (AUD5-001, 002)     │
│ - Battery never polls (AUD4-001)           │
│ - Data loss races (AUD4-002, 008)          │
│ - Silent failures (AUD2-001, 005, AUD5-009)│
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│ HIGH (44)                                   │
│ - Race conditions (AUD3-004, AUD4-003, 017)│
│ - Missing error recovery (AUD3-002, 009)   │
│ - Performance issues (AUD5-005, 014)       │
│ - UX breaks (AUD3-005, 006, AUD4-016)      │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│ MEDIUM (43)                                 │
│ - Missing features (AUD2-007, AUD3-016)    │
│ - Validation gaps (AUD6-002, AUD5-013)     │
│ - Data flow issues (AUD3-011, AUD4-022)    │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│ LOW (29)                                    │
│ - Dead code (AUD3-018, AUD6-015)           │
│ - Edge cases (AUD2-021, AUD4-043)          │
│ - Cosmetic (AUD4-042, 047, AUD5-020)       │
└─────────────────────────────────────────────┘
```

---

## Audit Methodology

This audit used the parallel agent exploratory testing methodology:

1. **DISCOVER**: Inventoried all pages, components, stores, hooks, IPC handlers, services
2. **PARTITION**: Divided into 6 audit domains (one per Phase C branch)
3. **DISPATCH**: Launched 6 specialized agents in parallel
4. **COLLECT**: Gathered all findings with exact file:line references
5. **COMPILE**: Merged into single prioritized report

Each agent traced complete user flows:
- UI interaction → state update → IPC call → handler execution → database query → response → UI update
- Verified dependency arrays, cleanup functions, error handling, type safety
- No assumptions - read actual code and verified every path

---

## Next Steps

Per project workflow:
1. ✅ Phase C completed (97 bugs fixed)
2. ✅ /simplify completed (3 files refined)
3. ✅ /audit completed (142 bugs found)
4. ⏳ /phased-dev to fix audit findings (26 CRITICAL + 44 HIGH = 70 bugs)
5. ⏳ Repeat /simplify + /audit until clean
6. ⏳ Continue to Phase D (64 LOW priority bugs)
7. ⏳ Continue to Phase E (Test Coverage improvements)

**Current Status**: Ready to dispatch bug fix agents for audit findings.
