# Task: Update IPC handlers for Chirp 3 settings

**Phase**: 2
**Priority**: High
**Estimated Complexity**: Low

## Context
IPC handlers need to persist/retrieve new Google Cloud settings. Design doc specifies backend-frontend sync.

## Current State
IPC handlers exist for AI provider settings.

## What's Missing/Needed
Add handlers for googleCloudProjectId, googleCloudApiKey, transcriptionBackend.

## Dependencies
- [ ] Task: Add Google Cloud credentials to settings

## Acceptance Criteria
- [ ] settings:get returns Google Cloud fields
- [ ] settings:set persists Google Cloud fields
- [ ] settings:getAll includes Google Cloud settings
- [ ] IPC calls work from renderer
- [ ] TypeScript compiles without errors

## Files to Create/Modify
- `electron/main/ipc/settings-handlers.ts` - Add Google Cloud handlers
- `electron/main/ipc/__tests__/settings-handlers.test.ts` - Test IPC

## Testing Requirements
Test IPC calls for get/set Google Cloud settings
