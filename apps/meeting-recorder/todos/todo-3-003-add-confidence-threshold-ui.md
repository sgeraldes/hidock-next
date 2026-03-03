# Task: Add word confidence threshold UI

**Phase**: 3
**Priority**: Medium
**Estimated Complexity**: Low

## Context
Let users adjust word confidence threshold for filtering. Design doc specifies 70% default.

## Current State
No user control over confidence threshold.

## What's Missing/Needed
Add settings UI:
- Slider for confidence threshold (50%-100%)
- Default 70%
- Tooltip explaining effect
- Real-time preview of filtering impact

## Dependencies
- [ ] Phase 1-2 settings tasks completed

## Acceptance Criteria
- [ ] Slider exists in Settings UI
- [ ] Range 50%-100%, step 5%
- [ ] Default 70%
- [ ] Setting persists across restarts
- [ ] Tooltip explains filtering
- [ ] Updates useSettingsStore.confidenceThreshold

## Files to Create/Modify
- `src/pages/Settings.tsx` - Add confidence slider
- `src/store/useSettingsStore.ts` - Add confidenceThreshold field
- `src/pages/__tests__/Settings.test.tsx` - Test slider

## Testing Requirements
Verify slider updates setting and persists correctly
