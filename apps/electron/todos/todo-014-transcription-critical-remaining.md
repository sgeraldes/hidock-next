# TODO-014: Transcription Queue Critical Bugs (3 remaining)

**Priority**: CRITICAL
**Phase**: A
**Domain**: Transcription Queue System
**Audit Reference**: COMPREHENSIVE_BUG_AUDIT_WAVE2.md - Transcription CRITICAL

## Problem

3 remaining CRITICAL bugs in transcription system (after race condition fix in TODO-005):

1. **Race condition** (covered in TODO-005)
2. **Memory leak** (covered in TODO-003)
3. **Silent failure - auto-transcribe queues without starting processor** (covered in TODO-005)

Additional bugs to fix here:
- **Data loss - retry doesn't update queue in database first** (HIGH priority)
- **Broken progress reporting - hardcoded 50% progress** (HIGH priority)

## Current State

From audit findings:
- Retry button updates in-memory queue but not database
- Progress always shows 50%, not actual transcription progress
- Database and in-memory queue get out of sync
- Users can't track transcription progress accurately

## Impact

- **Data loss**: Retried items lost on app restart
- **Poor UX**: Progress stuck at 50%, users don't know real status

## Files Affected

- `src/store/features/useTranscriptionStore.ts` - Queue state
- `electron/main/services/transcription.ts` - Transcription processing
- `electron/main/services/database.ts` - Queue persistence
- `src/components/TranscriptionProgress.tsx` (if exists) - Progress UI

## Dependencies

- Queue persistence architecture
- Progress reporting API from transcription providers
- Zustand store patterns

## Acceptance Criteria

### Retry Database Sync
- [ ] Retry operation updates database first
- [ ] In-memory queue synced with database
- [ ] Test: retry, restart app, verify item still in queue

### Progress Reporting
- [ ] Progress reflects actual transcription progress (0-100%)
- [ ] Progress updates in real-time
- [ ] Uses provider's progress API (not hardcoded)
- [ ] Test: transcribe, verify progress increases smoothly

### General
- [ ] Queue persistence reliable
- [ ] Progress accurate for all providers
- [ ] All tests pass

## Related Bugs

- Transcription HIGH: Data loss - retry doesn't update queue in database first
- Transcription HIGH: Broken progress reporting - hardcoded 50% progress
- Related to TODO-003 (memory leaks)
- Related to TODO-005 (race conditions)
