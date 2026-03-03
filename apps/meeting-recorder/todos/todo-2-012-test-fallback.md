# Task: Test fallback to Gemini multimodal

**Phase**: 2
**Priority**: High
**Estimated Complexity**: Medium

## Context
Verify graceful degradation when Chirp 3 unavailable. Design doc specifies fallback strategy.

## Current State
No test for fallback behavior.

## What's Missing/Needed
Integration test:
- Simulate Chirp 3 unavailable (missing/wrong credentials)
- Verify pipeline falls back to Gemini multimodal
- Verify transcription completes successfully
- Verify no errors in console

## Dependencies
- [ ] Task: Modify pipeline for two-stage processing
- [ ] Task: Test Chirp 3 e2e

## Acceptance Criteria
- [ ] Test simulates missing Chirp 3 credentials
- [ ] Test verifies fallback to Gemini multimodal
- [ ] Test verifies transcription works
- [ ] Test verifies TranscriptionResult format
- [ ] No crashes or uncaught errors
- [ ] User sees graceful error message

## Files to Create/Modify
- `electron/main/__tests__/chirp3-fallback.test.ts` - NEW
- `electron/main/services/transcription-pipeline.ts` - May need error handling

## Testing Requirements
Test with missing, invalid, and expired Chirp 3 credentials
