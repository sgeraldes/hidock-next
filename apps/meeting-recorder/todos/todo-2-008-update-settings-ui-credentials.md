# Task: Update Settings UI for Google Cloud credentials

**Phase**: 2
**Priority**: High
**Estimated Complexity**: Medium

## Context
UI needs input fields for Google Cloud Project ID, API key, and backend selection. Design doc specifies user-facing controls.

## Current State
Settings UI doesn't have Google Cloud section.

## What's Missing/Needed
Add UI section for:
- Google Cloud Project ID input
- Google Cloud API Key input (password field)
- Transcription backend radio/select

## Dependencies
- [ ] Task: Add Google Cloud credentials to settings

## Acceptance Criteria
- [ ] Google Cloud section exists in Settings UI
- [ ] Project ID input field with label
- [ ] API Key input as password field
- [ ] Backend selector: "Chirp 3 + Gemini (Recommended)" vs "Gemini Multimodal"
- [ ] Tooltip explains difference
- [ ] Updates useSettingsStore on change
- [ ] Current values displayed correctly

## Files to Create/Modify
- `src/pages/Settings.tsx` - Add Google Cloud section
- `src/pages/__tests__/Settings.test.tsx` - Test UI renders and updates

## Testing Requirements
Verify inputs render, update state, and mask API key
