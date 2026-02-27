# TODO-011: Library Page Critical Bugs (3 bugs)

**Priority**: CRITICAL
**Phase**: A
**Domain**: Library Page
**Audit Reference**: COMPREHENSIVE_BUG_AUDIT_WAVE2.md - Library Page CRITICAL

## Problem

3 CRITICAL bugs in Library page that break core functionality:

1. **Missing IPC handler for updateStatus** - Can't update recording status
2. **Missing IPC handler for cancelTranscription** - Can't cancel transcriptions
3. **Play button not wired** - Audio playback broken

## Current State

From audit findings:
- `recordings:updateStatus` IPC handler not registered
- `recordings:cancelTranscription` IPC handler not registered
- Play button onClick handler missing or doesn't call audio service
- Library shows recordings but can't interact with them

## Impact

- **Broken status updates**: Recording status stuck
- **Can't cancel**: Transcriptions can't be stopped
- **No audio playback**: Play button does nothing
- Library page is view-only, not functional

## Files Affected

- `src/pages/Library.tsx` - Play button, status UI
- `src/features/library/components/SourceRow.tsx` - Row actions
- `src/features/library/components/OperationController.tsx` - Audio controls
- `electron/main/ipc/recording-handlers.ts` - IPC handler registration
- `electron/main/services/transcription.ts` - Cancel logic

## Dependencies

- IPC handler pattern
- Audio playback service
- Recording status management
- Transcription queue architecture

## Acceptance Criteria

### IPC Handlers
- [ ] `recordings:updateStatus` handler implemented and registered
- [ ] `recordings:cancelTranscription` handler implemented and registered
- [ ] Both handlers have tests
- [ ] Test: call handlers via IPC, verify operations work

### Play Button
- [ ] Play button wired to audio playback service
- [ ] Clicking play starts audio
- [ ] Waveform visualization works
- [ ] Play/pause state properly managed
- [ ] Test: click play, verify audio plays

### General
- [ ] Status updates propagate to UI immediately
- [ ] Cancel transcription stops queue processing
- [ ] All tests pass

## Related Bugs

- Library CRITICAL: Missing IPC handler for updateStatus
- Library CRITICAL: Missing IPC handler for cancelTranscription
- Library CRITICAL: Play button not wired
