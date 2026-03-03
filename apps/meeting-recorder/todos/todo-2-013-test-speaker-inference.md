# Task: Test speaker inference from Gemini analysis

**Phase**: 2
**Priority**: Medium
**Estimated Complexity**: Medium

## Context
Verify Gemini Stage 2 correctly identifies speakers from text patterns. Design doc specifies this as key AI capability.

## Current State
No test for speaker inference quality.

## What's Missing/Needed
Unit test:
- Provide raw transcript with clear speaker patterns
- Verify analyzeTranscript identifies speakers
- Verify speaker names in TranscriptionResult
- Verify speaker continuity across chunks

## Dependencies
- [ ] Task: Add analyzeTranscript method

## Acceptance Criteria
- [ ] Test provides multi-speaker transcript
- [ ] Test verifies segments have speaker names
- [ ] Test verifies speakers are distinct
- [ ] Test verifies "Speaker 1", "Speaker 2" pattern
- [ ] Test passes

## Files to Create/Modify
- `electron/main/services/__tests__/ai-provider-speakers.test.ts` - NEW

## Testing Requirements
Mock transcript with clear speaker turns and verify identification
