# Task: Update Settings UI to show Gemini model options

**Phase**: 1
**Priority**: High
**Estimated Complexity**: Medium

## Context
UI needs dropdown to select between Gemini 2.5 Flash and 3.0 Pro. Design doc specifies this as user-facing control.

## Current State
Settings UI shows provider selection but not model options.

## What's Missing/Needed
Add dropdown/radio selector for Gemini model choice.

## Dependencies
- [ ] Task: Update settings store to support model selection

## Acceptance Criteria
- [ ] Dropdown shows "Gemini 2.5 Flash (Fast)" and "Gemini 3.0 Pro (Quality)"
- [ ] Selection updates useSettingsStore.geminiModel
- [ ] Current selection is highlighted
- [ ] Tooltip explains difference (speed vs quality)
- [ ] Only shown when Google provider is active

## Files to Create/Modify
- `src/pages/Settings.tsx` (or SettingsPanel.tsx) - Add model dropdown
- `src/pages/__tests__/Settings.test.tsx` - Test dropdown renders and updates

## Testing Requirements
Verify dropdown renders, updates state, and shows correct current selection
