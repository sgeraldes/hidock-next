# Task: Update settings store to support model selection

**Phase**: 1
**Priority**: High
**Estimated Complexity**: Medium

## Context
Users need ability to choose between Gemini 2.5 Flash (fast, cheap) and 3.0 Pro (high quality). Design doc specifies this as part of user control.

## Current State
Settings store has provider selection but not model-level selection.

## What's Missing/Needed
Add new settings field `geminiModel: "2.5-flash" | "3.0-pro"` with default "2.5-flash".

## Dependencies
- [ ] Task: Update DEFAULT_MODELS
- [ ] Task: Update @ai-sdk/google dependency
- [ ] Task: Add Gemini 3.0 Pro as model option

## Acceptance Criteria
- [ ] useSettingsStore has geminiModel field
- [ ] Setting persists across app restarts
- [ ] Default is "2.5-flash"
- [ ] TypeScript compiles without errors
- [ ] Settings save/load via IPC works correctly

## Files to Create/Modify
- `src/store/useSettingsStore.ts` - Add geminiModel field
- `electron/main/ipc/settings-handlers.ts` - Handle new setting
- `src/store/__tests__/useSettingsStore.test.ts` - Test persistence

## Testing Requirements
Verify setting persists, loads, and updates correctly
