# TODO-012: MeetingDetail Page Critical Bugs (4 bugs)

**Priority**: CRITICAL
**Phase**: A
**Domain**: MeetingDetail Page
**Audit Reference**: COMPREHENSIVE_BUG_AUDIT_WAVE2.md - MeetingDetail CRITICAL

## Problem

4 CRITICAL bugs in MeetingDetail page:

1. **No handler for actionables query** - Can't load action items
2. **Foreign key violation risk** - Database integrity errors
3. **No error boundary** - Page crashes propagate to whole app
4. **Race condition in audio playback** - State corruption during playback

## Current State

From audit findings:
- Actionables query handler not implemented
- Foreign key constraints allow orphaned records
- No ErrorBoundary component wrapping page
- Audio playback state can corrupt during rapid play/pause

## Impact

- **Missing actionables**: Can't see meeting action items
- **Data integrity**: Orphaned records in database
- **Crashes**: Page errors crash whole app
- **Playback bugs**: Audio state becomes inconsistent

## Files Affected

- `src/pages/MeetingDetail.tsx` - Page component
- `electron/main/ipc/meeting-handlers.ts` - IPC handlers
- `electron/main/services/database.ts` - Actionables query
- `src/components/ErrorBoundary.tsx` - Error handling
- `src/hooks/useAudioPlayback.ts` - Playback state (see TODO-002)

## Dependencies

- Database foreign key schema
- IPC handler patterns
- Error boundary implementation
- Audio playback service (being fixed in TODO-002)

## Acceptance Criteria

### Actionables Handler
- [ ] Actionables query handler implemented
- [ ] Handler registered in IPC
- [ ] Query uses proper foreign key joins
- [ ] Test: load meeting, verify actionables appear

### Foreign Key Safety
- [ ] Foreign key constraints properly defined
- [ ] Cascade deletes configured correctly
- [ ] Orphaned record prevention
- [ ] Test: delete meeting, verify dependent records cleaned

### Error Boundary
- [ ] ErrorBoundary wraps MeetingDetail page
- [ ] Errors show fallback UI, not white screen
- [ ] Error details logged for debugging
- [ ] Test: throw error in component, verify fallback UI

### Audio Playback Race
- [ ] Playback state properly locked during transitions
- [ ] Rapid play/pause doesn't corrupt state
- [ ] Related to TODO-002 fix
- [ ] Test: click play/pause rapidly, verify no corruption

### General
- [ ] All tests pass
- [ ] Page is crash-resistant

## Related Bugs

- MeetingDetail CRITICAL: No handler for actionables query
- MeetingDetail CRITICAL: Foreign key violation risk
- MeetingDetail CRITICAL: No error boundary
- MeetingDetail CRITICAL: Race condition in audio playback
