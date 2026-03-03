# Task: Test Chirp 3 transcription end-to-end

**Phase**: 2
**Priority**: High
**Estimated Complexity**: High

## Context
Verify full two-stage pipeline works: audio → Chirp 3 → Gemini → result. Design doc specifies this as critical integration test.

## Current State
No end-to-end test for Chirp 3 flow.

## What's Missing/Needed
Integration test:
- Send 10-second mock audio to pipeline
- Verify Chirp 3 receives audio
- Verify Gemini analysis triggered
- Verify TranscriptionResult produced
- Verify result has speakers, topics, actions

## Dependencies
- [ ] All Phase 2 tasks 1-10

## Acceptance Criteria
- [ ] Integration test file exists
- [ ] Test sends mock audio through pipeline
- [ ] Test verifies Chirp 3 STT output
- [ ] Test verifies Gemini analysis output
- [ ] Test verifies TranscriptionResult format
- [ ] Test passes with mock credentials
- [ ] No errors or exceptions

## Files to Create/Modify
- `electron/main/__tests__/chirp3-integration.test.ts` - NEW
- Mock audio fixtures for testing

## Testing Requirements
Full pipeline test with mocked Chirp 3 and Gemini APIs
