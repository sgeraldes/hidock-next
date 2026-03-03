# Task: Add Google Cloud credentials to settings

**Phase**: 2
**Priority**: High
**Estimated Complexity**: Medium

## Context
Users need to provide Google Cloud Project ID and API key for Chirp 3. Design doc specifies new settings fields.

## Current State
Settings store has AI provider settings but not Google Cloud specific.

## What's Missing/Needed
Add settings fields:
- googleCloudProjectId: string
- googleCloudApiKey: string
- transcriptionBackend: "chirp3+gemini" | "gemini-multimodal"

## Dependencies
- [ ] Phase 1 settings tasks completed

## Acceptance Criteria
- [ ] useSettingsStore has googleCloudProjectId field
- [ ] useSettingsStore has googleCloudApiKey field
- [ ] useSettingsStore has transcriptionBackend field
- [ ] Settings persist across app restarts
- [ ] Default backend is "gemini-multimodal" (safe fallback)
- [ ] TypeScript compiles without errors

## Files to Create/Modify
- `src/store/useSettingsStore.ts` - Add Google Cloud fields
- `electron/main/ipc/settings-handlers.ts` - Handle new settings
- `src/store/__tests__/useSettingsStore.test.ts` - Test persistence

## Testing Requirements
Verify settings save, load, and persist correctly
