# TODO-006: Settings Page Critical Bugs (6 bugs)

**Priority**: CRITICAL
**Phase**: A
**Domain**: Settings Page
**Audit Reference**: COMPREHENSIVE_BUG_AUDIT_WAVE2.md - Settings Page CRITICAL

## Problem

The Settings page has 6 CRITICAL bugs that cause data loss, race conditions, and missing error handling:

1. **Missing error handling in save handlers** - Save operations can fail silently
2. **No success feedback** - User doesn't know if settings were saved
3. **Missing dependency array** - useEffect may not run when needed
4. **Race condition between form state and config store** - Settings can be overwritten
5. **No loading state for initial config load** - May show stale data
6. **Config store updateConfig doesn't handle errors** - Errors swallowed

## Current State

From audit findings:
- Save handlers don't catch/handle errors
- No UI feedback when save succeeds
- useEffect dependency arrays incomplete
- Form state and config store can get out of sync
- Initial load doesn't show loading state
- updateConfig in store doesn't handle errors

## Impact

- **Data loss**: Settings changes may not be saved
- **Silent failures**: User thinks settings saved but they didn't
- **Stale UI**: Form shows old values while new config loads
- **Race conditions**: Rapid changes can overwrite each other

## Files Affected

- `src/pages/Settings.tsx` - Settings page component
- `src/store/useConfigStore.ts` (or similar) - Config state management
- `electron/main/ipc/config-handlers.ts` - Config save/load IPC handlers
- `electron/main/services/config.ts` - Config persistence service

## Dependencies

- Config store architecture
- IPC patterns for settings
- Error handling conventions
- Toast/notification system for feedback

## Acceptance Criteria

### Error Handling
- [ ] All save handlers wrapped in try/catch
- [ ] Errors displayed to user with specific message
- [ ] Failed saves don't update UI optimistically
- [ ] Retry mechanism for failed saves
- [ ] Config store updateConfig handles errors

### User Feedback
- [ ] Success toast/message after successful save
- [ ] Clear error messages for different failure types
- [ ] Loading spinner during save operation
- [ ] Disabled inputs during save to prevent race

### State Management
- [ ] useEffect dependency arrays complete and correct
- [ ] Form state properly synced with config store
- [ ] Initial config load shows loading state
- [ ] No race conditions between rapid changes

### Testing
- [ ] Test save with network error
- [ ] Test save with invalid config
- [ ] Test rapid successive saves
- [ ] Test form updates while save in progress
- [ ] All tests pass

## Related Bugs

- Settings CRITICAL: Missing error handling in save handlers
- Settings CRITICAL: No success feedback
- Settings CRITICAL: Missing dependency array
- Settings CRITICAL: Race condition between form state and config store
- Settings HIGH: No loading state for initial config load
- Settings HIGH: Config store updateConfig doesn't handle errors
