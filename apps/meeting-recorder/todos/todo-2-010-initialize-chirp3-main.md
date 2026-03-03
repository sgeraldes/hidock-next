# Task: Initialize Chirp3Provider in main process

**Phase**: 2
**Priority**: High
**Estimated Complexity**: Medium

## Context
Chirp3Provider needs to be created and configured when app starts. Design doc specifies main process initialization.

## Current State
No initialization of Chirp3Provider.

## What's Missing/Needed
Create and configure Chirp3Provider instance on app startup:
- Read Google Cloud settings
- Initialize SpeechClient with credentials
- Register with transcription pipeline
- Handle credential errors gracefully

## Dependencies
- [ ] Task: Create chirp3-provider.ts
- [ ] Task: Add Google Cloud credentials to settings

## Acceptance Criteria
- [ ] Chirp3Provider instantiated on app start
- [ ] Reads googleCloudProjectId and googleCloudApiKey from settings
- [ ] Initializes SpeechClient correctly
- [ ] Graceful error if credentials missing/invalid
- [ ] Provider available to transcription pipeline
- [ ] No crashes on startup

## Files to Create/Modify
- `electron/main/index.ts` - Initialize Chirp3Provider
- `electron/main/ipc/transcription-handlers.ts` - Wire provider to handlers

## Testing Requirements
Test initialization with valid and invalid credentials
