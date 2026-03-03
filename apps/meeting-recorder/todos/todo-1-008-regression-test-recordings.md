# Task: Regression test - existing recordings still work

**Phase**: 1
**Priority**: High
**Estimated Complexity**: Medium

## Context
Ensure upgrade doesn't break existing recordings or transcriptions. Design doc specifies backward compatibility as critical.

## Current State
Existing recordings use Gemini 2.0 format.

## What's Missing/Needed
Integration test that runs full transcription pipeline with new models.

## Dependencies
- [ ] All Phase 1 tasks 1-7

## Acceptance Criteria
- [ ] Test loads existing session data
- [ ] Test re-transcribes with Gemini 2.5
- [ ] Test verifies format matches expectations
- [ ] Test verifies no data loss
- [ ] Test passes with mock audio
- [ ] No transcription errors or exceptions

## Files to Create/Modify
- `electron/main/__tests__/transcription-regression.test.ts` - NEW
- Integration test for full pipeline

## Testing Requirements
Run full transcription flow: audio → Gemini → database → UI
