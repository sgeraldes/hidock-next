# Task: Create chirp3-provider.ts service

**Phase**: 2
**Priority**: High
**Estimated Complexity**: High

## Context
Core service for Chirp 3 streaming speech recognition. Design doc specifies this as main integration point.

## Current State
File doesn't exist.

## What's Missing/Needed
Create new service with Chirp3Provider class implementing:
- SpeechClient initialization
- Stream setup and management
- Audio chunk writing
- Result handling and callbacks

## Dependencies
- [ ] Task: Install @google-cloud/speech dependency

## Acceptance Criteria
- [ ] Chirp3Provider class exists
- [ ] Has private client: SpeechClient field
- [ ] Has startStream(config) method
- [ ] Has writeAudioChunk(buffer) method
- [ ] Has private handleData() callback
- [ ] TypeScript compiles without errors
- [ ] Unit tests exist

## Files to Create/Modify
- `electron/main/services/chirp3-provider.ts` - NEW file
- `electron/main/services/__tests__/chirp3-provider.test.ts` - NEW test file

## Testing Requirements
Unit test verifying class instantiates and methods exist
